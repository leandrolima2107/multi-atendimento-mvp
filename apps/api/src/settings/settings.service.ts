import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export const EVOLUTION_WEBHOOK_PUBLIC_URL_KEY = 'evolution.webhookPublicUrl';
export const EVOLUTION_WEBHOOK_LAST_SYNCED_URL_KEY = 'evolution.webhookLastSyncedUrl';
export const EVOLUTION_WEBHOOK_LAST_SYNC_STATUS_KEY = 'evolution.webhookLastSyncStatus';
export const EVOLUTION_WEBHOOK_LAST_SYNC_AT_KEY = 'evolution.webhookLastSyncAt';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getAdminSettings() {
    const [
      configuredUrl,
      lastSyncedUrl,
      lastSyncStatus,
      lastSyncAt,
    ] = await Promise.all([
      this.findSetting(EVOLUTION_WEBHOOK_PUBLIC_URL_KEY),
      this.findSetting(EVOLUTION_WEBHOOK_LAST_SYNCED_URL_KEY),
      this.findSetting(EVOLUTION_WEBHOOK_LAST_SYNC_STATUS_KEY),
      this.findSetting(EVOLUTION_WEBHOOK_LAST_SYNC_AT_KEY),
    ]);
    const envUrl = this.config.get<string>('WEBHOOK_PUBLIC_URL');

    return {
      evolutionWebhook: {
        publicUrl: configuredUrl?.value ?? envUrl ?? this.defaultWebhookPublicUrl(),
        source: configuredUrl ? 'DATABASE' : envUrl ? 'ENV' : 'DEFAULT',
        updatedAt: configuredUrl?.updatedAt ?? null,
        lastSyncedUrl: lastSyncedUrl?.value ?? null,
        lastSyncStatus: lastSyncStatus?.value ?? null,
        lastSyncAt: lastSyncAt?.value ?? null,
      },
    };
  }

  async getEvolutionWebhookPublicUrl() {
    const configuredUrl = await this.findSetting(EVOLUTION_WEBHOOK_PUBLIC_URL_KEY);
    return configuredUrl?.value ?? this.config.get<string>('WEBHOOK_PUBLIC_URL') ?? this.defaultWebhookPublicUrl();
  }

  async updateEvolutionWebhookPublicUrl(webhookPublicUrl: string, updatedById: string) {
    const normalizedUrl = this.normalizeWebhookPublicUrl(webhookPublicUrl);
    await this.prisma.platformSetting.upsert({
      where: { key: EVOLUTION_WEBHOOK_PUBLIC_URL_KEY },
      update: {
        value: normalizedUrl,
        updatedById,
      },
      create: {
        key: EVOLUTION_WEBHOOK_PUBLIC_URL_KEY,
        value: normalizedUrl,
        updatedById,
      },
    });

    return this.getAdminSettings();
  }

  async markEvolutionWebhookSync(status: string, syncedUrl?: string) {
    const timestamp = new Date().toISOString();
    const operations = [
      this.upsertSetting(EVOLUTION_WEBHOOK_LAST_SYNC_STATUS_KEY, status),
      this.upsertSetting(EVOLUTION_WEBHOOK_LAST_SYNC_AT_KEY, timestamp),
    ];

    if (syncedUrl) {
      operations.push(this.upsertSetting(EVOLUTION_WEBHOOK_LAST_SYNCED_URL_KEY, syncedUrl));
    }

    await Promise.all(operations);
  }

  private findSetting(key: string) {
    return this.prisma.platformSetting.findUnique({ where: { key } });
  }

  private upsertSetting(key: string, value: string) {
    return this.prisma.platformSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  private normalizeWebhookPublicUrl(value: string) {
    return value.trim().replace(/\/+$/, '');
  }

  private defaultWebhookPublicUrl() {
    return 'http://localhost:4100/webhooks/evolution';
  }
}
