import { describe, it, expect } from 'vitest';
import { jsonResponse, jsonError } from '../src/helpers.js';

describe('helpers', () => {
  describe('jsonResponse()', () => {
    it('returns 200 with JSON body by default', async () => {
      const res = jsonResponse({ success: true });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/json');
      const body = await res.json();
      expect(body).toEqual({ success: true });
    });

    it('respects custom status code', async () => {
      const res = jsonResponse({ ok: true }, 201);
      expect(res.status).toBe(201);
    });
  });

  describe('jsonError()', () => {
    it('returns 400 with error shape by default', async () => {
      const res = jsonError('Something went wrong');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ success: false, error: 'Something went wrong' });
    });

    it('respects custom status code', async () => {
      const res = jsonError('Unauthorized', 401);
      expect(res.status).toBe(401);
    });

    it('returns 404', async () => {
      const res = jsonError('Not found', 404);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
    });
  });
});
