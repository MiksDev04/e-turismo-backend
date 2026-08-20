-- =====================================================================
-- San Pablo City Tourism Demographics System
-- Full schema (structure only, no data)
-- =====================================================================
--
-- Includes the updated guest-capture model:
--   - `rooms` (new): individual rooms per business
--   - `guest_records` (rebuilt): stay details + the lead guest's
--     demographics merged in directly (country, nationality, birthdate,
--     sex). Male/female counts are captured (or auto-split via the PSA
--     47.1%/52.9% distribution when left blank). The remaining guests in
--     the party are implied by total_guests - male_count - female_count
--     and are not itemized. When origin groups are recorded
--     (`guest_origin_breakdowns`), male/female/total are derived from the
--     group sums instead; PSA applies only when no origin groups exist.
--   - `guest_record_rooms` (new): junction table -- a stay can span
--     more than one room (a party of 5 might get split across two)
--   - `guest_origin_breakdowns` (new): repeatable Origin Groups
--     (country / nationality / is_overseas / province / city_municipality /
--     male / female), keyed by `guest_records` (accommodation).
--     nationality is 'Filipino' or 'Foreign'.
--     country may be NULL when is_overseas = 1.
--     province / city_municipality are Philippines-only.
--   - `guest_breakdowns` / `guest_breakdowns_synced` are retired.
--
-- Includes the tourist-attraction model:
--   - `tourist_attractions` (new): public attractions (parks, plazas,
--     LGU-managed sites) tied to a user account, same pending/approved
--     workflow as businesses. One account = exactly one attraction.
--   - `attraction_visit_logs` (new): batch visit entries per attraction
--     per day (guest_count + origin classification) — no PII, like a
--     gate logbook. Nationality is NOT stored: it is derived from the
--     country column (country = 'Philippines' => Filipino, otherwise
--     Foreign). Male/female counts are captured (or auto-split via the
--     PSA 47.1%/52.9% distribution when left blank).
--   - `message_recipients` now links to either a business OR an
--     attraction (exactly one per row).
--   - `report_batches.report_type` is one of 'dae' | 'var1' | 'var2':
--     'dae'   = accommodation establishments (daily/summary/series)
--     'var1'  = tourist attractions, one daily grid per attraction (always 'daily')
--     'var2'  = combined accommodations + attractions, one row each (always 'total')
--   - `users.role` widened to 'attraction'; `pending_email_confirmations
--     .purpose` widened to 'attraction_registration'.
--
-- Table creation order respects foreign key dependencies:
--   users -> businesses -> tourist_attractions -> attraction_visit_logs
--         -> rooms -> guest_records -> guest_record_rooms
--         -> guest_origin_breakdowns -> messages -> message_recipients
--         -> report_batches
-- =====================================================================
DROP DATABASE tourism_db;
CREATE DATABASE IF NOT EXISTS `tourism_db`
  /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */
  /*!80016 DEFAULT ENCRYPTION='N' */;
USE `tourism_db`;

SET FOREIGN_KEY_CHECKS = 0;

DROP VIEW  IF EXISTS `guest_breakdowns_synced`;
DROP TABLE IF EXISTS `report_downloads`;
DROP TABLE IF EXISTS `report_batches`;
DROP TABLE IF EXISTS `message_recipients`;
DROP TABLE IF EXISTS `messages`;
DROP TABLE IF EXISTS `guest_record_rooms`;
DROP TABLE IF EXISTS `guest_origin_breakdowns`;
DROP TABLE IF EXISTS `guest_records`;
DROP TABLE IF EXISTS `guest_breakdowns`;
DROP TABLE IF EXISTS `rooms`;
DROP TABLE IF EXISTS `businesses`;
DROP TABLE IF EXISTS `attraction_visit_logs`;
DROP TABLE IF EXISTS `tourist_attractions`;
DROP TABLE IF EXISTS `pending_email_confirmations`;
DROP TABLE IF EXISTS `users`;

