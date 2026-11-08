/**
 * RateLimiter.ts
 * 
 * Token-bucket rate limiter for pairing attempts and other security-sensitive
 * operations. Implements a sliding-window counter with configurable limits.
 * 
 * Security requirement: "Rate limiting: On pairing attempts" (SECURITY.md)
 */

export interface RateLimiterConfig {
  /** Maximum number of attempts allowed within the window */
  maxAttempts: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Lockout duration in milliseconds when limit is exceeded */
  lockoutMs: number;
}

export interface RateLimiterResult {
  allowed: boolean;
  remainingAttempts: number;
  resetAt: number; // timestamp when the window resets
  lockoutUntil?: number; // timestamp when lockout expires, if locked
}

export class RateLimiter {
  private config: RateLimiterConfig;
  // Map of identifier -> array of attempt timestamps within the current window
  private attempts: Map<string, number[]> = new Map();
  // Map of identifier -> lockout expiry timestamp
  private lockouts: Map<string, number> = new Map();

  constructor(config: RateLimiterConfig) {
    this.config = {
      maxAttempts: config.maxAttempts,
      windowMs: config.windowMs,
      lockoutMs: config.lockoutMs,
    };
  }

  /**
   * Check if an attempt is allowed for the given identifier.
   * Records the attempt if allowed.
   */
  check(identifier: string): RateLimiterResult {
    const now = Date.now();

    // Check if currently locked out
    const lockoutUntil = this.lockouts.get(identifier);
    if (lockoutUntil && now < lockoutUntil) {
      return {
        allowed: false,
        remainingAttempts: 0,
        resetAt: lockoutUntil,
        lockoutUntil,
      };
    }

    // Clear expired lockout
    if (lockoutUntil && now >= lockoutUntil) {
      this.lockouts.delete(identifier);
    }

    // Get or initialize attempt history for this identifier
    const attempts = this.attempts.get(identifier) || [];

    // Remove timestamps outside the current window
    const windowStart = now - this.config.windowMs;
    const validAttempts = attempts.filter((t) => t > windowStart);

    if (validAttempts.length >= this.config.maxAttempts) {
      // Rate limit exceeded - impose lockout
      const lockoutExpiry = now + this.config.lockoutMs;
      this.lockouts.set(identifier, lockoutExpiry);
      this.attempts.set(identifier, validAttempts);

      return {
        allowed: false,
        remainingAttempts: 0,
        resetAt: lockoutExpiry,
        lockoutUntil: lockoutExpiry,
      };
    }

    // Record this attempt
    validAttempts.push(now);
    this.attempts.set(identifier, validAttempts);

    return {
      allowed: true,
      remainingAttempts: this.config.maxAttempts - validAttempts.length,
      resetAt: now + this.config.windowMs,
    };
  }

  /**
   * Check if an attempt would be allowed without recording it.
   */
  peek(identifier: string): RateLimiterResult {
    const now = Date.now();

    const lockoutUntil = this.lockouts.get(identifier);
    if (lockoutUntil && now < lockoutUntil) {
      return {
        allowed: false,
        remainingAttempts: 0,
        resetAt: lockoutUntil,
        lockoutUntil,
      };
    }

    const attempts = this.attempts.get(identifier) || [];
    const windowStart = now - this.config.windowMs;
    const validAttempts = attempts.filter((t) => t > windowStart);

    if (validAttempts.length >= this.config.maxAttempts) {
      return {
        allowed: false,
        remainingAttempts: 0,
        resetAt: now + this.config.lockoutMs,
        lockoutUntil: now + this.config.lockoutMs,
      };
    }

    return {
      allowed: true,
      remainingAttempts: this.config.maxAttempts - validAttempts.length,
      resetAt: now + this.config.windowMs,
    };
  }

  /**
   * Reset the rate limit state for an identifier (e.g. after successful pairing).
   */
  reset(identifier: string): void {
    this.attempts.delete(identifier);
    this.lockouts.delete(identifier);
  }

  /**
   * Get remaining attempts without recording.
   */
  getRemaining(identifier: string): number {
    const now = Date.now();
    const attempts = this.attempts.get(identifier) || [];
    const windowStart = now - this.config.windowMs;
    const validAttempts = attempts.filter((t) => t > windowStart);
    return Math.max(0, this.config.maxAttempts - validAttempts.length);
  }

  /**
   * Clean up expired entries to prevent memory growth.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [id, timestamps] of this.attempts.entries()) {
      const windowStart = now - this.config.windowMs;
      const valid = timestamps.filter((t) => t > windowStart);
      if (valid.length === 0) {
        this.attempts.delete(id);
      } else {
        this.attempts.set(id, valid);
      }
    }
    for (const [id, lockoutUntil] of this.lockouts.entries()) {
      if (now >= lockoutUntil) {
        this.lockouts.delete(id);
      }
    }
  }
}

/**
 * Default rate limiter configuration matching appsettings.json Pairing settings:
 * - CodeLength: 6
 * - TokenExpirationMinutes: 10
 * We conservatively limit to 5 pairing attempts per 5 minutes with a 15-minute lockout.
 */
export const defaultPairingRateLimiter = new RateLimiter({
  maxAttempts: 5,
  windowMs: 5 * 60 * 1000, // 5 minutes
  lockoutMs: 15 * 60 * 1000, // 15 minutes
});

// Periodic cleanup every minute
setInterval(() => {
  defaultPairingRateLimiter.cleanup();
}, 60 * 1000).unref?.();
