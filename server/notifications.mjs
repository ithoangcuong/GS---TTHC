import { randomUUID } from 'node:crypto';

export const NOTIFICATION_CHANNELS = Object.freeze(['IN_APP', 'EMAIL', 'SMS', 'ZALO_OA', 'TEAMS', 'TELEGRAM', 'WEBHOOK']);

/** Persist in the same transaction as alert escalation. External delivery is separate. */
export class InAppNotificationAdapter {
  constructor(db) { this.db = db; this.channel = 'IN_APP'; this.status = 'CONFIGURED'; }
  send({ alertId, caseId, message, createdAt = Date.now() }) {
    this.db.prepare('INSERT INTO notifications VALUES (?,?,?,?,?)').run(randomUUID(), alertId, caseId, message, createdAt);
  }
}

/** Explicit unavailable adapter; never invent endpoints, credentials or send messages. */
export class UnconfiguredNotificationAdapter {
  constructor(channel) {
    if (!NOTIFICATION_CHANNELS.includes(channel) || channel === 'IN_APP') throw new Error('Kênh thông báo không hợp lệ.');
    this.channel = channel; this.status = 'NOT_CONFIGURED';
  }
  async send() { throw new Error(`Kênh ${this.channel} cần cấu hình và thông tin tích hợp được xác nhận.`); }
}

export function listNotifications(db, { where, params }) {
  return db.prepare(`SELECT n.* FROM notifications n JOIN cases c ON c.id=n.caseId ${where} ORDER BY n.createdAt DESC LIMIT 50`).all(...params);
}
