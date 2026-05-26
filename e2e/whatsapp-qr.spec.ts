import { expect, test } from '@playwright/test';
import { API_URL, getSeedWhatsappInstance, loginApi, prisma } from './support/e2e-env';

test('generates a WhatsApp QR code through the project API', async ({ request }) => {
  const session = await loginApi(request);
  const instance = await getSeedWhatsappInstance();
  await prisma.whatsappInstance.update({
    where: { id: instance.id },
    data: {
      companyId: session.activeCompany!.id,
      apiKey: null,
      providerInstanceId: null,
      status: 'CREATED',
      qrCode: null,
      lastError: null,
    },
  });

  const response = await request.post(`${API_URL}/whatsapp/instances/${instance.id}/qrcode`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });

  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { status: string; qrCode?: string | null; lastError?: string | null };
  expect(body.status).toBe('QR_PENDING');
  expect(body.qrCode).toContain('data:image/png;base64,');
  expect(body.lastError).toBeNull();
});

test('does not mark a disconnected Evolution instance as connected', async ({ request }) => {
  const session = await loginApi(request);
  const instance = await getSeedWhatsappInstance();
  await prisma.whatsappInstance.update({
    where: { id: instance.id },
    data: {
      companyId: session.activeCompany!.id,
      apiKey: 'e2e-instance-token',
      providerInstanceId: 'e2e-provider-created',
      status: 'CONNECTED',
      qrCode: null,
      lastError: null,
    },
  });

  const response = await request.get(`${API_URL}/whatsapp/instances/${instance.id}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });

  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { status: string; qrCode?: string | null; lastError?: string | null };
  expect(body.status).toBe('DISCONNECTED');
});

test('keeps QR pending when Evolution is connected but not logged in', async ({ request }) => {
  const session = await loginApi(request);
  const instance = await getSeedWhatsappInstance();
  const existingQrCode = 'data:image/png;base64,eTJlLXBlbmRpbmc=';
  await prisma.whatsappInstance.update({
    where: { id: instance.id },
    data: {
      companyId: session.activeCompany!.id,
      apiKey: 'e2e-instance-token',
      providerInstanceId: 'e2e-provider-not-logged-in',
      status: 'CONNECTED',
      qrCode: existingQrCode,
      lastError: null,
    },
  });

  const response = await request.get(`${API_URL}/whatsapp/instances/${instance.id}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });

  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { status: string; qrCode?: string | null; lastError?: string | null };
  expect(body.status).toBe('QR_PENDING');
  expect(body.qrCode).toBe(existingQrCode);
  expect(body.lastError).toBeNull();
});
