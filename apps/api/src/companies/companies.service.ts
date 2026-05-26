import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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

  async createCompany(dto: CreateCompanyDto) {
    if (dto.planId) {
      const plan = await this.prisma.plan.findUnique({
        where: { id: dto.planId },
        select: { id: true, isActive: true },
      });

      if (!plan) {
        throw new BadRequestException("Plano informado não existe.");
      }

      if (!plan.isActive) {
        throw new BadRequestException("Plano informado está inativo.");
      }
    }

    try {
      return await this.prisma.company.create({
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
    } catch (error) {
      this.handleUniqueConflict(error, "Empresa");
    }
  }

  listPlans() {
    return this.prisma.plan.findMany({ orderBy: { createdAt: "asc" } });
  }

  async createPlan(dto: CreatePlanDto) {
    try {
      return await this.prisma.plan.create({ data: dto });
    } catch (error) {
      this.handleUniqueConflict(error, "Plano");
    }
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

  private handleUniqueConflict(error: unknown, entity: string): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ConflictException(`${entity} com identificador já cadastrado.`);
    }

    throw error;
  }
}
