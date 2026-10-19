-- ----------------------------------------------------------------------------
-- Migration: Add `is_foreign` to attraction_visit_logs
-- Records whether the app user logged the visitor as a Foreign tourist
-- (the "Foreign tourist" checkbox in the visit entry form). This is kept
-- separate from `country`: a foreigner who did not name their country still
-- stores country = NULL, but is_foreign = 1 so the row stays Foreign instead
-- of falling into "origin not captured".
--
-- Existing rows are backfilled from the current heuristic
-- (country IS NOT NULL AND country <> 'Philippines') so behavior is unchanged.
--
-- Run against the dev/production MySQL DB before deploying the backend code:
--   SOURCE src/config/migration_attraction_visit_logs_is_foreign.sql
-- ----------------------------------------------------------------------------

ALTER TABLE `attraction_visit_logs`
  ADD COLUMN `is_foreign` tinyint(1) NOT NULL DEFAULT 0
    COMMENT '1 = recorded as Foreign tourist by the app user (country may still be NULL when no country was named); 0 = domestic (Filipino) or origin not captured. Foreignness is decided by this flag, not by country.';

-- Backfill: rows that already carry a non-Philippines country are foreign.
UPDATE `attraction_visit_logs`
  SET `is_foreign` = 1
  WHERE `country` IS NOT NULL AND `country` <> 'Philippines';

-- Consistency guard (added separately so the backfill runs before it applies):
--   foreign rows can never carry Philippine province/city and never say
--   'Philippines' as their country; domestic rows never carry a foreign country.
ALTER TABLE `attraction_visit_logs`
  ADD CONSTRAINT `chk_avl_is_foreign_consistency` CHECK (
    (`is_foreign` = 1 AND `province` IS NULL AND `city_municipality` IS NULL
      AND (`country` IS NULL OR `country` <> 'Philippines'))
    OR
    (`is_foreign` = 0 AND (`country` IS NULL OR `country` = 'Philippines'))
  );