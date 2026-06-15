-- ============================================================
-- Tourism V2 App — MySQL Database Schema
-- Converted from PostgreSQL / Supabase
--
-- Requirements:
--   • MySQL 8.0.13+ (required for DEFAULT (UUID()) expressions)
--   • InnoDB engine (default in MySQL 8.x, required for FK support)
--
-- Key conversions from PostgreSQL → MySQL:
--   • uuid / gen_random_uuid()     → CHAR(36) / DEFAULT (UUID())
--   • CREATE TYPE … AS ENUM        → inline ENUM(...) per column
--   • boolean                      → BOOLEAN  (alias for TINYINT(1))
--   • text / character varying      → VARCHAR / TEXT
--   • timestamp with time zone      → DATETIME
--   • public.business_line[]        → JSON  (no native arrays in MySQL)
--   • ARRAY[...] / ANY (ARRAY[...]) → IN (...)
--   • now() - '30 days'::interval   → DATE_SUB(NOW(), INTERVAL 30 DAY)
--   • WITH (security_invoker = on)  → removed (no MySQL equivalent)
--   • 0::bigint cast                → plain 0
-- ============================================================


-- ------------------------------------------------------------
-- DATABASE
-- ------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS tourism_db
  CHARACTER SET  utf8mb4
  COLLATE        utf8mb4_unicode_ci;

USE tourism_db;


-- ------------------------------------------------------------
-- TABLES
-- (created in FK-dependency order)
-- ------------------------------------------------------------

-- ── users ────────────────────────────────────────────────────
-- Renamed from `profiles` in the original Supabase schema.
-- `password` stores a bcrypt / argon2 hash — never plain-text.
CREATE TABLE users (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  full_name   VARCHAR(255) NOT NULL,
  phone       VARCHAR(50)  NOT NULL,
  email       VARCHAR(255),
  username    VARCHAR(100) NOT NULL,
  password    TEXT         NOT NULL,   -- bcrypt / argon2 hash only
  role        ENUM('business', 'admin')
                           NOT NULL DEFAULT 'business',
  reset_otp   VARCHAR(6),
  reset_otp_expiry DATETIME,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  deleted_at  DATETIME,
  CONSTRAINT users_pkey            PRIMARY KEY (id),
  CONSTRAINT users_username_unique UNIQUE (username)
) ENGINE = InnoDB;


-- ── businesses ───────────────────────────────────────────────
-- `profile_id` renamed to `user_id` to match V2 schema.
-- `business_line` is stored as a JSON array because MySQL has
-- no native array type. Example value: ["hotel", "resort"]
CREATE TABLE businesses (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id              CHAR(36)     NOT NULL,           -- FK → users.id
  business_name        VARCHAR(255) NOT NULL,
  permit_number        VARCHAR(255),
  registration_number  VARCHAR(255),
  street               TEXT,
  total_rooms          INT          NOT NULL DEFAULT 0,
  permit_file_url      VARCHAR(1000),
  valid_id_url         VARCHAR(1000),
  status               ENUM('pending', 'approved', 'rejected',
                            'warning', 'suspended')
                                    NOT NULL DEFAULT 'pending',
  remarks              TEXT,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                             ON UPDATE CURRENT_TIMESTAMP,
  deleted_at           DATETIME,
  region               VARCHAR(255),
  city_municipality    VARCHAR(255),
  province             VARCHAR(255),
  barangay             VARCHAR(255),
  tradename            VARCHAR(255),
  -- PostgreSQL array → JSON. Allowed values per enum:
  --   'hotel', 'resort', 'motel', 'pension_inn',
  --   'youth_hostel', 'apartment', 'others'
  business_line        JSON,
  owner_first_name     VARCHAR(255),
  owner_last_name      VARCHAR(255),
  owner_middle_name    VARCHAR(255),
  business_type        ENUM('sole_proprietorship',
                            'corporation',
                            'partnership')
                                    NOT NULL DEFAULT 'sole_proprietorship',
  CONSTRAINT businesses_pkey         PRIMARY KEY (id),
  CONSTRAINT businesses_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users (id)
) ENGINE = InnoDB;


