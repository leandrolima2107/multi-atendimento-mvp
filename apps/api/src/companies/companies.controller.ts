import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthUser } from '../auth/auth.types';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto, CreatePlanDto } from './company.dto';

@ApiBearerAuth()
@ApiTags('companies')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Roles('PLATFORM_ADMIN')
  @Get()
  listCompanies() {
    return this.companies.listCompanies();
  }

  @Roles('PLATFORM_ADMIN')
  @Post()
  createCompany(@Body() dto: CreateCompanyDto) {
    return this.companies.createCompany(dto);
  }

  @Get('current')
  current(@CurrentUser() user: AuthUser) {
    if (!user.companyId) {
      return null;
    }
    return this.companies.companyOverview(user.companyId);
  }

  @Roles('PLATFORM_ADMIN')
  @Get('plans')
  listPlans() {
    return this.companies.listPlans();
  }

  @Roles('PLATFORM_ADMIN')
  @Post('plans')
  createPlan(@Body() dto: CreatePlanDto) {
    return this.companies.createPlan(dto);
  }
}
