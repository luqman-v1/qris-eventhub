import {
  getPendingExpectationsByAmount,
  markExpectationCompleted,
} from '../db/payment.js';

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Attempt to match an incoming notification amount to a pending payment expectation.
 * Match priority:
 *   1. Order reference found in notification text
 *   2. Amount-only match (only safe when exactly one expectation exists)
 *
 * @param {D1Database} db
 * @param {{ text: string, title: string, bigText?: string, amountDetected: string }} notification
 */
export async function checkPaymentMatch(db, { text, title, bigText, amountDetected }) {
  const expectations = await getPendingExpectationsByAmount(db, amountDetected);

  if (expectations.length === 0) {
    console.log(`🔍 No pending expectations for amount ${amountDetected}`);
    return;
  }

  const { matched, matchType } = resolveMatch(expectations, { text, title, bigText, amountDetected });

  if (!matched) {
    console.log('❌ No payment expectation matched');
    return;
  }

  console.log(`✅ Matched order ${matched.order_reference} via ${matchType}`);

  const normalizedDetected = parseInt(amountDetected, 10).toString();
  const normalizedExpected = parseInt(matched.expected_amount, 10).toString();

  if (normalizedDetected !== normalizedExpected) {
    console.error(`❌ Amount mismatch: expected ${normalizedExpected}, got ${normalizedDetected}`);
    return;
  }

  await completePayment(db, matched, { amountDetected, matchType });
}

// ─── Internal ──────────────────────────────────────────────────────────────

/**
 * Find the best matching expectation from a list.
 * @param {object[]} expectations
 * @param {{ text: string, title: string, bigText?: string, amountDetected: string }} notification
 * @returns {{ matched: object|null, matchType: string }}
 */
function resolveMatch(expectations, { text, title, bigText, amountDetected }) {
  const searchText = [text, title, bigText].filter(Boolean).join(' ').toLowerCase();

  // Priority 1: order reference found in notification body
  for (const expectation of expectations) {
    if (searchText.includes(expectation.order_reference.toLowerCase())) {
      return { matched: expectation, matchType: 'order_reference_match' };
    }
  }

  // Priority 2: amount-only match — only safe when unambiguous
  if (expectations.length === 1) {
    return { matched: expectations[0], matchType: 'amount_only_match' };
  }

  console.log(`❌ Ambiguous: ${expectations.length} expectations for amount ${amountDetected}`);
  return { matched: null, matchType: 'none' };
}

/**
 * Mark a payment as completed and trigger the merchant callback (if configured).
 * @param {D1Database} db
 * @param {object} expectation
 * @param {{ amountDetected: string, matchType: string }} meta
 */
async function completePayment(db, expectation, { amountDetected, matchType }) {
  const completedAt = new Date().toISOString();

  await markExpectationCompleted(db, expectation.id, completedAt);
  console.log(`✅ Payment completed for order ${expectation.order_reference}`);

  if (expectation.callback_url) {
    await fireCallback(expectation.callback_url, {
      event:           'payment.completed',
      order_reference: expectation.order_reference,
      status:          'completed',
      amount_detected: amountDetected,
      expected_amount: expectation.expected_amount,
      original_amount: expectation.original_amount,
      unique_amount:   expectation.unique_amount,
      match_type:      matchType,
      completed_at:    completedAt,
    });
  }
}

/**
 * POST payment data to the merchant's callback URL.
 * Errors are caught and logged — a failing callback must never un-confirm a payment.
 * @param {string} url
 * @param {object} payload
 */
async function fireCallback(url, payload) {
  try {
    console.log(`📡 Firing callback → ${url}`);
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    console.log(`📡 Callback response: ${res.status} ${res.statusText}`);
  } catch (err) {
    console.error(`❌ Callback failed for order ${payload.order_reference}:`, err.message);
  }
}
