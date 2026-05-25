import { expect, test } from '@playwright/test';
import { getSeedWhatsappInstance, loginAsCompanyAdmin, prisma } from './support/e2e-env';

test('navigates through company MVP screens', async ({ page }) => {
  const instance = await getSeedWhatsappInstance();
  await prisma.whatsappInstance.update({
    where: { id: instance.id },
    data: {
      apiKey: 'e2e-instance-key',
      providerInstanceId: 'e2e-provider-main',
      status: 'CREATED',
      qrCode: null,
      lastError: null,
    },
  });

  await loginAsCompanyAdmin(page);

  await page.getByRole('button', { name: 'Leads' }).click();
  await expect(page.locator('.panel-title').getByText('Leads', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'WhatsApp' }).click();
  await expect(page.getByText('Conexões WhatsApp')).toBeVisible();
  await expect(page.getByText('Starter')).toBeVisible();
  await expect(page.getByText('Números usados')).toBeVisible();
  await expect(page.getByText('1/1')).toBeVisible();
  await expect(page.getByText('Limite do plano atingido.')).toBeVisible();
  await expect(page.getByText('WhatsApp principal')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Criar' })).toBeDisabled();
  await page.getByRole('button', { name: 'Gerar QR' }).click();
  await expect(page.getByText('QR Code gerado.')).toBeVisible();
  await expect(page.getByText('Aguardando QR')).toBeVisible();
  await expect(page.getByAltText('QR Code do WhatsApp')).toBeVisible();

  await page.getByRole('button', { name: 'Empresa' }).click();
  await expect(page.getByText('Checklist de onboarding')).toBeVisible();
  await expect(page.getByText('Equipe cadastrada')).toBeVisible();
});

test('keeps layout usable on mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsCompanyAdmin(page);
  await page.getByRole('button', { name: 'WhatsApp' }).click();

  await expect(page.getByText('Conexões WhatsApp')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
