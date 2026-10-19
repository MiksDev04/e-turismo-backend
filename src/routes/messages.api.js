import express from 'express';
import db from '../config/db.js';
import auth from '../middleware/auth.js';
import mailer from '../utils/mailer.js';
import crypto from 'crypto';

const router = express.Router();

/**
 * GET /api/messages/eligible-businesses
 * Admin only: Fetches all approved + warning businesses for the compose dropdown.
 */
router.get('/eligible-businesses', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const [rows] = await connection.execute(
      `SELECT id, business_name, status FROM businesses WHERE status IN ('approved', 'warning') AND deleted_at IS NULL ORDER BY business_name ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/messages/eligible-attractions
 * Admin only: Fetches all approved + warning attractions for the compose dropdown.
 */
router.get('/eligible-attractions', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const [rows] = await connection.execute(
      `SELECT id, attraction_name, status FROM tourist_attractions WHERE status IN ('approved', 'warning') AND deleted_at IS NULL ORDER BY attraction_name ASC`
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
      "SELECT business_name FROM businesses WHERE id = ? AND status = 'approved' AND deleted_at IS NULL LIMIT 1",
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
    const { businessIds, attractionIds, messageType, subject, content } = req.body;
    const businesses = Array.isArray(businessIds) ? businessIds : [];
    const attractions = Array.isArray(attractionIds) ? attractionIds : [];
    if (businesses.length > 0 && attractions.length > 0) {
      return res.status(400).json({
        message: 'A message cannot target both businesses and attractions in one send; the letter text is audience-specific.',
      });
    }
    if ((businesses.length + attractions.length) === 0 || !messageType || !subject || !content) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const messageId = crypto.randomUUID();
    await connection.execute(
      'INSERT INTO messages (id, sender_id, message_type, subject, content, is_broadcast) VALUES (?, ?, ?, ?, ?, ?)',
      [messageId, req.user.id, messageType, subject.trim(), content.trim(), false]
    );

    for (const bizId of businesses) {
      await connection.execute(
        'INSERT INTO message_recipients (message_id, business_id) VALUES (?, ?)',
        [messageId, bizId]
      );
    }

    for (const attractionId of attractions) {
      await connection.execute(
        'INSERT INTO message_recipients (message_id, attraction_id) VALUES (?, ?)',
        [messageId, attractionId]
      );
    }

    // Fetch emails to send notifications
    const emailParams = [];
    let emailQuery = 'SELECT u.email FROM users u WHERE 1=0';
    if (businesses.length > 0) {
      emailParams.push(...businesses);
      emailQuery += ` OR u.id IN (SELECT user_id FROM businesses b WHERE b.id IN (${businesses.map(() => '?').join(',')}) AND u.email IS NOT NULL)`;
    }
    if (attractions.length > 0) {
      emailParams.push(...attractions);
      emailQuery += ` OR u.id IN (SELECT user_id FROM tourist_attractions ta WHERE ta.id IN (${attractions.map(() => '?').join(',')}) AND u.email IS NOT NULL)`;
    }
    const [recipients] = await connection.execute(emailQuery, emailParams);

    await connection.commit();

    // Send emails asynchronously after commit
    recipients.forEach(r => {
      mailer.sendSystemMessage(r.email, subject.trim(), content.trim(), messageType).catch(console.error);
    });

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
    const { recipientKind, messageType, subject, content } = req.body;
    if (!messageType || !subject || !content) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const kind = recipientKind === 'attraction' ? 'attraction' : 'business';

    if (kind === 'attraction') {
      const [attractions] = await connection.execute(
        "SELECT id FROM tourist_attractions WHERE status IN ('approved', 'warning') AND deleted_at IS NULL"
      );

      if (attractions.length === 0) {
        return res.json({ messageId: '', recipientCount: 0 });
      }

      const messageId = crypto.randomUUID();
      await connection.execute(
        'INSERT INTO messages (id, sender_id, message_type, subject, content, is_broadcast) VALUES (?, ?, ?, ?, ?, ?)',
        [messageId, req.user.id, messageType, subject.trim(), content.trim(), true]
      );

      for (const att of attractions) {
        await connection.execute(
          'INSERT INTO message_recipients (message_id, attraction_id) VALUES (?, ?)',
          [messageId, att.id]
        );
      }

      // Fetch emails to send notifications
      const [recipients] = await connection.execute(
        `SELECT u.email 
         FROM tourist_attractions ta 
         JOIN users u ON ta.user_id = u.id 
         WHERE ta.status IN ('approved', 'warning') AND ta.deleted_at IS NULL AND u.email IS NOT NULL`
      );

      await connection.commit();

      // Send emails asynchronously after commit
      recipients.forEach(r => {
        mailer.sendSystemMessage(r.email, subject.trim(), content.trim(), messageType).catch(console.error);
      });

      return res.status(201).json({ messageId, recipientCount: attractions.length });
    }

    const [businesses] = await connection.execute(
      "SELECT id FROM businesses WHERE status IN ('approved', 'warning') AND deleted_at IS NULL"
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

    // Fetch emails to send notifications
    const [recipients] = await connection.execute(
      `SELECT u.email 
       FROM businesses b 
       JOIN users u ON b.user_id = u.id 
       WHERE b.status IN ('approved', 'warning') AND b.deleted_at IS NULL AND u.email IS NOT NULL`
    );

    await connection.commit();

    // Send emails asynchronously after commit
    recipients.forEach(r => {
      mailer.sendSystemMessage(r.email, subject.trim(), content.trim(), messageType).catch(console.error);
    });

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
 * Admin only: Fetch paginated sent messages.
 * Query params: page, pageSize, searchQuery, type, scope
 */
router.get('/admin/outbox', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const {
      page = '1',
      pageSize = '10',
      searchQuery,
      type,
      scope,
      audience,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limit   = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
    const offset  = (pageNum - 1) * limit;

    // ── Build WHERE clause ────────────────────────────────────────────────
    const conditions = ['m.sender_id = ?'];
    const params     = [req.user.id];

    if (searchQuery) {
      conditions.push('(m.subject LIKE ? OR u.full_name LIKE ?)');
      const like = `%${searchQuery}%`;
      params.push(like, like);
    }

    if (type && type !== 'all' && type !== 'All Types') {
      conditions.push('m.message_type = ?');
      params.push(type.toLowerCase());
    }

    if (scope === 'Broadcast') {
      conditions.push('m.is_broadcast = TRUE');
    } else if (scope === 'Targeted') {
      conditions.push('m.is_broadcast = FALSE');
    }

    if (audience === 'Attraction') {
      conditions.push(
        'EXISTS (SELECT 1 FROM message_recipients rk WHERE rk.message_id = m.id AND rk.attraction_id IS NOT NULL)'
      );
    } else if (audience === 'Business') {
      conditions.push(
        'EXISTS (SELECT 1 FROM message_recipients rk WHERE rk.message_id = m.id AND rk.business_id IS NOT NULL)'
      );
    }

    const whereClause = conditions.join(' AND ');

    // ── Count total ───────────────────────────────────────────────────────
    const [countRows] = await connection.query(
      `SELECT COUNT(*) as total FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE ${whereClause}`,
      params
    );
    const totalCount = countRows[0].total;

    if (totalCount === 0) {
      return res.json({ data: [], totalCount: 0, pageCount: 0 });
    }

    // ── Fetch paginated rows ──────────────────────────────────────────────
    const [rows] = await connection.query(
      `SELECT m.*, u.full_name as sender_name,
              CASE WHEN EXISTS (SELECT 1 FROM message_recipients rk WHERE rk.message_id = m.id AND rk.attraction_id IS NOT NULL)
                   THEN 'attraction' ELSE 'business' END AS recipient_kind
       FROM messages m 
       JOIN users u ON m.sender_id = u.id 
       WHERE ${whereClause}
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const data = rows.map(m => ({
      ...m,
      sender: { full_name: m.sender_name }
    }));

    res.json({ data, totalCount, pageCount: Math.ceil(totalCount / limit) });
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
      `SELECT mr.*, b.business_name, b.status as business_status,
              ta.attraction_name, ta.status as attraction_status
       FROM message_recipients mr
       LEFT JOIN businesses b ON mr.business_id = b.id
       LEFT JOIN tourist_attractions ta ON mr.attraction_id = ta.id
       WHERE mr.message_id = ?
       ORDER BY mr.is_read ASC`,
      [req.params.messageId]
    );

    const result = rows.map(r => {
      const name = r.business_name || r.attraction_name || '—';
      const status = r.business_status || r.attraction_status || 'unknown';
      return {
        ...r,
        recipient_kind: r.business_id ? 'business' : 'attraction',
        business: { business_name: name, status },
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/messages/business/inbox
 * Business only: Fetch paginated received messages.
 * Query params: page, pageSize, includeArchived, searchQuery
 */
router.get('/business/inbox', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const {
      page = '1',
      pageSize = '10',
      includeArchived,
      searchQuery,
      type,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limit   = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
    const offset  = (pageNum - 1) * limit;

    const [biz] = await connection.query('SELECT id FROM businesses WHERE user_id = ?', [req.user.id]);
    if (biz.length === 0) return res.status(403).json({ message: 'No business found' });
    const businessId = biz[0].id;

    // ── Build WHERE clause ────────────────────────────────────────────────
    const conditions = ['mr.business_id = ?'];
    const params     = [businessId];

    if (includeArchived !== 'true') {
      conditions.push("mr.status != 'archived'");
    }

    if (searchQuery) {
      conditions.push('(m.subject LIKE ? OR m.content LIKE ?)');
      const like = `%${searchQuery}%`;
      params.push(like, like);
    }

    if (type && type !== 'all' && type !== 'All') {
      conditions.push('m.message_type = ?');
      params.push(type.toLowerCase());
    }

    const whereClause = conditions.join(' AND ');

    // ── Count total ───────────────────────────────────────────────────────
    const [countRows] = await connection.query(
      `SELECT COUNT(*) as total
       FROM message_recipients mr
       JOIN messages m ON mr.message_id = m.id
       WHERE ${whereClause}`,
      params
    );
    const totalCount = countRows[0].total;

    if (totalCount === 0) {
      return res.json({ data: [], totalCount: 0, pageCount: 0 });
    }

    // ── Fetch paginated rows ──────────────────────────────────────────────
    const [rows] = await connection.query(
      `SELECT mr.*, m.message_type, m.subject, m.content, m.is_broadcast, m.created_at as sent_at, u.full_name as sender_name
       FROM message_recipients mr
       JOIN messages m ON mr.message_id = m.id
       JOIN users u ON m.sender_id = u.id
       WHERE ${whereClause}
       ORDER BY mr.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const data = rows.map(r => ({
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

    res.json({ data, totalCount, pageCount: Math.ceil(totalCount / limit) });
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
 * GET /api/messages/attraction/inbox
 * Attraction only: Fetch paginated received messages.
 * Query params: page, pageSize, includeArchived, searchQuery, type
 */
router.get('/attraction/inbox', auth.authenticate, auth.requireRole('attraction'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const {
      page = '1',
      pageSize = '10',
      includeArchived,
      searchQuery,
      type,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limit   = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
    const offset  = (pageNum - 1) * limit;

    const [att] = await connection.query('SELECT id FROM tourist_attractions WHERE user_id = ?', [req.user.id]);
    if (att.length === 0) return res.status(403).json({ message: 'No attraction found' });
    const attractionId = att[0].id;

    // ── Build WHERE clause ────────────────────────────────────────────────
    const conditions = ['mr.attraction_id = ?'];
    const params     = [attractionId];

    if (includeArchived !== 'true') {
      conditions.push("mr.status != 'archived'");
    }

    if (searchQuery) {
      conditions.push('(m.subject LIKE ? OR m.content LIKE ?)');
      const like = `%${searchQuery}%`;
      params.push(like, like);
    }

    if (type && type !== 'all' && type !== 'All') {
      conditions.push('m.message_type = ?');
      params.push(type.toLowerCase());
    }

    const whereClause = conditions.join(' AND ');

    // ── Count total ───────────────────────────────────────────────────────
    const [countRows] = await connection.query(
      `SELECT COUNT(*) as total
       FROM message_recipients mr
       JOIN messages m ON mr.message_id = m.id
       WHERE ${whereClause}`,
      params
    );
    const totalCount = countRows[0].total;

    if (totalCount === 0) {
      return res.json({ data: [], totalCount: 0, pageCount: 0 });
    }

    // ── Fetch paginated rows ──────────────────────────────────────────────
    const [rows] = await connection.query(
      `SELECT mr.*, m.message_type, m.subject, m.content, m.is_broadcast, m.created_at as sent_at, u.full_name as sender_name
       FROM message_recipients mr
       JOIN messages m ON mr.message_id = m.id
       JOIN users u ON m.sender_id = u.id
       WHERE ${whereClause}
       ORDER BY mr.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const data = rows.map(r => ({
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

    res.json({ data, totalCount, pageCount: Math.ceil(totalCount / limit) });
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/messages/attraction/unread-count
 * Attraction only: Fetch unread count.
 */
router.get('/attraction/unread-count', auth.authenticate, auth.requireRole('attraction'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const [att] = await connection.execute('SELECT id FROM tourist_attractions WHERE user_id = ?', [req.user.id]);
    if (att.length === 0) return res.json(0);
    const attractionId = att[0].id;

    const [rows] = await connection.execute(
      'SELECT COUNT(*) as count FROM message_recipients WHERE attraction_id = ? AND is_read = FALSE',
      [attractionId]
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
      `UPDATE message_recipients SET is_read = TRUE, status = 'read', read_at = NOW() WHERE id = ? AND is_read = FALSE`,
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
      `UPDATE message_recipients SET status = 'archived' WHERE id = ?`,
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
