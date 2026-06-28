-- MySQL dump 10.13  Distrib 8.0.40, for Win64 (x86_64)
--
-- Host: 127.0.0.1    Database: tourism_db
-- ------------------------------------------------------
-- Server version	8.0.40

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Temporary view structure for view `business_activity_summary`
--

DROP TABLE IF EXISTS `business_activity_summary`;
/*!50001 DROP VIEW IF EXISTS `business_activity_summary`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `business_activity_summary` AS SELECT 
 1 AS `id`,
 1 AS `business_name`,
 1 AS `business_line`,
 1 AS `business_status`,
 1 AS `total_records`,
 1 AS `total_guests`,
 1 AS `last_activity`,
 1 AS `activity_status`*/;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `businesses`
--

DROP TABLE IF EXISTS `businesses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `businesses` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `user_id` char(36) NOT NULL,
  `business_name` varchar(255) NOT NULL,
  `permit_number` varchar(255) DEFAULT NULL,
  `registration_number` varchar(255) DEFAULT NULL,
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `businesses`
--

LOCK TABLES `businesses` WRITE;
/*!40000 ALTER TABLE `businesses` DISABLE KEYS */;
INSERT INTO `businesses` VALUES ('45a7a2b0-be2e-4a9b-b587-7cdf6d3fb6e4','ed9a77d9-eac7-4014-a30c-ecba33d9c27e','Santos Hotel','SP-34','BIR-2024-12','Putol Street',30,'/uploads/permits/1781422276199-351726655.pdf','/uploads/valid_ids/1781422276224-357248392.pdf','approved',NULL,'2026-06-14 15:31:32','2026-06-14 15:32:11',NULL,'Region IV-A','San Pablo City','Laguna','Atisan','Santos Luxury Hotel','[\"hotel\"]','Maria','Santos','Mendoza','sole_proprietorship'),('8dab324f-acff-424a-af2c-fd6a15879d1d','78d63c06-02ad-474f-b0f7-b4ee600c5902','Juan\'s Resort','SP-788','BIR-2026-01','Matapang Street 2',10,'/uploads/permits/1781272426470-540686108.pdf','/uploads/valid_ids/1781272426474-869976461.pdf','approved',NULL,'2026-06-12 21:53:46','2026-06-16 10:10:12',NULL,'Region IV-A','San Pablo City','Laguna','Barangay II-C','Juan Dragon Resort','[\"resort\"]','Juan','Dela Cruz','Matapang','sole_proprietorship');
/*!40000 ALTER TABLE `businesses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `guest_breakdowns`
--

DROP TABLE IF EXISTS `guest_breakdowns`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `guest_breakdowns` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `guest_record_id` char(36) NOT NULL,
  `country` varchar(255) DEFAULT NULL,
  `philippines_region` varchar(255) DEFAULT NULL,
  `sex` enum('male','female') NOT NULL,
  `age_group` enum('0-9','10-17','18-25','26-35','36-45','46-55','56+','prefer_not_to_say') NOT NULL,
  `count` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_overseas` tinyint(1) NOT NULL DEFAULT '0',
  `nationality` enum('Filipino','Foreign') DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_gb_guest_record_id` (`guest_record_id`),
  KEY `idx_gb_country` (`country`),
  CONSTRAINT `guest_breakdowns_guest_record_id_fkey` FOREIGN KEY (`guest_record_id`) REFERENCES `guest_records` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `guest_breakdowns`
--

