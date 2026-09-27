import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { fileURLToPath } from 'node:url';

// Real AuthProvider, Axios, Web Locks, BroadcastChannel, guards and LoginPage.
// HTTP fixtures model atomic cookie rotation; no real DB/staging claim.
const root = fileURLToPath(new URL('../../', import.meta.url));
const config = {
  logLevel: 'error',
  root,
  configFile: `${root}/vite.config.ts`,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: {
    outDir: '.vite/auth-restore',
    rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) },
  },
  preview: { host: '127.0.0.1', port: 4196, strictPort: true },
};
await build(config);
const server = await preview(config);
const html = await fs.readFile(`${root}/.vite/auth-restore/test/auth-restore/index.html`, 'utf8');
const origin = 'http://127.0.0.1:4196';
const reports = [];
let browser;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function setup(role, { locks = true, channel = true } = {}) {
  const context = await browser.newContext();
  const model = {
    role,
    serial: 0,
    cookie: null,
    access: null,
    mode: 'valid',
    delay: 150,
    reads: 0,
    refreshes: [],
    logout: 0,
    active: 0,
    maxActive: 0,
    events: [],
    errors: [],
  };
  await context.addInitScript(
    ({ locks, channel }) => {
      window.authTestEvents = [];
      window.addEventListener('auth-test-state', (event) =>
        window.authTestEvents.push(event.detail),
      );
      if (!locks) Object.defineProperty(navigator, 'locks', { value: undefined });
      if (!channel) Object.defineProperty(window, 'BroadcastChannel', { value: undefined });
    },
    { locks, channel },
  );
  context.on('page', (page) => page.on('pageerror', (error) => model.errors.push(error.message)));
  const payload = () => ({
    accessToken: model.access,
    expiresIn: 900,
    user: {
      id: `${role}-test`,
      role,
      fullName: `${role} Test`,
      email: `${role.toLowerCase()}@example.test`,
      status: 'ACTIVE',
      mustChangePassword: false,
      phone: null,
    },
  });
  const invalid = (route) =>
    route.fulfill({
      status: 401,
      json: {
        statusCode: 401,
        code: 'AUTH_REFRESH_TOKEN_INVALID',
        message: 'Invalid refresh session',
      },
    });
  const rotate = async (route) => {
    model.serial++;
    model.cookie = `refresh-${model.serial}`;
    model.access = `access-${model.serial}`;
    await route.fulfill({
      headers: {
        'Set-Cookie': `logistics_refresh=${model.cookie}; HttpOnly; Path=/api/v1/auth; SameSite=Lax`,
      },
      json: { data: payload(), meta: {} },
    });
  };
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) {
      if (request.isNavigationRequest())
        return route.fulfill({ contentType: 'text/html', body: html });
      return route.continue();
    }
    if (url.pathname === '/api/v1/auth/login') return rotate(route);
    if (url.pathname === '/api/v1/auth/logout') {
      model.cookie = null;
      model.access = null;
      model.logout++;
      return route.fulfill({
        headers: {
          'Set-Cookie': 'logistics_refresh=; HttpOnly; Path=/api/v1/auth; SameSite=Lax; Max-Age=0',
        },
        json: { data: {}, meta: {} },
      });
    }
    if (url.pathname === '/api/v1/auth/refresh') {
      const sentCookie = (await request.allHeaders()).cookie ?? '';
      const entry = { cookiePresent: sentCookie.includes('logistics_refresh='), mode: model.mode };
      model.refreshes.push(entry);
      model.active++;
      model.maxActive = Math.max(model.maxActive, model.active);
      const mode = model.mode;
      await sleep(model.delay);
      try {
        if (mode === 'offline') {
          entry.status = 'network';
          return await route.abort('connectionfailed');
        }
        if (mode === 'slow') await sleep(10500);
        if (mode === '503' || mode === '429' || mode === '403') {
          entry.status = Number(mode);
          return await route.fulfill({
            status: Number(mode),
            json: { code: mode === '403' ? 'AUTH_ORIGIN_FORBIDDEN' : 'SERVICE_UNAVAILABLE' },
          });
        }
        if (
          mode === 'invalid' ||
          !model.cookie ||
          !sentCookie.split('; ').includes(`logistics_refresh=${model.cookie}`)
        ) {
          entry.status = 401;
          return await invalid(route);
        }
        entry.status = 200;
        return await rotate(route);
      } finally {
        model.active--;
      }
    }
    if (url.pathname === '/api/v1/test/protected') {
      model.reads++;
      if (
        model.protectedDenied ||
        (await request.allHeaders()).authorization !== `Bearer ${model.access}`
      )
        return route.fulfill({ status: 401, json: { code: 'AUTH_ACCESS_TOKEN_INVALID' } });
      return route.fulfill({ json: { data: { ok: true }, meta: {} } });
    }
    throw Error(`Unexpected request ${url.pathname}`);
  });
  const page = await context.newPage();
  const status = (p = page) => p.getByTestId('auth-status');
  const authenticated = async (p = page) => {
    await expect(status(p)).toHaveText('authenticated');
    await expect(p.getByRole('heading', { name: `${role} workspace` })).toBeVisible();
  };
  const login = async () => {
    await page.goto(`${origin}/login`);
    await expect(status()).toHaveText('guest');
    await page.locator('#login-email').fill(`${role.toLowerCase()}@example.test`);
    await page.locator('#login-password').fill('Browser-fixture-only');
    await page.locator('button[type=submit]').click();
    await authenticated();
  };
  return { context, model, page, status, authenticated, login };
}

