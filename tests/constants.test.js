import { describe, it, expect } from 'vitest';
import {
  CORS_HEADERS,
  UNIQUE_AMOUNT_TTL_MS,
  PAYMENT_MATCH_WINDOW_MIN,
  UNIQUE_AMOUNT_MAX,
} from '../src/constants.js';

describe('constants', () => {
  it('CORS_HEADERS has correct keys and values', () => {
    expect(CORS_HEADERS['Access-Control-Allow-Origin']).toBe('*');
    expect(CORS_HEADERS['Access-Control-Allow-Methods']).toContain('POST');
    expect(CORS_HEADERS['Access-Control-Allow-Methods']).toContain('GET');
    expect(CORS_HEADERS['Access-Control-Allow-Headers']).toContain('x-api-key');
  });

  it('UNIQUE_AMOUNT_TTL_MS equals 1 hour', () => {
    expect(UNIQUE_AMOUNT_TTL_MS).toBe(3_600_000);
  });

  it('PAYMENT_MATCH_WINDOW_MIN is a positive number', () => {
    expect(PAYMENT_MATCH_WINDOW_MIN).toBeGreaterThan(0);
  });

  it('UNIQUE_AMOUNT_MAX is 200', () => {
    expect(UNIQUE_AMOUNT_MAX).toBe(200);
  });
});
