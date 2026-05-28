import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import axios from 'axios';
import crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SendMediaMessageDto } from './inbox.dto';
import { MediaStorageService } from './media-storage.service';

type ConversationStatusValue = 'QUEUED' | 'OPEN' | 'CLOSED';
type OutboundMediaType = 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT';
type MessageWithStorage = {
  id: string;
  companyId: string;
  conversationId?: string;
  whatsappInstanceId?: string;
  externalId?: string | null;
  mediaUrl?: string | null;
  storagePath?: string | null;
};

const OUTBOUND_MEDIA_TYPES: Record<SendMediaMessageDto['type'], OutboundMediaType> = {
  image: 'IMAGE',
  audio: 'AUDIO',
  video: 'VIDEO',
  document: 'DOCUMENT',
};

const BLOCKED_DOCUMENT_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.exe', '.js', '.msi', '.ps1', '.scr', '.sh', '.vbs']);

const SAFE_WHATSAPP_INSTANCE_SELECT = {
  id: true,
  name: true,
  status: true,
  phoneNumber: true,
  profileName: true,
} as const;

const MESSAGE_SELECT = {
  id: true,
  companyId: true,
  conversationId: true,
  whatsappInstanceId: true,
  senderId: true,
  externalId: true,
  direction: true,
  type: true,
  status: true,
  providerStatus: true,
  body: true,
  mediaUrl: true,
  mediaMimeType: true,
  mediaFileName: true,
  mediaSize: true,
  caption: true,
  storagePath: true,
  error: true,
  sentAt: true,
  deliveredAt: true,
  readAt: true,
  createdAt: true,
  sender: { select: { id: true, name: true } },
} as const;

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  async list(companyId: string, status?: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        companyId,
        status: this.normalizeStatus(status),
      },
      include: {
        lead: { include: { tags: { include: { tag: true } }, pipelineStage: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        whatsappInstance: { select: SAFE_WHATSAPP_INSTANCE_SELECT },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: MESSAGE_SELECT },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });

    return conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => this.decorateMessage(message)),
    }));
  }

  async get(companyId: string, id: string) {
    const conversation = await this.prisma.conversation.findFirstOrThrow({
      where: { id, companyId },
      include: {
        lead: { include: { tags: { include: { tag: true } }, pipelineStage: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        whatsappInstance: { select: SAFE_WHATSAPP_INSTANCE_SELECT },
        messages: { orderBy: { createdAt: 'asc' }, select: MESSAGE_SELECT },
      },
    });

    return {
      ...conversation,
      messages: conversation.messages.map((message) => this.decorateMessage(message)),
    };
  }

  async assign(companyId: string, conversationId: string, userId: string) {
    await this.ensureConversation(companyId, conversationId);

    const conversation = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { assignedToId: userId, status: 'OPEN' },
      include: { lead: true, assignedTo: { select: { id: true, name: true } } },
    });

    this.realtime.emitToCompany(companyId, 'conversation:updated', conversation);
    return conversation;
  }

  async close(companyId: string, conversationId: string) {
    await this.ensureConversation(companyId, conversationId);
    const conversation = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    this.realtime.emitToCompany(companyId, 'conversation:updated', conversation);
    return conversation;
  }

  async reopen(companyId: string, conversationId: string) {
    await this.ensureConversation(companyId, conversationId);
    const conversation = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'OPEN', closedAt: null },
    });
    this.realtime.emitToCompany(companyId, 'conversation:updated', conversation);
    return conversation;
  }

  async sendText(companyId: string, conversationId: string, senderId: string, body: string) {
    const conversation = await this.getSendableConversation(companyId, conversationId);
    const authKey = this.getEvolutionAuthKey(conversation.whatsappInstance.apiKey);
    const number = conversation.lead.phone ?? conversation.lead.remoteJid.split('@')[0];
    const idempotencyKey = crypto.randomUUID();
    const message = await this.prisma.message.create({
      data: {
        companyId,
        conversationId,
        whatsappInstanceId: conversation.whatsappInstanceId,
        senderId,
        idempotencyKey,
        direction: 'OUTBOUND',
        type: 'TEXT',
        status: 'PENDING',
        body,
      },
      select: MESSAGE_SELECT,
    });

    this.realtime.emitToCompany(companyId, 'message:new', { conversationId, message: this.decorateMessage(message) });

    try {
      const response = await this.sendEvolutionText(
        conversation.whatsappInstance.providerInstanceId!,
        authKey,
        number,
        body,
        idempotencyKey,
      );
      const sentMessage = await this.markSent(message.id, conversationId, response);
      this.realtime.emitToCompany(companyId, 'message:updated', { conversationId, message: sentMessage });
      return sentMessage;
    } catch (error) {
      const failedMessage = await this.markFailed(message.id, this.errorMessage(error));
      this.realtime.emitToCompany(companyId, 'message:updated', {
        conversationId,
        message: this.decorateMessage(failedMessage),
      });
      throw new BadRequestException(failedMessage.error ?? 'Não foi possível enviar pelo WhatsApp.');
    }
  }

  async sendMedia(companyId: string, conversationId: string, senderId: string, dto: SendMediaMessageDto) {
    const messageType = OUTBOUND_MEDIA_TYPES[dto.type];
    this.assertOutboundMediaAllowed(dto, messageType);

    const conversation = await this.getSendableConversation(companyId, conversationId);
    const authKey = this.getEvolutionAuthKey(conversation.whatsappInstance.apiKey);
    const number = conversation.lead.phone ?? conversation.lead.remoteJid.split('@')[0];
    const idempotencyKey = crypto.randomUUID();
    const caption = dto.caption?.trim() || undefined;

    const message = await this.prisma.message.create({
      data: {
        companyId,
        conversationId,
        whatsappInstanceId: conversation.whatsappInstanceId,
        senderId,
        idempotencyKey,
        direction: 'OUTBOUND',
        type: messageType,
        status: 'PENDING',
        body: caption,
        caption,
        mediaMimeType: dto.mimeType,
        mediaFileName: dto.fileName,
        mediaSize: dto.size,
      },
      select: MESSAGE_SELECT,
    });

    this.realtime.emitToCompany(companyId, 'message:new', { conversationId, message: this.decorateMessage(message) });

    try {
      const stored = await this.mediaStorage.storeBase64({
        companyId,
        conversationId,
        messageId: message.id,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        declaredSize: dto.size,
        dataBase64: dto.dataBase64,
      });
      const stagedMessage = await this.prisma.message.update({
        where: { id: message.id },
        data: stored,
        select: MESSAGE_SELECT,
      });
      this.realtime.emitToCompany(companyId, 'message:updated', {
        conversationId,
        message: this.decorateMessage(stagedMessage),
      });

      const response = await this.sendEvolutionMedia(
        conversation.whatsappInstance.providerInstanceId!,
        authKey,
        number,
        dto,
        messageType,
        idempotencyKey,
      );
      const sentMessage = await this.markSent(message.id, conversationId, response);
      this.realtime.emitToCompany(companyId, 'message:updated', { conversationId, message: sentMessage });
      return sentMessage;
    } catch (error) {
      const failedMessage = await this.markFailed(message.id, this.errorMessage(error));
      this.realtime.emitToCompany(companyId, 'message:updated', {
        conversationId,
        message: this.decorateMessage(failedMessage),
      });
      throw new BadRequestException(failedMessage.error ?? 'Não foi possível enviar a mídia pelo WhatsApp.');
    }
  }

  private async getSendableConversation(companyId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, companyId },
      include: { whatsappInstance: true, lead: true },
    });

    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada.');
    }

    if (conversation.status === 'CLOSED') {
      throw new BadRequestException('Reabra a conversa antes de enviar mensagem.');
    }

    if (conversation.whatsappInstance.status !== 'CONNECTED') {
      throw new BadRequestException('Conecte seu WhatsApp para enviar e receber mensagens.');
    }

    if (!conversation.whatsappInstance.providerInstanceId) {
      throw new BadRequestException('Conecte seu WhatsApp para enviar e receber mensagens.');
    }

    return conversation;
  }

  private getEvolutionAuthKey(instanceApiKey?: string | null) {
    const authKey = instanceApiKey ?? this.config.get<string>('EVOLUTION_GLOBAL_API_KEY');

    if (!authKey) {
      throw new BadRequestException('Configuração segura do WhatsApp incompleta. Fale com o administrador.');
    }

    return authKey;
  }

  private async sendEvolutionText(providerInstanceId: string, apiKey: string, number: string, text: string, idempotencyKey: string) {
    const baseUrl = this.evolutionBaseUrl();
    const response = await axios.post(
      `${baseUrl}/send/text`,
      { number, text, id: idempotencyKey, formatJid: true },
      { headers: this.evolutionHeaders(apiKey, providerInstanceId), timeout: 15000 },
    );

    return response.data as unknown;
  }

  private async sendEvolutionMedia(
    providerInstanceId: string,
    apiKey: string,
    number: string,
    dto: SendMediaMessageDto,
    messageType: OutboundMediaType,
    idempotencyKey: string,
  ) {
    const endpoint = messageType.toLowerCase();
    const baseUrl = this.evolutionBaseUrl();
    const response = await axios.post(
      `${baseUrl}/send/${endpoint}`,
      {
        number,
        id: idempotencyKey,
        formatJid: true,
        media: this.stripDataUri(dto.dataBase64),
        mimetype: dto.mimeType,
        mimeType: dto.mimeType,
        fileName: dto.fileName,
        caption: dto.caption?.trim() || undefined,
        mediatype: endpoint,
      },
      { headers: this.evolutionHeaders(apiKey, providerInstanceId), timeout: 30000 },
    );

    return response.data as unknown;
  }

  private async markSent(messageId: string, conversationId: string, response: unknown) {
    const externalId = this.extractExternalId(response);
    const providerStatus = this.extractProviderStatus(response);
    const sentMessage = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        externalId,
        providerStatus,
        status: 'SENT',
        raw: response as Prisma.InputJsonValue,
        sentAt: new Date(),
      },
      select: MESSAGE_SELECT,
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: sentMessage.createdAt, status: 'OPEN' },
    });

    return this.decorateMessage(sentMessage);
  }

  private async markFailed(messageId: string, error: string) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: { status: 'FAILED', error },
      select: MESSAGE_SELECT,
    });
  }

  private evolutionBaseUrl() {
    const baseUrl = this.config.get<string>('EVOLUTION_BASE_URL');
    if (!baseUrl) {
      throw new Error('EVOLUTION_BASE_URL não configurado.');
    }
    return baseUrl.replace(/\/$/, '');
  }

  private evolutionHeaders(apiKey: string, providerInstanceId: string) {
    return {
      apikey: apiKey,
      instanceId: providerInstanceId,
      'Content-Type': 'application/json',
    };
  }

  private assertOutboundMediaAllowed(dto: SendMediaMessageDto, messageType: OutboundMediaType) {
    if (dto.size > this.mediaStorage.getMaxBytes()) {
      throw new BadRequestException('O arquivo excede o limite permitido.');
    }

    const mimeType = dto.mimeType.toLowerCase();
    const extension = this.fileExtension(dto.fileName);

    if (BLOCKED_DOCUMENT_EXTENSIONS.has(extension)) {
      throw new BadRequestException('Este tipo de arquivo não pode ser enviado pelo atendimento.');
    }

    if (messageType === 'DOCUMENT') {
      return;
    }

    const expectedPrefix = `${dto.type}/`;
    if (!mimeType.startsWith(expectedPrefix)) {
      throw new BadRequestException('O tipo do arquivo não combina com o envio selecionado.');
    }
  }

  private errorMessage(error: unknown) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        return 'A Evolution Go recusou o envio. Confira a conexão do WhatsApp e tente novamente.';
      }
      if (status && status >= 500) {
        return 'A Evolution Go ficou indisponível por alguns instantes. Tente novamente.';
      }
      return 'Não foi possível concluir o envio na Evolution Go. Tente novamente.';
    }
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      if (typeof response === 'object' && response && 'message' in response) {
        const message = (response as { message?: unknown }).message;
        return Array.isArray(message) ? message.join(' ') : typeof message === 'string' ? message : error.message;
      }
    }
    return error instanceof Error ? error.message : 'Erro desconhecido';
  }

  private async ensureConversation(companyId: string, conversationId: string) {
    const exists = await this.prisma.conversation.findFirst({ where: { id: conversationId, companyId } });
    if (!exists) {
      throw new NotFoundException('Conversa não encontrada.');
    }
  }

  private normalizeStatus(status?: string): ConversationStatusValue | undefined {
    if (!status) {
      return undefined;
    }
    const upper = status.toUpperCase();
    return ['QUEUED', 'OPEN', 'CLOSED'].includes(upper) ? (upper as ConversationStatusValue) : undefined;
  }

  private decorateMessage<T extends MessageWithStorage>(message: T) {
    const signedUrl = this.mediaStorage.signedUrlFor(message);
    const safeMessage = { ...message } as Record<string, unknown>;
    delete safeMessage.storagePath;
    delete safeMessage.companyId;
    delete safeMessage.conversationId;
    delete safeMessage.whatsappInstanceId;
    delete safeMessage.externalId;
    return {
      ...safeMessage,
      mediaUrl: signedUrl,
    };
  }

  private extractExternalId(response: unknown) {
    const root = this.asRecord(response);
    const data = this.asRecord(root?.data);
    const key = this.asRecord(root?.key) ?? this.asRecord(data?.key);
    return this.stringOrUndefined(key?.id) ?? this.stringOrUndefined(root?.id) ?? this.stringOrUndefined(data?.id);
  }

  private extractProviderStatus(response: unknown) {
    const root = this.asRecord(response);
    const data = this.asRecord(root?.data);
    return this.stringOrUndefined(root?.status) ?? this.stringOrUndefined(data?.status);
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  }

  private stringOrUndefined(value: unknown) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private stripDataUri(value: string) {
    return value.includes(',') ? value.split(',').pop() ?? '' : value;
  }

  private fileExtension(fileName: string) {
    const index = fileName.lastIndexOf('.');
    return index >= 0 ? fileName.slice(index).toLowerCase() : '';
  }
}