LOCK TABLES `guest_breakdowns` WRITE;
/*!40000 ALTER TABLE `guest_breakdowns` DISABLE KEYS */;
INSERT INTO `guest_breakdowns` VALUES ('025f0973-e5c2-4024-9e37-8ad1897e8163','566ebe2e-d7a6-4445-9f8a-0c9a7840a95b','Philippines','Region XIII','male','26-35',1,'2026-06-12 22:06:51',0,'Filipino'),('0614b1d0-9104-445d-ab86-91f95b4acd44','f1fa12da-9c96-4572-837e-a309d4b48da4','Philippines','NCR','female','26-35',1,'2026-06-12 22:05:36',0,'Filipino'),('2124c1af-94f5-4ad9-a4a2-3c33d5130a0d','d019f9f9-506e-4b21-b069-5e7636dbaf97','Brazil',NULL,'male','26-35',3,'2026-06-15 21:46:38',0,NULL),('3834d817-f860-43b2-9a28-41b031535b55','d019f9f9-506e-4b21-b069-5e7636dbaf97','Brazil',NULL,'female','26-35',2,'2026-06-15 21:46:38',0,NULL),('419f0686-821a-4552-bff9-0360657b53fd','6117017e-d213-4ab2-b2e6-d6f232546f2f','Others',NULL,'male','36-45',3,'2026-06-17 20:50:32',0,NULL),('469c5921-d0d9-45f5-8924-68fbf4172708','a2e58d04-be21-4bfc-afd5-2d2a64d55854','Philippines','NCR','female','26-35',1,'2026-06-13 09:45:36',0,'Filipino'),('51e93836-0f35-4c43-b5d7-877a16101551','23cd1242-fd1f-4c94-9f49-d05003a66fab','China',NULL,'female','26-35',3,'2026-06-15 21:40:11',0,NULL),('5a2c37ca-9254-4813-8c30-008fd167c2ce','25b913a3-e9ac-4f56-b68a-92bd5898b8f8',NULL,NULL,'male','36-45',1,'2026-06-17 18:54:26',1,NULL),('741dd913-eb25-4ab6-b385-a6ac7ab19066','0c13bb8f-c773-4b84-9054-72a614079b20','Belgium',NULL,'male','46-55',5,'2026-06-13 09:35:49',0,NULL),('b930168f-02ab-4a28-a40d-1e86000a3133','a2e58d04-be21-4bfc-afd5-2d2a64d55854','Austria',NULL,'male','36-45',1,'2026-06-13 09:45:36',0,NULL),('c4f5ac2e-60fb-4b79-91bf-b2a9a7724ff0','6117017e-d213-4ab2-b2e6-d6f232546f2f','Others',NULL,'female','26-35',3,'2026-06-17 20:50:32',0,NULL),('f8439d52-9942-48d5-876a-6b21fb245ea4','25b913a3-e9ac-4f56-b68a-92bd5898b8f8',NULL,NULL,'male','46-55',1,'2026-06-17 18:54:26',1,NULL);
/*!40000 ALTER TABLE `guest_breakdowns` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Temporary view structure for view `guest_breakdowns_synced`
--

DROP TABLE IF EXISTS `guest_breakdowns_synced`;
/*!50001 DROP VIEW IF EXISTS `guest_breakdowns_synced`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `guest_breakdowns_synced` AS SELECT 
 1 AS `id`,
 1 AS `guest_record_id`,
 1 AS `country`,
 1 AS `philippines_region`,
 1 AS `sex`,
 1 AS `age_group`,
 1 AS `count`,
 1 AS `created_at`,
 1 AS `is_overseas`,
 1 AS `nationality`,
 1 AS `business_id`*/;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `guest_records`
--

DROP TABLE IF EXISTS `guest_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `guest_records` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `business_id` char(36) NOT NULL,
  `check_in` date NOT NULL,
  `check_out` date NOT NULL,
  `total_guests` int NOT NULL,
  `rooms_occupied` int NOT NULL,
  `purpose_of_visit` varchar(255) NOT NULL,
  `transportation_mode` varchar(255) NOT NULL,
  `status` enum('active','archived') NOT NULL DEFAULT 'active',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_gr_business_id` (`business_id`),
  KEY `idx_gr_status` (`status`),
  KEY `idx_gr_check_in` (`check_in`),
  KEY `idx_gr_is_deleted` (`is_deleted`),
  CONSTRAINT `guest_records_business_id_fkey` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `guest_records`
--

