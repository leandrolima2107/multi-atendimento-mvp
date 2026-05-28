import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { InboxController, InboxMediaController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { MediaStorageService } from './media-storage.service';

@Module({
  imports: [RealtimeModule],
  controllers: [InboxController, InboxMediaController],
  providers: [InboxService, MediaStorageService],
  exports: [InboxService, MediaStorageService],
})
export class InboxModule {}
