import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkPaymentMatch } from '../src/services/payment-matcher.js';
import * as paymentDb from '../src/db/payment.js';

// ─── DB mock helpers ───────────────────────────────────────────────────────

function makePendingExpectation(overrides = {}) {
  return {
    id:               1,
    order_reference:  'ORDER-001',
    expected_amount:  '50075',
    original_amount:  '50000',
    unique_amount:    '075',
    callback_url:     null,
    status:           'pending',
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('payment-matcher / checkPaymentMatch()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Suppress console output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('does nothing when no pending expectations found', async () => {
    vi.spyOn(paymentDb, 'getPendingExpectationsByAmount').mockResolvedValue([]);
    const markSpy = vi.spyOn(paymentDb, 'markExpectationCompleted');

    await checkPaymentMatch({}, { text: 'hi', title: 'test', bigText: '', amountDetected: '50075' });

    expect(markSpy).not.toHaveBeenCalled();
  });

  it('matches by order reference found in notification text', async () => {
    const expectation = makePendingExpectation();
    vi.spyOn(paymentDb, 'getPendingExpectationsByAmount').mockResolvedValue([expectation]);
    const markSpy = vi.spyOn(paymentDb, 'markExpectationCompleted').mockResolvedValue();

    await checkPaymentMatch({}, {
      text:           'Pembayaran ORDER-001 berhasil',
      title:          'QRIS',
      bigText:        '',
      amountDetected: '50075',
    });

    expect(markSpy).toHaveBeenCalledWith({}, 1, expect.any(String));
  });

  it('matches by amount-only when exactly one expectation exists', async () => {
    const expectation = makePendingExpectation();
    vi.spyOn(paymentDb, 'getPendingExpectationsByAmount').mockResolvedValue([expectation]);
    const markSpy = vi.spyOn(paymentDb, 'markExpectationCompleted').mockResolvedValue();

    await checkPaymentMatch({}, {
      text:           'Pembayaran berhasil',
      title:          'BNI',
      bigText:        '',
      amountDetected: '50075',
    });

    expect(markSpy).toHaveBeenCalled();
  });

  it('does NOT match when multiple expectations exist and order ref not in text', async () => {
    const expectations = [
      makePendingExpectation({ id: 1, order_reference: 'ORDER-001' }),
      makePendingExpectation({ id: 2, order_reference: 'ORDER-002' }),
    ];
    vi.spyOn(paymentDb, 'getPendingExpectationsByAmount').mockResolvedValue(expectations);
    const markSpy = vi.spyOn(paymentDb, 'markExpectationCompleted').mockResolvedValue();

    await checkPaymentMatch({}, {
      text:           'Generic payment notification',
      title:          'Bank',
      bigText:        '',
      amountDetected: '50075',
    });

    expect(markSpy).not.toHaveBeenCalled();
  });

  it('does NOT complete payment when detected amount does not match expected', async () => {
    const expectation = makePendingExpectation({ expected_amount: '99999' });
    vi.spyOn(paymentDb, 'getPendingExpectationsByAmount').mockResolvedValue([expectation]);
    const markSpy = vi.spyOn(paymentDb, 'markExpectationCompleted').mockResolvedValue();

    await checkPaymentMatch({}, {
      text:           'ORDER-001',
      title:          'BNI',
      bigText:        '',
      amountDetected: '50075',
    });

    expect(markSpy).not.toHaveBeenCalled();
  });

  it('fires callback URL after successful match', async () => {
    const expectation = makePendingExpectation({ callback_url: 'https://example.com/callback' });
    vi.spyOn(paymentDb, 'getPendingExpectationsByAmount').mockResolvedValue([expectation]);
    vi.spyOn(paymentDb, 'markExpectationCompleted').mockResolvedValue();

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      status: 200, statusText: 'OK',
    });

    await checkPaymentMatch({}, {
      text:           'ORDER-001',
      title:          'QRIS',
      bigText:        '',
      amountDetected: '50075',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/callback',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does NOT throw when callback URL request fails', async () => {
    const expectation = makePendingExpectation({ callback_url: 'https://broken.example.com' });
    vi.spyOn(paymentDb, 'getPendingExpectationsByAmount').mockResolvedValue([expectation]);
    vi.spyOn(paymentDb, 'markExpectationCompleted').mockResolvedValue();
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    // Should not throw
    await expect(checkPaymentMatch({}, {
      text:           'ORDER-001',
      title:          'QRIS',
      bigText:        '',
      amountDetected: '50075',
    })).resolves.toBeUndefined();
  });
});
