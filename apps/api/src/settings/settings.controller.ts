import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { EvolutionWebhookSyncService } from './evolution-webhook-sync.service';
import { SettingsService } from './settings.service';
import { UpdateEvolutionWebhookUrlDto } from './settings.dto';

@ApiBearerAuth()
@ApiTags('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PLATFORM_ADMIN')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly webhookSync: EvolutionWebhookSyncService,
  ) {}

  @Get('platform')
  getPlatformSettings() {
    return this.settings.getAdminSettings();
  }

  @Put('platform/evolution-webhook')
  async updateEvolutionWebhook(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateEvolutionWebhookUrlDto,
  ) {
    await this.settings.updateEvolutionWebhookPublicUrl(
      dto.webhookPublicUrl,
      user.id,
    );
    const sync = await this.webhookSync.syncIfChanged('admin-update');
    const settings = await this.settings.getAdminSettings();
    return { ...settings, sync };
  }

  @Post('platform/evolution-webhook/sync')
  syncEvolutionWebhook() {
    return this.webhookSync.syncIfChanged('manual');
  }
}
