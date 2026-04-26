import { CORS_HEADERS } from './constants.js';
import { jsonError } from './helpers.js';
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

// ─── DB init guard ─────────────────────────────────────────────────────────
// Initialise tables once per isolate lifetime (Cloudflare Workers model)

let tablesInitialized = false;

async function ensureTablesExist(db) {
  if (tablesInitialized) return;
  try {
    await initializeTables(db);
    tablesInitialized = true;
  } catch (err) {
    console.error('DB init error:', err);
  }
}

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

    await ensureTablesExist(env.DB);

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