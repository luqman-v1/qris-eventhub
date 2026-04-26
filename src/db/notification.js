/**
 * Insert a new notification record.
 * All fields default to null when not provided.
 * @param {D1Database} db
 * @param {object} fields
 * @returns {Promise<D1Result>}
 */
export async function insertNotification(db, {
  deviceId, packageName, appName, postedAt,
  title, text, subText, bigText,
  channelId, notificationId, amountDetected, extras,
}) {
  return db.prepare(`
    INSERT INTO notifications (
      device_id, package_name, app_name, posted_at, title, text,
      sub_text, big_text, channel_id, notification_id, amount_detected, extras
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    deviceId       ?? null,
    packageName    ?? null,
    appName        ?? null,
    postedAt       ?? null,
    title          ?? null,
    text           ?? null,
    subText        ?? null,
    bigText        ?? null,
    channelId      ?? null,
    notificationId ?? null,
    amountDetected ?? null,
    extras ? JSON.stringify(extras) : null,
  ).run();
}

/**
 * Fetch paginated notifications, optionally filtered by device.
 * @param {D1Database} db
 * @param {{ deviceId?: string, limit: number, offset: number }} opts
 * @returns {Promise<object[]>}
 */
export async function getNotifications(db, { deviceId, limit, offset }) {
  let query = 'SELECT * FROM notifications';
  const params = [];

  if (deviceId) {
    query += ' WHERE device_id = ?';
    params.push(deviceId);
  }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results = [] } = await db.prepare(query).bind(...params).all();
  return results;
}

/**
 * Fetch all devices ordered by last seen.
 * @param {D1Database} db
 * @returns {Promise<object[]>}
 */
export async function getDevices(db) {
  const { results = [] } = await db
    .prepare('SELECT * FROM devices ORDER BY last_seen DESC')
    .all();
  return results;
}

/**
 * Fetch aggregate stats for notifications and devices.
 * @param {D1Database} db
 * @returns {Promise<object>}
 */
export async function getStats(db) {
  const [totalNotifications, totalDevices, notificationsToday, topApps] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS count FROM notifications').first(),
    db.prepare('SELECT COUNT(*) AS count FROM devices').first(),
    db.prepare(`
      SELECT COUNT(*) AS count FROM notifications
      WHERE date(created_at) = date('now')
    `).first(),
    db.prepare(`
      SELECT package_name, app_name, COUNT(*) AS count
      FROM notifications
      GROUP BY package_name, app_name
      ORDER BY count DESC
      LIMIT 10
    `).all(),
  ]);

  return {
    totalNotifications: totalNotifications?.count ?? 0,
    totalDevices:       totalDevices?.count        ?? 0,
    notificationsToday: notificationsToday?.count  ?? 0,
    topApps:            topApps.results            ?? [],
  };
}
