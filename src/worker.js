import { CORS_HEADERS } from './constants.js';
import { jsonResponse, jsonError } from './helpers.js';
import { initializeTables } from './db/init.js';
import {
  handleHealth,
  handleTest,
  handleWebhook,
  handleGetNotifications,
  handleGetDevices,
  handleGetStats,
} from './handlers/notification.js';
import {
  handleQRISConvert,
  handleQRISValidate,
  handleQRISGenerateForOrder,
  handleQRISUniqueAmount,
} from './handlers/qris.js';

// ─── Route table ───────────────────────────────────────────────────────────
// { [pathname]: { [method]: handler } }

const ROUTES = {
  '/health':                  { GET:  handleHealth },
  '/webhook':                 { POST: handleWebhook },
  '/test':                    { POST: handleTest },
  '/notifications':           { GET:  handleGetNotifications },
  '/devices':                 { GET:  handleGetDevices },
  '/stats':                   { GET:  handleGetStats },
  '/qris/convert':            { POST: handleQRISConvert },
  '/qris/validate':           { POST: handleQRISValidate },
  '/qris/generate-for-order': { POST: handleQRISGenerateForOrder },
};

// ─── Worker entry point ────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const { method }   = request;

    // Preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // API key guard (skipped for /health and when key is unconfigured)
    const requiredKey = env.API_KEY || 'your-secret-api-key';
    if (pathname !== '/health' && requiredKey !== 'your-secret-api-key') {
      if (request.headers.get('x-api-key') !== requiredKey) {
        return jsonError('Invalid or missing API key', 401);
      }
    }

    try {
      const response = await route(pathname, method, request, env, ctx);

      // Attach CORS headers to every response
      for (const [key, value] of Object.entries(CORS_HEADERS)) {
        response.headers.set(key, value);
      }

      return response;
    } catch (err) {
      console.error('Unhandled request error:', err);
      return jsonError('Internal server error', 500);
    }
  },
};

// ─── Router ────────────────────────────────────────────────────────────────

async function route(pathname, method, request, env, ctx) {
  // Migration endpoint — run once after deploy
  if (pathname === '/migrate') {
    if (method !== 'POST') return jsonError('Method not allowed', 405);
    return handleMigrate(env);
  }

  // Named routes
  if (ROUTES[pathname]) {
    const handler = ROUTES[pathname][method];
    return handler
      ? handler(request, env, ctx)
      : jsonError('Method not allowed', 405);
  }

  // Dynamic route: GET /qris/unique-amount/:orderRef
  if (pathname.startsWith('/qris/unique-amount/')) {
    return method === 'GET'
      ? handleQRISUniqueAmount(request, env)
      : jsonError('Method not allowed', 405);
  }

  return jsonError('Endpoint not found', 404);
}

// ─── Migration handler ────────────────────────────────────────────────────

async function handleMigrate(env) {
  try {
    await initializeTables(env.DB);
    console.log('✅ Database migration completed');
    return jsonResponse({
      success:   true,
      message:   'Database migration completed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('❌ Migration failed:', err);
    return jsonError('Migration failed: ' + err.message, 500);
  }
}