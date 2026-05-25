import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://127.0.0.1:3200';
export const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4200';
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:15432/multi_atendimento_e2e?schema=public';

process.env.DATABASE_URL = E2E_DATABASE_URL;

export const prisma = new PrismaClient({
  datasources: { db: { url: E2E_DATABASE_URL } },
});

export async function loginAsCompanyAdmin(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('E-mail').fill('admin@acme.local');
  await page.getByPlaceholder('Senha').fill('admin123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('ACME Atendimento')).toBeVisible();
}

export async function loginAsPlatformAdmin(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('E-mail').fill('platform@multi.local');
  await page.getByPlaceholder('Senha').fill('admin123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('header').getByText('Plataforma', { exact: true })).toBeVisible();
}

export async function loginApi(request: APIRequestContext, email = 'admin@acme.local') {
  const response = await request.post(`${API_URL}/auth/login`, {
    data: { email, password: 'admin123' },
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{
    accessToken: string;
    activeCompany: { id: string } | null;
    user: { id: string; email: string };
  }>;
}

export async function getSeedWhatsappInstance() {
  const instance = await prisma.whatsappInstance.findFirst({
    where: { instanceKey: 'acme-main' },
    include: { company: true },
  });
  expect(instance).toBeTruthy();
  return instance!;
}

export async function postEvolutionWebhook(request: APIRequestContext, payload: unknown) {
  const instance = await getSeedWhatsappInstance();
  const response = await request.post(`${API_URL}/webhooks/evolution/${instance.id}`, {
    params: { secret: instance.webhookSecret },
    data: payload,
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{ ok: boolean; eventId: string; replay?: boolean }>;
}

export async function waitForCount(label: string, getter: () => Promise<number>, expected: number) {
  await expect
    .poll(getter, {
      message: label,
      timeout: 10_000,
      intervals: [250, 500, 750, 1000],
    })
    .toBe(expected);
}

export function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
