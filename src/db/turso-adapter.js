import { createClient } from '@libsql/client/web';

/**
 * Create a Turso/libSQL client wrapped in a D1-compatible interface.
 * This lets all existing db/*.js modules work without modification.
 *
 * Required env vars:
 *   TURSO_DATABASE_URL  — e.g. libsql://my-db-username.turso.io
 *   TURSO_AUTH_TOKEN     — from `turso db tokens create <db>`
 */
export function createTursoDB() {
  const url   = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url) throw new Error('TURSO_DATABASE_URL is not set');

  const client = createClient({
    url,
    authToken: token,
  });

  return wrapAsD1(client);
}

// ─── D1-compatible wrapper ─────────────────────────────────────────────────

/**
 * Wraps a libSQL Client so it exposes the same surface as Cloudflare D1:
 *   db.prepare(sql).bind(...args).run()   → { meta: { last_row_id } }
 *   db.prepare(sql).bind(...args).first() → row | null
 *   db.prepare(sql).bind(...args).all()   → { results: [...] }
 *   db.batch([stmt, ...])                 → [result, ...]
 */
function wrapAsD1(client) {
  return {
    prepare(sql) {
      return new D1Statement(client, sql);
    },

    async batch(statements) {
      const results = [];
      for (const stmt of statements) {
        // Each statement is a D1Statement — execute them in sequence
        results.push(await stmt.run());
      }
      return results;
    },
  };
}

class D1Statement {
  constructor(client, sql) {
    this._client = client;
    this._sql    = sql;
    this._args   = [];
  }

  bind(...args) {
    this._args = args;
    return this; // chainable
  }

  async run() {
    const result = await this._client.execute({
      sql:  this._sql,
      args: this._args,
    });
    return {
      meta: {
        last_row_id:   Number(result.lastInsertRowid ?? 0),
        rows_written:  result.rowsAffected ?? 0,
      },
    };
  }

  async first() {
    const result = await this._client.execute({
      sql:  this._sql,
      args: this._args,
    });
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async all() {
    const result = await this._client.execute({
      sql:  this._sql,
      args: this._args,
    });
    return { results: result.rows };
  }
}
