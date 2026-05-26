import { Module } from '@nestjs/common';
import { EvolutionWebhookSyncService } from './evolution-webhook-sync.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, EvolutionWebhookSyncService],
  exports: [SettingsService],
})
export class SettingsModule {}