-- ── guest_records ────────────────────────────────────────────
CREATE TABLE guest_records (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  business_id         CHAR(36)     NOT NULL,            -- FK → businesses.id
  check_in            DATE         NOT NULL,
  check_out           DATE         NOT NULL,
  total_guests        INT          NOT NULL,
  rooms_occupied      INT          NOT NULL,
  purpose_of_visit    VARCHAR(255) NOT NULL,
  transportation_mode VARCHAR(255) NOT NULL,
  status              ENUM('active', 'archived')
                                   NOT NULL DEFAULT 'active',
  is_deleted          BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT guest_records_pkey             PRIMARY KEY (id),
  CONSTRAINT guest_records_business_id_fkey FOREIGN KEY (business_id)
    REFERENCES businesses (id)
) ENGINE = InnoDB;


-- ── guest_breakdowns ─────────────────────────────────────────
-- The PostgreSQL CHECK on `nationality` is replicated by the
-- ENUM itself — only 'Filipino', 'Foreign', or NULL are valid.
CREATE TABLE guest_breakdowns (
  id                  CHAR(36)  NOT NULL DEFAULT (UUID()),
  guest_record_id     CHAR(36)  NOT NULL,               -- FK → guest_records.id
  country             VARCHAR(255),
  philippines_region  VARCHAR(255),
  sex                 ENUM('male', 'female')    NOT NULL,
  age_group           ENUM('0-9', '10-17', '18-25', '26-35',
                           '36-45', '46-55', '56+',
                           'prefer_not_to_say') NOT NULL,
  count               INT       NOT NULL,
  created_at          DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_overseas         BOOLEAN   NOT NULL DEFAULT FALSE,
  nationality         ENUM('Filipino', 'Foreign'),       -- NULL allowed
  CONSTRAINT guest_breakdowns_pkey                 PRIMARY KEY (id),
  CONSTRAINT guest_breakdowns_guest_record_id_fkey FOREIGN KEY (guest_record_id)
    REFERENCES guest_records (id)
) ENGINE = InnoDB;


-- ── reports ──────────────────────────────────────────────────
CREATE TABLE reports (
  id                          CHAR(36)     NOT NULL DEFAULT (UUID()),
  report_type                 VARCHAR(100) NOT NULL DEFAULT 'DAE-1B',
  period_month                SMALLINT     NOT NULL,
  period_year                 SMALLINT     NOT NULL,
  file_url                    VARCHAR(1000),
  generated_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generated_by                CHAR(36),                 -- FK → users.id (nullable)
  include_sheet_establishment BOOLEAN      NOT NULL DEFAULT TRUE,
  include_sheet_country_sum   BOOLEAN      NOT NULL DEFAULT TRUE,
  include_sheet_monthly       BOOLEAN      NOT NULL DEFAULT TRUE,
  CONSTRAINT reports_pkey              PRIMARY KEY (id),
  CONSTRAINT reports_generated_by_fkey FOREIGN KEY (generated_by)
    REFERENCES users (id),
  CONSTRAINT chk_period_month CHECK (period_month >= 1 AND period_month <= 12),
  CONSTRAINT chk_period_year  CHECK (period_year  >= 2000)
) ENGINE = InnoDB;


-- ── messages ─────────────────────────────────────────────────
CREATE TABLE messages (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  sender_id    CHAR(36)     NOT NULL,                   -- FK → users.id
  message_type ENUM('compliance', 'announcement', 'general')
                            NOT NULL DEFAULT 'general',
  subject      VARCHAR(255) NOT NULL,
  content      TEXT         NOT NULL,
  is_broadcast BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT messages_pkey           PRIMARY KEY (id),
  CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id)
    REFERENCES users (id)
) ENGINE = InnoDB;


-- ── message_recipients ───────────────────────────────────────
CREATE TABLE message_recipients (
  id          CHAR(36)  NOT NULL DEFAULT (UUID()),
  message_id  CHAR(36)  NOT NULL,                       -- FK → messages.id
  business_id CHAR(36)  NOT NULL,                       -- FK → businesses.id
  status      ENUM('unread', 'read', 'archived')
                        NOT NULL DEFAULT 'unread',
  is_read     BOOLEAN   NOT NULL DEFAULT FALSE,
  read_at     DATETIME,
  created_at  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT message_recipients_pkey             PRIMARY KEY (id),
  CONSTRAINT message_recipients_message_id_fkey  FOREIGN KEY (message_id)
    REFERENCES messages (id),
  CONSTRAINT message_recipients_business_id_fkey FOREIGN KEY (business_id)
    REFERENCES businesses (id)
) ENGINE = InnoDB;


