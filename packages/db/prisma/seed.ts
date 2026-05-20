import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 10);

  const plan = await prisma.plan.upsert({
    where: { slug: 'starter' },
    update: {},
    create: {
      name: 'Starter',
      slug: 'starter',
      maxWhatsappInstances: 1,
      maxUsers: 5,
    },
  });

  const company = await prisma.company.upsert({
    where: { slug: 'acme' },
    update: { planId: plan.id },
    create: {
      name: 'ACME Atendimento',
      slug: 'acme',
      planId: plan.id,
    },
  });

  for (const stage of [
    { name: 'Novo lead', position: 1 },
    { name: 'Em atendimento', position: 2 },
    { name: 'Fechado', position: 3 },
  ]) {
    await prisma.pipelineStage.upsert({
      where: { companyId_position: { companyId: company.id, position: stage.position } },
      update: { name: stage.name },
      create: { companyId: company.id, ...stage },
    });
  }

  for (const tag of [
    { name: 'Urgente', color: '#dc2626' },
    { name: 'Venda', color: '#16a34a' },
  ]) {
    await prisma.tag.upsert({
      where: { companyId_name: { companyId: company.id, name: tag.name } },
      update: { color: tag.color },
      create: { companyId: company.id, ...tag },
    });
  }

  const platform = await prisma.user.upsert({
    where: { email: 'platform@multi.local' },
    update: {
      name: 'Admin Plataforma',
      platformRole: 'PLATFORM_ADMIN',
      isActive: true,
    },
    create: {
      name: 'Admin Plataforma',
      email: 'platform@multi.local',
      passwordHash,
      platformRole: 'PLATFORM_ADMIN',
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@acme.local' },
    update: {
      name: 'Admin ACME',
      isActive: true,
    },
    create: {
      name: 'Admin ACME',
      email: 'admin@acme.local',
      passwordHash,
    },
  });

  const agent = await prisma.user.upsert({
    where: { email: 'agent@acme.local' },
    update: {
      name: 'Atendente ACME',
      isActive: true,
    },
    create: {
      name: 'Atendente ACME',
      email: 'agent@acme.local',
      passwordHash,
    },
  });

  await prisma.companyMember.upsert({
    where: { companyId_userId: { companyId: company.id, userId: admin.id } },
    update: {},
    create: { companyId: company.id, userId: admin.id, role: 'COMPANY_ADMIN' },
  });

  await prisma.companyMember.upsert({
    where: { companyId_userId: { companyId: company.id, userId: agent.id } },
    update: {},
    create: { companyId: company.id, userId: agent.id, role: 'AGENT' },
  });

  const existingWhatsapp = await prisma.whatsappInstance.findFirst({
    where: { companyId: company.id },
  });

  if (!existingWhatsapp) {
    await prisma.whatsappInstance.create({
      data: {
        companyId: company.id,
        name: 'WhatsApp principal',
        instanceKey: 'acme-main',
        webhookSecret: 'dev-webhook-secret',
        status: 'CREATED',
      },
    });
  }

  console.log({ platform: platform.email, admin: admin.email, agent: agent.email });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
