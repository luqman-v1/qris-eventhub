import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QRISConverter } from '../src/qris-converter.js';
import * as paymentDb from '../src/db/payment.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

const SAMPLE_STATIC = QRISConverter.generateSampleQRIS('Test Merchant');

function makeEnv(dbOverrides = {}) {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind:  vi.fn().mockReturnThis(),
        run:   vi.fn().mockResolvedValue({ meta: { last_row_id: 99 } }),
        first: vi.fn().mockResolvedValue(null),
        all:   vi.fn().mockResolvedValue({ results: [] }),
      }),
      ...dbOverrides,
    },
  };
}

function makeRequest(body, method = 'POST') {
  return new Request('https://worker.test/qris/generate-for-order', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('handlers/qris', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // ── handleQRISValidate ───────────────────────────────────────────────────

  describe('handleQRISValidate()', () => {
    it('returns valid:true for a correct QRIS', async () => {
      const { handleQRISValidate } = await import('../src/handlers/qris.js');
      const req = new Request('https://worker.test/qris/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qris: SAMPLE_STATIC }),
      });

      const res = await handleQRISValidate(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.valid).toBe(true);
    });

    it('returns 400 when qris field is missing', async () => {
      const { handleQRISValidate } = await import('../src/handlers/qris.js');
      const req = new Request('https://worker.test/qris/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await handleQRISValidate(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid JSON body', async () => {
      const { handleQRISValidate } = await import('../src/handlers/qris.js');
      const req = new Request('https://worker.test/qris/validate', {
        method: 'POST',
        body: 'NOT JSON',
      });

      const res = await handleQRISValidate(req);
      expect(res.status).toBe(400);
    });
  });

  // ── handleQRISConvert ────────────────────────────────────────────────────

  describe('handleQRISConvert()', () => {
    it('returns 400 when staticQRIS is missing', async () => {
      const { handleQRISConvert } = await import('../src/handlers/qris.js');
      const req = new Request('https://worker.test/qris/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: '50000' }),
      });
      const res = await handleQRISConvert(req, makeEnv());
      expect(res.status).toBe(400);
    });

    it('returns 400 when amount is missing', async () => {
      const { handleQRISConvert } = await import('../src/handlers/qris.js');
      const req = new Request('https://worker.test/qris/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staticQRIS: SAMPLE_STATIC }),
      });
      const res = await handleQRISConvert(req, makeEnv());
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid QRIS format', async () => {
      const { handleQRISConvert } = await import('../src/handlers/qris.js');
      const req = new Request('https://worker.test/qris/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staticQRIS: 'INVALID', amount: '50000' }),
      });
      const res = await handleQRISConvert(req, makeEnv());
      expect(res.status).toBe(400);
    });

    it('converts successfully without orderRef', async () => {
      const { handleQRISConvert } = await import('../src/handlers/qris.js');
      const req = new Request('https://worker.test/qris/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staticQRIS: SAMPLE_STATIC, amount: '50000' }),
      });
      const res = await handleQRISConvert(req, makeEnv());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.dynamicQRIS).toContain('010212');
    });
  });

  // ── handleQRISGenerateForOrder ───────────────────────────────────────────

  describe('handleQRISGenerateForOrder()', () => {
    it('returns 400 when required fields are missing', async () => {
      const { handleQRISGenerateForOrder } = await import('../src/handlers/qris.js');
      const req = makeRequest({ staticQRIS: SAMPLE_STATIC, originalAmount: '50000' }); // missing orderRef
      const res = await handleQRISGenerateForOrder(req, makeEnv());
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid QRIS', async () => {
      const { handleQRISGenerateForOrder } = await import('../src/handlers/qris.js');
      const req = makeRequest({ staticQRIS: 'BAD', originalAmount: '50000', orderRef: 'ORD-1' });
      const res = await handleQRISGenerateForOrder(req, makeEnv());
      expect(res.status).toBe(400);
    });

    it('stores payment expectation with null callbackUrl when not provided', async () => {
      const createSpy = vi.spyOn(paymentDb, 'createPaymentExpectation').mockResolvedValue({
        meta: { last_row_id: 42 },
      });
      vi.spyOn(paymentDb, 'reserveUniqueAmount').mockResolvedValue('007');

      const { handleQRISGenerateForOrder } = await import('../src/handlers/qris.js');
      const req = makeRequest({
        staticQRIS:     SAMPLE_STATIC,
        originalAmount: '50000',
        orderRef:       'ORD-001',
        // callbackUrl intentionally omitted
      });

      const res = await handleQRISGenerateForOrder(req, makeEnv());
      expect(res.status).toBe(200);

      expect(createSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ callbackUrl: undefined }),
      );

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.unique_amount).toBe('007');
      expect(body.combined_amount).toBe('50007');
      expect(body.payment_expectation_id).toBe(42);
    });

    it('includes callbackUrl in the DB record when provided', async () => {
      const createSpy = vi.spyOn(paymentDb, 'createPaymentExpectation').mockResolvedValue({
        meta: { last_row_id: 43 },
      });
      vi.spyOn(paymentDb, 'reserveUniqueAmount').mockResolvedValue('010');

      const { handleQRISGenerateForOrder } = await import('../src/handlers/qris.js');
      const req = makeRequest({
        staticQRIS:     SAMPLE_STATIC,
        originalAmount: '50000',
        orderRef:       'ORD-002',
        callbackUrl:    'https://merchant.example.com/callback',
      });

      await handleQRISGenerateForOrder(req, makeEnv());

      expect(createSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ callbackUrl: 'https://merchant.example.com/callback' }),
      );
    });
  });

  // ── handleQRISUniqueAmount ───────────────────────────────────────────────

  describe('handleQRISUniqueAmount()', () => {
    it('returns 404 when order not found', async () => {
      vi.spyOn(paymentDb, 'getExpectationByOrderRef').mockResolvedValue(null);
      const { handleQRISUniqueAmount } = await import('../src/handlers/qris.js');
      const req = new Request('https://worker.test/qris/unique-amount/ORD-999');
      const res = await handleQRISUniqueAmount(req, makeEnv());
      expect(res.status).toBe(404);
    });

    it('returns order details when found', async () => {
      vi.spyOn(paymentDb, 'getExpectationByOrderRef').mockResolvedValue({
        unique_amount:   '042',
        original_amount: '50000',
        status:          'pending',
        created_at:      '2026-04-26T10:00:00.000Z',
      });

      const { handleQRISUniqueAmount } = await import('../src/handlers/qris.js');
      const req = new Request('https://worker.test/qris/unique-amount/ORD-001');
      const res = await handleQRISUniqueAmount(req, makeEnv());
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.order_reference).toBe('ORD-001');
      expect(body.unique_amount).toBe('042');
    });
  });
});
