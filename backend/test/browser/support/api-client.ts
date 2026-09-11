import { expect, request, type APIRequestContext } from '@playwright/test';
import type { PhaseFActor } from './phase-f-fixture.js';

interface LoginEnvelope {
  data: { accessToken: string };
}

export class PhaseFApiClient {
  private readonly tokens = new Map<string, string>();

  private constructor(private readonly context: APIRequestContext) {}

  static async create(): Promise<PhaseFApiClient> {
    return new PhaseFApiClient(await request.newContext({ baseURL: 'http://127.0.0.1:3000' }));
  }

  async login(actor: PhaseFActor): Promise<string> {
    const cached = this.tokens.get(actor.email);
    if (cached) return cached;
    const response = await this.context.post('/api/v1/auth/login', {
      data: { email: actor.email, password: actor.password },
    });
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as LoginEnvelope;
    this.tokens.set(actor.email, body.data.accessToken);
    return body.data.accessToken;
  }

  async updateDriverLocation(
    actor: PhaseFActor,
    latitude: number,
    longitude: number,
  ): Promise<void> {
    const accessToken = await this.login(actor);
    const response = await this.context.post('/api/v1/driver/location', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { latitude, longitude },
    });
    expect(response.ok()).toBe(true);
  }

  async startDriverLocationHeartbeat(
    actor: PhaseFActor,
    latitude: number,
    longitude: number,
    intervalMs = 4_000,
  ): Promise<() => Promise<void>> {
    let failure: Error | undefined;
    let inFlight: Promise<void> | undefined;
    let stopped = false;
    let stopPromise: Promise<void> | undefined;
    await this.updateDriverLocation(actor, latitude, longitude);
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = this.updateDriverLocation(actor, latitude, longitude)
        .catch((error: unknown) => {
          failure ??=
            error instanceof Error
              ? error
              : new Error('Driver location heartbeat failed', { cause: error });
        })
        .finally(() => {
          inFlight = undefined;
        });
    }, intervalMs);

    return () => {
      stopPromise ??= (async () => {
        if (!stopped) {
          stopped = true;
          clearInterval(timer);
          await inFlight;
        }
        if (failure) throw failure;
      })();
      return stopPromise;
    };
  }

  async expectForbiddenShipmentRead(actor: PhaseFActor, shipmentId: string): Promise<void> {
    const accessToken = await this.login(actor);
    const response = await this.context.get(`/api/v1/dispatcher/shipments/${shipmentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(response.status()).toBe(403);
  }

  async expectCustomerLocationStatus(
    actor: PhaseFActor,
    shipmentId: string,
    expectedStatus: number,
  ): Promise<void> {
    const accessToken = await this.login(actor);
    const response = await this.context.get(`/api/v1/shipments/${shipmentId}/location`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(response.status()).toBe(expectedStatus);
  }

  async dispose(): Promise<void> {
    await this.context.dispose();
  }
}
