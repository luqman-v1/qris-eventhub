import { UNIQUE_AMOUNT_TTL_MS, UNIQUE_AMOUNT_MAX, PAYMENT_MATCH_WINDOW_MIN } from '../constants.js';

// ─── Payment Expectations ──────────────────────────────────────────────────

/**
 * Create or replace a payment expectation for an order.
 * @param {D1Database} db
 * @param {object} fields
 * @returns {Promise<D1Result>}
 */
export async function createPaymentExpectation(db, {
  orderRef, combinedAmount, uniqueAmount, originalAmount, callbackUrl,
}) {
  return db.prepare(`
    INSERT OR REPLACE INTO payment_expectations (
      order_reference, expected_amount, unique_amount, original_amount, callback_url, created_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).bind(
    orderRef,
    combinedAmount,
    uniqueAmount,
    originalAmount,
    callbackUrl ?? null,
    new Date().toISOString(),
  ).run();
}

/**
 * Fetch pending payment expectations matching the given amount
 * within the configured time window.
 * @param {D1Database} db
 * @param {string} amountDetected
 * @returns {Promise<object[]>}
 */
export async function getPendingExpectationsByAmount(db, amountDetected) {
  const normalized = parseInt(amountDetected, 10).toString();

  const { results = [] } = await db.prepare(`
    SELECT * FROM payment_expectations
    WHERE (expected_amount = ? OR CAST(expected_amount AS INTEGER) = ?)
      AND status = 'pending'
      AND created_at > datetime('now', '-${PAYMENT_MATCH_WINDOW_MIN} minutes')
    ORDER BY created_at DESC
  `).bind(amountDetected, normalized).all();

  return results;
}

/**
 * Mark a payment expectation as completed.
 * @param {D1Database} db
 * @param {number} id
 * @param {string} completedAt  ISO string
 */
export async function markExpectationCompleted(db, id, completedAt) {
  await db.prepare(`
    UPDATE payment_expectations
    SET status = 'completed', completed_at = ?
    WHERE id = ?
  `).bind(completedAt, id).run();
}

/**
 * Get the latest payment expectation for an order.
 * @param {D1Database} db
 * @param {string} orderRef
 * @returns {Promise<object|null>}
 */
export async function getExpectationByOrderRef(db, orderRef) {
  return db.prepare(`
    SELECT unique_amount, original_amount, status, created_at
    FROM payment_expectations
    WHERE order_reference = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(orderRef).first();
}

// ─── Unique Amounts ────────────────────────────────────────────────────────

/**
 * Reserve a unique 3-digit suffix (001–200) for the given order.
 * Reuses an existing, non-expired reservation if available.
 * @param {D1Database} db
 * @param {string} orderRef
 * @returns {Promise<string>} e.g. "042"
 */
export async function reserveUniqueAmount(db, orderRef) {
  // Reuse if already assigned and still valid
  const existing = await db.prepare(`
    SELECT unique_amount FROM unique_amounts
    WHERE order_reference = ? AND expires_at > datetime('now')
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(orderRef).first();

  if (existing) {
    console.log(`♻️  Reusing unique amount ${existing.unique_amount} for order ${orderRef}`);
    return existing.unique_amount;
  }

  // Purge expired slots before allocating a new one
  await db.prepare(`DELETE FROM unique_amounts WHERE expires_at < datetime('now')`).run();

  // Find and reserve a free slot
  for (let attempt = 0; attempt < UNIQUE_AMOUNT_MAX; attempt++) {
    const candidate = String(Math.floor(Math.random() * UNIQUE_AMOUNT_MAX) + 1).padStart(3, '0');

    const taken = await db.prepare(`
      SELECT 1 FROM unique_amounts
      WHERE unique_amount = ? AND expires_at > datetime('now')
    `).bind(candidate).first();

    if (!taken) {
      const expiresAt = new Date(Date.now() + UNIQUE_AMOUNT_TTL_MS).toISOString();
      try {
        await db.prepare(`
          INSERT INTO unique_amounts (unique_amount, order_reference, expires_at)
          VALUES (?, ?, ?)
        `).bind(candidate, orderRef, expiresAt).run();

        console.log(`🎲 Unique amount ${candidate} reserved for order ${orderRef}`);
        return candidate;
      } catch {
        // Race condition — retry with a different candidate
        continue;
      }
    }
  }

  throw new Error('No unique amounts available (pool exhausted)');
}
