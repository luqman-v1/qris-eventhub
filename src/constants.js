export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
};

/** Unique amount reservation TTL (1 hour) */
export const UNIQUE_AMOUNT_TTL_MS = 60 * 60 * 1000;

/** Window (in minutes) to search for matching payment expectations */
export const PAYMENT_MATCH_WINDOW_MIN = 5;

/** Max unique suffix value (001–200) */
export const UNIQUE_AMOUNT_MAX = 200;
