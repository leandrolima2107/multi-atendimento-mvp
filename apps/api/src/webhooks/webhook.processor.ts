import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Message, MessageType, Prisma, WhatsappInstance } from '@prisma/client';
import { MediaStorageService } from '../inbox/media-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

type AnyRecord = Record<string, unknown>;

@Injectable()
export class WebhookProcessor {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly mediaStorage: MediaStorageService,
    private readonly config: ConfigService,
  ) {}

  async process(eventId: string) {
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: eventId },
      include: { whatsappInstance: true },
    });

    if (!event || event.status === 'PROCESSED') {
      return;
    }

    try {
      const payload = event.payload as AnyRecord;
      const eventName = String(payload.event ?? payload.type ?? payload.eventType ?? event.eventType).toUpperCase();

      if (eventName.includes('QRCODE')) {
        await this.handleQrCode(event.whatsappInstanceId, payload);
      } else if (eventName.includes('CONNECTION') || eventName.includes('CONNECTED') || eventName.includes('DISCONNECTED') || eventName.includes('PAIR')) {
        await this.handleConnection(event.whatsappInstanceId, payload);
      } else if (eventName.includes('UPDATE')) {
        await this.handleMessageUpdate(event.companyId!, payload);
      } else if (eventName.includes('MESSAGE') || eventName.includes('MESSAGES')) {
        await this.handleMessage(event.companyId!, event.whatsappInstance!, payload);
      }

      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      this.logger.error(message);
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: 'FAILED', error: message },
      });
      throw error;
    }
  }

  private async handleQrCode(instanceId: string | null, payload: AnyRecord) {
    if (!instanceId) {
      return;
    }
    const data = payload.data as AnyRecord | undefined;
    const qrCode = String(data?.qrcode ?? data?.code ?? payload.qrcode ?? payload.code ?? '');
    await this.prisma.whatsappInstance.update({
      where: { id: instanceId },
      data: { status: 'QR_PENDING', qrCode: qrCode || null, lastSyncedAt: new Date() },
    });
  }

  private async handleConnection(instanceId: string | null, payload: AnyRecord) {
    if (!instanceId) {
      return;
    }
    const data = payload.data as AnyRecord | undefined;
    const state = String(data?.state ?? data?.status ?? payload.status ?? payload.event ?? '').toUpperCase();
    const status = ['OPEN', 'CONNECTED', 'ONLINE', 'PAIRSUCCESS'].includes(state) || eventLooksPaired(payload) ? 'CONNECTED' : 'DISCONNECTED';
    const disconnectReason =
      status === 'CONNECTED'
        ? null
        : stringOrUndefined(data?.disconnect_reason) ??
          stringOrUndefined(data?.disconnectReason) ??
          stringOrUndefined(data?.reason);
    const phoneNumber = status === 'CONNECTED' ? normalizePhoneFromJid(stringOrUndefined(data?.jid) ?? stringOrUndefined(data?.ID) ?? stringOrUndefined(data?.JID) ?? stringOrUndefined(data?.ownerJid) ?? stringOrUndefined(data?.phoneNumber) ?? stringOrUndefined(data?.phone) ?? stringOrUndefined(data?.number) ?? '') : undefined;
    const profileName =
      status === 'CONNECTED'
        ? stringOrUndefined(data?.BusinessName) ??
          stringOrUndefined(data?.Name) ??
          stringOrUndefined(data?.profileName) ??
          stringOrUndefined(data?.pushName) ??
          stringOrUndefined(data?.displayName) ??
          stringOrUndefined(data?.name)
        : undefined;
    const instance = await this.prisma.whatsappInstance.update({
      where: { id: instanceId },
      data: {
        status,
        qrCode: status === 'CONNECTED' ? null : undefined,
        phoneNumber,
        profileName,
        lastError: disconnectReason,
        lastSyncedAt: new Date(),
      },
    });
    this.realtime.emitToCompany(instance.companyId, 'whatsapp:status', instance);
  }

  private async handleMessage(companyId: string, whatsappInstance: WhatsappInstance, payload: AnyRecord) {
    const messagePayload = this.extractMessagePayload(payload);
    const remoteJid = messagePayload.remoteJid;

    if (!remoteJid || messagePayload.isGroup || messagePayload.fromMe) {
      return;
    }

    if (messagePayload.externalId) {
      const existing = await this.prisma.message.findUnique({
        where: { companyId_externalId: { companyId, externalId: messagePayload.externalId } },
      });
      if (existing) {
        return;
      }
    }

    const phone = normalizePhoneFromJid(remoteJid);
    const lead = await this.prisma.lead.upsert({
      where: { companyId_remoteJid: { companyId, remoteJid } },
      update: {
        name: messagePayload.pushName ?? undefined,
        phone,
      },
      create: {
        companyId,
        remoteJid,
        phone,
        name: messagePayload.pushName,
      },
    });

    const conversation =
      (await this.prisma.conversation.findFirst({
        where: { companyId, leadId: lead.id, status: { not: 'CLOSED' } },
        orderBy: { createdAt: 'desc' },
      })) ??
      (await this.prisma.conversation.create({
        data: {
          companyId,
          leadId: lead.id,
          whatsappInstanceId: whatsappInstance.id,
          status: 'QUEUED',
        },
      }));

    let message = await this.prisma.message.create({
      data: {
        companyId,
        conversationId: conversation.id,
        whatsappInstanceId: whatsappInstance.id,
        externalId: messagePayload.externalId,
        direction: 'INBOUND',
        type: messagePayload.type as MessageType,
        status: 'RECEIVED',
        providerStatus: messagePayload.providerStatus,
        body: messagePayload.body,
        mediaUrl: messagePayload.mediaUrl,
        mediaMimeType: messagePayload.mediaMimeType,
        mediaFileName: messagePayload.mediaFileName,
        mediaSize: messagePayload.mediaSize,
        caption: messagePayload.caption,
        raw: payload as Prisma.InputJsonValue,
      },
    });

    if (messagePayload.mediaUrl) {
      try {
        const stored = await this.mediaStorage.storeRemote({
          companyId,
          conversationId: conversation.id,
          messageId: message.id,
          sourceUrl: messagePayload.mediaUrl,
          fileName: messagePayload.mediaFileName,
          mimeType: messagePayload.mediaMimeType,
          apiKey: whatsappInstance.apiKey ?? this.config.get<string>('EVOLUTION_GLOBAL_API_KEY'),
          providerInstanceId: whatsappInstance.providerInstanceId,
        });
        if (stored) {
          message = await this.prisma.message.update({
            where: { id: message.id },
            data: stored,
          });
        }
      } catch (error) {
        this.logger.warn(`Não foi possível armazenar mídia recebida: ${this.errorMessage(error)}`);
      }
    }

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: message.createdAt, status: conversation.status === 'CLOSED' ? 'QUEUED' : conversation.status },
    });

    this.realtime.emitToCompany(companyId, 'message:new', {
      conversationId: conversation.id,
      message: this.messageForClient(message),
    });
  }

  private async handleMessageUpdate(companyId: string, payload: AnyRecord) {
    const messagePayload = this.extractMessagePayload(payload);
    if (!messagePayload.externalId) {
      return;
    }

    const status = mapProviderStatus(messagePayload.providerStatus);
    if (!status) {
      return;
    }

    const message = await this.prisma.message.findUnique({
      where: { companyId_externalId: { companyId, externalId: messagePayload.externalId } },
    });

    if (!message) {
      return;
    }

    const now = new Date();
    const updated = await this.prisma.message.update({
      where: { id: message.id },
      data: {
        status,
        providerStatus: messagePayload.providerStatus,
        deliveredAt: status === 'DELIVERED' ? now : undefined,
        readAt: status === 'READ' ? now : undefined,
      },
    });

    this.realtime.emitToCompany(companyId, 'message:updated', { conversationId: updated.conversationId, message: updated });
  }

  private extractMessagePayload(payload: AnyRecord) {
    const data = (payload.data as AnyRecord | undefined) ?? payload;
    const info = (data.Info as AnyRecord | undefined) ?? {};
    const key = (data.key as AnyRecord | undefined) ?? {};
    const remoteJid =
      stringOrUndefined(key.remoteJid) ??
      stringOrUndefined(info.Chat) ??
      stringOrUndefined(data.remoteJid) ??
      stringOrUndefined(data.chatId) ??
      stringOrUndefined(info.Sender);
    const message = (data.message as AnyRecord | undefined) ?? (data.Message as AnyRecord | undefined) ?? data;
    const imageMessage = message.imageMessage as AnyRecord | undefined;
    const audioMessage = message.audioMessage as AnyRecord | undefined;
    const videoMessage = message.videoMessage as AnyRecord | undefined;
    const documentMessage = message.documentMessage as AnyRecord | undefined;
    const stickerMessage = message.stickerMessage as AnyRecord | undefined;
    const locationMessage = message.locationMessage as AnyRecord | undefined;
    const contactMessage = message.contactMessage as AnyRecord | undefined;
    const contactsArrayMessage = message.contactsArrayMessage as AnyRecord | undefined;
    const mediaMessage = imageMessage ?? audioMessage ?? videoMessage ?? documentMessage ?? stickerMessage;
    const caption = stringOrUndefined(mediaMessage?.caption);
    const locationBody = locationMessage
      ? formatLocationMessage(locationMessage)
      : undefined;
    const contactRecord = contactMessage ?? contactsArrayMessage;
    const contactBody = contactRecord ? formatContactMessage(contactRecord) : undefined;
    const text =
      stringOrUndefined(message.conversation) ??
      stringOrUndefined((message.extendedTextMessage as AnyRecord | undefined)?.text) ??
      caption ??
      locationBody ??
      contactBody ??
      stringOrUndefined(data.text) ??
      stringOrUndefined(data.body);

    const mediaUrl =
      stringOrUndefined(data.mediaUrl) ??
      stringOrUndefined(data.url) ??
      stringOrUndefined(mediaMessage?.url) ??
      stringOrUndefined(mediaMessage?.mediaUrl);

    const type = resolveMessageType(message, mediaUrl);

    return {
      externalId: stringOrUndefined(key.id) ?? stringOrUndefined(info.ID) ?? stringOrUndefined(data.id),
      remoteJid,
      fromMe: booleanValue(key.fromMe ?? info.IsFromMe ?? data.fromMe),
      isGroup:
        isGroupJid(remoteJid) ||
        booleanValue(info.IsGroup ?? data.isGroup) ||
        isGroupJid(stringOrUndefined(info.Chat)) ||
        isGroupJid(stringOrUndefined(data.chatId)),
      pushName: stringOrUndefined(data.pushName) ?? stringOrUndefined(info.PushName) ?? stringOrUndefined(data.name),
      body: text,
      mediaUrl,
      mediaMimeType:
        stringOrUndefined(data.mediaMimeType) ??
        stringOrUndefined(data.mimetype) ??
        stringOrUndefined(data.mimeType) ??
        stringOrUndefined(mediaMessage?.mimetype) ??
        stringOrUndefined(mediaMessage?.mimeType),
      mediaFileName:
        stringOrUndefined(data.fileName) ??
        stringOrUndefined(data.filename) ??
        stringOrUndefined(mediaMessage?.fileName) ??
        stringOrUndefined(mediaMessage?.filename),
      mediaSize: integerOrUndefined(data.mediaSize ?? data.fileLength ?? data.fileSize ?? mediaMessage?.fileLength ?? mediaMessage?.fileSize),
      caption,
      type,
      providerStatus: stringOrUndefined(data.status) ?? stringOrUndefined(payload.status),
    };
  }

  private messageForClient(message: Message) {
    const safeMessage = { ...message } as Record<string, unknown>;
    delete safeMessage.raw;
    delete safeMessage.storagePath;
    delete safeMessage.companyId;
    delete safeMessage.conversationId;
    delete safeMessage.whatsappInstanceId;
    delete safeMessage.externalId;
    delete safeMessage.mediaUrl;
    return {
      ...safeMessage,
      mediaUrl: this.mediaStorage.signedUrlFor(message),
    };
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}

