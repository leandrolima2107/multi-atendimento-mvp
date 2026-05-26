import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

type AnyRecord = Record<string, unknown>;

@Injectable()
export class WebhookProcessor {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
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
      } else if (eventName.includes('CONNECTION') || eventName.includes('CONNECTED') || eventName.includes('DISCONNECTED')) {
        await this.handleConnection(event.whatsappInstanceId, payload);
      } else if (eventName.includes('UPDATE')) {
        await this.handleMessageUpdate(event.companyId!, payload);
      } else if (eventName.includes('MESSAGE') || eventName.includes('MESSAGES')) {
        await this.handleMessage(event.companyId!, event.whatsappInstanceId!, payload);
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
      data: { status: 'QR_PENDING', qrCode: qrCode || null },
    });
  }

  private async handleConnection(instanceId: string | null, payload: AnyRecord) {
    if (!instanceId) {
      return;
    }
    const data = payload.data as AnyRecord | undefined;
    const state = String(data?.state ?? data?.status ?? payload.status ?? payload.event ?? '').toUpperCase();
    const status = ['OPEN', 'CONNECTED', 'ONLINE'].includes(state) ? 'CONNECTED' : 'DISCONNECTED';
    const disconnectReason =
      status === 'CONNECTED'
        ? null
        : stringOrUndefined(data?.disconnect_reason) ??
          stringOrUndefined(data?.disconnectReason) ??
          stringOrUndefined(data?.reason);
    const instance = await this.prisma.whatsappInstance.update({
      where: { id: instanceId },
      data: { status, qrCode: status === 'CONNECTED' ? null : undefined, lastError: disconnectReason },
    });
    this.realtime.emitToCompany(instance.companyId, 'whatsapp:status', instance);
  }

  private async handleMessage(companyId: string, whatsappInstanceId: string, payload: AnyRecord) {
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
          whatsappInstanceId,
          status: 'QUEUED',
        },
      }));

    const message = await this.prisma.message.create({
      data: {
        companyId,
        conversationId: conversation.id,
        whatsappInstanceId,
        externalId: messagePayload.externalId,
        direction: 'INBOUND',
        type: messagePayload.type,
        status: 'RECEIVED',
        providerStatus: messagePayload.providerStatus,
        body: messagePayload.body,
        mediaUrl: messagePayload.mediaUrl,
        raw: payload as any,
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: message.createdAt, status: conversation.status === 'CLOSED' ? 'QUEUED' : conversation.status },
    });

    this.realtime.emitToCompany(companyId, 'message:new', { conversationId: conversation.id, message });
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
    const text =
      stringOrUndefined(message.conversation) ??
      stringOrUndefined((message.extendedTextMessage as AnyRecord | undefined)?.text) ??
      stringOrUndefined((message.imageMessage as AnyRecord | undefined)?.caption) ??
      stringOrUndefined(data.text) ??
      stringOrUndefined(data.body);

    const mediaUrl =
      stringOrUndefined(data.mediaUrl) ??
      stringOrUndefined((message.imageMessage as AnyRecord | undefined)?.url) ??
      stringOrUndefined((message.documentMessage as AnyRecord | undefined)?.url);

    const type = mediaUrl ? 'MEDIA' : 'TEXT';

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
      type: type as 'TEXT' | 'MEDIA',
      providerStatus: stringOrUndefined(data.status) ?? stringOrUndefined(payload.status),
    };
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
  return remoteJid.split('@')[0].split(':')[0];
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
