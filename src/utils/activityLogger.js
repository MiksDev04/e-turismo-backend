import { pool as db } from '../config/db.js';

async function logActivity(actorId, actionType, refs = {}, details = null) {
  try {
    await db.query(
      `INSERT INTO activity_logs
        (actor_id, action_type, business_id, tourist_attraction_id, guest_record_id, visit_log_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        actorId ?? null,
        actionType,
        refs.businessId ?? null,
        refs.attractionId ?? null,
        refs.guestRecordId ?? null,
        refs.visitLogId ?? null,
        details ?? null,
      ]
    );
  } catch (err) {
    console.error('activity log insert failed:', err.message);
  }
}

// entries: [{ actorId, actionType, refs, details }]
async function logActivityBatch(entries) {
  if (!entries || entries.length === 0) return;
  try {
    const rows = entries.map((e) => [
      e.actorId ?? null,
      e.actionType,
      e.refs?.businessId ?? null,
      e.refs?.attractionId ?? null,
      e.refs?.guestRecordId ?? null,
      e.refs?.visitLogId ?? null,
      e.details ?? null,
    ]);
    await db.query(
      `INSERT INTO activity_logs
        (actor_id, action_type, business_id, tourist_attraction_id, guest_record_id, visit_log_id, details)
       VALUES ?`,
      [rows]
    );
  } catch (err) {
    console.error('activity log batch insert failed:', err.message);
  }
}

export { logActivity, logActivityBatch };