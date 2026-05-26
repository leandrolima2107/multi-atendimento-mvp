import { expect, test } from '@playwright/test';
import { API_URL, loginApi, prisma, uniqueId } from './support/e2e-env';

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

test('company admin cannot change platform settings', async ({ request }) => {
  const session = await loginApi(request);
  const response = await request.get(`${API_URL}/settings/platform`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });

  expect(response.status()).toBe(403);
});
