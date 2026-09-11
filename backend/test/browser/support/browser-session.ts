import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { PhaseFActor } from './phase-f-fixture.js';
import { resetBrowserAuditRateLimits } from './test.js';

const applicationUrl = 'http://localhost:5173';

export interface RoleBrowserSession {
  context: BrowserContext;
  page: Page;
}

export async function openRoleBrowser(input: {
  browser: Browser;
  actor: PhaseFActor;
  expectedPath: string;
  homeHeading: string;
  viewport: { width: number; height: number };
}): Promise<RoleBrowserSession> {
  // Multiple actors share one CI proxy IP; fast Linux runs otherwise exhaust its login budget.
  await resetBrowserAuditRateLimits(applicationUrl);
  const context = await input.browser.newContext({
    baseURL: applicationUrl,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: input.viewport,
  });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(input.actor.email);
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(input.actor.password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === input.expectedPath),
    page.getByRole('button', { name: 'Đăng nhập' }).click(),
  ]);
  await expect(page.getByRole('heading', { level: 1, name: input.homeHeading })).toBeVisible();
  return { context, page };
}

export async function expectSessionAfterReload(
  page: Page,
  expectedPath: string,
  heading: string,
): Promise<void> {
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(expectedPath)}$`));
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
}

export async function expectMinimumControlHeight(
  page: Page,
  accessibleName: string,
  minimumHeight = 44,
): Promise<void> {
  const box = await page.getByRole('button', { name: accessibleName }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(minimumHeight);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
