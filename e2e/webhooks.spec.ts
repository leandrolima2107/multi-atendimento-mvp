import { expect, test } from '@playwright/test';
import {
  API_URL,
  getSeedWhatsappInstance,
  loginApi,
  postEvolutionWebhook,
  prisma,
  uniqueId,
  waitForCount,
} from './support/e2e-env';

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('rejects webhook with invalid secret', async ({ request }) => {
  const instance = await getSeedWhatsappInstance();
  const response = await request.post(`${API_URL}/webhooks/evolution/${instance.id}`, {
    params: { secret: 'wrong-secret' },
    data: { event: 'Message', data: { Info: { ID: uniqueId('invalid') } } },
  });

  expect(response.status()).toBe(401);
});

test('ignores group and fromMe messages without creating business records', async ({ request }) => {
  const before = {
    leads: await prisma.lead.count(),
    conversations: await prisma.conversation.count(),
    messages: await prisma.message.count(),
  };

  await postEvolutionWebhook(request, {
    event: 'Message',
    data: {
      Info: {
        ID: uniqueId('group'),
        Chat: '120363000000000000@g.us',
        Sender: '559999999999@s.whatsapp.net',
        IsFromMe: false,
        PushName: 'Participante Grupo',
      },
      Message: { conversation: 'mensagem de grupo ignorada' },
    },
  });

  await postEvolutionWebhook(request, {
    event: 'SendMessage',
    data: {
      Info: {
        ID: uniqueId('from-me'),
        Chat: '559888888888@s.whatsapp.net',
        Sender: '5569993451747:40@s.whatsapp.net',
        IsFromMe: true,
        PushName: 'Meu número',
      },
      Message: { conversation: 'eco ignorado' },
    },
  });

  await waitForCount('lead count unchanged', () => prisma.lead.count(), before.leads);
  await waitForCount('conversation count unchanged', () => prisma.conversation.count(), before.conversations);
  await waitForCount('message count unchanged', () => prisma.message.count(), before.messages);
});

test('creates one inbound conversation and dedupes repeated external id', async ({ request }) => {
  const externalId = uniqueId('inbound');
  const phone = `559${Math.floor(10000000 + Math.random() * 89999999)}`;
  const body = `Mensagem E2E ${externalId}`;
  const beforeMessages = await prisma.message.count();

  const first = await postEvolutionWebhook(request, {
    event: 'Message',
    data: {
      Info: {
        ID: externalId,
        Chat: `${phone}@s.whatsapp.net`,
        Sender: `${phone}@s.whatsapp.net`,
        IsFromMe: false,
        PushName: 'Lead E2E',
      },
      Message: { conversation: body },
    },
  });
  expect(first.ok).toBe(true);

  await waitForCount('message created once', () => prisma.message.count(), beforeMessages + 1);

  const replay = await postEvolutionWebhook(request, {
    event: 'Message',
    data: {
      Info: {
        ID: externalId,
        Chat: `${phone}@s.whatsapp.net`,
        Sender: `${phone}@s.whatsapp.net`,
        IsFromMe: false,
        PushName: 'Lead E2E',
      },
      Message: { conversation: body },
    },
  });

  expect(replay.replay).toBe(true);
  await waitForCount('duplicate ignored', () => prisma.message.count(), beforeMessages + 1);

  const message = await prisma.message.findUnique({
    where: { companyId_externalId: { companyId: (await getSeedWhatsappInstance()).companyId, externalId } },
    include: { conversation: { include: { lead: true } } },
  });

  expect(message?.direction).toBe('INBOUND');
  expect(message?.body).toBe(body);
  expect(message?.conversation.status).toBe('QUEUED');
  expect(message?.conversation.lead.phone).toBe(phone);
});

