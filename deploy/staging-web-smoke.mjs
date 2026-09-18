import { chromium, expect } from '@playwright/test';

// Read-only staging route check. Never saves cookies or logs authentication headers.
const origin = 'https://logistics-staging-web.onrender.com';
const browser = await chromium.launch();
const results = [];
try {
  const context = await browser.newContext({
    javaScriptEnabled: false,
  });
  // Check server fallback independently of client-side auth redirects, then
  // verify rendering with normal JavaScript and unchanged authentication.
  const renderContext = await browser.newContext({
    storageState: process.env.STAGING_BROWSER_STORAGE_STATE || undefined,
  });
  const page = await context.newPage();
  const renderedPage = await renderContext.newPage();
  for (const step of ['root', 'direct', 'refresh']) {
    const response = step === 'refresh'
      ? await page.reload({ waitUntil: 'domcontentloaded' })
      : await page.goto(`${origin}${step === 'root' ? '/' : '/shipments/new'}`, { waitUntil: 'domcontentloaded' });
    const headers = response.headers();
    const html = await response.text();
    const result = {
      step, url: response.url(), status: response.status(),
      contentType: headers['content-type'],
      csp: headers['content-security-policy'] ?? null,
      appShell: html.includes('<div id="root">'),
    };
    if (result.status === 200 && result.appShell) {
      try {
        await renderedPage.goto(response.url());
        await expect(renderedPage.getByRole('heading').first()).toBeVisible({ timeout: 20000 });
        result.rendered = true;
        result.renderedPath = new URL(renderedPage.url()).pathname;
      } catch {
        result.rendered = false;
      }
    }
    results.push(result);
  }
  const passed = results.every((result) => result.status === 200 && result.appShell && result.rendered);
  console.log(JSON.stringify({ staging: `${origin}/shipments/new`, routeSmoke: passed ? 'PASS' : 'FAIL', results }, null, 2));
  if (!passed) {
    console.log('Leaflet smoke: BLOCKED by SPA route. No tile conclusions.');
    process.exitCode = 1;
  } else if (new URL(renderedPage.url()).pathname === '/login') {
    console.log('Leaflet smoke: AUTH BLOCKED. Provide an authorized staging session before tile checks.');
  }
} finally {
  await browser.close();
}
