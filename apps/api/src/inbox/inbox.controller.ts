import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { AuthUser } from '../auth/auth.types';
import { InboxService } from './inbox.service';
import { SendMessageDto } from './inbox.dto';

@ApiBearerAuth()
@ApiTags('inbox')
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('inbox')
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
}