-- ---------------------------------------------------------------
-- Table: users
-- ---------------------------------------------------------------
CREATE TABLE `users` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `full_name` varchar(255) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `username` varchar(100) NOT NULL,
  `password` text NOT NULL,
  `role` enum('business','admin','attraction') NOT NULL DEFAULT 'business',
  `reset_otp` varchar(6) DEFAULT NULL,
  `reset_otp_expiry` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  `new_email` varchar(255) DEFAULT NULL,
  `email_confirm_token` varchar(128) DEFAULT NULL,
  `email_confirm_expiry` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_username_unique` (`username`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_deleted_at` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------
-- Table: pending_email_confirmations
-- ---------------------------------------------------------------
CREATE TABLE `pending_email_confirmations` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `purpose` enum('admin_setup','business_registration','attraction_registration') NOT NULL,
  `full_name` varchar(255) NOT NULL,
  `username` varchar(100) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `confirmation_token` varchar(64) NOT NULL,
  `expires_at` datetime NOT NULL,
  `confirmed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pending_confirm_purpose_email` (`purpose`,`email`),
  KEY `idx_pending_confirm_token` (`confirmation_token`),
  KEY `idx_pending_confirm_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------
-- Table: businesses
-- ---------------------------------------------------------------
CREATE TABLE `businesses` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `user_id` char(36) NOT NULL,
  `business_name` varchar(255) NOT NULL,
  `permit_number` varchar(255) DEFAULT NULL,
  `registration_number` varchar(255) DEFAULT NULL,
  `ae_id` varchar(100) NOT NULL,
  `street` text,

  `permit_file_url` varchar(1000) DEFAULT NULL,
  `valid_id_url` varchar(1000) DEFAULT NULL,
  `status` enum('pending','approved','rejected','warning','suspended') NOT NULL DEFAULT 'pending',
  `remarks` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  `region` varchar(255) DEFAULT NULL,
  `city_municipality` varchar(255) DEFAULT NULL,
  `province` varchar(255) DEFAULT NULL,
  `barangay` varchar(255) DEFAULT NULL,
  `tradename` varchar(255) DEFAULT NULL,
  `business_line` json DEFAULT NULL,
  `owner_first_name` varchar(255) DEFAULT NULL,
  `owner_last_name` varchar(255) DEFAULT NULL,
  `owner_middle_name` varchar(255) DEFAULT NULL,
  `business_type` enum('sole_proprietorship','corporation','partnership') NOT NULL DEFAULT 'sole_proprietorship',
  PRIMARY KEY (`id`),
  KEY `idx_businesses_user_id` (`user_id`),
  KEY `idx_businesses_status` (`status`),
  KEY `idx_businesses_deleted_at` (`deleted_at`),
  CONSTRAINT `businesses_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------
-- Table: tourist_attractions (new)
-- ---------------------------------------------------------------
CREATE TABLE `tourist_attractions` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `user_id` char(36) NOT NULL,
  `attraction_name` varchar(255) NOT NULL,
  `attraction_type` json DEFAULT NULL COMMENT 'Array of one or more: Ecotourism, Natural Attractions, Cultural, Religious, Historical Heritage Sites, Agri-Tourism, Farm Tourism Sites',
  `valid_id_url` varchar(1000) DEFAULT NULL,
  `barangay` varchar(255) DEFAULT NULL,
  `street` text,
  `status` enum('pending','approved','rejected','warning') NOT NULL DEFAULT 'pending',
  `remarks` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ta_user_id` (`user_id`),
  KEY `idx_ta_status` (`status`),
  KEY `idx_ta_deleted_at` (`deleted_at`),
  CONSTRAINT `tourist_attractions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------
