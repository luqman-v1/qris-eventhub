/**
 * Return a JSON response with the given data and HTTP status.
 * @param {object} data
 * @param {number} [status=200]
 */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Return a JSON error response.
 * @param {string} message
 * @param {number} [status=400]
 */
export function jsonError(message, status = 400) {
  return jsonResponse({ success: false, error: message }, status);
}
