-- Report revision indexes
-- ─────────────────────────────────────────────────────────────────────────────
-- The report cache runs a data-revision check on every open to decide whether
-- the cached PDF/XLSX is still current. That check does
--   MAX(created_at), MAX(updated_at), COUNT(*)
-- on each report-feeding table. Without an index on the timestamp columns MySQL
-- full-scans every table; these keys make MAX() an index seek.
--
-- MySQL has no "CREATE INDEX IF NOT EXISTS", so this migration is NOT
-- idempotent. If you need to re-run it, DROP the keys first, e.g.:
--   ALTER TABLE `guest_records` DROP KEY `idx_gr_created_at`, DROP KEY `idx_gr_updated_at`;

ALTER TABLE `guest_records`
  ADD KEY `idx_gr_created_at`  (`created_at`),
  ADD KEY `idx_gr_updated_at`  (`updated_at`);

ALTER TABLE `guest_record_rooms`
  ADD KEY `idx_grr_created_at` (`created_at`),
  ADD KEY `idx_grr_updated_at` (`updated_at`);

ALTER TABLE `guest_origin_breakdowns`
  ADD KEY `idx_gob_created_at` (`created_at`),
  ADD KEY `idx_gob_updated_at` (`updated_at`);

ALTER TABLE `attraction_visit_logs`
  ADD KEY `idx_avl_created_at` (`created_at`),
  ADD KEY `idx_avl_updated_at` (`updated_at`);

ALTER TABLE `businesses`
  ADD KEY `idx_biz_created_at` (`created_at`),
  ADD KEY `idx_biz_updated_at` (`updated_at`);

ALTER TABLE `tourist_attractions`
  ADD KEY `idx_ta_created_at`  (`created_at`),
  ADD KEY `idx_ta_updated_at`  (`updated_at`);

ALTER TABLE `rooms`
  ADD KEY `idx_rooms_created_at` (`created_at`),
  ADD KEY `idx_rooms_updated_at` (`updated_at`);
