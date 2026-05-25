import { expect, test } from '@playwright/test';
import {
  API_URL,
  getSeedWhatsappInstance,
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
