import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateLeadDto } from './leads.dto';

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  list(companyId: string) {
    return this.prisma.lead.findMany({
      where: { companyId },
      include: {
        pipelineStage: true,
        tags: { include: { tag: true } },
        conversations: {
          orderBy: { lastMessageAt: 'desc' },
          take: 1,
          include: { assignedTo: { select: { id: true, name: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async update(companyId: string, id: string, dto: UpdateLeadDto) {
    const lead = await this.prisma.lead.findFirst({ where: { id, companyId } });
    if (!lead) {
      throw new NotFoundException('Lead não encontrado.');
    }

    return this.prisma.lead.update({
      where: { id },
      data: dto,
      include: { pipelineStage: true, tags: { include: { tag: true } } },
    });
  }

  pipeline(companyId: string) {
    return this.prisma.pipelineStage.findMany({
      where: { companyId },
      include: { leads: true },
      orderBy: { position: 'asc' },
    });
  }
}
