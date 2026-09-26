-- 001_init.sql
-- Základní schéma: poptávky z kontaktního formuláře.

CREATE TABLE IF NOT EXISTS poptavky (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  jmeno VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  zprava TEXT NULL,
  vyrizeno TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_poptavky_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
