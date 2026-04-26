import { jsonResponse, jsonError } from '../helpers.js';
import { QRISConverter } from '../qris-converter.js';
import {
  createPaymentExpectation,
  getExpectationByOrderRef,
  reserveUniqueAmount,
} from '../db/payment.js';

// ─── Convert ───────────────────────────────────────────────────────────────

export async function handleQRISConvert(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Invalid JSON body');

  const { staticQRIS, amount, serviceFee, orderRef } = body;

  if (!staticQRIS || !amount) {
    return jsonError('Missing required fields: staticQRIS, amount');
  }

  if (!QRISConverter.validateQRIS(staticQRIS)) {
    return jsonError('Invalid QRIS format - failed validation');
  }

  // Optionally append a unique suffix for order traceability
  let uniqueAmount = null;
  if (orderRef) {
    uniqueAmount = await reserveUniqueAmount(env.DB, orderRef);
  }

  const combinedAmount = uniqueAmount
    ? (parseInt(amount, 10) + parseInt(uniqueAmount, 10)).toString()
    : amount;

  const dynamicQRIS = QRISConverter.convertStaticToDynamic(staticQRIS, combinedAmount, serviceFee);

  console.log(`QRIS convert: ${amount} + ${uniqueAmount ?? 0} = ${combinedAmount}`);

  return jsonResponse({
    success:   true,
    staticQRIS,
    dynamicQRIS,
    amount:    combinedAmount,
    ...(uniqueAmount && {
      original_amount: amount,
      unique_amount:   uniqueAmount,
      combined_amount: combinedAmount,
      order_reference: orderRef,
      amount_type:     'combined',
    }),
    timestamp: new Date().toISOString(),
  });
}

// ─── Validate ──────────────────────────────────────────────────────────────

export async function handleQRISValidate(request) {
  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Invalid JSON body');

  const { qris } = body;
  if (!qris) return jsonError('Missing QRIS code');

  return jsonResponse({
    success:   true,
    valid:     QRISConverter.validateQRIS(qris),
    type:      qris.includes('010212') ? 'dynamic' : 'static',
    amount:    QRISConverter.extractAmount(qris),
    timestamp: new Date().toISOString(),
  });
}

// ─── Generate for Order ────────────────────────────────────────────────────

export async function handleQRISGenerateForOrder(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Invalid JSON body');

  const { staticQRIS, originalAmount, orderRef, callbackUrl, serviceFee } = body;

  if (!staticQRIS || !originalAmount || !orderRef) {
    return jsonError('Missing required fields: staticQRIS, originalAmount, orderRef');
  }

  if (!QRISConverter.validateQRIS(staticQRIS)) {
    return jsonError('Invalid QRIS format');
  }

  const uniqueAmount   = await reserveUniqueAmount(env.DB, orderRef);
  const combinedAmount = (parseInt(originalAmount, 10) + parseInt(uniqueAmount, 10)).toString();
  const dynamicQRIS    = QRISConverter.convertStaticToDynamic(staticQRIS, combinedAmount, serviceFee);

  const result = await createPaymentExpectation(env.DB, {
    orderRef, combinedAmount, uniqueAmount, originalAmount, callbackUrl,
  });

  console.log(`🎲 QRIS order ${orderRef}: ${originalAmount} + ${uniqueAmount} = ${combinedAmount}`);

  return jsonResponse({
    success:                true,
    order_reference:        orderRef,
    dynamic_qris:           dynamicQRIS,
    combined_amount:        combinedAmount,
    unique_amount:          uniqueAmount,
    original_amount:        originalAmount,
    amount_for_payment:     combinedAmount,
    payment_expectation_id: result.meta?.last_row_id,
    instructions: {
      customer: `Please pay exactly ${combinedAmount} IDR using the QR code`,
      system:   `Monitor notifications for amount ${combinedAmount} to confirm payment`,
    },
    timestamp: new Date().toISOString(),
  });
}

// ─── Unique Amount Lookup ──────────────────────────────────────────────────

export async function handleQRISUniqueAmount(request, env) {
  const pathParts = new URL(request.url).pathname.split('/');
  const orderRef  = pathParts[pathParts.length - 1];

  const row = await getExpectationByOrderRef(env.DB, orderRef);
  if (!row) return jsonError('Order not found', 404);

  return jsonResponse({
    success:         true,
    order_reference: orderRef,
    unique_amount:   row.unique_amount,
    original_amount: row.original_amount,
    status:          row.status,
    created_at:      row.created_at,
  });
}
