import { expect, test } from '@playwright/test';
import { API_URL, getSeedWhatsappInstance, loginApi, prisma, uniqueId } from './support/e2e-env';

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('platform admin manages the global Evolution webhook URL', async ({ request }) => {
  const session = await loginApi(request, 'platform@multi.local');
  const webhookPublicUrl = `${API_URL}/webhooks/evolution-${uniqueId('settings')}`;

  const update = await request.put(`${API_URL}/settings/platform/evolution-webhook`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    data: { webhookPublicUrl },
  });

  expect(update.ok()).toBeTruthy();
  const updateBody = (await update.json()) as {
    evolutionWebhook: { publicUrl: string };
    sync?: { ok?: boolean; updated?: number };
  };
  expect(updateBody.evolutionWebhook.publicUrl).toBe(webhookPublicUrl);
  expect(updateBody.sync?.ok).toBeTruthy();

  const current = await request.get(`${API_URL}/settings/platform`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  expect(current.ok()).toBeTruthy();
  const currentBody = (await current.json()) as { evolutionWebhook: { publicUrl: string } };
  expect(currentBody.evolutionWebhook.publicUrl).toBe(webhookPublicUrl);

  const manualSync = await request.post(`${API_URL}/settings/platform/evolution-webhook/sync`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  expect(manualSync.ok()).toBeTruthy();
});

test('webhook sync does not start QR for newly created connections', async ({ request }) => {
  const session = await loginApi(request, 'platform@multi.local');
  const company = await prisma.company.findUniqueOrThrow({ where: { slug: 'acme' } });
  const instanceKey = uniqueId('created-sync');
  const instance = await prisma.whatsappInstance.create({
    data: {
      companyId: company.id,
      name: 'Conexão recém-criada',
      instanceKey,
      providerInstanceId: uniqueId('provider'),
      apiKey: 'e2e-instance-token',
      webhookSecret: uniqueId('secret'),
      status: 'CREATED',
    },
  });

  const response = await request.post(`${API_URL}/settings/platform/evolution-webhook/sync`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });

  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { ok?: boolean; updated?: number };
  expect(body.ok).toBeTruthy();
  expect(body.updated).toBe(0);

  const unchanged = await prisma.whatsappInstance.findUniqueOrThrow({
    where: { id: instance.id },
    select: { status: true, qrCode: true, lastError: true },
  });
  expect(unchanged.status).toBe('CREATED');
  expect(unchanged.qrCode).toBeNull();
  expect(unchanged.lastError).toBeNull();
  await prisma.whatsappInstance.delete({ where: { id: instance.id } });
});

test('webhook sync supports connected instances authenticated by the global API key', async ({ request }) => {
  const session = await loginApi(request, 'platform@multi.local');
  const instance = await getSeedWhatsappInstance();
  await prisma.whatsappInstance.update({
    where: { id: instance.id },
    data: {
      providerInstanceId: 'e2e-provider-global-key',
      apiKey: null,
      status: 'CONNECTED',
      lastError: null,
    },
  });

  const response = await request.post(`${API_URL}/settings/platform/evolution-webhook/sync`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });

  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { ok?: boolean; updated?: number; error?: string };
  expect(body.ok).toBeTruthy();
  expect(body.updated).toBe(1);
  expect(body.error).toBeUndefined();
});

test('company admin cannot change platform settings', async ({ request }) => {
  const session = await loginApi(request);
  const response = await request.get(`${API_URL}/settings/platform`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });

  expect(response.status()).toBe(403);
});
