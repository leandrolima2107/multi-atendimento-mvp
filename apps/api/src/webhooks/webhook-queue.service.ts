import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { WebhookProcessor } from './webhook.processor';

@Injectable()
export class WebhookQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookQueueService.name);
  private connection?: IORedis;
  private queue?: Queue<{ eventId: string }>;
  private worker?: Worker<{ eventId: string }>;

  constructor(
    private readonly config: ConfigService,
    private readonly processor: WebhookProcessor,
  ) {}

  onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn('REDIS_URL ausente; webhooks serão processados inline.');
      return;
    }

    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue('evolution-webhooks', { connection: this.connection });
    this.worker = new Worker('evolution-webhooks', (job: Job<{ eventId: string }>) => this.processor.process(job.data.eventId), {
      connection: this.connection,
      concurrency: 5,
    });
  }

  async enqueue(eventId: string, dedupeKey?: string) {
    if (!this.queue) {
      await this.processor.process(eventId);
      return;
    }
    await this.queue.add('process', { eventId }, { jobId: dedupeKey ?? eventId, attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit();
  }
}
