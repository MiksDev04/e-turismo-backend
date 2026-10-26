-- =====================================================================
-- Migration: dashboard speed-up indexes
-- Run against the live `tourism_db` database (MySQL).
-- NOT idempotent: if a key already exists, drop it first before re-running.
-- =====================================================================

ALTER TABLE guest_records
  ADD KEY idx_gr_biz_del_checkin (business_id, is_deleted, check_in),
  ADD KEY idx_gr_del_checkin (is_deleted, check_in);

ALTER TABLE attraction_visit_logs
  ADD KEY idx_avl_att_del_date (attraction_id, deleted_at, visit_date),
  ADD KEY idx_avl_del_date (deleted_at, visit_date);
