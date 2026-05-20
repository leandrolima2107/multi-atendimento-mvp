import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { WebhookProcessor } from './webhook.processor';
import { WebhookQueueService } from './webhook-queue.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [RealtimeModule],
  controllers: [WebhooksController],
  providers: [WebhookProcessor, WebhookQueueService],
})
export class WebhooksModule {}
