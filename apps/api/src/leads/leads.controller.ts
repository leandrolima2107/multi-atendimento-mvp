import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { AuthUser } from '../auth/auth.types';
import { LeadsService } from './leads.service';
import { UpdateLeadDto } from './leads.dto';

@ApiBearerAuth()
@ApiTags('leads')
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.leads.list(user.companyId!);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leads.update(user.companyId!, id, dto);
  }

  @Get('pipeline/stages')
  pipeline(@CurrentUser() user: AuthUser) {
    return this.leads.pipeline(user.companyId!);
  }
}
