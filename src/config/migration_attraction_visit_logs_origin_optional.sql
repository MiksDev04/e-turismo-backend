-- ----------------------------------------------------------------------------
-- Migration: Make attraction visitor origin & gender optional
-- Makes `attraction_visit_logs.country` nullable (origin not captured at some
-- attractions that only do a headcount). A blank entry now stores NULL instead
-- of silently becoming 'Philippines, no city'.
--
-- province / city_municipality are already nullable; the application layer
-- keeps them NULL whenever country is NULL. male_count / female_count are
-- already nullable and covered by chk_avl_sex_sum (passes when either is NULL).
--
-- Run against the dev/production MySQL DB before deploying the backend code:
--   SOURCE src/config/migration_attraction_visit_logs_origin_optional.sql
-- ----------------------------------------------------------------------------

ALTER TABLE `attraction_visit_logs`
  MODIFY `country` varchar(255) DEFAULT NULL
  COMMENT 'NULL = origin not captured; Philippines = Filipino tourist; otherwise Foreign. Nationality is derived from this value, never stored';