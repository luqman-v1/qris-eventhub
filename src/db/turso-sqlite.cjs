const { createClient } = require('@libsql/client/web');
require('dotenv').config();

/**
 * A wrapper around Turso/libSQL that mimics the sqlite3 callback API.
 * This allows the existing Express application to use Turso without rewriting
 * all the database queries.
 */
class Database {
    constructor(dbPathOrUrl) {
        // If it's a local file path, use it, but if TURSO_DATABASE_URL is provided, use that.
        const url = process.env.TURSO_DATABASE_URL || dbPathOrUrl;
        const authToken = process.env.TURSO_AUTH_TOKEN;

        console.log(`🔌 Initializing Database Connection (Turso)`);
        
        this.client = createClient({
            url: url,
            authToken: authToken
        });
    }

    _normalizeParams(params, callback) {
        if (typeof params === 'function') {
            return { args: [], cb: params };
        }
        return { args: params || [], cb: callback };
    }

    run(sql, params, callback) {
        const { args, cb } = this._normalizeParams(params, callback);
        
        this.client.execute({ sql, args })
            .then(result => {
                if (cb) {
                    // Mimic sqlite3 context binding for this.lastID and this.changes
                    const context = {
                        lastID: result.lastInsertRowid ? Number(result.lastInsertRowid) : 0,
                        changes: result.rowsAffected
                    };
                    cb.call(context, null);
                }
            })
            .catch(err => {
                console.error(`DB Run Error: ${sql}`, err);
                if (cb) cb(err);
            });
        
        return this;
    }

    all(sql, params, callback) {
        const { args, cb } = this._normalizeParams(params, callback);
        
        this.client.execute({ sql, args })
            .then(result => {
                if (cb) cb(null, result.rows);
            })
            .catch(err => {
                console.error(`DB All Error: ${sql}`, err);
                if (cb) cb(err, []);
            });
            
        return this;
    }

    get(sql, params, callback) {
        const { args, cb } = this._normalizeParams(params, callback);
        
        this.client.execute({ sql, args })
            .then(result => {
                if (cb) cb(null, result.rows.length > 0 ? result.rows[0] : null);
            })
            .catch(err => {
                console.error(`DB Get Error: ${sql}`, err);
                if (cb) cb(err, null);
            });
            
        return this;
    }

    serialize(callback) {
        // Turso executes sequentially for standard HTTP execute, 
        // but since we are wrapping Promises into callbacks, 
        // we just call it immediately. For table creation it will be slightly parallel
        // but typically safe for IF NOT EXISTS.
        if (callback) callback();
    }

    close(callback) {
        try {
            this.client.close();
            if (callback) callback(null);
        } catch (err) {
            if (callback) callback(err);
        }
    }
}

module.exports = { Database };
