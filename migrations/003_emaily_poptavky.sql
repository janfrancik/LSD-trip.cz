-- 003_emaily_poptavky.sql
--
-- Fáze 1, druhá část:
--   a) log odeslaných e-mailů - potřebný už teď, protože reset hesla posílá
--      e-mail a chceme od začátku vidět, co komu odešlo (a v testovacím
--      režimu i to, komu by to odešlo v produkci),
--   b) převedení poptávek na stav a doplnění polí, která administrace potřebuje.

-- a) E-maily -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS emaily (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  resend_id VARCHAR(100) NULL,
  sablona_klic VARCHAR(60) NULL,
  -- prijemce = komu e-mail patří (skutečný zákazník),
  -- prijemce_skutecny = kam byl doopravdy odeslán. V testovacím režimu se liší.
  prijemce VARCHAR(255) NOT NULL,
  prijemce_skutecny VARCHAR(255) NULL,
  predmet VARCHAR(255) NOT NULL,
  telo_snapshot MEDIUMTEXT NULL,
  rezervace_id INT UNSIGNED NULL,
  zakaznik_id INT UNSIGNED NULL,
  termin_id INT UNSIGNED NULL,
  poptavka_id INT UNSIGNED NULL,
  uzivatel_id INT UNSIGNED NULL,
  stav ENUM('ve_fronte','odeslano','doruceno','otevreno','kliknuto','bounce','stiznost','chyba')
    NOT NULL DEFAULT 've_fronte',
  rezim ENUM('live','test','vypnuto') NOT NULL,
  chyba TEXT NULL,
  odeslano_at DATETIME NULL,
  stav_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_emaily_resend (resend_id),
  KEY idx_emaily_prijemce (prijemce),
  KEY idx_emaily_stav (stav, created_at),
  KEY idx_emaily_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_udalosti (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email_id INT UNSIGNED NOT NULL,
  typ VARCHAR(40) NOT NULL,
  payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_email_udalosti_email (email_id, created_at),
  CONSTRAINT fk_email_udalosti_email FOREIGN KEY (email_id)
    REFERENCES emaily (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- b) Poptávky ----------------------------------------------------------------
-- Tabulka poptavky vznikla v 001 s příznakem `vyrizeno`. Administrace potřebuje
-- víc stavů (rozpracovanou poptávku i spam), telefon, vazby a soft delete.
-- ALTER ... IF NOT EXISTS je v MariaDB podporované, migrace je tedy opakovatelná.

ALTER TABLE poptavky
  ADD COLUMN IF NOT EXISTS telefon VARCHAR(40) NULL AFTER email,
  ADD COLUMN IF NOT EXISTS produkt_id INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS termin_id INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS zakaznik_id INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS stav ENUM('nova','vyrizuje_se','vyrizeno','spam')
    NOT NULL DEFAULT 'nova',
  ADD COLUMN IF NOT EXISTS prirazeno_id INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS odpoved TEXT NULL,
  ADD COLUMN IF NOT EXISTS odpovezeno_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS odpovedel_id INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS interni_poznamka TEXT NULL,
  ADD COLUMN IF NOT EXISTS zdroj VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS ip VARCHAR(45) NULL,
  ADD COLUMN IF NOT EXISTS smazano_at DATETIME NULL;

-- Převod starého příznaku na stav.
--
-- Pozor: obyčejný UPDATE se zmínkou o `vyrizeno` by při druhém spuštění
-- migrace spadl už při parsování, protože sloupec už neexistuje. Proto se
-- příkaz skládá dynamicky a když sloupec chybí, neudělá se nic.
SET @ma_vyrizeno := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'poptavky' AND COLUMN_NAME = 'vyrizeno'
);
SET @sql := IF(@ma_vyrizeno > 0,
  'UPDATE poptavky SET stav = ''vyrizeno'' WHERE vyrizeno = 1',
  'DO 0');
PREPARE prevod FROM @sql;
EXECUTE prevod;
DEALLOCATE PREPARE prevod;

ALTER TABLE poptavky DROP COLUMN IF EXISTS vyrizeno;

ALTER TABLE poptavky
  ADD KEY IF NOT EXISTS idx_poptavky_stav (stav, created_at),
  ADD KEY IF NOT EXISTS idx_poptavky_email (email);
