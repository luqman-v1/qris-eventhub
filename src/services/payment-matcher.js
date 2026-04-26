import {
  getPendingExpectationsByAmount,
  markExpectationCompleted,
} from '../db/payment.js';

// ─── Signature ─────────────────────────────────────────────────────────────

/**
 * Generate a SHA-256 hex signature for the callback payload.
 * String format (mirrors Lynk.id convention):
 *   amountDetected + orderReference + completedAt + secret
 *
 * @param {string} amountDetected
 * @param {string} orderReference
 * @param {string} completedAt   ISO timestamp
 * @param {string} secret        CALLBACK_SECRET from env
 * @returns {Promise<string>}    hex string
 */
export async function generateCallbackSignature(amountDetected, orderReference, completedAt, secret) {
  const message = amountDetected + orderReference + completedAt + secret;
  const encoded = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

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
/**
 * @param {D1Database} db
 * @param {{ text: string, title: string, bigText?: string, amountDetected: string }} notification
 * @param {string|undefined} callbackSecret  env.CALLBACK_SECRET
 */
export async function checkPaymentMatch(db, { text, title, bigText, amountDetected }, callbackSecret) {
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

  await completePayment(db, matched, { amountDetected, matchType }, callbackSecret);
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
async function completePayment(db, expectation, { amountDetected, matchType }, callbackSecret) {
  const completedAt = new Date().toISOString();

  await markExpectationCompleted(db, expectation.id, completedAt);
  console.log(`✅ Payment completed for order ${expectation.order_reference}`);

  if (expectation.callback_url) {
    const payload = {
      event:           'payment.completed',
      order_reference: expectation.order_reference,
      status:          'completed',
      amount_detected: amountDetected,
      expected_amount: expectation.expected_amount,
      original_amount: expectation.original_amount,
      unique_amount:   expectation.unique_amount,
      match_type:      matchType,
      completed_at:    completedAt,
    };
    await fireCallback(expectation.callback_url, payload, callbackSecret);
  }
}

/**
 * POST payment data to the merchant's callback URL.
 * Errors are caught and logged — a failing callback must never un-confirm a payment.
 * @param {string} url
 * @param {object} payload
 */
async function fireCallback(url, payload, callbackSecret) {
  try {
    const headers = { 'Content-Type': 'application/json' };

    if (callbackSecret) {
      headers['X-QRIS-Signature'] = await generateCallbackSignature(
        payload.amount_detected,
        payload.order_reference,
        payload.completed_at,
        callbackSecret,
      );
    } else {
      console.warn('⚠️  CALLBACK_SECRET not set — callback sent without signature');
    }

    console.log(`📡 Firing callback → ${url}`);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body:   JSON.stringify(payload),
    });
    console.log(`📡 Callback response: ${res.status} ${res.statusText}`);
  } catch (err) {
    console.error(`❌ Callback failed for order ${payload.order_reference}:`, err.message);
  }
}
