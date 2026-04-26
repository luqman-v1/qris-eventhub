import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as deviceDb from '../src/db/device.js';
import * as notifDb from '../src/db/notification.js';
import * as paymentMatcher from '../src/services/payment-matcher.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeEnv() {
  return { DB: {} };
}

function makeWebhookRequest(body) {
  return new Request('https://worker.test/webhook', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('handlers/notification', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // ── handleHealth ─────────────────────────────────────────────────────────

  describe('handleHealth()', () => {
    it('returns 200 with status OK', async () => {
      const { handleHealth } = await import('../src/handlers/notification.js');
      const res = await handleHealth();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('OK');
      expect(body.platform).toBe('Cloudflare Workers');
      expect(typeof body.timestamp).toBe('string');
    });
  });

  // ── handleTest ───────────────────────────────────────────────────────────

  describe('handleTest()', () => {
    it('echoes the request body', async () => {
      const { handleTest } = await import('../src/handlers/notification.js');
      const req = new Request('https://worker.test/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
      });
      const res = await handleTest(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ hello: 'world' });
    });

    it('returns 400 for invalid JSON', async () => {
      const { handleTest } = await import('../src/handlers/notification.js');
      const req = new Request('https://worker.test/test', {
        method: 'POST',
        body:   'NOT JSON',
      });
      const res = await handleTest(req);
      expect(res.status).toBe(400);
    });
  });

  // ── handleWebhook ─────────────────────────────────────────────────────────

  describe('handleWebhook()', () => {
    it('returns 400 when deviceId is missing', async () => {
      const { handleWebhook } = await import('../src/handlers/notification.js');
      const req = makeWebhookRequest({ packageName: 'com.app' });
      const res = await handleWebhook(req, makeEnv(), {});
      expect(res.status).toBe(400);
    });

    it('returns 400 when packageName is missing', async () => {
      const { handleWebhook } = await import('../src/handlers/notification.js');
      const req = makeWebhookRequest({ deviceId: 'device-1' });
      const res = await handleWebhook(req, makeEnv(), {});
      expect(res.status).toBe(400);
    });

    it('inserts notification and returns 200 on valid payload', async () => {
      vi.spyOn(deviceDb, 'upsertDevice').mockResolvedValue();
      vi.spyOn(notifDb, 'insertNotification').mockResolvedValue({ meta: { last_row_id: 55 } });

      const { handleWebhook } = await import('../src/handlers/notification.js');
      const req = makeWebhookRequest({
        deviceId:    'device-1',
        packageName: 'com.bank.app',
        title:       'Transfer',
        text:        'Rp 50.000',
      });
      const res = await handleWebhook(req, makeEnv(), {});
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.id).toBe(55);
    });

    it('triggers payment matching when amountDetected is present', async () => {
      vi.spyOn(deviceDb, 'upsertDevice').mockResolvedValue();
      vi.spyOn(notifDb, 'insertNotification').mockResolvedValue({ meta: { last_row_id: 1 } });
      const matchSpy = vi.spyOn(paymentMatcher, 'checkPaymentMatch').mockResolvedValue();

      const { handleWebhook } = await import('../src/handlers/notification.js');
      const req = makeWebhookRequest({
        deviceId:       'device-1',
        packageName:    'com.bank',
        amountDetected: '50075',
      });
      // ctx without waitUntil → fallback to await
      await handleWebhook(req, makeEnv(), {});

      expect(matchSpy).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ amountDetected: '50075' }),
      );
    });

    it('does NOT trigger payment matching when amountDetected is absent', async () => {
      vi.spyOn(deviceDb, 'upsertDevice').mockResolvedValue();
      vi.spyOn(notifDb, 'insertNotification').mockResolvedValue({ meta: { last_row_id: 2 } });
      const matchSpy = vi.spyOn(paymentMatcher, 'checkPaymentMatch').mockResolvedValue();

      const { handleWebhook } = await import('../src/handlers/notification.js');
      const req = makeWebhookRequest({ deviceId: 'device-1', packageName: 'com.app' });
      await handleWebhook(req, makeEnv(), {});

      expect(matchSpy).not.toHaveBeenCalled();
    });

    it('uses ctx.waitUntil when available', async () => {
      vi.spyOn(deviceDb, 'upsertDevice').mockResolvedValue();
      vi.spyOn(notifDb, 'insertNotification').mockResolvedValue({ meta: { last_row_id: 3 } });
      vi.spyOn(paymentMatcher, 'checkPaymentMatch').mockResolvedValue();

      const { handleWebhook } = await import('../src/handlers/notification.js');
      const ctx = { waitUntil: vi.fn() };
      const req = makeWebhookRequest({
        deviceId: 'dev', packageName: 'app', amountDetected: '1000',
      });

      await handleWebhook(req, makeEnv(), ctx);
      expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    });
  });

  // ── handleGetNotifications ────────────────────────────────────────────────

  describe('handleGetNotifications()', () => {
    it('returns empty array when no notifications', async () => {
      vi.spyOn(notifDb, 'getNotifications').mockResolvedValue([]);
      const { handleGetNotifications } = await import('../src/handlers/notification.js');
      const req = new Request('https://worker.test/notifications');
      const res = await handleGetNotifications(req, makeEnv());
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
      expect(body.count).toBe(0);
    });

    it('passes limit and offset from query params', async () => {
      const spy = vi.spyOn(notifDb, 'getNotifications').mockResolvedValue([]);
      const { handleGetNotifications } = await import('../src/handlers/notification.js');
      const req = new Request('https://worker.test/notifications?limit=10&offset=5');
      await handleGetNotifications(req, makeEnv());
      expect(spy).toHaveBeenCalledWith({}, expect.objectContaining({ limit: 10, offset: 5 }));
    });
  });
});
