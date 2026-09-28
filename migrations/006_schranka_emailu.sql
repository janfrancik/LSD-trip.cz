-- 006_schranka_emailu.sql
--
-- Testovací schránka e-mailů. Na testu nebude Resend (ten se nasadí až
-- v produkci s firemním klíčem pro doménu lsd-trip.cz), takže e-maily nikam
-- neodcházejí - ukládají se celé do databáze a v administraci se dají otevřít
-- jako v poštovním klientovi, včetně funkčních odkazů.
--
-- Produkce používá tutéž tabulku jako log odeslaných e-mailů se stavem
-- doručení z Resendu; liší se jen režim.

-- Textová verze se dosud nikam neukládala - do schránky patří obojí,
-- aby šlo přepnout mezi HTML a textem stejně jako v poštovním klientovi.
ALTER TABLE emaily
  ADD COLUMN IF NOT EXISTS telo_text MEDIUMTEXT NULL AFTER telo_snapshot;

-- Nový režim a nový stav. Přidání hodnoty do ENUM je zpětně kompatibilní:
-- starší verze aplikace o něm neví, ale nic jí nerozbije.
ALTER TABLE emaily
  MODIFY COLUMN rezim ENUM('live','test','vypnuto','schranka') NOT NULL;

ALTER TABLE emaily
  MODIFY COLUMN stav ENUM('ve_fronte','ve_schrance','odeslano','doruceno','otevreno',
                          'kliknuto','bounce','stiznost','chyba')
    NOT NULL DEFAULT 've_fronte';

-- Přílohy e-mailu. Soubor leží ve volume uploads (stejně jako přílohy
-- akceptace), v databázi je jen cesta - jinak by z dumpu databáze byly
-- megabajty PDF s fakturami.
CREATE TABLE IF NOT EXISTS email_prilohy (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email_id INT UNSIGNED NOT NULL,
  nazev VARCHAR(255) NOT NULL,
  mime VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
  velikost INT UNSIGNED NOT NULL DEFAULT 0,
  soubor VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_email_prilohy_email (email_id),
  CONSTRAINT fk_email_prilohy_email FOREIGN KEY (email_id)
    REFERENCES emaily (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Hledání ve schránce jde podle předmětu a adresáta.
ALTER TABLE emaily
  ADD KEY IF NOT EXISTS idx_emaily_sablona (sablona_klic, created_at);
