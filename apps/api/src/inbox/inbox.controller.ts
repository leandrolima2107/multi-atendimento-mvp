import { Body, Controller, Get, Header, Param, Post, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { AuthUser } from '../auth/auth.types';
import { InboxService } from './inbox.service';
import { SendMediaMessageDto, SendMessageDto } from './inbox.dto';
import { MediaStorageService } from './media-storage.service';

@ApiBearerAuth()
@ApiTags('atendimentos')
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller(['inbox', 'atendimentos'])
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get('conversations')
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.inbox.list(user.companyId!, status);
  }

  @Get('conversations/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inbox.get(user.companyId!, id);
  }

  @Post('conversations/:id/assign-me')
  assignMe(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inbox.assign(user.companyId!, id, user.id);
  }

  @Post('conversations/:id/close')
  close(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inbox.close(user.companyId!, id);
  }

  @Post('conversations/:id/reopen')
  reopen(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inbox.reopen(user.companyId!, id);
  }

  @Post('conversations/:id/messages')
  send(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.inbox.sendText(user.companyId!, id, user.id, dto.body);
  }

  @Post('conversations/:id/media')
  sendMedia(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendMediaMessageDto) {
    return this.inbox.sendMedia(user.companyId!, id, user.id, dto);
  }
}

@ApiTags('atendimentos')
@Controller(['inbox', 'atendimentos'])
export class InboxMediaController {
  constructor(private readonly mediaStorage: MediaStorageService) {}

  @Get('media/:messageId')
  @Header('Cache-Control', 'private, max-age=60')
  async getMedia(
    @Param('messageId') messageId: string,
    @Query('expires') expires: string | undefined,
    @Query('signature') signature: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const media = await this.mediaStorage.readSignedMedia(messageId, expires, signature);
    response.setHeader('Content-Type', media.mimeType);
    response.setHeader('Content-Length', String(media.size));
    response.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(media.fileName)}"`);
    return new StreamableFile(media.stream);
  }
}
