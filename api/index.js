import { CORS_HEADERS } from '../src/constants.js';
import { jsonResponse, jsonError } from '../src/helpers.js';
import { createTursoDB } from '../src/db/turso-adapter.js';
import { initializeTables } from '../src/db/init.js';
import {
  handleHealth,
  handleTest,
  handleWebhook,
  handleGetNotifications,
  handleGetDevices,
  handleGetStats,
} from '../src/handlers/notification.js';
import {
  handleQRISConvert,
  handleQRISValidate,
  handleQRISGenerateForOrder,
  handleQRISUniqueAmount,
} from '../src/handlers/qris.js';

// ─── Route table ───────────────────────────────────────────────────────────

const ROUTES = {
  '/api/health':                  { GET:  handleHealth },
  '/api/webhook':                 { POST: handleWebhook },
  '/api/test':                    { POST: handleTest },
  '/api/notifications':           { GET:  handleGetNotifications },
  '/api/devices':                 { GET:  handleGetDevices },
  '/api/stats':                   { GET:  handleGetStats },
  '/api/qris/convert':            { POST: handleQRISConvert },
  '/api/qris/validate':           { POST: handleQRISValidate },
  '/api/qris/generate-for-order': { POST: handleQRISGenerateForOrder },
  '/api/migrate':                 { POST: handleMigrate },
};

// ─── Migrate handler ───────────────────────────────────────────────────────

async function handleMigrate(request, env) {
  try {
    await initializeTables(env.DB);
    return jsonResponse({
      success:   true,
      message:   'Database migration completed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Migration failed:', err);
    return jsonError('Migration failed: ' + err.message, 500);
  }
}

// ─── Vercel Serverless Function ────────────────────────────────────────────

export default async function handler(request) {
  const url      = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, '') || '/'; // strip trailing slash
  const method   = request.method;

  // Preflight
  if (method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // Build env object (mirrors Cloudflare env structure)
  const env = {
    DB:              createTursoDB(),
    API_KEY:         process.env.API_KEY         || 'your-secret-api-key',
    CALLBACK_SECRET: process.env.CALLBACK_SECRET,
  };

  // API key guard (skipped for /api/health)
  if (pathname !== '/api/health' && env.API_KEY !== 'your-secret-api-key') {
    if (request.headers.get('x-api-key') !== env.API_KEY) {
      return addCors(jsonError('Invalid or missing API key', 401));
    }
  }

  try {
    const response = await route(pathname, method, request, env);
    return addCors(response);
  } catch (err) {
    console.error('Unhandled request error:', err);
    return addCors(jsonError('Internal server error', 500));
  }
}

// ─── Router ────────────────────────────────────────────────────────────────

async function route(pathname, method, request, env) {
  // Named routes
  if (ROUTES[pathname]) {
    const handler = ROUTES[pathname][method];
    return handler
      ? handler(request, env, {})
      : jsonError('Method not allowed', 405);
  }

  // Dynamic route: GET /api/qris/unique-amount/:orderRef
  if (pathname.startsWith('/api/qris/unique-amount/')) {
    return method === 'GET'
      ? handleQRISUniqueAmount(request, env)
      : jsonError('Method not allowed', 405);
  }

  return jsonError('Endpoint not found', 404);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function addCors(response) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

// ─── Vercel config ─────────────────────────────────────────────────────────
export const config = {
  runtime: 'nodejs',
};
