-- =====================================================================
-- Migration: guest_records — add male/female counts, drop transport + region
-- Run against the live `tourism_db` database (MySQL 8.0.16+).
-- Order matters: backfill before adding the CHECK constraint so existing
-- rows satisfy it.
-- =====================================================================

USE `tourism_db`;

-- 1) Add the new count columns (existing rows get 0)
ALTER TABLE `guest_records`
  ADD COLUMN `male_count` INT NOT NULL DEFAULT 0 COMMENT 'Male guests; auto-filled via PSA 47.1/52.9 split when blank' AFTER `total_guests`,
  ADD COLUMN `female_count` INT NOT NULL DEFAULT 0 COMMENT 'Female guests; female = total_guests - male_count' AFTER `male_count`;

-- 2) Backfill existing rows with the PSA 47.1%/52.9% split
--    male = ROUND(total * 0.471), female = total - male  (sum always = total)
UPDATE `guest_records`
SET `male_count`   = ROUND(`total_guests` * 0.471),
    `female_count` = `total_guests` - ROUND(`total_guests` * 0.471)
WHERE `male_count` = 0 AND `female_count` = 0;

-- 3) Enforce the invariant and drop the removed fields
ALTER TABLE `guest_records`
  ADD CONSTRAINT `chk_gr_sex_sum` CHECK (`male_count` + `female_count` = `total_guests`),
  DROP COLUMN `transportation_mode`,
  DROP COLUMN `lead_philippines_region`;
