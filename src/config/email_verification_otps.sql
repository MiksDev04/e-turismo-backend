CREATE TABLE IF NOT EXISTS `pending_email_confirmations` (
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