test('stores inbound WhatsApp image webhook as media message', async ({ request }) => {
  const externalId = uniqueId('inbound-media');
  const phone = `559${Math.floor(10000000 + Math.random() * 89999999)}`;
  const caption = `Comprovante ${externalId}`;

  await postEvolutionWebhook(request, {
    event: 'Message',
    data: {
      Info: {
        ID: externalId,
        Chat: `${phone}@s.whatsapp.net`,
        Sender: `${phone}@s.whatsapp.net`,
        IsFromMe: false,
        PushName: 'Lead com mídia',
      },
      Message: {
        imageMessage: {
          caption,
          url: `https://cdn.example.test/${externalId}.jpg`,
          mimetype: 'image/jpeg',
          fileLength: 12345,
        },
      },
    },
  });

  const instance = await getSeedWhatsappInstance();
  await expect
    .poll(async () =>
      prisma.message.findUnique({
        where: { companyId_externalId: { companyId: instance.companyId, externalId } },
      }),
    )
    .toMatchObject({
      direction: 'INBOUND',
      type: 'IMAGE',
      status: 'RECEIVED',
      body: caption,
      mediaUrl: `https://cdn.example.test/${externalId}.jpg`,
      mediaMimeType: 'image/jpeg',
      mediaSize: 12345,
      caption,
    });
});

test('sends outbound document media through backend', async ({ request }) => {
  const externalId = uniqueId('outbound-media-seed');
  const phone = `559${Math.floor(10000000 + Math.random() * 89999999)}`;
  const instance = await getSeedWhatsappInstance();
  await prisma.whatsappInstance.update({
    where: { id: instance.id },
    data: { status: 'CONNECTED', providerInstanceId: 'e2e-provider-connected', apiKey: null },
  });

  await postEvolutionWebhook(request, {
    event: 'Message',
    data: {
      Info: {
        ID: externalId,
        Chat: `${phone}@s.whatsapp.net`,
        Sender: `${phone}@s.whatsapp.net`,
        IsFromMe: false,
        PushName: 'Lead mídia outbound',
      },
      Message: { conversation: 'Pode enviar o comprovante?' },
    },
  });

  await expect
    .poll(async () => {
      const conversation = await prisma.conversation.findFirst({
        where: { companyId: instance.companyId, lead: { remoteJid: `${phone}@s.whatsapp.net` } },
      });
      return Boolean(conversation);
    })
    .toBe(true);
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { companyId: instance.companyId, lead: { remoteJid: `${phone}@s.whatsapp.net` } },
  });
  const session = await loginApi(request);
  const fileBytes = Buffer.from('comprovante e2e', 'utf8');
  const response = await request.post(`${API_URL}/atendimentos/conversations/${conversation.id}/media`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    data: {
      type: 'document',
      fileName: 'comprovante.txt',
      mimeType: 'text/plain',
      size: fileBytes.byteLength,
      dataBase64: fileBytes.toString('base64'),
      caption: 'Comprovante',
    },
  });

  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body).toMatchObject({
    direction: 'OUTBOUND',
    type: 'DOCUMENT',
    status: 'SENT',
    caption: 'Comprovante',
    mediaMimeType: 'text/plain',
    mediaFileName: 'comprovante.txt',
    mediaSize: fileBytes.byteLength,
  });
  expect(body.mediaUrl).toContain('/atendimentos/media/');
  expect(JSON.stringify(body)).not.toContain('e2e-local-evolution-key');
});

test('maps disconnected connection events without false connected status', async ({ request }) => {
  const instance = await getSeedWhatsappInstance();
  await prisma.whatsappInstance.update({
    where: { id: instance.id },
    data: { status: 'CONNECTED', qrCode: null, lastError: null },
  });

  await postEvolutionWebhook(request, {
    event: 'Connection',
    data: {
      state: 'DISCONNECTED',
      reason: 'QR code limit reached (5)',
      id: uniqueId('connection'),
    },
  });

  await expect
    .poll(async () => {
      const updated = await prisma.whatsappInstance.findUnique({ where: { id: instance.id } });
      return updated?.status;
    })
    .toBe('DISCONNECTED');

  const updated = await prisma.whatsappInstance.findUnique({ where: { id: instance.id } });
  expect(updated?.lastError).toBe('QR code limit reached (5)');
});
