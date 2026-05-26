import { expect, test } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { API_URL, loginApi, prisma, uniqueId } from './support/e2e-env';

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('restricts platform plans API to platform admins', async ({ request }) => {
  const session = await loginApi(request, 'admin@acme.local');

  const response = await request.get(`${API_URL}/companies/plans`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });

  expect(response.status()).toBe(403);
});

test('rejects creating another WhatsApp instance after the plan limit is reached', async ({ request }) => {
  const session = await loginApi(request, 'admin@acme.local');

  const response = await request.post(`${API_URL}/whatsapp/instances`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    data: { name: 'WhatsApp extra' },
  });

  expect(response.status()).toBe(400);
  expect(await response.text()).toContain('Limite de conexões WhatsApp do plano atingido.');
});

test('requires a company plan before creating WhatsApp instances', async ({ request }) => {
  const id = uniqueId('sem-plano');
  const email = `${id}@multi.local`;
  const passwordHash = await bcrypt.hash('admin123', 10);
  const company = await prisma.company.create({
    data: {
      name: `Empresa sem plano ${id}`,
      slug: id,
    },
  });
  const user = await prisma.user.create({
    data: {
      name: 'Admin sem plano',
      email,
      passwordHash,
    },
  });
  await prisma.companyMember.create({
    data: {
      companyId: company.id,
      userId: user.id,
      role: 'COMPANY_ADMIN',
    },
  });
  const session = await loginApi(request, email);

  const response = await request.post(`${API_URL}/whatsapp/instances`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    data: { name: 'WhatsApp sem plano' },
  });

  expect(response.status()).toBe(400);
  expect(await response.text()).toContain('Defina um plano para a empresa antes de criar conexões WhatsApp.');
});

test('blocks login for suspended companies', async ({ request }) => {
  const company = await prisma.company.findUniqueOrThrow({ where: { slug: 'acme' } });

  try {
    await prisma.company.update({
      where: { id: company.id },
      data: { status: 'SUSPENDED' },
    });

    const response = await request.post(`${API_URL}/auth/login`, {
      data: { email: 'admin@acme.local', password: 'admin123' },
    });

    expect(response.status()).toBe(401);
    expect(await response.text()).toContain('Empresa indisponível para acesso.');
  } finally {
    await prisma.company.update({
      where: { id: company.id },
      data: { status: 'ACTIVE' },
    });
  }
});