-- Table: attraction_visit_logs (new)
-- ---------------------------------------------------------------
CREATE TABLE `attraction_visit_logs` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `attraction_id` char(36) NOT NULL,
  `visit_date` date NOT NULL,
  `guest_count` int NOT NULL,
  `male_count` int DEFAULT NULL COMMENT 'Optional; auto-filled via PSA 47.1/52.9 split when blank',
  `female_count` int DEFAULT NULL COMMENT 'Optional; female = guest_count - male_count',
  `country` varchar(255) NOT NULL DEFAULT 'Philippines' COMMENT 'Philippines = Filipino tourist; otherwise Foreign. Nationality is derived from this value, never stored',
  `province` varchar(255) DEFAULT NULL COMMENT 'Only set for domestic (Filipino) tourists',
  `city_municipality` varchar(255) DEFAULT NULL COMMENT 'Only set for domestic (Filipino) tourists',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_avl_attraction_id` (`attraction_id`),
  KEY `idx_avl_visit_date` (`visit_date`),
  KEY `idx_avl_deleted_at` (`deleted_at`),
  CONSTRAINT `attraction_visit_logs_attraction_id_fkey` FOREIGN KEY (`attraction_id`) REFERENCES `tourist_attractions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_avl_guest_count` CHECK (`guest_count` >= 1),
  CONSTRAINT `chk_avl_sex_sum` CHECK (`male_count` IS NULL OR `female_count` IS NULL OR `male_count` + `female_count` = `guest_count`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------
-- Table: rooms (new)
-- ---------------------------------------------------------------
CREATE TABLE `rooms` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `business_id` char(36) NOT NULL,
  `room_number` varchar(50) NOT NULL,
  `capacity` int NOT NULL DEFAULT '1' COMMENT 'Max guests the room can hold',
  `room_status` enum('vacant','reserved','occupied','unavailable') NOT NULL DEFAULT 'vacant',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rooms_business_room_number` (`business_id`,`room_number`),
  KEY `idx_rooms_business_id` (`business_id`),
  KEY `idx_rooms_room_status` (`room_status`),
  CONSTRAINT `rooms_business_id_fkey` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------
