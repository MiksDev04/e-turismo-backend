-- =====================================================================
-- San Pablo City Tourism Demographics System
-- Full schema (structure only, no data)
-- =====================================================================
--
-- Includes the updated guest-capture model:
--   - `rooms` (new): individual rooms per business
--   - `guest_records` (rebuilt): stay details + the lead guest's
--     demographics merged in directly (country, nationality, region,
--     birthdate, sex). The remaining guests in the party are implied
--     by total_guests - 1 and are not itemized.
--   - `guest_record_rooms` (new): junction table -- a stay can span
--     more than one room (a party of 5 might get split across two)
--   - `guest_breakdowns` / `guest_breakdowns_synced` are retired.
--
-- Table creation order respects foreign key dependencies:
--   users -> businesses -> rooms -> guest_records -> guest_record_rooms
--         -> messages -> message_recipients
--         -> report_batches -> reports
-- =====================================================================
DROP DATABASE tourism_db;
CREATE DATABASE IF NOT EXISTS `tourism_db`
  /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */
  /*!80016 DEFAULT ENCRYPTION='N' */;
USE `tourism_db`;

SET FOREIGN_KEY_CHECKS = 0;

DROP VIEW  IF EXISTS `guest_breakdowns_synced`;
DROP TABLE IF EXISTS `reports`;
DROP TABLE IF EXISTS `report_batches`;
DROP TABLE IF EXISTS `message_recipients`;
DROP TABLE IF EXISTS `messages`;
DROP TABLE IF EXISTS `guest_record_rooms`;
DROP TABLE IF EXISTS `guest_records`;
DROP TABLE IF EXISTS `guest_breakdowns`;
DROP TABLE IF EXISTS `rooms`;
DROP TABLE IF EXISTS `businesses`;
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
  `role` enum('business','admin') NOT NULL DEFAULT 'business',
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
  `purpose` enum('admin_setup','business_registration') NOT NULL,
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
  `ae_id` varchar(20) NOT NULL,
  `street` text,
  `total_rooms` int NOT NULL DEFAULT '0',
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
  `length_of_stay` int NOT NULL COMMENT 'Nights; app computes as DATEDIFF(check_out, check_in), min 1',
  `total_guests` int NOT NULL,
  `purpose_of_visit` varchar(255) NOT NULL,
  `transportation_mode` varchar(255) NOT NULL,

  -- Lead guest: the one whose valid ID was checked
  `lead_country` varchar(255) NOT NULL,
  `lead_city_municipality` varchar(255) DEFAULT NULL,
  `lead_province` varchar(255) DEFAULT NULL,
  `lead_nationality` enum('Filipino','Foreign') DEFAULT NULL,
  `lead_philippines_region` varchar(255) DEFAULT NULL COMMENT 'Only set when lead_nationality = Filipino',
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
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_grr_record_room` (`guest_record_id`,`room_id`),
  KEY `idx_grr_guest_record_id` (`guest_record_id`),
  KEY `idx_grr_room_id` (`room_id`),
  KEY `idx_grr_status` (`status`),
  CONSTRAINT `guest_record_rooms_guest_record_id_fkey` FOREIGN KEY (`guest_record_id`) REFERENCES `guest_records` (`id`) ON DELETE CASCADE,
  CONSTRAINT `guest_record_rooms_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE RESTRICT
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
  `business_id` char(36) NOT NULL,
  `status` enum('unread','read','archived') NOT NULL DEFAULT 'unread',
  `is_read` tinyint(1) NOT NULL DEFAULT '0',
  `read_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mr_message_id` (`message_id`),
  KEY `idx_mr_business_id` (`business_id`),
  KEY `idx_mr_is_read` (`is_read`),
  KEY `idx_mr_status` (`status`),
  CONSTRAINT `message_recipients_business_id_fkey` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`),
  CONSTRAINT `message_recipients_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------
-- Table: report_batches
-- ---------------------------------------------------------------
CREATE TABLE `report_batches` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `report_scope` enum('monthly','annual') NOT NULL DEFAULT 'monthly',
  `period_month` smallint NOT NULL,
  `period_year` smallint NOT NULL,
  `generated_by` char(36) DEFAULT NULL,
  `generated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_report_batches_scope_period` (`report_scope`,`period_year`,`period_month`),
  KEY `idx_report_batches_period` (`period_year`,`period_month`),
  KEY `idx_report_batches_generated_by` (`generated_by`),
  CONSTRAINT `report_batches_generated_by_fkey` FOREIGN KEY (`generated_by`) REFERENCES `users` (`id`),
  CONSTRAINT `chk_batch_period_month` CHECK ((`period_month` between 1 and 12)),
  CONSTRAINT `chk_batch_period_year` CHECK ((`period_year` >= 2000))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------
-- Table: reports
-- ---------------------------------------------------------------
CREATE TABLE `reports` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `batch_id` char(36) NOT NULL,
  `business_id` char(36) DEFAULT NULL,
  `report_type` enum('business','total') NOT NULL DEFAULT 'business',
  `file_url` varchar(1000) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reports_batch_business_type` (`batch_id`,`business_id`,`report_type`),
  KEY `idx_reports_batch_id` (`batch_id`),
  KEY `idx_reports_business_id` (`business_id`),
  CONSTRAINT `reports_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `report_batches` (`id`) ON DELETE CASCADE,
  CONSTRAINT `reports_business_id_fkey` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`)
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
-- =====================================================================