-- ------------------------------------------------------------
-- INDEXES
-- (FKs get implicit indexes; these add extra read performance)
-- ------------------------------------------------------------

-- users
CREATE INDEX idx_users_role            ON users              (role);
CREATE INDEX idx_users_deleted_at      ON users              (deleted_at);

-- businesses
CREATE INDEX idx_businesses_user_id    ON businesses         (user_id);
CREATE INDEX idx_businesses_status     ON businesses         (status);
CREATE INDEX idx_businesses_deleted_at ON businesses         (deleted_at);

-- guest_records
CREATE INDEX idx_gr_business_id        ON guest_records      (business_id);
CREATE INDEX idx_gr_status             ON guest_records      (status);
CREATE INDEX idx_gr_check_in           ON guest_records      (check_in);
CREATE INDEX idx_gr_is_deleted         ON guest_records      (is_deleted);

-- guest_breakdowns
CREATE INDEX idx_gb_guest_record_id    ON guest_breakdowns   (guest_record_id);
CREATE INDEX idx_gb_country            ON guest_breakdowns   (country);

-- reports
CREATE INDEX idx_reports_period        ON reports            (period_year, period_month);
CREATE INDEX idx_reports_generated_by  ON reports            (generated_by);

-- messages
CREATE INDEX idx_messages_sender_id    ON messages           (sender_id);
CREATE INDEX idx_messages_created_at   ON messages           (created_at);

-- message_recipients
CREATE INDEX idx_mr_message_id         ON message_recipients (message_id);
CREATE INDEX idx_mr_business_id        ON message_recipients (business_id);
CREATE INDEX idx_mr_is_read            ON message_recipients (is_read);
CREATE INDEX idx_mr_status             ON message_recipients (status);


-- ------------------------------------------------------------
-- VIEWS
-- ------------------------------------------------------------

-- ── business_activity_summary ────────────────────────────────
-- PostgreSQL differences converted:
--   • WITH (security_invoker = on)       → removed
--   • ANY (ARRAY['approved', 'warning']) → IN ('approved', 'warning')
--   • now() - '30 days'::interval        → DATE_SUB(NOW(), INTERVAL 30 DAY)
--   • COALESCE(SUM(...), 0::bigint)      → COALESCE(SUM(...), 0)
--   • 'no_activity'::text casts          → plain string literals
CREATE VIEW business_activity_summary AS
SELECT
  b.id,
  b.business_name,
  b.business_line,
  b.status                              AS business_status,
  COUNT(gr.id)                          AS total_records,
  COALESCE(SUM(gr.total_guests), 0)     AS total_guests,
  MAX(gr.created_at)                    AS last_activity,
  CASE
    WHEN COUNT(gr.id) = 0
         THEN 'no_activity'
    WHEN MAX(gr.created_at) < DATE_SUB(NOW(), INTERVAL 30 DAY)
         THEN 'inactive'
    WHEN MAX(gr.created_at) < DATE_SUB(NOW(), INTERVAL 7 DAY)
         THEN 'low_activity'
    ELSE 'active'
  END                                   AS activity_status
FROM businesses b
LEFT JOIN guest_records gr
  ON  gr.business_id = b.id
  AND gr.is_deleted  = FALSE
WHERE b.status     IN ('approved', 'warning')
  AND b.deleted_at IS NULL
GROUP BY
  b.id,
  b.business_name,
  b.business_line,
  b.status;


-- ── guest_breakdowns_synced ──────────────────────────────────
-- Joins breakdowns with their parent record to expose business_id.
-- WITH (security_invoker = on) removed — no MySQL equivalent.
CREATE VIEW guest_breakdowns_synced AS
SELECT
  gb.id,
  gb.guest_record_id,
  gb.country,
  gb.philippines_region,
  gb.sex,
  gb.age_group,
  gb.count,
  gb.created_at,
  gb.is_overseas,
  gb.nationality,
  gr.business_id
FROM  guest_breakdowns gb
JOIN  guest_records    gr ON gb.guest_record_id = gr.id;