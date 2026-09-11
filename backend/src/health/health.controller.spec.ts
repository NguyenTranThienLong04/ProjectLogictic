import { jest } from '@jest/globals';
import type { HealthService } from './health.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('serves liveness without invoking dependency readiness checks', () => {
    const checkReadiness = jest.fn();
    const health = { checkReadiness } as unknown as HealthService;
    const result = new HealthController(health).checkLiveness();

    expect(result.status).toBe('ok');
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
    expect(checkReadiness).not.toHaveBeenCalled();
  });
});
