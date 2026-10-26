-- Dashboard speed-up indexes
-- MySQL has no "CREATE INDEX IF NOT EXISTS", so this migration is NOT
-- idempotent. If you need to re-run it, DROP the keys first, e.g.:
--   ALTER TABLE `guest_records` DROP KEY `idx_gr_biz_del_checkin`, DROP KEY `idx_gr_del_checkin`;
--   ALTER TABLE `attraction_visit_logs` DROP KEY `idx_avl_att_del_date`, DROP KEY `idx_avl_del_date`;

ALTER TABLE `guest_records`
  ADD KEY `idx_gr_biz_del_checkin` (`business_id`, `is_deleted`, `check_in`),
  ADD KEY `idx_gr_del_checkin` (`is_deleted`, `check_in`);

ALTER TABLE `attraction_visit_logs`
  ADD KEY `idx_avl_att_del_date` (`attraction_id`, `deleted_at`, `visit_date`),
  ADD KEY `idx_avl_del_date` (`deleted_at`, `visit_date`);