LOCK TABLES `guest_records` WRITE;
/*!40000 ALTER TABLE `guest_records` DISABLE KEYS */;
INSERT INTO `guest_records` VALUES ('0c13bb8f-c773-4b84-9054-72a614079b20','8dab324f-acff-424a-af2c-fd6a15879d1d','2026-06-13','2026-06-15',5,2,'Business','Bus','active',0,'2026-06-13 09:35:49'),('23cd1242-fd1f-4c94-9f49-d05003a66fab','8dab324f-acff-424a-af2c-fd6a15879d1d','2026-06-14','2026-06-14',3,2,'Religious','Tricycle','active',0,'2026-06-14 22:32:24'),('25b913a3-e9ac-4f56-b68a-92bd5898b8f8','8dab324f-acff-424a-af2c-fd6a15879d1d','2026-06-17','2026-06-18',2,1,'Religious','Tricycle','active',0,'2026-06-17 18:54:26'),('566ebe2e-d7a6-4445-9f8a-0c9a7840a95b','8dab324f-acff-424a-af2c-fd6a15879d1d','2026-06-12','2026-06-12',1,0,'Leisure','Bus','active',0,'2026-06-12 22:06:51'),('6117017e-d213-4ab2-b2e6-d6f232546f2f','8dab324f-acff-424a-af2c-fd6a15879d1d','2026-06-17','2026-06-18',6,2,'Leisure','Tricycle','active',0,'2026-06-17 20:50:32'),('a2e58d04-be21-4bfc-afd5-2d2a64d55854','8dab324f-acff-424a-af2c-fd6a15879d1d','2026-06-13','2026-06-15',2,1,'Leisure','Private Car','active',0,'2026-06-13 09:45:36'),('d019f9f9-506e-4b21-b069-5e7636dbaf97','8dab324f-acff-424a-af2c-fd6a15879d1d','2026-06-15','2026-06-17',5,3,'Leisure','Private Car','active',0,'2026-06-15 21:39:06'),('f1fa12da-9c96-4572-837e-a309d4b48da4','8dab324f-acff-424a-af2c-fd6a15879d1d','2026-06-12','2026-06-12',1,0,'Leisure','Bus','active',0,'2026-06-12 22:05:36');
/*!40000 ALTER TABLE `guest_records` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `message_recipients`
--

DROP TABLE IF EXISTS `message_recipients`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `message_recipients`
--

LOCK TABLES `message_recipients` WRITE;
/*!40000 ALTER TABLE `message_recipients` DISABLE KEYS */;
INSERT INTO `message_recipients` VALUES ('293f5535-67c3-11f1-b864-2243ebd04f1e','1ce42e65-a5fd-476a-88a8-286944746d84','45a7a2b0-be2e-4a9b-b587-7cdf6d3fb6e4','read',1,'2026-06-14 15:32:29','2026-06-14 15:32:13'),('f32f7a4e-66c7-11f1-b864-2243ebd04f1e','df052d32-a76e-4570-8741-12f2a33906dd','8dab324f-acff-424a-af2c-fd6a15879d1d','read',1,'2026-06-13 09:34:48','2026-06-13 09:33:58');
/*!40000 ALTER TABLE `message_recipients` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `messages`
--

DROP TABLE IF EXISTS `messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `messages`
--

LOCK TABLES `messages` WRITE;
/*!40000 ALTER TABLE `messages` DISABLE KEYS */;
INSERT INTO `messages` VALUES ('1ce42e65-a5fd-476a-88a8-286944746d84','c7b059d0-6606-11f1-af36-9a9c406b5877','announcement','Accommodation Application Approved','REPUBLIC OF THE PHILIPPINES\nCITY OF SAN PABLO\nOFFICE OF TOURISM\n\nJune 14, 2026\n\nTo: Santos Hotel\nRe: Accommodation Application Approved\n\nANNOUNCEMENT\n\nDear Establishment Representative,\n\nWe\'re pleased to let you know your accommodation application has been approved.\n\nThis notice is duly issued by the San Pablo City Tourism Office and is valid even without a handwritten signature, being an official electronic communication of the office.\n\nFor questions and concerns, please contact us at admin@example.com or call us at 09953644707, or visit our office at the San Pablo City Hall.\n\nRespectfully,\n\nMiko Gapasan\nTourism Officer\nSan Pablo City Tourism Office\n\n---\nThis is an official communication from the San Pablo City Tourism Office.\nReference No.: MSG-422333302',0,'2026-06-14 15:32:13'),('df052d32-a76e-4570-8741-12f2a33906dd','c7b059d0-6606-11f1-af36-9a9c406b5877','announcement','System Update','REPUBLIC OF THE PHILIPPINES\nCITY OF SAN PABLO\nOFFICE OF TOURISM\n\nJune 13, 2026\n\nTo: Juan\'s Resort\nRe: System Update\n\nANNOUNCEMENT\n\nDear Establishment Representative,\n\nUpdate you mobile application by clicking the update button on profile page\n\nThis notice is duly issued by the San Pablo City Tourism Office and is valid even without a handwritten signature, being an official electronic communication of the office.\n\nFor questions and concerns, please contact us at admin@example.com or call us at 09953644707, or visit our office at the San Pablo City Hall.\n\nRespectfully,\n\nMiko Gapasan\nTourism Officer\nSan Pablo City Tourism Office\n\n---\nThis is an official communication from the San Pablo City Tourism Office.\nReference No.: MSG-314438861',0,'2026-06-13 09:33:58');
/*!40000 ALTER TABLE `messages` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `report_batches`
--

DROP TABLE IF EXISTS `report_batches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `report_batches`
--

LOCK TABLES `report_batches` WRITE;
/*!40000 ALTER TABLE `report_batches` DISABLE KEYS */;
INSERT INTO `report_batches` VALUES ('05471801-0c1e-4dd9-b061-73384999066e','monthly',6,2026,'c7b059d0-6606-11f1-af36-9a9c406b5877','2026-06-18 15:20:40'),('662c0866-d304-4771-ad5a-7c0e9e452a6d','monthly',5,2026,'c7b059d0-6606-11f1-af36-9a9c406b5877','2026-06-18 15:22:26');
/*!40000 ALTER TABLE `report_batches` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `reports`
--

DROP TABLE IF EXISTS `reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reports` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `batch_id` char(36) NOT NULL,
  `business_id` char(36) DEFAULT NULL,
  `report_type` enum('business','total') NOT NULL DEFAULT 'business',
  `file_url` varchar(1000) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reports_batch_business_type` (`batch_id`,`business_id`,`report_type`),
  KEY `idx_reports_batch_id` (`batch_id`),
  KEY `idx_reports_business_id` (`business_id`),
  CONSTRAINT `reports_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `report_batches` (`id`) ON DELETE CASCADE,
  CONSTRAINT `reports_business_id_fkey` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `reports`
--

LOCK TABLES `reports` WRITE;
/*!40000 ALTER TABLE `reports` DISABLE KEYS */;
/*!40000 ALTER TABLE `reports` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
  `new_email` varchar(255) DEFAULT NULL,
  `email_confirm_token` varchar(128) DEFAULT NULL,
  `email_confirm_expiry` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_username_unique` (`username`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_deleted_at` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES ('78d63c06-02ad-474f-b0f7-b4ee600c5902','Juan Dela Cruz','0994-677-4321','mikogapasan04@gmail.com','juan123','$2b$10$qSyQTPB2uZaw4iDwC7HVruMN.itYgMPLZ1AoUmaD8m9CkFT.6BWIG','business','130941','2026-06-16 10:30:06','2026-06-12 21:53:46','2026-06-16 10:15:05',NULL),('c7b059d0-6606-11f1-af36-9a9c406b5877','Miko Gapasan','09953644707','miksgapasan@gmail.com','admin','$2b$10$.Xw0CO8YaCg3N7t.zRCyYOfjdygHntScnDhSc0ModrrLo8A5/Kwf6','admin','164119','2026-06-16 00:43:40','2026-06-12 10:31:13','2026-06-16 00:28:39',NULL),('ed9a77d9-eac7-4014-a30c-ecba33d9c27e','Maria Santos','0934-786-4333','santos@gmail.com','santos123','$2b$10$dSBTJWgUgT.2FI.zGv21sO6SL/B2haOS60WzY2NH3KJeC4LC9ObRm','business',NULL,NULL,'2026-06-14 15:31:32','2026-06-14 15:31:32',NULL);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Final view structure for view `business_activity_summary`
--

/*!50001 DROP VIEW IF EXISTS `business_activity_summary`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `business_activity_summary` AS select `b`.`id` AS `id`,`b`.`business_name` AS `business_name`,`b`.`business_line` AS `business_line`,`b`.`status` AS `business_status`,count(`gr`.`id`) AS `total_records`,coalesce(sum(`gr`.`total_guests`),0) AS `total_guests`,max(`gr`.`created_at`) AS `last_activity`,(case when (count(`gr`.`id`) = 0) then 'no_activity' when (max(`gr`.`created_at`) < (now() - interval 30 day)) then 'inactive' when (max(`gr`.`created_at`) < (now() - interval 7 day)) then 'low_activity' else 'active' end) AS `activity_status` from (`businesses` `b` left join `guest_records` `gr` on(((`gr`.`business_id` = `b`.`id`) and (`gr`.`is_deleted` = false)))) where ((`b`.`status` in ('approved','warning')) and (`b`.`deleted_at` is null)) group by `b`.`id`,`b`.`business_name`,`b`.`business_line`,`b`.`status` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `guest_breakdowns_synced`
--

/*!50001 DROP VIEW IF EXISTS `guest_breakdowns_synced`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `guest_breakdowns_synced` AS select `gb`.`id` AS `id`,`gb`.`guest_record_id` AS `guest_record_id`,`gb`.`country` AS `country`,`gb`.`philippines_region` AS `philippines_region`,`gb`.`sex` AS `sex`,`gb`.`age_group` AS `age_group`,`gb`.`count` AS `count`,`gb`.`created_at` AS `created_at`,`gb`.`is_overseas` AS `is_overseas`,`gb`.`nationality` AS `nationality`,`gr`.`business_id` AS `business_id` from (`guest_breakdowns` `gb` join `guest_records` `gr` on((`gb`.`guest_record_id` = `gr`.`id`))) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-06-19  9:34:10