try {
  browser = await chromium.launch();
  for (const role of ['CUSTOMER', 'ADMIN', 'DRIVER']) {
    const s = await setup(role);
    const { context, page, model, authenticated, status } = s;
    try {
      await s.login();
      const home = role === 'CUSTOMER' ? '/dashboard' : `/${role.toLowerCase()}/dashboard`;
      await page.goto(origin + home);
      await authenticated();
      let count = model.refreshes.length;
      model.delay = 400;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(status()).toHaveText('loading');
      assert.equal(new URL(page.url()).pathname, home);
      await authenticated();
      assert.equal(model.refreshes.length - count, 1, 'StrictMode reload must single-flight');
      assert.equal(model.refreshes.at(-1).status, 200);
      const nested = `${home}/nested?filter=pending#details`;
      await page.goto(origin + nested);
      await authenticated();
      await page.reload();
      await authenticated();
      assert.equal(page.url(), origin + nested);
      const states = await page.evaluate(() => window.authTestEvents);
      assert.ok(states.some((s) => s.status === 'loading'));
      assert.ok(!states.some((s) => s.status === 'guest' || s.pathname === '/login'));
      const peers = await Promise.all([context.newPage(), context.newPage()]);
      for (const peer of peers) {
        await peer.goto(origin + nested);
        await authenticated(peer);
      }
      count = model.refreshes.length;
      await page.reload();
      await authenticated();
      for (const peer of peers) await authenticated(peer);
      assert.equal(model.refreshes.length - count, 1);
      count = model.refreshes.length;
      await Promise.all([page, ...peers].map((p) => p.reload()));
      for (const p of [page, ...peers]) await authenticated(p);
      assert.ok(model.refreshes.length - count <= 3, 'simultaneous tabs remain bounded');
      model.access = 'expired';
      count = model.refreshes.length;
      await page.getByRole('button', { name: 'Load protected data' }).click();
      await expect(page.getByTestId('api-result')).toHaveText('requests passed');
      assert.equal(model.refreshes.length - count, 1, 'eight 401s coalesce into one refresh');
      for (const peer of peers) await authenticated(peer);
      assert.equal(model.maxActive, 1, 'Web Locks serialize across tabs');
      for (const mode of ['503', 'offline', '429', '403']) {
        model.mode = mode;
        count = model.refreshes.length;
        await page.reload();
        await expect(status()).toHaveText('restore-error');
        assert.equal(page.url(), origin + nested);
        await expect(page.getByRole('alert')).toBeVisible();
        for (const peer of peers) await authenticated(peer);
        await page.waitForTimeout(350);
        assert.equal(model.refreshes.length - count, 1, 'no automatic retry loop');
        model.mode = 'valid';
        await page.getByRole('button', { name: 'Thử lại' }).click();
        await authenticated();
      }
      // Expiry + transient refresh failure must preserve an existing session.
      model.mode = '503';
      model.access = 'expired-again';
      await page.getByRole('button', { name: 'Load protected data' }).click();
      await expect(page.getByTestId('api-result')).toHaveText('requests failed');
      await authenticated();
      for (const peer of peers) await authenticated(peer);
      model.mode = 'valid';
      await page.getByRole('button', { name: 'Load protected data' }).click();
      await expect(page.getByTestId('api-result')).toHaveText('requests passed');
      // A late failure must not clear a session from a newer login in another tab.
      model.mode = '503';
      model.delay = 1200;
      await page.reload();
      await expect.poll(() => model.active).toBe(1);
      await peers[0].getByRole('button', { name: 'Sign in again' }).click();
      await authenticated();
      await expect.poll(() => model.active).toBe(0);
      await authenticated();
      model.delay = 150;
      model.mode = 'invalid';
      await page.reload();
      await expect(status()).toHaveText('guest');
      assert.equal(new URL(page.url()).pathname, '/login');
      for (const peer of peers) await authenticated(peer);
      model.mode = 'valid';
      await page.locator('#login-email').fill(`${role.toLowerCase()}@example.test`);
      await page.locator('#login-password').fill('Browser-fixture-only');
      await page.locator('button[type=submit]').click();
      await authenticated();
      assert.equal(page.url(), origin + nested, 'auth-invalid return path retains query/hash');
      // Logout waits for another tab's rotation and then revokes its new cookie.
      model.access = 'expired-before-logout';
      model.delay = 700;
      await peers[0].getByRole('button', { name: 'Load protected data' }).click();
      await expect.poll(() => model.active).toBe(1);
      await page.getByRole('button', { name: 'Logout', exact: true }).click();
      await expect(status()).toHaveText('guest');
      for (const peer of peers) await expect(status(peer)).toHaveText('guest');
      await page.reload();
      await expect(status()).toHaveText('guest');
      assert.equal(model.refreshes.at(-1).cookiePresent, false);
      assert.equal(model.logout, 1);
      const storage = await page.evaluate(() => ({
        local: { ...localStorage },
        session: { ...sessionStorage },
        visibleCookies: document.cookie,
      }));
      assert.deepEqual(storage, { local: {}, session: {}, visibleCookies: '' });
      assert.deepEqual(model.errors, []);
      reports.push({
        role,
        pass: true,
        states,
        refreshes: model.refreshes,
        maxConcurrentRefreshes: model.maxActive,
      });
      console.log(
        `PASS ${role}: login/reload/nested/three tabs/expiry/transient retry/invalid/logout; real browser, HTTP fixtures`,
      );
    } finally {
      await context.close();
    }
  }
  // No Web Locks/BroadcastChannel: basic restoration must still work.
  const fallback = await setup('CUSTOMER', { locks: false, channel: false });
  try {
    await fallback.login();
    await fallback.page.reload();
    await fallback.authenticated();
    reports.push({ case: 'no-browser-coordination-APIs', pass: true });
  } finally {
    await fallback.context.close();
  }
  const noLocks = await setup('CUSTOMER', { locks: false });
  try {
    await noLocks.login();
    const peers = await Promise.all([noLocks.context.newPage(), noLocks.context.newPage()]);
    await Promise.all([noLocks.page.reload(), ...peers.map((p) => p.goto(origin + '/dashboard'))]);
    for (const p of [noLocks.page, ...peers]) await noLocks.authenticated(p);
    assert.ok(noLocks.model.refreshes.length <= 7, 'fallback rotation recovery stays bounded');
    reports.push({ case: 'three-tabs-without-web-locks', pass: true });
  } finally {
    await noLocks.context.close();
  }
  const denied = await setup('CUSTOMER');
  try {
    await denied.login();
    denied.model.protectedDenied = true;
    const count = denied.model.refreshes.length;
    await denied.page.getByRole('button', { name: 'Load protected data' }).click();
    await expect(denied.page.getByTestId('api-result')).toHaveText('requests failed');
    await denied.authenticated();
    assert.equal(denied.model.refreshes.length - count, 1);
    assert.equal(denied.model.reads, 16, 'each denied request gets at most one replay');
    reports.push({ case: 'retried-401-has-no-refresh-loop', pass: true });
  } finally {
    await denied.context.close();
  }
  const peerRecovery = await setup('CUSTOMER');
  try {
    await peerRecovery.login();
    const peer = await peerRecovery.context.newPage();
    await peer.goto(origin + '/dashboard');
    await peerRecovery.authenticated(peer);
    peerRecovery.model.mode = '503';
    await peerRecovery.page.reload();
    await expect(peerRecovery.status()).toHaveText('restore-error');
    peerRecovery.model.mode = 'valid';
    await peer.getByRole('button', { name: 'Sign in again' }).click();
    await peerRecovery.authenticated();
    await peer.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(peerRecovery.status()).toHaveText('guest');
    assert.equal(new URL(peerRecovery.page.url()).pathname, '/login');
    reports.push({ case: 'peer-login-resolves-restore-error-before-logout', pass: true });
  } finally {
    await peerRecovery.context.close();
  }
  const timeout = await setup('CUSTOMER');
  try {
    await timeout.login();
    timeout.model.mode = 'slow';
    await timeout.page.reload();
    await expect(timeout.status()).toHaveText('restore-error', { timeout: 15000 });
    assert.equal(new URL(timeout.page.url()).pathname, '/dashboard');
    timeout.model.mode = 'valid';
    await timeout.page.getByRole('button', { name: 'Thử lại' }).click();
    await timeout.authenticated();
    reports.push({ case: 'axios-timeout-manual-recovery', pass: true });
  } finally {
    await timeout.context.close();
  }
  console.log('PASS auth restoration browser regressions');
} finally {
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/auth-restore-browser.json', JSON.stringify(reports, null, 2));
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
