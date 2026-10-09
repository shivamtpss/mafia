import { Injectable } from '@nestjs/common';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Lightweight in-memory token-bucket rate limiter keyed by an arbitrary string
 * (e.g. `${socketId}:${action}`). Prevents chat/vote/room-creation spam. For
 * multi-instance deployments this would move to Redis; the interface is stable.
 */
@Injectable()
export class RateLimiterService {
  private readonly buckets = new Map<string, Bucket>();

  /**
   * @param key      unique bucket key
   * @param capacity max burst
   * @param refillPerSec tokens restored per second
   * @returns true if allowed, false if rate-limited
   */
  consume(key: string, capacity: number, refillPerSec: number): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: capacity, updatedAt: now };
    const elapsedSec = (now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(
      capacity,
      bucket.tokens + elapsedSec * refillPerSec,
    );
    bucket.updatedAt = now;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}
