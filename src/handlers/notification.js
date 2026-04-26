import { jsonResponse, jsonError } from '../helpers.js';
import { upsertDevice } from '../db/device.js';
import {
  insertNotification,
  getNotifications,
  getDevices,
  getStats,
} from '../db/notification.js';
import { checkPaymentMatch } from '../services/payment-matcher.js';

// ─── Health ────────────────────────────────────────────────────────────────

export async function handleHealth() {
  return jsonResponse({
    status:    'OK',
    timestamp: new Date().toISOString(),
    platform:  'Cloudflare Workers',
  });
}

// ─── Test ──────────────────────────────────────────────────────────────────

export async function handleTest(request) {
  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Invalid JSON body');

  console.log('Test notification received:', body);
  return jsonResponse({
    success:   true,
    message:   'Test notification received successfully',
    timestamp: new Date().toISOString(),
    data:      body,
  });
}

// ─── Webhook ───────────────────────────────────────────────────────────────

export async function handleWebhook(request, env, ctx) {
  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Invalid JSON body');

  const {
    deviceId, packageName, appName, postedAt,
    title, text, subText, bigText,
    channelId, notificationId, amountDetected, extras,
  } = body;

  if (!deviceId || !packageName) {
    return jsonError('Missing required fields: deviceId, packageName');
  }

  const timestamp = new Date().toISOString();

  // Device upsert is non-fatal
  await upsertDevice(env.DB, deviceId, timestamp).catch(err =>
    console.error('Device upsert failed:', err),
  );

  const result = await insertNotification(env.DB, {
    deviceId, packageName, appName, postedAt,
    title, text, subText, bigText,
    channelId, notificationId, amountDetected, extras,
  });

  console.log(`Notification #${result.meta?.last_row_id} from ${deviceId} (${packageName})`);

  // Payment matching runs in background — doesn't block the response
  if (amountDetected) {
    const matchTask = checkPaymentMatch(env.DB, { text, title, bigText, amountDetected }, env.CALLBACK_SECRET)
      .catch(err => console.error('Background payment match error:', err));

    ctx?.waitUntil ? ctx.waitUntil(matchTask) : await matchTask;
  }

  return jsonResponse({
    success:   true,
    message:   'Notification received successfully',
    id:        result.meta?.last_row_id,
    timestamp,
  });
}

// ─── Notifications ─────────────────────────────────────────────────────────

export async function handleGetNotifications(request, env) {
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get('device_id');
  const limit    = parseInt(searchParams.get('limit')  || '100', 10);
  const offset   = parseInt(searchParams.get('offset') || '0',   10);

  const results = await getNotifications(env.DB, { deviceId, limit, offset });
  return jsonResponse({ success: true, data: results, count: results.length });
}

// ─── Devices ───────────────────────────────────────────────────────────────

export async function handleGetDevices(request, env) {
  const results = await getDevices(env.DB);
  return jsonResponse({ success: true, data: results, count: results.length });
}

// ─── Stats ─────────────────────────────────────────────────────────────────

export async function handleGetStats(request, env) {
  const data = await getStats(env.DB);
  return jsonResponse({ success: true, data });
}
