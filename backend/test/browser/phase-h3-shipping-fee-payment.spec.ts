import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext } from './support/test.js';
import {
  expectMinimumControlHeight,
  expectNoHorizontalOverflow,
  openRoleBrowser,
} from './support/browser-session.js';
import { createPhaseH3Fixture, type PhaseH3FixtureValue } from './support/phase-h3-fixture.js';

const webhookSecret = 'phase-h3-browser-test-webhook-secret-32-characters';

test.describe.serial('Phase H3 shipping-fee payment result flow', () => {
  let fixture: PhaseH3FixtureValue;
  const contexts: BrowserContext[] = [];

  test.beforeAll(async () => {
    fixture = await createPhaseH3Fixture();
  });

  test.afterAll(async () => {
    await Promise.allSettled(contexts.map((context) => context.close()));
    await fixture.cleanup();
  });

  test('Customer sees pending then authoritative webhook success without changing COD UI', async ({
    browser,
  }) => {
    const customer = await openRoleBrowser({
      browser,
      actor: fixture.actor,
      expectedPath: '/dashboard',
      homeHeading: 'Dashboard',
      viewport: { width: 390, height: 844 },
    });
    contexts.push(customer.context);
    await customer.page.goto(`/shipments/${fixture.shipmentId}`);
    await expect(
      customer.page.getByRole('heading', { name: 'Thanh toán phí vận chuyển' }),
    ).toBeVisible();
    await expectMinimumControlHeight(customer.page, 'Thanh toán phí vận chuyển', 48);

    await Promise.all([
      customer.page.waitForResponse(
        (response) =>
          response.url().endsWith('/shipping-fee-payments') && response.status() === 201,
      ),
      customer.page.getByRole('button', { name: 'Thanh toán phí vận chuyển' }).click(),
    ]);
    await expect(customer.page).toHaveURL(/\/payments\/result\?reference=SFP-/);
    await expect(customer.page.getByRole('heading', { name: 'Kết quả thanh toán' })).toBeVisible();
    await expect(
      customer.page.getByText('Đang chờ xác nhận thanh toán', { exact: true }),
    ).toBeVisible();
    const reference = new URL(customer.page.url()).searchParams.get('reference');
    expect(reference).toMatch(/^SFP-[A-F0-9]{32}$/);

    const rawBody = JSON.stringify({
      eventId: `evt-browser-${randomUUID()}`,
      reference,
      providerReference: `TEST-${reference}`,
      amount: fixture.feeAmount,
      status: 'SUCCEEDED',
      occurredAt: new Date().toISOString(),
    });
    const signature = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    const webhookResponse = await fetch(
      'http://127.0.0.1:3000/api/v1/shipping-fee-payments/webhook',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-payment-signature': signature },
        body: rawBody,
      },
    );
    expect(webhookResponse.status).toBe(200);

    await expect(customer.page.getByText('Thanh toán thành công', { exact: true })).toBeVisible();
    await expect(
      customer.page.getByText('Webhook hợp lệ đã xác nhận khoản phí.', { exact: false }),
    ).toBeVisible();
    await expect(customer.page.getByText(webhookSecret)).toHaveCount(0);
    await customer.page.getByRole('link', { name: 'Quay lại vận đơn' }).click();
    await expect(customer.page).toHaveURL(new RegExp(`/shipments/${fixture.shipmentId}$`));
    await expect(
      customer.page.getByText('Đã thanh toán trực tuyến', { exact: true }),
    ).toBeVisible();
    await expect(customer.page.getByRole('heading', { name: 'COD' })).toBeVisible();
    await expect(customer.page.getByText('180.000 ₫', { exact: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(customer.page);
  });
});
