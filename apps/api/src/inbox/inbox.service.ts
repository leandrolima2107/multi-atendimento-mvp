import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

type ConversationStatusValue = 'QUEUED' | 'OPEN' | 'CLOSED';

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
  ) {}

  list(companyId: string, status?: string) {
    return this.prisma.conversation.findMany({
      where: {
        companyId,
        status: this.normalizeStatus(status),
      },
      include: {
        lead: { include: { tags: { include: { tag: true } }, pipelineStage: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        whatsappInstance: { select: { id: true, name: true, status: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  get(companyId: string, id: string) {
    return this.prisma.conversation.findFirstOrThrow({
      where: { id, companyId },
      include: {
        lead: { include: { tags: { include: { tag: true } }, pipelineStage: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        whatsappInstance: true,
        messages: { orderBy: { createdAt: 'asc' }, include: { sender: { select: { id: true, name: true } } } },
      },
    });
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

    if (!conversation.whatsappInstance.apiKey || !conversation.whatsappInstance.providerInstanceId) {
      throw new BadRequestException('Instância do WhatsApp sem chave de API. Recrie ou reconecte a instância.');
    }

    const number = conversation.lead.phone ?? conversation.lead.remoteJid.split('@')[0];
    const message = await this.prisma.message.create({
      data: {
        companyId,
        conversationId,
        whatsappInstanceId: conversation.whatsappInstanceId,
        senderId,
        idempotencyKey: cryptoRandomId(),
        direction: 'OUTBOUND',
        type: 'TEXT',
        status: 'QUEUED',
        body,
      },
      include: { sender: { select: { id: true, name: true } } },
    });

    this.realtime.emitToCompany(companyId, 'message:new', { conversationId, message });

    try {
      const response = await this.sendEvolutionText(
        conversation.whatsappInstance.providerInstanceId,
        conversation.whatsappInstance.apiKey,
        number,
        body,
        message.idempotencyKey!,
      );
      const externalId = response?.key?.id ?? response?.data?.key?.id;
      const providerStatus = response?.status ?? response?.data?.status;
      const sentMessage = await this.prisma.message.update({
        where: { id: message.id },
        data: {
          externalId: typeof externalId === 'string' ? externalId : undefined,
          providerStatus: typeof providerStatus === 'string' ? providerStatus : undefined,
          status: 'SENT',
          raw: response,
          sentAt: new Date(),
        },
        include: { sender: { select: { id: true, name: true } } },
      });

      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: sentMessage.createdAt, status: 'OPEN' },
      });

      this.realtime.emitToCompany(companyId, 'message:updated', { conversationId, message: sentMessage });
      return sentMessage;
    } catch (error) {
      const failedMessage = await this.prisma.message.update({
        where: { id: message.id },
        data: { status: 'FAILED', error: this.errorMessage(error) },
        include: { sender: { select: { id: true, name: true } } },
      });
      this.realtime.emitToCompany(companyId, 'message:updated', { conversationId, message: failedMessage });
      throw new BadRequestException(`Falha ao enviar pelo WhatsApp: ${failedMessage.error}`);
    }
  }

  private async sendEvolutionText(providerInstanceId: string, apiKey: string, number: string, text: string, idempotencyKey: string) {
    const baseUrl = this.config.get<string>('EVOLUTION_BASE_URL');
    if (!baseUrl) {
      throw new Error('EVOLUTION_BASE_URL não configurado.');
    }

    const response = await axios.post(
      `${baseUrl}/send/text`,
      { number, text, id: idempotencyKey, formatJid: true },
      { headers: { apikey: apiKey, instanceId: providerInstanceId, 'Content-Type': 'application/json' }, timeout: 15000 },
    );

    return response.data;
  }

  private errorMessage(error: unknown) {
    if (axios.isAxiosError(error)) {
      return error.response?.data ? JSON.stringify(error.response.data) : error.message;
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
}

function cryptoRandomId() {
  return crypto.randomUUID();
}
