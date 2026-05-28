import { Module } from '@nestjs/common';
import { InboxModule } from '../inbox/inbox.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WebhookProcessor } from './webhook.processor';
import { WebhookQueueService } from './webhook-queue.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [RealtimeModule, InboxModule],
  controllers: [WebhooksController],
  providers: [WebhookProcessor, WebhookQueueService],
})
export class WebhooksModule {}
