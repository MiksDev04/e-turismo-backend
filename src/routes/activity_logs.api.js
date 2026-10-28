import express from 'express';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();
const businessRouter = express.Router();
const attractionRouter = express.Router();

const adminGuard = [auth.authenticate, auth.requireRole('admin')];
const businessGuard = [auth.authenticate, auth.requireRole('business')];
const attractionGuard = [auth.authenticate, auth.requireRole('attraction')];

async function handleFetch(req, res, next, scopeType = 'admin') {
  try {
    const { action_type, date_from, date_to } = req.query;
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 20;
    if (limit > 100) limit = 100;

    const offset = (page - 1) * limit;

    const actionTypeFilter = action_type || null;
    const dateFromFilter = date_from || null;
    const dateToFilter = date_to || null;

    let scopeWhere = '';
    let scopeParams = [];
    if (scopeType === 'business') {
      scopeWhere =
        'AND (al.actor_id = ? OR al.business_id IN (SELECT id FROM businesses WHERE user_id = ?))';
      scopeParams = [req.user.id, req.user.id];
    } else if (scopeType === 'attraction') {
      scopeWhere =
        'AND (al.actor_id = ? OR al.tourist_attraction_id IN (SELECT id FROM tourist_attractions WHERE user_id = ?))';
      scopeParams = [req.user.id, req.user.id];
    }

    const listSql = `SELECT al.id, al.created_at, al.action_type, al.details,
                            al.actor_id, u.full_name AS actor_name, u.role AS actor_role,
                            COALESCE(
                              (SELECT b.business_name FROM businesses b
                                WHERE b.user_id = u.id AND b.deleted_at IS NULL ORDER BY b.created_at LIMIT 1),
                              (SELECT t.attraction_name FROM tourist_attractions t
                                WHERE t.user_id = u.id AND t.deleted_at IS NULL LIMIT 1)
                            ) AS actor_org_name,
                            COALESCE(tb.business_name, tt.attraction_name) AS target_name
                     FROM activity_logs al
                     LEFT JOIN users u ON u.id = al.actor_id
                     LEFT JOIN businesses tb ON tb.id = al.business_id
                     LEFT JOIN tourist_attractions tt ON tt.id = al.tourist_attraction_id
                     WHERE (? IS NULL OR al.action_type = ?)
                       AND (? IS NULL OR al.created_at >= ?)
                       AND (? IS NULL OR al.created_at < DATE_ADD(?, INTERVAL 1 DAY))
                       ${scopeWhere}
                     ORDER BY al.created_at DESC
                     LIMIT ? OFFSET ?`;

    const countSql = `SELECT COUNT(*) as total FROM activity_logs al
                      WHERE (? IS NULL OR al.action_type = ?)
                        AND (? IS NULL OR al.created_at >= ?)
                        AND (? IS NULL OR al.created_at < DATE_ADD(?, INTERVAL 1 DAY))
                        ${scopeWhere}`;

    const listParams = [
      actionTypeFilter,
      actionTypeFilter,
      dateFromFilter,
      dateFromFilter,
      dateToFilter,
      dateToFilter,
      ...scopeParams,
      String(limit),
      String(offset),
    ];

    const countParams = [
      actionTypeFilter,
      actionTypeFilter,
      dateFromFilter,
      dateFromFilter,
      dateToFilter,
      dateToFilter,
      ...scopeParams,
    ];

    const [[listRows], [countRows]] = await Promise.all([
      db.pool.execute(listSql, listParams),
      db.pool.execute(countSql, countParams),
    ]);

    res.json({
      items: listRows,
      total: countRows[0]?.total || 0,
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
}

router.get('/activity-logs', adminGuard, (req, res, next) =>
  handleFetch(req, res, next, 'admin')
);

businessRouter.get('/activity-logs', businessGuard, (req, res, next) =>
  handleFetch(req, res, next, 'business')
);

attractionRouter.get('/activity-logs', attractionGuard, (req, res, next) =>
  handleFetch(req, res, next, 'attraction')
);

export default router;
export { businessRouter, attractionRouter };