-- Table: guest_records (rebuilt, lead guest fields merged in)
-- ---------------------------------------------------------------
CREATE TABLE `guest_records` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `business_id` char(36) NOT NULL,

  -- Stay details
  `check_in` date NOT NULL,
  `check_out` date NOT NULL,
  `actual_check_out` datetime DEFAULT NULL COMMENT 'Actual datetime when guest checked out',
  `total_guests` int NOT NULL,
  `male_count` int NOT NULL DEFAULT 0 COMMENT 'Male guests; auto-filled via PSA 47.1/52.9 split when blank',
  `female_count` int NOT NULL DEFAULT 0 COMMENT 'Female guests; female = total_guests - male_count',
  `purpose_of_visit` varchar(255) NOT NULL,

  -- Lead guest: the one whose valid ID was checked
  `lead_country` varchar(255) DEFAULT NULL,
  `lead_city_municipality` varchar(255) DEFAULT NULL,
  `lead_province` varchar(255) DEFAULT NULL,
  `lead_nationality` enum('Filipino','Foreign') DEFAULT NULL,
  `lead_is_overseas` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'True if a Filipino lead guest resides abroad (balikbayan/OFW)',
  `lead_birthdate` date NOT NULL COMMENT 'Age at time of stay is derived from this + check_in, not stored',
  `lead_sex` enum('male','female') NOT NULL,

  `status` enum('active','archived') NOT NULL DEFAULT 'active',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_gr_business_id` (`business_id`),
  KEY `idx_gr_status` (`status`),
  KEY `idx_gr_check_in` (`check_in`),
  KEY `idx_gr_is_deleted` (`is_deleted`),
  KEY `idx_gr_lead_nationality` (`lead_nationality`),
  CONSTRAINT `guest_records_business_id_fkey` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_gr_total_guests` CHECK (`total_guests` >= 1),
  CONSTRAINT `chk_gr_sex_sum` CHECK (`male_count` + `female_count` = `total_guests`),
  CONSTRAINT `chk_gr_dates` CHECK (`check_out` >= `check_in`),
  CONSTRAINT `chk_gr_lead_birthdate` CHECK (`lead_birthdate` <= `check_in`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------
-- Table: guest_record_rooms (junction — a stay can span more
-- than one room)
-- ---------------------------------------------------------------
CREATE TABLE `guest_record_rooms` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `guest_record_id` char(36) NOT NULL,
  `room_id` char(36) NOT NULL,
  `status` enum('active','completed') NOT NULL DEFAULT 'active',
  `deleted_at` datetime DEFAULT NULL COMMENT 'Soft-delete: when this room link was removed from the stay',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_grr_record_room` (`guest_record_id`,`room_id`),
  KEY `idx_grr_guest_record_id` (`guest_record_id`),
  KEY `idx_grr_room_id` (`room_id`),
  KEY `idx_grr_status` (`status`),
  KEY `idx_grr_deleted_at` (`deleted_at`),
  CONSTRAINT `guest_record_rooms_guest_record_id_fkey` FOREIGN KEY (`guest_record_id`) REFERENCES `guest_records` (`id`) ON DELETE CASCADE,
  CONSTRAINT `guest_record_rooms_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------
-- Table: guest_origin_breakdowns
-- Origin Groups: repeatable Country / Nationality /
-- Province / City-Municipality / Male / Female rows. Keyed by
-- guest_records (accommodation). country may be NULL when
-- is_overseas = 1. province / city_municipality are
-- Philippines-only.
-- ---------------------------------------------------------------
DROP TABLE IF EXISTS `guest_origin_breakdowns`;
CREATE TABLE `guest_origin_breakdowns` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `guest_record_id` char(36) NOT NULL,
  `country` varchar(255) DEFAULT NULL,
  `nationality` varchar(255) DEFAULT NULL,
  `is_overseas` tinyint(1) NOT NULL DEFAULT 0,
  `province` varchar(255) DEFAULT NULL,
  `city_municipality` varchar(255) DEFAULT NULL,
  `male_count` int NOT NULL DEFAULT 0,
  `female_count` int NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_gob_guest_record_id` (`guest_record_id`),
  KEY `idx_gob_deleted_at` (`deleted_at`),
  CONSTRAINT `fk_gob_guest_record`
    FOREIGN KEY (`guest_record_id`) REFERENCES `guest_records` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_gob_sex_sum` CHECK (male_count + female_count >= 1),
  CONSTRAINT `chk_gob_country_required` CHECK (is_overseas = 1 OR country IS NOT NULL),
  CONSTRAINT `chk_gob_origin_only_philippines` CHECK (
    country = 'Philippines' OR (province IS NULL AND city_municipality IS NULL)
  ),
  CONSTRAINT `chk_gob_overseas_no_origin` CHECK (
    is_overseas = 0 OR (province IS NULL AND city_municipality IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------
-- Table: messages
-- ---------------------------------------------------------------
CREATE TABLE `messages` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `sender_id` char(36) NOT NULL,
  `message_type` enum('compliance','announcement','general') NOT NULL DEFAULT 'general',
  `subject` varchar(255) NOT NULL,
  `content` text NOT NULL,
  `is_broadcast` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_messages_sender_id` (`sender_id`),
  KEY `idx_messages_created_at` (`created_at`),
  CONSTRAINT `messages_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------
-- Table: message_recipients
-- ---------------------------------------------------------------
CREATE TABLE `message_recipients` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `message_id` char(36) NOT NULL,
  `business_id` char(36) DEFAULT NULL,
  `attraction_id` char(36) DEFAULT NULL,
  `status` enum('unread','read','archived') NOT NULL DEFAULT 'unread',
  `is_read` tinyint(1) NOT NULL DEFAULT '0',
  `read_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mr_message_id` (`message_id`),
  KEY `idx_mr_business_id` (`business_id`),
  KEY `idx_mr_attraction_id` (`attraction_id`),
  KEY `idx_mr_is_read` (`is_read`),
  KEY `idx_mr_status` (`status`),
  CONSTRAINT `message_recipients_business_id_fkey` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`),
  CONSTRAINT `message_recipients_attraction_id_fkey` FOREIGN KEY (`attraction_id`) REFERENCES `tourist_attractions` (`id`),
  CONSTRAINT `message_recipients_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_mr_recipient_exclusive` CHECK (
    (`business_id` IS NOT NULL AND `attraction_id` IS NULL)
    OR (`business_id` IS NULL AND `attraction_id` IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------
-- Table: report_batches
-- ---------------------------------------------------------------
CREATE TABLE `report_batches` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `report_type` enum('dae','var1','var2') NOT NULL,
  `report_variant` enum('daily','summary','series','total') NOT NULL
    COMMENT 'DAE: daily/summary/series. VAR 1 (attractions): always daily. VAR 2 (combined): always total.',
  `period_year` smallint NOT NULL,
  `period_months` JSON NOT NULL
    COMMENT 'Sorted array of ints 1-12, e.g. [1,2,3]. App must sort before insert.',
  `period_months_hash` char(64)
    GENERATED ALWAYS AS (SHA2(CAST(`period_months` AS CHAR), 256)) STORED,
  `requested_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_viewed_at` datetime DEFAULT NULL
    COMMENT 'Bumped on every view; viewing is a live query, no file involved',
  `last_xlsx_url` varchar(1000) DEFAULT NULL,
  `last_pdf_url` varchar(1000) DEFAULT NULL,
  `last_generated_at` datetime DEFAULT NULL
    COMMENT 'Bumped whenever Download regenerates the file',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_batch_combo` (`report_type`, `report_variant`, `period_year`, `period_months_hash`),
  KEY `idx_batches_type_period` (`report_type`, `period_year`),
  CONSTRAINT `report_batches_requested_by_fkey` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`),
  CONSTRAINT `chk_batch_period_year` CHECK (`period_year` >= 2000),
  CONSTRAINT `chk_batch_period_months_array` CHECK (JSON_TYPE(`period_months`) = 'ARRAY'),
  CONSTRAINT `chk_batch_variant_matches_type` CHECK (
    (`report_type` = 'dae'  AND `report_variant` IN ('daily','summary','series')) OR
    (`report_type` = 'var1' AND `report_variant` = 'daily') OR
    (`report_type` = 'var2' AND `report_variant` = 'total')
  ),
  CONSTRAINT `chk_batch_single_month_variants` CHECK (
    `report_variant` NOT IN ('daily','summary') OR JSON_LENGTH(`period_months`) = 1
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- Reporting helper (reference only, not executed by this script)
-- Use this in the DAE-1B report generator / any query that needs the
-- lead guest's age or age bracket at the time of THAT specific stay:
--
-- SELECT
--   gr.*,
--   TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) AS lead_age,
--   CASE
--     WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 9  THEN '0-9'
--     WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 17 THEN '10-17'
--     WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 25 THEN '18-25'
--     WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 35 THEN '26-35'
--     WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 45 THEN '36-45'
--     WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 55 THEN '46-55'
--     ELSE '56+'
--   END AS lead_age_group
-- FROM guest_records gr;
--
-- To list which room(s) a stay occupies:
--
-- SELECT
--   gr.id AS guest_record_id,
--   GROUP_CONCAT(r.room_number ORDER BY r.room_number SEPARATOR ', ') AS rooms
-- FROM guest_records gr
-- JOIN guest_record_rooms grr ON grr.guest_record_id = gr.id
-- JOIN rooms r ON r.id = grr.room_id
-- GROUP BY gr.id;
--
-- VAR total now combines both sources (accommodations + attractions).
-- Source of truth per record: when it has live origin groups
-- (guest_origin_breakdowns), spread each group's origin + counts;
-- otherwise fall back to the record lead origin + counts. When groups
-- exist, nationality is read from the stored column; when absent, the lead
-- record nationality is used directly.
--
-- SELECT nationality, country, province, city_municipality,
--        SUM(guest_count) AS guest_count
-- FROM (
--   SELECT
--     CASE WHEN gob.id IS NULL THEN gr.lead_nationality
--          ELSE COALESCE(gob.nationality, CASE WHEN gob.country = 'Philippines' THEN 'Filipino' ELSE 'Foreign' END) END AS nationality,
--     COALESCE(gob.country, gr.lead_country) AS country,
--     COALESCE(gob.province, gr.lead_province) AS province,
--     COALESCE(gob.city_municipality, gr.lead_city_municipality) AS city_municipality,
--     CASE WHEN gob.id IS NULL THEN gr.total_guests
--          ELSE gob.male_count + gob.female_count END AS guest_count
--   FROM guest_records gr
--   LEFT JOIN guest_origin_breakdowns gob
--     ON gob.guest_record_id = gr.id AND gob.deleted_at IS NULL
--   WHERE gr.is_deleted = 0
--   UNION ALL
--   SELECT
--     CASE WHEN avl.country = 'Philippines' THEN 'Filipino' ELSE 'Foreign' END AS nationality,
--     avl.country,
--     avl.province,
--     avl.city_municipality,
--     avl.guest_count
--   FROM attraction_visit_logs avl
--   WHERE avl.deleted_at IS NULL
-- ) combined
-- GROUP BY nationality, country, province, city_municipality;
-- =====================================================================
