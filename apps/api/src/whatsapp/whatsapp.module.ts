import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [SettingsModule],
  controllers: [WhatsappController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
