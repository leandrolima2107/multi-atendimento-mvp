import { expect, test } from '@playwright/test';
import { loginAsCompanyAdmin, loginAsPlatformAdmin } from './support/e2e-env';

test('renders login screen with seeded defaults', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Multi Atendimento')).toBeVisible();
  await expect(page.getByPlaceholder('E-mail')).toHaveValue('admin@acme.local');
  await expect(page.getByPlaceholder('Senha')).toHaveValue('admin123');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled();
});

test('logs in as company admin and opens the company shell', async ({ page }) => {
  await loginAsCompanyAdmin(page);

  await expect(page.getByRole('button', { name: 'Inbox' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Leads' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'WhatsApp' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Empresa' })).toBeVisible();
  await expect(page.getByText('Fila de atendimento')).toBeVisible();
});

test('logs in as platform admin and opens the platform shell', async ({ page }) => {
  await loginAsPlatformAdmin(page);

  await expect(page.getByRole('button', { name: 'Empresas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Planos' })).toBeVisible();
  await expect(page.getByText('ACME Atendimento')).toBeVisible();
});

test('shows invalid credentials error', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('E-mail').fill('admin@acme.local');
  await page.getByPlaceholder('Senha').fill('senha-errada');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByText('E-mail ou senha inválidos.')).toBeVisible();
});
