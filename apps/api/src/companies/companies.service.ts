import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCompanyDto, CreatePlanDto } from "./company.dto";

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  listCompanies() {
    return this.prisma.company.findMany({
      include: {
        plan: true,
        _count: {
          select: {
            members: true,
            whatsappInstances: true,
            leads: true,
            conversations: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  createCompany(dto: CreateCompanyDto) {
    return this.prisma.company.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        planId: dto.planId,
        pipelineStages: {
          create: [
            { name: "Novo lead", position: 1 },
            { name: "Em atendimento", position: 2 },
            { name: "Fechado", position: 3 },
          ],
        },
      },
      include: { plan: true },
    });
  }

  listPlans() {
    return this.prisma.plan.findMany({ orderBy: { createdAt: "asc" } });
  }

  createPlan(dto: CreatePlanDto) {
    return this.prisma.plan.create({ data: dto });
  }

  companyOverview(companyId: string) {
    return this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: {
        plan: true,
        _count: {
          select: {
            members: true,
            whatsappInstances: true,
            leads: true,
            conversations: true,
          },
        },
      },
    });
  }
}