function stringOrUndefined(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function booleanValue(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return ['true', '1', 'yes'].includes(value.toLowerCase());
  }
  return Boolean(value);
}

function isGroupJid(value?: string) {
  return Boolean(value?.includes('@g.us'));
}

function normalizePhoneFromJid(remoteJid: string) {
  const digits = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
  return digits.length >= 8 ? digits : undefined;
}

function numberOrUndefined(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function integerOrUndefined(value: unknown) {
  const parsed = numberOrUndefined(value);
  return parsed === undefined ? undefined : Math.round(parsed);
}

function resolveMessageType(message: AnyRecord, mediaUrl?: string) {
  if (message.imageMessage) return 'IMAGE';
  if (message.audioMessage) return 'AUDIO';
  if (message.videoMessage) return 'VIDEO';
  if (message.documentMessage) return 'DOCUMENT';
  if (message.stickerMessage) return 'STICKER';
  if (message.locationMessage) return 'LOCATION';
  if (message.contactMessage || message.contactsArrayMessage) return 'CONTACT';
  if (mediaUrl) return 'UNKNOWN';
  return 'TEXT';
}

function formatLocationMessage(locationMessage: AnyRecord) {
  const latitude = numberOrUndefined(locationMessage.degreesLatitude ?? locationMessage.latitude);
  const longitude = numberOrUndefined(locationMessage.degreesLongitude ?? locationMessage.longitude);
  if (latitude === undefined || longitude === undefined) {
    return 'Localização compartilhada';
  }
  return `Localização compartilhada: ${latitude}, ${longitude}`;
}

function formatContactMessage(contactMessage: AnyRecord) {
  return (
    stringOrUndefined(contactMessage.displayName) ??
    stringOrUndefined(contactMessage.name) ??
    'Contato compartilhado'
  );
}

function eventLooksPaired(payload: AnyRecord) {
  const eventName = String(payload.event ?? payload.type ?? payload.eventType ?? '').toUpperCase();
  return eventName.includes('PAIR') || eventName.includes('OPEN');
}

function mapProviderStatus(status?: string) {
  const normalized = status?.toUpperCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes('READ')) {
    return 'READ';
  }
  if (normalized.includes('DELIVER')) {
    return 'DELIVERED';
  }
  if (normalized.includes('ERROR') || normalized.includes('FAIL')) {
    return 'FAILED';
  }
  if (normalized.includes('PENDING') || normalized.includes('SERVER') || normalized.includes('SENT')) {
    return 'SENT';
  }
  return undefined;
}
