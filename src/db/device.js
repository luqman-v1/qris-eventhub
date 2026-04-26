/**
 * Upsert a device record and increment its notification counter.
 * @param {D1Database} db
 * @param {string} deviceId
 * @param {string} timestamp  ISO string
 */
export async function upsertDevice(db, deviceId, timestamp) {
  await db.prepare(`
    INSERT OR REPLACE INTO devices (device_id, last_seen, total_notifications)
    VALUES (
      ?,
      ?,
      COALESCE((SELECT total_notifications FROM devices WHERE device_id = ?) + 1, 1)
    )
  `).bind(deviceId, timestamp, deviceId).run();
}
