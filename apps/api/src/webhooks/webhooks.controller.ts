import { Body, Controller, Headers, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookQueueService } from './webhook-queue.service';

@ApiTags('webhooks')
@Controller('webhooks/evolution')
export class WebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: WebhookQueueService,
  ) {}

  @Post(':instanceKey')
  async receive(
    @Param('instanceKey') instanceKey: string,
    @Body() payload: Record<string, unknown>,
    @Headers('x-webhook-secret') webhookSecret?: string,
    @Query('secret') querySecret?: string,
  ) {
    const instance = await this.prisma.whatsappInstance.findFirst({
      where: {
        OR: [{ instanceKey }, { id: instanceKey }],
      },
    });

    if (!instance) {
      throw new UnauthorizedException('Instancia desconhecida.');
    }

    const providedSecret = webhookSecret ?? querySecret;
    if (providedSecret !== instance.webhookSecret) {
      throw new UnauthorizedException('Webhook secret invalido.');
    }

    const eventType = String(payload.event ?? payload.type ?? payload.eventType ?? 'UNKNOWN');
    const externalId = extractExternalId(payload);

    if (externalId) {
      const existing = await this.prisma.webhookEvent.findFirst({
        where: {
          whatsappInstanceId: instance.id,
          eventType,
          externalId,
        },
      });

      if (existing) {
        if (existing.status !== 'PROCESSED') {
          await this.queue.enqueue(existing.id, `${instance.id}:${eventType}:${externalId}`);
        }
        return { ok: true, eventId: existing.id, replay: true };
      }
    }

    const event = await this.prisma.webhookEvent.create({
      data: {
        companyId: instance.companyId,
        whatsappInstanceId: instance.id,
        eventType,
        externalId,
        payload: payload as any,
      },
    });

    await this.queue.enqueue(event.id, externalId ? `${instance.id}:${eventType}:${externalId}` : undefined);

    return { ok: true, eventId: event.id };
  }
}

function extractExternalId(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | undefined;
  const key = data?.key as Record<string, unknown> | undefined;
  const info = data?.Info as Record<string, unknown> | undefined;
  return typeof key?.id === 'string'
    ? key.id
    : typeof info?.ID === 'string'
      ? info.ID
      : undefined;
}
