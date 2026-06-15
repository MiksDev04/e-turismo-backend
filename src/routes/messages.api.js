import express from 'express';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/messages/eligible-businesses
 * Admin only: Fetches all approved + warning businesses for the compose dropdown.
 */
router.get('/eligible-businesses', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const [rows] = await connection.execute(
      'SELECT id, business_name, status FROM businesses WHERE status IN ("approved", "warning") AND deleted_at IS NULL ORDER BY business_name ASC'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/messages/receiver-name/:businessId
 * Admin only: Fetches a single business name.
 */
router.get('/receiver-name/:businessId', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const [rows] = await connection.execute(
      'SELECT business_name FROM businesses WHERE id = ? AND status = "approved" AND deleted_at IS NULL LIMIT 1',
      [req.params.businessId]
    );
    if (rows.length === 0) return res.json(null);
    res.json(rows[0].business_name);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * POST /api/messages/send-selected
 * Admin only: Send to specific businesses.
 */
router.post('/send-selected', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  await connection.beginTransaction();
  try {
    const { businessIds, messageType, subject, content } = req.body;
    if (!businessIds || !businessIds.length || !messageType || !subject || !content) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const messageId = crypto.randomUUID();
    await connection.execute(
      'INSERT INTO messages (id, sender_id, message_type, subject, content, is_broadcast) VALUES (?, ?, ?, ?, ?, ?)',
      [messageId, req.user.id, messageType, subject.trim(), content.trim(), false]
    );

    for (const bizId of businessIds) {
      await connection.execute(
        'INSERT INTO message_recipients (message_id, business_id) VALUES (?, ?)',
        [messageId, bizId]
      );
    }

    await connection.commit();
    res.status(201).json({ messageId });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * POST /api/messages/send-all
 * Admin only: Broadcast to all eligible businesses.
 */
router.post('/send-all', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  await connection.beginTransaction();
  try {
    const { messageType, subject, content } = req.body;
    if (!messageType || !subject || !content) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const [businesses] = await connection.execute(
      'SELECT id FROM businesses WHERE status IN ("approved", "warning") AND deleted_at IS NULL'
    );

    if (businesses.length === 0) {
      return res.json({ messageId: '', recipientCount: 0 });
    }

    const messageId = crypto.randomUUID();
    await connection.execute(
      'INSERT INTO messages (id, sender_id, message_type, subject, content, is_broadcast) VALUES (?, ?, ?, ?, ?, ?)',
      [messageId, req.user.id, messageType, subject.trim(), content.trim(), true]
    );

    for (const biz of businesses) {
      await connection.execute(
        'INSERT INTO message_recipients (message_id, business_id) VALUES (?, ?)',
        [messageId, biz.id]
      );
    }

    await connection.commit();
    res.status(201).json({ messageId, recipientCount: businesses.length });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/messages/admin/outbox
 * Admin only: Fetch sent messages.
 */
router.get('/admin/outbox', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const [rows] = await connection.execute(
      `SELECT m.*, u.full_name as sender_name 
       FROM messages m 
       JOIN users u ON m.sender_id = u.id 
       WHERE m.sender_id = ? 
       ORDER BY m.created_at DESC`,
      [req.user.id]
    );
    
    // Map to expected Flutter format (nesting sender name)
    const result = rows.map(m => ({
      ...m,
      sender: { full_name: m.sender_name }
    }));

    res.json(result);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/messages/admin/report/:messageId
 * Admin only: Fetch delivery report.
 */
router.get('/admin/report/:messageId', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const [rows] = await connection.execute(
      `SELECT mr.*, b.business_name, b.status as business_status 
       FROM message_recipients mr 
       JOIN businesses b ON mr.business_id = b.id 
       WHERE mr.message_id = ? 
       ORDER BY mr.is_read ASC, b.business_name ASC`,
      [req.params.messageId]
    );

    const result = rows.map(r => ({
      ...r,
      business: { business_name: r.business_name, status: r.business_status }
    }));

    res.json(result);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/messages/business/inbox
 * Business only: Fetch received messages.
 */
router.get('/business/inbox', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const { includeArchived } = req.query;

    const [biz] = await connection.execute('SELECT id FROM businesses WHERE user_id = ?', [req.user.id]);
    if (biz.length === 0) return res.status(403).json({ message: 'No business found' });
    const businessId = biz[0].id;

    let query = `SELECT mr.*, m.message_type, m.subject, m.content, m.is_broadcast, m.created_at as sent_at, u.full_name as sender_name
                 FROM message_recipients mr
                 JOIN messages m ON mr.message_id = m.id
                 JOIN users u ON m.sender_id = u.id
                 WHERE mr.business_id = ?`;
    
    if (includeArchived !== 'true') {
      query += ` AND mr.status != 'archived'`;
    }

    query += ` ORDER BY mr.created_at DESC`;

    const [rows] = await connection.execute(query, [businessId]);

    const result = rows.map(r => ({
      ...r,
      message: {
        message_type: r.message_type,
        subject: r.subject,
        content: r.content,
        is_broadcast: r.is_broadcast,
        created_at: r.sent_at,
        sender: { full_name: r.sender_name }
      }
    }));

    res.json(result);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/messages/business/unread-count
 * Business only: Fetch unread count.
 */
router.get('/business/unread-count', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const [biz] = await connection.execute('SELECT id FROM businesses WHERE user_id = ?', [req.user.id]);
    if (biz.length === 0) return res.json(0);
    const businessId = biz[0].id;

    const [rows] = await connection.execute(
      'SELECT COUNT(*) as count FROM message_recipients WHERE business_id = ? AND is_read = FALSE',
      [businessId]
    );

    res.json(rows[0].count);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * PUT /api/messages/recipient/:recipientId/read
 * Shared/Business: Mark as read.
 */
router.put('/recipient/:recipientId/read', auth.authenticate, async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    await connection.execute(
      'UPDATE message_recipients SET is_read = TRUE, status = "read", read_at = NOW() WHERE id = ? AND is_read = FALSE',
      [req.params.recipientId]
    );
    res.json({ message: 'Marked as read' });
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * PUT /api/messages/recipient/:recipientId/archive
 * Shared/Business: Archive.
 */
router.put('/recipient/:recipientId/archive', auth.authenticate, async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    await connection.execute(
      'UPDATE message_recipients SET status = "archived" WHERE id = ?',
      [req.params.recipientId]
    );
    res.json({ message: 'Archived' });
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

export default router;
