import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  EVOLUTION_WEBHOOK_LAST_SYNCED_URL_KEY,
  SettingsService,
} from './settings.service';
import { PrismaService } from '../prisma/prisma.service';

const EVOLUTION_WEBHOOK_EVENTS = [
  'MESSAGE',
  'SEND_MESSAGE',
  'CONNECTION',
  'QRCODE',
  'READ_RECEIPT',
];

@Injectable()
export class EvolutionWebhookSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EvolutionWebhookSyncService.name);
  private interval?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const intervalMs = this.syncIntervalMs();
    this.interval = setInterval(() => {
      void this.syncIfChanged('cron');
    }, intervalMs);
    void this.syncIfChanged('startup');
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  async syncIfChanged(reason = 'manual') {
    if (this.isRunning) {
      return { ok: false, skipped: true, reason: 'sync-already-running' };
    }

    this.isRunning = true;
    try {
      const webhookPublicUrl = await this.settings.getEvolutionWebhookPublicUrl();
      const lastSynced = await this.prisma.platformSetting.findUnique({
        where: { key: EVOLUTION_WEBHOOK_LAST_SYNCED_URL_KEY },
      });

      if (lastSynced?.value === webhookPublicUrl && reason === 'cron') {
        return {
          ok: true,
          skipped: true,
          reason: 'unchanged',
          webhookPublicUrl,
        };
      }

      const syncResult = await this.applyWebhookUrl(webhookPublicUrl);
      const status = syncResult.ok
        ? `OK: ${syncResult.updated} instância(s) atualizada(s) por ${reason}.`
        : `ERRO: ${syncResult.error}`;

      await this.settings.markEvolutionWebhookSync(
        status,
        syncResult.ok ? webhookPublicUrl : undefined,
      );

      return { ...syncResult, webhookPublicUrl };
    } finally {
      this.isRunning = false;
    }
  }

  private async applyWebhookUrl(webhookPublicUrl: string) {
    const baseUrl = this.config.get<string>('EVOLUTION_BASE_URL');
    if (!baseUrl) {
      return { ok: false, updated: 0, error: 'EVOLUTION_BASE_URL não configurado.' };
    }
    const globalApiKey = this.config.get<string>('EVOLUTION_GLOBAL_API_KEY');

    const reachabilityError = this.webhookReachabilityError(baseUrl, webhookPublicUrl);
    if (reachabilityError) {
      return { ok: false, updated: 0, error: reachabilityError };
    }

    const instances = await this.prisma.whatsappInstance.findMany({
      where: {
        providerInstanceId: { not: null },
        status: { in: ['QR_PENDING', 'CONNECTED'] },
      },
      select: {
        id: true,
        instanceKey: true,
        providerInstanceId: true,
        apiKey: true,
        webhookSecret: true,
      },
    });

    let updated = 0;
    const failures: string[] = [];

    for (const instance of instances) {
      const apiKey = instance.apiKey ?? globalApiKey;
      if (!apiKey) {
        failures.push(`${instance.instanceKey}: chave da Evolution ausente`);
        continue;
      }

      try {
        await this.configureInstanceWebhook({
          providerInstanceId: instance.providerInstanceId!,
          apiKey,
          webhookUrl: `${webhookPublicUrl}/${instance.id}?secret=${instance.webhookSecret}`,
        });
        await this.prisma.whatsappInstance.update({
          where: { id: instance.id },
          data: { lastError: null },
        });
        updated += 1;
      } catch (error) {
        const message = this.errorMessage(error);
        failures.push(`${instance.instanceKey}: ${message}`);
        await this.prisma.whatsappInstance.update({
          where: { id: instance.id },
          data: { lastError: `Falha ao atualizar webhook Evolution: ${message}` },
        });
      }
    }

    if (failures.length) {
      const error = failures.slice(0, 3).join(' | ');
      this.logger.warn(error);
      return { ok: false, updated, error };
    }

    return { ok: true, updated };
  }

  private configureInstanceWebhook({
    providerInstanceId,
    apiKey,
    webhookUrl,
  }: {
    providerInstanceId: string;
    apiKey: string;
    webhookUrl: string;
  }) {
    const baseUrl = this.config.get<string>('EVOLUTION_BASE_URL')!;

    return axios.post(
      `${baseUrl}/instance/connect`,
      {
        webhookUrl,
        subscribe: EVOLUTION_WEBHOOK_EVENTS,
        immediate: false,
      },
      {
        headers: {
          apikey: apiKey,
          instanceId: providerInstanceId,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      },
    );
  }

  private webhookReachabilityError(evolutionBaseUrl: string, webhookUrl: string) {
    const evolutionHost = this.hostname(evolutionBaseUrl);
    const webhookHost = this.hostname(webhookUrl);

    if (!evolutionHost || !webhookHost) {
      return 'URL pública do webhook inválida.';
    }

    if (this.isInternalHost(webhookHost) && !this.isInternalHost(evolutionHost)) {
      return 'WEBHOOK_PUBLIC_URL aponta para uma URL local/interna, mas a Evolution Go configurada é remota. Configure uma URL pública da API antes de sincronizar.';
    }

    return null;
  }

  private hostname(value: string) {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  private isLocalHost(hostname: string) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost');
  }

  private isInternalHost(hostname: string) {
    return this.isLocalHost(hostname) || hostname === 'host.docker.internal' || !hostname.includes('.') || this.isPrivateIpv4(hostname);
  }

  private isPrivateIpv4(hostname: string) {
    const parts = hostname.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return false;
    }

    const [first, second] = parts;
    return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
  }

  private errorMessage(error: unknown) {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data as { message?: string | string[]; error?: string } | string | undefined;
      if (typeof data === 'string') {
        return data;
      }
      if (Array.isArray(data?.message)) {
        return data.message.join(' ');
      }
      return data?.message ?? data?.error ?? error.message;
    }
    return error instanceof Error ? error.message : 'Erro desconhecido.';
  }

  private syncIntervalMs() {
    const configured = Number(this.config.get('EVOLUTION_WEBHOOK_SYNC_INTERVAL_MS'));
    return Number.isFinite(configured) && configured >= 10000 ? configured : 60000;
  }
}
