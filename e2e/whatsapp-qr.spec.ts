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

test('stores connected phone and profile returned by Evolution', async ({ request }) => {
  const session = await loginApi(request);
  const instance = await getSeedWhatsappInstance();
  await prisma.whatsappInstance.update({
    where: { id: instance.id },
    data: {
      companyId: session.activeCompany!.id,
      apiKey: 'e2e-instance-token',
      providerInstanceId: 'e2e-provider-connected',
      status: 'QR_PENDING',
      qrCode: 'data:image/png;base64,eTJlLXBlbmRpbmc=',
      phoneNumber: null,
      profileName: null,
      lastSyncedAt: null,
      lastError: null,
    },
  });

  const response = await request.get(`${API_URL}/whatsapp/instances/${instance.id}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });

  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    status: string;
    phoneNumber?: string | null;
    profileName?: string | null;
    lastSyncedAt?: string | null;
  };
  expect(body.status).toBe('CONNECTED');
  expect(body.phoneNumber).toBe('5569993451747');
  expect(body.profileName).toBe('Leandro Celulares');
  expect(body.lastSyncedAt).toBeTruthy();
});

test('fills connected identity when Evolution splits name and jid across endpoints', async ({ request }) => {
  const session = await loginApi(request);
  const instance = await getSeedWhatsappInstance();
  await prisma.whatsappInstance.update({
    where: { id: instance.id },
    data: {
      companyId: session.activeCompany!.id,
      apiKey: 'e2e-instance-token',
      providerInstanceId: 'e2e-provider-connected-by-all',
      status: 'CONNECTED',
      qrCode: null,
      phoneNumber: null,
      profileName: null,
      lastSyncedAt: null,
      lastError: null,
    },
  });

  const response = await request.get(`${API_URL}/whatsapp/instances`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });

  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as Array<{
    id: string;
    status: string;
    phoneNumber?: string | null;
    profileName?: string | null;
  }>;
  const updated = body.find((row) => row.id === instance.id);
  expect(updated?.status).toBe('CONNECTED');
  expect(updated?.phoneNumber).toBe('5569993949151');
  expect(updated?.profileName).toBe('Leandro celulares');
});

test('disconnects a connected WhatsApp instance without exposing Evolution credentials', async ({ request }) => {
  const session = await loginApi(request);
  const instance = await getSeedWhatsappInstance();
  await prisma.whatsappInstance.update({
    where: { id: instance.id },
    data: {
      companyId: session.activeCompany!.id,
      apiKey: 'e2e-instance-token',
      providerInstanceId: 'e2e-provider-connected',
      status: 'CONNECTED',
      qrCode: null,
      phoneNumber: '5569993451747',
      profileName: 'Leandro Celulares',
      lastError: null,
    },
  });

  const response = await request.post(`${API_URL}/whatsapp/instances/${instance.id}/disconnect`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });

  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    status: string;
    phoneNumber?: string | null;
    profileName?: string | null;
    apiKey?: string;
    webhookSecret?: string;
  };
  expect(body.status).toBe('DISCONNECTED');
  expect(body.phoneNumber).toBeNull();
  expect(body.profileName).toBeNull();
  expect(body.apiKey).toBeUndefined();
  expect(body.webhookSecret).toBeUndefined();
});
