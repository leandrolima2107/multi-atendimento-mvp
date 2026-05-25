import { expect, test } from '@playwright/test';
import { loginAsCompanyAdmin, postEvolutionWebhook, uniqueId } from './support/e2e-env';

test('shows webhook-created inbound conversation in inbox and supports assignment lifecycle', async ({ page, request }) => {
  const externalId = uniqueId('ui-inbox');
  const body = `Atendimento criado pelo E2E ${externalId}`;
  const phone = `5588${Math.floor(10000000 + Math.random() * 89999999)}`;

  await postEvolutionWebhook(request, {
    event: 'Message',
    data: {
      Info: {
        ID: externalId,
        Chat: `${phone}@s.whatsapp.net`,
        Sender: `${phone}@s.whatsapp.net`,
        IsFromMe: false,
        PushName: 'Cliente E2E',
      },
      Message: { conversation: body },
    },
  });

  await loginAsCompanyAdmin(page);

  await expect(page.locator('.messages').getByText(body)).toBeVisible();
  await expect(page.locator('.thread .panel-title').getByText('Cliente E2E', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Assumir' }).click();
  await page.getByRole('button', { name: 'Abertas' }).click();
  await expect(page.locator('.thread').getByText('Admin ACME')).toBeVisible();

  await page.getByRole('button', { name: 'Encerrar' }).click();
  await page.getByRole('button', { name: 'Encerradas' }).click();
  await expect(page.getByRole('button', { name: 'Reabrir' })).toBeVisible();

  await page.getByRole('button', { name: 'Reabrir' }).click();
  await page.getByRole('button', { name: 'Abertas' }).click();
  await expect(page.getByRole('button', { name: 'Encerrar' })).toBeVisible();
});
