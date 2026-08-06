CREATE DATABASE  IF NOT EXISTS "tourism_db_v2" /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;
USE `tourism_db_v2`;
-- MySQL dump 10.13  Distrib 8.0.40, for Win64 (x86_64)
--
-- Host: mysql-1819fe83-mikogapasan04-3fc8.g.aivencloud.com    Database: tourism_db_v2
-- ------------------------------------------------------
-- Server version	8.0.45

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
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '0ac0f844-3c84-11f1-8dff-466e122fd547:1-874,
50f3bc6f-799b-11f1-92da-e65e17bfe2a4:1-1486,
e8a80145-3ba1-11f1-b76c-b69356c7cc61:1-39';

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
  `ae_id` varchar(100) NOT NULL,
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
INSERT INTO `businesses` VALUES ('863661e2-2fa4-422e-82ce-ef8119ef19ae','0068cf0e-2e6b-42b9-b405-88f7c37dbc60','Santos Hotel','SP-7678','BIR-2022-56','DOT-R4A-ACC-01588-2022','Purok 5C',0,'https://res.cloudinary.com/dcumsgzer/raw/upload/v1785069363/tourism/permits/863661e2-2fa4-422e-82ce-ef8119ef19ae','https://res.cloudinary.com/dcumsgzer/raw/upload/v1785069364/tourism/valid_ids/863661e2-2fa4-422e-82ce-ef8119ef19ae','approved',NULL,'2026-07-26 12:36:05','2026-07-26 12:37:10',NULL,'Region IV-A','San Pablo City','Laguna','Barangay II-F','Santos Grand Hotel','[\"hotel\"]','Maria','Santos',NULL,'sole_proprietorship'),('9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','f89185d0-3b63-4869-8cf5-9ddffdab7e55','Juan\'s Resort','SP-4567','BIR-577','DOT-R4A-ACC-01586-2022','Purok 3A',0,'https://res.cloudinary.com/dcumsgzer/raw/upload/v1784552761/tourism/permits/9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','https://res.cloudinary.com/dcumsgzer/raw/upload/v1784552762/tourism/valid_ids/9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','approved',NULL,'2026-07-20 13:06:03','2026-07-22 02:14:10',NULL,'Region IV-A','San Pablo City','Laguna','Barangay II-C','Juan Dragon Reort','[\"resort\"]','Juan','Dela Cruz','Magapi','sole_proprietorship');
/*!40000 ALTER TABLE `businesses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `guest_record_rooms`
--

DROP TABLE IF EXISTS `guest_record_rooms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `guest_record_rooms` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `guest_record_id` char(36) NOT NULL,
  `room_id` char(36) NOT NULL,
  `status` enum('active','completed') NOT NULL DEFAULT 'active',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_grr_record_room` (`guest_record_id`,`room_id`),
  KEY `idx_grr_guest_record_id` (`guest_record_id`),
  KEY `idx_grr_room_id` (`room_id`),
  KEY `idx_grr_deleted_at` (`deleted_at`),
  CONSTRAINT `guest_record_rooms_guest_record_id_fkey` FOREIGN KEY (`guest_record_id`) REFERENCES `guest_records` (`id`) ON DELETE CASCADE,
  CONSTRAINT `guest_record_rooms_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `guest_record_rooms`
--

LOCK TABLES `guest_record_rooms` WRITE;
/*!40000 ALTER TABLE `guest_record_rooms` DISABLE KEYS */;
INSERT INTO `guest_record_rooms` VALUES ('00cd7330-923d-43cd-9613-5630a13ed23f','47e1e055-a36c-43a5-a7f1-04459f608d36','54e24d12-09b4-4eb3-86cd-e111064170f2','completed','2026-08-06 12:57:19','2026-08-04 16:25:39','2026-08-06 12:57:19'),('04cfad01-c8e6-4820-baa6-0208f1a35a93','bb5fc3a0-dbb1-4257-adca-3474ac8bdf0f','cbf1b18c-c2d2-46f1-a509-251e7a26f7ca','completed','2026-07-27 08:15:30','2026-07-27 08:15:30',NULL),('07f2fa9c-6f3d-434f-9058-72377a86e0be','d3b40408-bf54-44d6-bba3-bdcb78332731','54e24d12-09b4-4eb3-86cd-e111064170f2','completed','2026-08-03 22:12:52','2026-08-03 22:09:39','2026-08-03 22:12:52'),('1db7af4c-3196-4b6d-9526-a58f046160ea','cae680bc-861e-4ffd-a798-d6c76f0ed16e','87f70085-a6e6-4429-b0bd-24aa19fc146a','completed','2026-07-30 02:31:21','2026-07-30 02:31:21',NULL),('1dcd56c7-ce42-4bdd-b21e-b4cebc3f515e','9f11952c-c2f4-4565-ab88-2c3a0aa4c456','72f0186c-f101-4fe4-8bb9-c8ade9157f6d','completed','2026-07-26 01:22:53','2026-07-26 01:22:53',NULL),('2b9d7a6d-95d8-4741-82cb-e7ae6ed0b9bb','859e2585-eebd-4a04-920a-9bafc90c091a','65791d8918d0c-hkrz4v6ebw','active',NULL,'2026-08-04 16:27:44',NULL),('3075dd9c-5c8c-4f49-ab77-d7a7eca681d0','9d996e8b-ba0e-48b6-93b7-06bdb5056044','54e24d12-09b4-4eb3-86cd-e111064170f2','completed','2026-07-26 13:41:24','2026-07-26 13:41:24',NULL),('35a335c4-86b9-477b-819d-e4006ae60888','bfa95a37-76f7-4d77-843c-0ae34e1183f8','54e24d12-09b4-4eb3-86cd-e111064170f2','completed','2026-08-03 22:08:57','2026-08-01 13:30:35','2026-08-03 22:08:57'),('375ef216-a7ff-4d7f-b727-e31c71ee7ea5','b6399d75-708f-4567-99b6-8524946b0a5d','87f70085-a6e6-4429-b0bd-24aa19fc146a','completed','2026-08-04 16:26:55','2026-08-02 01:18:31','2026-08-04 16:26:55'),('3d28fa21-b107-46d9-9589-ce92dc16a26d','802abc0e-b069-452a-ab1e-6eb9a2c2d8c3','72f0186c-f101-4fe4-8bb9-c8ade9157f6d','completed','2026-08-02 11:36:37','2026-08-02 11:36:37',NULL),('3e494cec-14aa-47ef-a81a-c93a9c7df1aa','2222be5e-81a1-425c-a7c3-e41444625f24','72f0186c-f101-4fe4-8bb9-c8ade9157f6d','completed','2026-08-06 12:56:59','2026-08-02 21:51:24','2026-08-06 12:56:59'),('4253fc53-f77c-4f47-8d86-b5bef297944d','6cf8e9ea-0a9c-4b9a-92f3-e5078fec6789','cbf1b18c-c2d2-46f1-a509-251e7a26f7ca','completed','2026-07-24 04:44:47','2026-07-24 04:44:47',NULL),('5bec1de3-7474-46bc-96be-e76e6913f072','bff3b473-d9f9-4b45-ab77-642e0bf2c78e','65791d8918d0c-hkrz4v6ebw','completed','2026-08-03 22:08:36','2026-07-31 02:24:11','2026-08-03 22:08:36'),('5cd52468-c9f3-4900-b645-c899f3c10a56','2222be5e-81a1-425c-a7c3-e41444625f24','cbf1b18c-c2d2-46f1-a509-251e7a26f7ca','completed','2026-08-03 17:19:19','2026-08-02 11:33:03','2026-08-03 17:19:19'),('68a081ba-530c-4b7d-a503-dbf9ce4b3abd','ae5a9ed4-eac3-4a9a-8607-277b4a49e73c','19ef9cab-8187-4706-99e9-fde8ba5b3eac','completed','2026-07-20 13:39:50','2026-07-20 13:39:50',NULL),('73d6ea43-2cc2-445d-a13c-ccdee8a61b04','47e1e055-a36c-43a5-a7f1-04459f608d36','e2a2b088-41f7-4a26-907c-ff19aabe00e8','completed','2026-08-06 12:57:19','2026-08-04 16:25:40','2026-08-06 12:57:19'),('7814089d-9933-4d68-a7ab-67977022c9ca','910b93af-c870-46d0-90b2-680c5ca6d68b','e07bb40d-de3c-4dd5-b4c4-7cde90394e17','active',NULL,'2026-08-06 12:58:04',NULL),('7cf5467a-c2a0-42d6-a37a-bd9b55b394f6','9f379b41-8a69-4093-9fb7-e4dc182ef383','65791d8918d0c-hkrz4v6ebw','completed','2026-07-27 08:15:29','2026-07-27 08:15:29',NULL),('7d128fb5-f592-4663-858e-c7cfc78d8b93','4dcb17c7-2167-4fe5-a822-3b501731c0b5','cbf1b18c-c2d2-46f1-a509-251e7a26f7ca','completed','2026-07-23 01:45:39','2026-07-23 01:45:39',NULL),('ace12b85-0d22-48bd-9845-73dab065a033','65770e9a-c79b-42e4-9b0d-4da85981756c','7b92c73e-33f3-48eb-8c01-61dc55866714','completed','2026-07-25 02:44:17','2026-07-25 02:44:17',NULL),('ae1b05f8-f12e-4c0f-8fe0-6085f98296c1','9deeccbf-57e3-4e71-a6a1-5070ade8bd3f','87f70085-a6e6-4429-b0bd-24aa19fc146a','completed','2026-07-20 13:29:50','2026-07-20 13:29:50',NULL),('b2d2f4a0-3647-468f-992b-987d60cfc997','35ecd3d0-284d-4f9d-bab0-386257d5ba45','cbf1b18c-c2d2-46f1-a509-251e7a26f7ca','completed','2026-07-21 02:22:38','2026-07-21 02:22:38',NULL),('bb716044-9d80-4ed1-b662-08d5b4be47bc','4dd968ca-fd2e-41a4-ae8a-a60286a0ef11','e07bb40d-de3c-4dd5-b4c4-7cde90394e17','completed','2026-08-03 22:09:00','2026-07-30 02:34:57','2026-08-03 22:09:00'),('bcbc061c-ede7-488c-b26c-794426926fa7','859e2585-eebd-4a04-920a-9bafc90c091a','87f70085-a6e6-4429-b0bd-24aa19fc146a','active',NULL,'2026-08-04 16:27:44',NULL),('bcdf8edd-d667-4af5-aa3d-22405529deeb','338c4ad1-13bd-4bf4-b080-06bde7de1f5b','e2a2b088-41f7-4a26-907c-ff19aabe00e8','completed','2026-07-27 11:55:22','2026-07-27 11:55:22',NULL),('c6b1dca9-bd8b-458b-a7fa-cac0fb543e33','b51dcb3d-480c-4d52-a7ab-6ea71ee5cfae','54e24d12-09b4-4eb3-86cd-e111064170f2','completed','2026-07-29 05:01:40','2026-07-29 05:01:40',NULL),('dc76aa22-7d09-4d42-ab42-a812233f0a75','9deeccbf-57e3-4e71-a6a1-5070ade8bd3f','7b92c73e-33f3-48eb-8c01-61dc55866714','completed','2026-07-20 13:29:50','2026-07-20 13:29:50',NULL),('df0d3343-e366-4ac7-be55-71759a340d09','2222be5e-81a1-425c-a7c3-e41444625f24','19ef9cab-8187-4706-99e9-fde8ba5b3eac','completed','2026-08-03 15:57:12','2026-08-03 15:57:12',NULL),('df5bcbd1-b131-4f74-af95-999037ce9be6','26be647a-aa14-41ae-8a11-8fa11661361a','87f70085-a6e6-4429-b0bd-24aa19fc146a','completed','2026-07-21 02:24:14','2026-07-21 02:24:14',NULL),('e01f79b0-d1a3-4483-a5d1-39b7bf99a7ee','d3b40408-bf54-44d6-bba3-bdcb78332731','219a6c6f-9048-4a92-bb5d-08d028c0ea4e','completed','2026-08-04 16:24:53','2026-08-03 22:12:52','2026-08-04 16:24:53'),('e3aa0b7d-7884-4976-b3b0-a35ea8c96c28','802abc0e-b069-452a-ab1e-6eb9a2c2d8c3','19ef9cab-8187-4706-99e9-fde8ba5b3eac','completed','2026-08-02 11:36:37','2026-08-02 11:36:37',NULL),('e60d0c93-56b6-4dd7-b18e-bbbdc75e6a76','f2a4a78e-fed8-42a0-b7bc-cd5496ee3372','7b92c73e-33f3-48eb-8c01-61dc55866714','completed','2026-07-27 01:32:48','2026-07-27 01:32:48',NULL),('f162da91-66dc-4498-b4ba-fd946f8da183','b6399d75-708f-4567-99b6-8524946b0a5d','7b92c73e-33f3-48eb-8c01-61dc55866714','completed','2026-08-04 16:26:55','2026-08-02 01:18:31','2026-08-04 16:26:55'),('f241c7ee-5da9-4d85-b9c0-2c2329c6a38a','cc825fdd-4429-460a-9f97-39bc04d779ed','e2a2b088-41f7-4a26-907c-ff19aabe00e8','completed','2026-07-31 02:25:21','2026-07-31 02:25:21',NULL),('f396ed47-620e-4e25-99b8-95f7f9d69ea6','6cf8e9ea-0a9c-4b9a-92f3-e5078fec6789','87f70085-a6e6-4429-b0bd-24aa19fc146a','completed','2026-07-24 04:44:47','2026-07-24 04:44:47',NULL),('fb03b6af-c922-45e8-8a1d-61baf5fc266a','b51dcb3d-480c-4d52-a7ab-6ea71ee5cfae','e07bb40d-de3c-4dd5-b4c4-7cde90394e17','completed','2026-07-29 05:01:40','2026-07-29 05:01:40',NULL);
/*!40000 ALTER TABLE `guest_record_rooms` ENABLE KEYS */;
UNLOCK TABLES;

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
  `actual_check_out` datetime DEFAULT NULL,
  `length_of_stay` int NOT NULL COMMENT 'Nights; app computes as DATEDIFF(check_out, check_in), min 1',
  `total_guests` int NOT NULL,
  `purpose_of_visit` varchar(255) NOT NULL,
  `transportation_mode` varchar(255) NOT NULL,
  `lead_city_municipality` varchar(255) DEFAULT NULL,
  `lead_province` varchar(255) DEFAULT NULL,
  `lead_country` varchar(255) DEFAULT NULL,
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
  CONSTRAINT `chk_gr_dates` CHECK ((`check_out` >= `check_in`)),
  CONSTRAINT `chk_gr_lead_birthdate` CHECK ((`lead_birthdate` <= `check_in`)),
  CONSTRAINT `chk_gr_total_guests` CHECK ((`total_guests` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `guest_records`
--

LOCK TABLES `guest_records` WRITE;
/*!40000 ALTER TABLE `guest_records` DISABLE KEYS */;
INSERT INTO `guest_records` VALUES ('0ba409a7-2bd7-46cc-859d-955bfbab4e3f','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-26','2026-07-26','2026-07-26 09:28:04',1,15,'Leisure','Tricycle',NULL,'Rizal','Philippines','Filipino','CALABARZON',0,'1988-05-19','male','archived',0,'2026-07-26 01:25:36','2026-08-02 05:22:01'),('2222be5e-81a1-425c-a7c3-e41444625f24','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-08-02','2026-08-05','2026-08-06 12:56:57',3,7,'Leisure','Van','City of Puerto Princesa','Palawan','Philippines','Filipino','MIMAROPA Region',0,'1968-04-21','female','archived',0,'2026-08-02 11:33:03','2026-08-06 12:56:58'),('26be647a-aa14-41ae-8a11-8fa11661361a','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-21','2026-07-21','2026-07-21 10:23:55',1,3,'Leisure','Tricycle','City of Biñan','Laguna','Philippines','Filipino','CALABARZON',0,'1989-04-12','male','archived',0,'2026-07-21 02:24:14','2026-08-02 05:22:01'),('338c4ad1-13bd-4bf4-b080-06bde7de1f5b','863661e2-2fa4-422e-82ce-ef8119ef19ae','2026-07-27','2026-07-29','2026-07-29 12:57:24',2,8,'Leisure','Bus',NULL,NULL,NULL,NULL,NULL,1,'1995-03-16','female','archived',0,'2026-07-27 11:55:22','2026-08-02 05:22:01'),('35ecd3d0-284d-4f9d-bab0-386257d5ba45','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-21','2026-07-23','2026-07-23 09:23:03',2,8,'Leisure','Van','City of Lucena','Quezon','Philippines','Filipino','CALABARZON',0,'2006-01-18','female','archived',0,'2026-07-21 02:22:37','2026-08-02 05:22:01'),('43900972-4197-4883-8e7c-91ee5ee7d49e','863661e2-2fa4-422e-82ce-ef8119ef19ae','2026-08-04','2026-08-04','2026-08-04 16:26:32',1,13,'Leisure','Motorcycle','Famy','Laguna','Philippines','Filipino','CALABARZON',0,'2003-01-16','male','archived',0,'2026-08-04 16:26:29','2026-08-04 16:26:34'),('47e1e055-a36c-43a5-a7f1-04459f608d36','863661e2-2fa4-422e-82ce-ef8119ef19ae','2026-08-04','2026-08-06','2026-08-06 12:57:18',2,18,'Leisure','Van','City of San Pablo','Laguna','Philippines','Filipino','CALABARZON',0,'1999-12-27','female','archived',0,'2026-08-04 16:25:39','2026-08-06 12:57:19'),('4dcb17c7-2167-4fe5-a822-3b501731c0b5','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-23','2026-07-24','2026-07-24 12:43:42',1,8,'Leisure','Van','Batangas City','Batangas','Philippines','Filipino','CALABARZON',0,'2000-05-26','male','archived',0,'2026-07-23 01:45:39','2026-08-02 05:22:01'),('4dd968ca-fd2e-41a4-ae8a-a60286a0ef11','863661e2-2fa4-422e-82ce-ef8119ef19ae','2026-07-30','2026-08-03','2026-08-03 22:08:59',4,7,'Leisure','Private Car',NULL,'Guimaras','Philippines','Filipino','Western Visayas',0,'1986-04-28','male','archived',0,'2026-07-30 02:34:56','2026-08-03 22:09:00'),('65770e9a-c79b-42e4-9b0d-4da85981756c','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-25','2026-07-26','2026-07-26 09:21:18',1,5,'Leisure','Private Car',NULL,NULL,'USA','Foreign',NULL,0,'1992-03-12','male','archived',0,'2026-07-25 02:44:17','2026-08-02 05:22:01'),('6cf8e9ea-0a9c-4b9a-92f3-e5078fec6789','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-24','2026-07-26','2026-07-26 09:21:22',2,12,'Leisure','Private Car','City of San Pablo','Laguna','Philippines','Filipino','CALABARZON',0,'1993-10-13','female','archived',0,'2026-07-24 04:44:47','2026-08-02 05:22:01'),('754bc679-2782-424c-83bb-dd2aac82061f','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-25','2026-07-25','2026-07-25 11:25:27',1,8,'Leisure','Tricycle','City of Marikina',NULL,'Philippines','Filipino','NCR',0,'2004-03-19','male','archived',0,'2026-07-25 03:25:12','2026-08-02 05:22:01'),('802abc0e-b069-452a-ab1e-6eb9a2c2d8c3','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-08-02','2026-08-02','2026-08-02 11:39:12',1,12,'Leisure','Tricycle','Bay','Laguna','Philippines','Filipino','CALABARZON',0,'1988-12-07','female','archived',0,'2026-08-02 11:35:33','2026-08-02 05:22:01'),('859e2585-eebd-4a04-920a-9bafc90c091a','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-08-04','2026-08-07',NULL,3,14,'Leisure','Bus','City of Borongan','Eastern Samar','Philippines','Filipino','Eastern Visayas',0,'1993-10-07','female','active',0,'2026-08-04 16:27:44','2026-08-04 16:30:07'),('910b93af-c870-46d0-90b2-680c5ca6d68b','863661e2-2fa4-422e-82ce-ef8119ef19ae','2026-08-06','2026-08-08',NULL,2,6,'Leisure','Private Car','City of San Pedro','Laguna','Philippines','Filipino','CALABARZON',0,'1988-02-24','male','active',0,'2026-08-06 12:58:03','2026-08-06 12:58:03'),('9d996e8b-ba0e-48b6-93b7-06bdb5056044','863661e2-2fa4-422e-82ce-ef8119ef19ae','2026-07-26','2026-07-28','2026-07-28 18:37:23',2,10,'Leisure','Private Car','City of San Pablo','Laguna','Philippines','Filipino','CALABARZON',0,'1994-09-19','female','archived',0,'2026-07-26 13:41:24','2026-08-02 05:22:01'),('9deeccbf-57e3-4e71-a6a1-5070ade8bd3f','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-20','2026-07-22','2026-07-20 21:29:05',2,10,'Leisure','Bus','Dolores','Quezon','Philippines','Filipino','CALABARZON',0,'1989-06-23','female','archived',0,'2026-07-20 13:29:50','2026-08-02 05:22:01'),('9f11952c-c2f4-4565-ab88-2c3a0aa4c456','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-26','2026-07-29','2026-07-29 12:56:57',3,8,'Leisure','Van','Calauan','Laguna','Philippines','Filipino','CALABARZON',0,'1982-09-22','male','archived',0,'2026-07-26 01:22:52','2026-08-02 05:22:01'),('9f379b41-8a69-4093-9fb7-e4dc182ef383','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-27','2026-07-31','2026-07-31 10:22:05',4,10,'Business','Bus',NULL,NULL,NULL,NULL,NULL,1,'1990-01-13','female','archived',0,'2026-07-27 08:15:29','2026-08-02 05:22:01'),('a38863ad-5be7-49a9-a99c-7a9c13409878','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-20','2026-07-20','2026-07-20 21:29:28',1,5,'Leisure','Tricycle','City of San Pablo','Laguna','Philippines','Filipino','CALABARZON',0,'2004-01-15','male','archived',0,'2026-07-20 13:25:19','2026-08-02 05:22:01'),('aaa920c9-10c5-40eb-b9ba-e49f561510fb','863661e2-2fa4-422e-82ce-ef8119ef19ae','2026-08-02','2026-08-02','2026-08-02 15:22:36',1,14,'Leisure','Private Car','City of San Pablo','Laguna','Philippines','Filipino','CALABARZON',0,'1962-01-26','male','archived',0,'2026-08-02 14:20:22','2026-08-02 15:22:37'),('ae5a9ed4-eac3-4a9a-8607-277b4a49e73c','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-20','2026-07-24','2026-07-24 12:43:45',4,4,'Leisure','Private Car','Bato','Camarines Sur','Philippines','Filipino','Bicol Region',0,'2001-06-19','male','archived',0,'2026-07-20 13:39:50','2026-08-02 05:22:01'),('b51dcb3d-480c-4d52-a7ab-6ea71ee5cfae','863661e2-2fa4-422e-82ce-ef8119ef19ae','2026-07-29','2026-07-30','2026-07-30 10:31:54',1,10,'Leisure','Private Car','Buenavista','Marinduque','Philippines','Filipino','MIMAROPA Region',0,'1987-10-12','female','archived',0,'2026-07-29 05:01:39','2026-08-02 05:22:01'),('b6399d75-708f-4567-99b6-8524946b0a5d','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-08-02','2026-08-04','2026-08-04 16:26:53',2,10,'Leisure','Private Car',NULL,'Camarines Norte','Philippines','Filipino','Bicol Region',0,'1985-11-02','female','archived',0,'2026-08-02 01:18:31','2026-08-04 16:26:54'),('bb5fc3a0-dbb1-4257-adca-3474ac8bdf0f','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-27','2026-07-31','2026-07-31 10:22:11',4,4,'Education','Private Car','Tiaong','Quezon','Philippines','Filipino','CALABARZON',0,'1990-01-10','male','archived',0,'2026-07-27 08:15:30','2026-08-02 05:22:01'),('bc583188-d082-4101-a475-601fd0c0b560','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-26','2026-07-26','2026-07-26 09:37:13',1,7,'Leisure','Motorcycle','City of Calbayog','Samar','Philippines','Filipino','Eastern Visayas',0,'1967-01-01','female','archived',0,'2026-07-26 01:33:20','2026-08-02 05:22:01'),('bfa95a37-76f7-4d77-843c-0ae34e1183f8','863661e2-2fa4-422e-82ce-ef8119ef19ae','2026-08-01','2026-08-03','2026-08-03 22:08:55',2,9,'Leisure','Van','City of Antipolo','Rizal','Philippines','Filipino','CALABARZON',0,'1994-03-28','male','archived',0,'2026-08-01 13:30:35','2026-08-03 22:08:57'),('bff3b473-d9f9-4b45-ab77-642e0bf2c78e','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-31','2026-08-03','2026-08-03 22:08:34',3,10,'Leisure','Motorcycle',NULL,NULL,'Malaysia','Foreign',NULL,0,'1995-03-20','male','archived',0,'2026-07-31 02:24:11','2026-08-03 22:08:35'),('cae680bc-861e-4ffd-a798-d6c76f0ed16e','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-28','2026-08-01','2026-08-01 21:28:54',4,4,'Leisure','Private Car',NULL,'Catanduanes','Philippines','Filipino','Bicol Region',0,'2000-10-06','male','archived',0,'2026-07-30 02:31:21','2026-08-02 05:22:01'),('cc825fdd-4429-460a-9f97-39bc04d779ed','863661e2-2fa4-422e-82ce-ef8119ef19ae','2026-07-31','2026-08-01','2026-08-01 21:29:25',1,7,'Leisure','Van',NULL,'Batangas','Philippines','Filipino','CALABARZON',0,'1999-02-22','male','archived',0,'2026-07-31 02:25:21','2026-08-02 05:22:01'),('d3b40408-bf54-44d6-bba3-bdcb78332731','863661e2-2fa4-422e-82ce-ef8119ef19ae','2026-08-03','2026-08-04','2026-08-04 16:24:50',1,9,'Leisure','Van','City of San Pablo','Laguna','Philippines','Filipino','CALABARZON',0,'1988-11-03','male','archived',0,'2026-08-03 22:09:39','2026-08-04 16:24:52'),('d3d0bcbc-1598-428f-89b2-645984903081','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-22','2026-07-22','2026-07-22 22:02:32',1,8,'Leisure','Private Car','Morong','Rizal','Philippines','Filipino','CALABARZON',0,'2003-08-05','male','archived',0,'2026-07-22 01:31:06','2026-08-02 05:22:01'),('f2a4a78e-fed8-42a0-b7bc-cd5496ee3372','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-27','2026-07-29','2026-07-29 12:56:55',2,5,'Leisure','Tricycle','City of San Pablo','Laguna','Philippines','Filipino','CALABARZON',0,'1995-05-16','female','archived',0,'2026-07-27 01:32:48','2026-08-02 05:22:01'),('f373d72a-9cf0-40b9-a464-ffaaccd05b16','863661e2-2fa4-422e-82ce-ef8119ef19ae','2026-07-30','2026-07-30','2026-07-30 10:35:02',1,17,'Leisure','Bus','Majayjay','Laguna','Philippines','Filipino','CALABARZON',0,'2003-04-29','male','archived',0,'2026-07-30 02:33:59','2026-08-02 05:22:01'),('f68e0ef1-6239-4ffe-a5b5-6fff5bccec41','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2026-07-25','2026-07-25','2026-07-25 11:05:17',1,15,'Leisure','Van','Alaminos','Laguna','Philippines','Filipino','CALABARZON',0,'1992-04-22','male','archived',0,'2026-07-25 03:05:11','2026-08-02 05:22:01'),('fa4b6e24-a60a-4425-8ca3-1413ffbcf1c3','863661e2-2fa4-422e-82ce-ef8119ef19ae','2026-07-27','2026-07-27','2026-07-27 19:55:08',1,5,'Leisure','Private Car','City of Manila',NULL,'Philippines','Filipino','NCR',0,'2001-05-10','female','archived',0,'2026-07-27 02:44:55','2026-08-02 05:22:01');
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
INSERT INTO `message_recipients` VALUES ('11978423-843d-11f1-bf70-e65e17bfe2a4','af810d7b-ad80-456f-ab88-4e8bbf546ade','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','read',1,'2026-07-20 13:18:55','2026-07-20 13:15:24'),('b8b919cc-88ee-11f1-bf70-e65e17bfe2a4','70f1acb7-59bd-466d-a32e-f68b487da7d0','863661e2-2fa4-422e-82ce-ef8119ef19ae','read',1,'2026-07-26 12:42:36','2026-07-26 12:37:10'),('d1a8457b-900c-11f1-bf70-e65e17bfe2a4','490a3e25-bac5-41d6-b2aa-95456a426622','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','unread',0,NULL,'2026-08-04 22:00:15');
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
INSERT INTO `messages` VALUES ('490a3e25-bac5-41d6-b2aa-95456a426622','baa1af2a-e796-4d7e-b8f2-3af9fec7b781','general','Test Message 001','REPUBLIC OF THE PHILIPPINES\nCITY OF SAN PABLO\nOFFICE OF TOURISM\n\nAugust 4, 2026\n\nTo: Juan\'s Resort\nRe: Test Message 001\n\nGENERAL NOTICE\n\nDear Establishment Representative,\n\nHello this is a test message dont reply.\n\nThis notice is duly issued by the San Pablo City Tourism Office and is valid even without a handwritten signature, being an official electronic communication of the office.\n\nFor questions and concerns, please contact us at mikogapasan04@gmail.com or call us at 09950644707, or visit our office at the San Pablo City Hall.\n\nRespectfully,\n\nMiko Gapasan\nTourism Officer\nSan Pablo City Tourism Office\n\n---\nThis is an official communication from the San Pablo City Tourism Office.',0,'2026-08-04 22:00:15'),('70f1acb7-59bd-466d-a32e-f68b487da7d0','baa1af2a-e796-4d7e-b8f2-3af9fec7b781','announcement','Accommodation Application Approved','REPUBLIC OF THE PHILIPPINES\nCITY OF SAN PABLO\nOFFICE OF TOURISM\n\nJuly 26, 2026\n\nTo: Santos Hotel\nRe: Accommodation Application Approved\n\nANNOUNCEMENT\n\nDear Establishment Representative,\n\nWe\'re pleased to let you know your accommodation application has been approved.\n\nThis notice is duly issued by the San Pablo City Tourism Office and is valid even without a handwritten signature, being an official electronic communication of the office.\n\nFor questions and concerns, please contact us at mikogapasan04@gmail.com or call us at 09950644707, or visit our office at the San Pablo City Hall.\n\nRespectfully,\n\nMiko Gapasan\nTourism Officer\nSan Pablo City Tourism Office\n\n---\nThis is an official communication from the San Pablo City Tourism Office.',0,'2026-07-26 12:37:10'),('af810d7b-ad80-456f-ab88-4e8bbf546ade','baa1af2a-e796-4d7e-b8f2-3af9fec7b781','announcement','Accommodation Application Approved','REPUBLIC OF THE PHILIPPINES\nCITY OF SAN PABLO\nOFFICE OF TOURISM\n\nJuly 20, 2026\n\nTo: Juan\'s Resort\nRe: Accommodation Application Approved\n\nANNOUNCEMENT\n\nDear Establishment Representative,\n\nWe\'re pleased to let you know your accommodation application has been approved.\n\nThis notice is duly issued by the San Pablo City Tourism Office and is valid even without a handwritten signature, being an official electronic communication of the office.\n\nFor questions and concerns, please contact us at mikogapasan04@gmail.com or call us at 09950644707, or visit our office at the San Pablo City Hall.\n\nRespectfully,\n\nMiko Gapasan\nTourism Officer\nSan Pablo City Tourism Office\n\n---\nThis is an official communication from the San Pablo City Tourism Office.',0,'2026-07-20 13:15:24');
/*!40000 ALTER TABLE `messages` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `pending_email_confirmations`
--

DROP TABLE IF EXISTS `pending_email_confirmations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `pending_email_confirmations`
--

LOCK TABLES `pending_email_confirmations` WRITE;
/*!40000 ALTER TABLE `pending_email_confirmations` DISABLE KEYS */;
/*!40000 ALTER TABLE `pending_email_confirmations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `report_batches`
--

DROP TABLE IF EXISTS `report_batches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `report_batches` (
  `id` char(36) NOT NULL DEFAULT (uuid()),
  `report_type` enum('dae','var') NOT NULL,
  `report_variant` enum('daily','summary','series','total') NOT NULL COMMENT 'DAE: daily/summary/series. VAR always uses total (single sheet).',
  `period_year` smallint NOT NULL,
  `period_months` json NOT NULL COMMENT 'Sorted array of ints 1-12, e.g. [1,2,3]. App must sort before insert.',
  `period_months_hash` char(64) GENERATED ALWAYS AS (sha2(cast(`period_months` as char charset utf8mb4),256)) STORED,
  `requested_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_viewed_at` datetime DEFAULT NULL COMMENT 'Bumped on every view; viewing is a live query, no file involved',
  `last_xlsx_url` varchar(1000) DEFAULT NULL,
  `last_pdf_url` varchar(1000) DEFAULT NULL,
  `last_generated_at` datetime DEFAULT NULL COMMENT 'Bumped whenever Download regenerates the file',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_batch_combo` (`report_type`,`report_variant`,`period_year`,`period_months_hash`),
  KEY `idx_batches_type_period` (`report_type`,`period_year`),
  KEY `report_batches_requested_by_fkey` (`requested_by`),
  CONSTRAINT `report_batches_requested_by_fkey` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`),
  CONSTRAINT `chk_batch_period_months_array` CHECK ((json_type(`period_months`) = _utf8mb4'ARRAY')),
  CONSTRAINT `chk_batch_period_year` CHECK ((`period_year` >= 2000)),
  CONSTRAINT `chk_batch_single_month_variants` CHECK (((`report_variant` not in (_utf8mb4'daily',_utf8mb4'summary')) or (json_length(`period_months`) = 1))),
  CONSTRAINT `chk_batch_variant_matches_type` CHECK ((((`report_type` = _utf8mb4'dae') and (`report_variant` in (_utf8mb4'daily',_utf8mb4'summary',_utf8mb4'series'))) or ((`report_type` = _utf8mb4'var') and (`report_variant` = _utf8mb4'total'))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `report_batches`
--

LOCK TABLES `report_batches` WRITE;
/*!40000 ALTER TABLE `report_batches` DISABLE KEYS */;
INSERT INTO `report_batches` (`id`, `report_type`, `report_variant`, `period_year`, `period_months`, `requested_by`, `created_at`, `last_viewed_at`, `last_xlsx_url`, `last_pdf_url`, `last_generated_at`) VALUES ('1a062a02-483a-4859-bfd0-4753a4dae8d7','dae','series',2026,'[1, 2, 3, 4, 5]','baa1af2a-e796-4d7e-b8f2-3af9fec7b781','2026-07-22 05:36:37','2026-07-31 05:31:34',NULL,NULL,'2026-07-30 08:16:21'),('245f36df-4ec5-4e74-a824-95fcb34704e1','dae','summary',2026,'[8]','baa1af2a-e796-4d7e-b8f2-3af9fec7b781','2026-07-31 05:19:01','2026-08-04 21:01:17',NULL,NULL,'2026-08-04 21:01:20'),('2b9f33bf-9319-4057-bf9e-0bb7d13eb77a','var','total',2026,'[8]','baa1af2a-e796-4d7e-b8f2-3af9fec7b781','2026-07-31 05:21:41','2026-08-06 11:27:07',NULL,NULL,'2026-08-04 23:31:39'),('2dde838c-acb9-464b-ae39-3c6716c4bb99','var','total',2026,'[7]','baa1af2a-e796-4d7e-b8f2-3af9fec7b781','2026-07-23 08:20:28','2026-08-04 20:38:52',NULL,NULL,'2026-08-01 13:47:10'),('3ee9a545-3916-4ca5-a6ed-03e5a4915c9d','dae','daily',2026,'[7]','baa1af2a-e796-4d7e-b8f2-3af9fec7b781','2026-07-22 01:20:19','2026-08-05 09:47:02',NULL,NULL,'2026-08-01 13:52:13'),('48c3e0e0-f3e5-489c-9b5f-e1a9ef038708','dae','summary',2026,'[7]','baa1af2a-e796-4d7e-b8f2-3af9fec7b781','2026-07-22 02:49:28','2026-08-04 19:07:57',NULL,NULL,'2026-08-04 20:34:56'),('750d8000-4e14-4f88-9890-5440f8eb5af3','dae','series',2026,'[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]','baa1af2a-e796-4d7e-b8f2-3af9fec7b781','2026-07-22 05:36:59','2026-08-04 23:32:21',NULL,NULL,'2026-08-04 21:01:24'),('7f214fd8-b751-4d81-9e7d-628109d38d9c','dae','daily',2026,'[8]','baa1af2a-e796-4d7e-b8f2-3af9fec7b781','2026-07-31 03:57:22','2026-08-06 12:59:35',NULL,NULL,'2026-08-04 21:03:50');
/*!40000 ALTER TABLE `report_batches` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `rooms`
--

DROP TABLE IF EXISTS `rooms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `rooms`
--

LOCK TABLES `rooms` WRITE;
/*!40000 ALTER TABLE `rooms` DISABLE KEYS */;
INSERT INTO `rooms` VALUES ('0a6d0fac-124a-4180-9b1b-95d2655261c1','863661e2-2fa4-422e-82ce-ef8119ef19ae','2',4,'vacant','2026-07-26 12:36:05','2026-07-26 12:36:05'),('19ef9cab-8187-4706-99e9-fde8ba5b3eac','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','1',4,'vacant','2026-07-20 13:06:03','2026-08-03 15:57:59'),('219a6c6f-9048-4a92-bb5d-08d028c0ea4e','863661e2-2fa4-422e-82ce-ef8119ef19ae','8',12,'vacant','2026-07-26 12:36:05','2026-08-04 16:24:51'),('3c3e08ce-a85c-4891-8857-c4591913660d','863661e2-2fa4-422e-82ce-ef8119ef19ae','4',5,'vacant','2026-07-26 12:36:05','2026-07-26 12:36:05'),('54e24d12-09b4-4eb3-86cd-e111064170f2','863661e2-2fa4-422e-82ce-ef8119ef19ae','7',12,'vacant','2026-07-26 12:36:05','2026-08-06 12:57:18'),('65791d8918d0c-hkrz4v6ebw','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','6',10,'occupied','2026-07-27 06:29:36','2026-08-04 16:30:08'),('72f0186c-f101-4fe4-8bb9-c8ade9157f6d','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','5',8,'vacant','2026-07-20 13:06:04','2026-08-06 12:56:58'),('7b92c73e-33f3-48eb-8c01-61dc55866714','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','3',6,'vacant','2026-07-20 13:06:04','2026-08-04 16:26:54'),('87f70085-a6e6-4429-b0bd-24aa19fc146a','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','2',4,'occupied','2026-07-20 13:06:03','2026-08-04 16:30:08'),('8bdcfb68-0bb5-4629-a325-e50d37563493','863661e2-2fa4-422e-82ce-ef8119ef19ae','3',5,'vacant','2026-07-26 12:36:05','2026-07-26 12:36:05'),('c4cc0de2-790a-42c1-a9b3-1f3666efd224','863661e2-2fa4-422e-82ce-ef8119ef19ae','1',4,'reserved','2026-07-26 12:36:05','2026-08-03 22:33:07'),('cbf1b18c-c2d2-46f1-a509-251e7a26f7ca','9fdd2c94-6c5a-4c3d-8fa3-89b78e52504b','4',8,'vacant','2026-07-20 13:06:04','2026-08-03 17:19:18'),('e07bb40d-de3c-4dd5-b4c4-7cde90394e17','863661e2-2fa4-422e-82ce-ef8119ef19ae','5',8,'occupied','2026-07-26 12:36:05','2026-08-06 12:58:04'),('e2a2b088-41f7-4a26-907c-ff19aabe00e8','863661e2-2fa4-422e-82ce-ef8119ef19ae','6',8,'vacant','2026-07-26 12:36:05','2026-08-06 12:57:18');
/*!40000 ALTER TABLE `rooms` ENABLE KEYS */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES ('0068cf0e-2e6b-42b9-b405-88f7c37dbc60','Maria Santos','09878757657','gapasanmikom@gmail.com','santos123','$2b$10$5Cdz9qaMysdUixv5HA7siu1GFtBa7h2A12/Usp4pnmPw3Wz1oF9le','business','211337','2026-08-03 22:49:22','2026-07-26 12:36:02','2026-08-03 22:34:22',NULL,NULL,NULL,NULL),('baa1af2a-e796-4d7e-b8f2-3af9fec7b781','Miko Gapasan','09950644707','mikogapasan04@gmail.com','admin123','$2b$10$A6H0i1IpJsdz5ypQ9SGusOUK.qvKe80G0voOJ.g1cwjxdv1kDhkBG','admin','638973','2026-08-04 23:30:11','2026-07-20 12:52:45','2026-08-04 23:20:13',NULL,NULL,NULL,NULL),('f89185d0-3b63-4869-8cf5-9ddffdab7e55','Juan Dela Cruz','09876543234','miksgapasan@gmail.com','juan123','$2b$10$N/L4XSEOO7VMWTNzpHVCrOjfMX9hTh.05qePDh5RuQ4tqogAcgbl2','business','732849','2026-08-04 23:39:44','2026-07-20 13:06:00','2026-08-04 23:24:43',NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-08-06 13:58:40
