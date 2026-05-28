import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { TenantGuard } from "../auth/tenant.guard";
import { AuthUser } from "../auth/auth.types";
import { CreateWhatsappInstanceDto } from "./whatsapp.dto";
import { WhatsappService } from "./whatsapp.service";

@ApiBearerAuth()
@ApiTags("whatsapp")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller("whatsapp")
export class WhatsappController {
  constructor(private readonly whatsapp: WhatsappService) {}

  @Roles("COMPANY_ADMIN")
  @Get("instances")
  list(@CurrentUser() user: AuthUser) {
    return this.whatsapp.list(user.companyId!);
  }

  @Roles("COMPANY_ADMIN")
  @Post("instances")
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWhatsappInstanceDto,
  ) {
    return this.whatsapp.create(user.companyId!, dto);
  }

  @Roles("COMPANY_ADMIN")
  @Post("instances/:id/connect")
  connect(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.whatsapp.connect(user.companyId!, id);
  }

  @Roles("COMPANY_ADMIN")
  @Post("instances/:id/qrcode")
  requestQrCode(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.whatsapp.requestQrCode(user.companyId!, id);
  }

  @Roles("COMPANY_ADMIN")
  @Post("instances/:id/disconnect")
  disconnect(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.whatsapp.disconnect(user.companyId!, id);
  }

  @Roles("COMPANY_ADMIN")
  @Get("instances/:id")
  status(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.whatsapp.refreshStatus(user.companyId!, id);
  }
}
