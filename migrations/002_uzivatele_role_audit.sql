-- 002_uzivatele_role_audit.sql
--
-- Fáze 1: uživatelé administrace, přihlášení, role, audit a nastavení.
-- Všechny příkazy jsou idempotentní (IF NOT EXISTS), migraci lze spustit znovu.

-- Uživatelé administrace. Role 'ucetni' je v ENUM připravená, i když se teď
-- žádný takový účet nezakládá - přidání člověka pak nevyžaduje migraci.
CREATE TABLE IF NOT EXISTS uzivatele (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  heslo_hash VARCHAR(255) NULL,
  jmeno VARCHAR(160) NOT NULL,
  telefon VARCHAR(40) NULL,
  role ENUM('admin','provoz','instruktor','ucetni') NOT NULL DEFAULT 'provoz',
  aktivni TINYINT(1) NOT NULL DEFAULT 1,
  totp_secret VARCHAR(255) NULL,
  totp_potvrzeno_at DATETIME NULL,
  posledni_prihlaseni_at DATETIME NULL,
  zamceno_do DATETIME NULL,
  smazano_at DATETIME NULL,
  vytvoril_id INT UNSIGNED NULL,
  upravil_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_uzivatele_email (email),
  KEY idx_uzivatele_role (role, aktivni)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Přihlášení. V DB je jen SHA-256 tokenu, nikdy token samotný - únik dumpu
-- databáze tedy neumožní přihlásit se za někoho jiného.
CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(64) NOT NULL,
  uzivatel_id INT UNSIGNED NOT NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sessions_uzivatel (uzivatel_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_uzivatel FOREIGN KEY (uzivatel_id)
    REFERENCES uzivatele (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Jednorázové tokeny na nastavení nebo reset hesla. Také jen v hashi.
CREATE TABLE IF NOT EXISTS reset_hesla (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  uzivatel_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  ucel ENUM('reset','pozvanka') NOT NULL DEFAULT 'reset',
  expires_at DATETIME NOT NULL,
  pouzito_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reset_token (token_hash),
  KEY idx_reset_uzivatel (uzivatel_id),
  CONSTRAINT fk_reset_uzivatel FOREIGN KEY (uzivatel_id)
    REFERENCES uzivatele (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pokusy o přihlášení: podklad pro rate limit, zámek účtu a audit.
CREATE TABLE IF NOT EXISTS prihlaseni_pokusy (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  ip VARCHAR(45) NULL,
  uspech TINYINT(1) NOT NULL DEFAULT 0,
  duvod VARCHAR(60) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pokusy_email (email, created_at),
  KEY idx_pokusy_ip (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit: kdo, kdy, co, před a po. Uživatel se nemaže s auditem (SET NULL),
-- aby se historie nedala smazat zrušením účtu.
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uzivatel_id INT UNSIGNED NULL,
  uzivatel_email VARCHAR(255) NULL,
  akce VARCHAR(64) NOT NULL,
  entita VARCHAR(64) NOT NULL,
  entita_id VARCHAR(64) NULL,
  popis VARCHAR(255) NULL,
  pred JSON NULL,
  po JSON NULL,
  ip VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_entita (entita, entita_id, created_at),
  KEY idx_audit_uzivatel (uzivatel_id, created_at),
  KEY idx_audit_created (created_at),
  CONSTRAINT fk_audit_uzivatel FOREIGN KEY (uzivatel_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nastavení aplikace. Klíče jsou dané registrem v kódu (src/nastaveni.js),
-- v databázi jsou jen hodnoty - administrace tak umí ukázat popisky a typy,
-- aniž by je musel někdo psát do databáze.
CREATE TABLE IF NOT EXISTS nastaveni (
  klic VARCHAR(100) NOT NULL,
  hodnota TEXT NULL,
  upravil_id INT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (klic),
  CONSTRAINT fk_nastaveni_uzivatel FOREIGN KEY (upravil_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
