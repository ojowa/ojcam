/**
 * RateLimiter.test.ts
 * Unit tests for the RateLimiter security module.
 */

import { RateLimiter } from '../services/security/RateLimiter';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({
      maxAttempts: 3,
      windowMs: 60000, // 1 minute
      lockoutMs: 300000, // 5 minutes
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should allow attempts within the limit', () => {
    const result1 = limiter.check('device-1');
    const result2 = limiter.check('device-1');
    const result3 = limiter.check('device-1');

    expect(result1.allowed).toBe(true);
    expect(result1.remainingAttempts).toBe(2);
    expect(result2.allowed).toBe(true);
    expect(result2.remainingAttempts).toBe(1);
    expect(result3.allowed).toBe(true);
    expect(result3.remainingAttempts).toBe(0);
  });

  it('should reject attempts exceeding the limit', () => {
    limiter.check('device-1');
    limiter.check('device-1');
    limiter.check('device-1');

    const result = limiter.check('device-1');
    expect(result.allowed).toBe(false);
    expect(result.remainingAttempts).toBe(0);
    expect(result.lockoutUntil).toBeDefined();
    expect(result.lockoutUntil).toBeGreaterThan(Date.now());
  });

  it('should track different identifiers independently', () => {
    limiter.check('device-1');
    limiter.check('device-1');
    limiter.check('device-1');

    // device-1 should be rate limited
    const result1 = limiter.check('device-1');
    expect(result1.allowed).toBe(false);

    // device-2 should still be allowed
    const result2 = limiter.check('device-2');
    expect(result2.allowed).toBe(true);
  });

  it('should reset rate limit state for an identifier', () => {
    limiter.check('device-1');
    limiter.check('device-1');
    limiter.check('device-1');

    const result1 = limiter.check('device-1');
    expect(result1.allowed).toBe(false);

    limiter.reset('device-1');

    const result2 = limiter.check('device-1');
    expect(result2.allowed).toBe(true);
    expect(result2.remainingAttempts).toBe(2);
  });

  it('should report remaining attempts correctly', () => {
    limiter.check('device-1');
    expect(limiter.getRemaining('device-1')).toBe(2);

    limiter.check('device-1');
    expect(limiter.getRemaining('device-1')).toBe(1);

    limiter.check('device-1');
    expect(limiter.getRemaining('device-1')).toBe(0);
  });

  it('should allow peek without recording', () => {
    const peek1 = limiter.peek('device-1');
    expect(peek1.allowed).toBe(true);
    expect(peek1.remainingAttempts).toBe(3);

    // Check again - peek should not have recorded
    const peek2 = limiter.peek('device-1');
    expect(peek2.allowed).toBe(true);
    expect(peek2.remainingAttempts).toBe(3);

    // Actual check should record
    limiter.check('device-1');
    expect(limiter.getRemaining('device-1')).toBe(2);
  });

  it('should enforce lockout period', () => {
    // Exhaust attempts
    limiter.check('device-1');
    limiter.check('device-1');
    limiter.check('device-1');

    const result = limiter.check('device-1');
    expect(result.allowed).toBe(false);

    // The lockout should be in the future
    expect(result.lockoutUntil!).toBeGreaterThan(Date.now());
  });
});
