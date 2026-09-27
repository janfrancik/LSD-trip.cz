-- 004_akceptace.sql
--
-- Modul „Ke schválení“ (akceptační testování). Běží jen na testu a ve vývoji;
-- v produkci se obrazovka ani API nezapnou. Tabulky ale vznikají všude, aby
-- migrace byla pro obě prostředí stejná a nasazení se nelišilo schématem.
--
-- Zadání testovacích úkolů je v repozitáři (docs/akceptace/<faze>.yml) a při
-- startu aplikace se naimportuje. V databázi jsou proto jak úkoly (kopie
-- zadání), tak výsledky testerů - a ty se při novém importu nesmí ztratit,
-- proto je párování na `kod`, ne na id.

-- Nová role. Tester vidí jen modul Ke schválení, nic jiného.
ALTER TABLE uzivatele
  MODIFY COLUMN role ENUM('admin','provoz','instruktor','ucetni','tester')
    NOT NULL DEFAULT 'provoz';

-- Verze = jedna fáze k otestování.
CREATE TABLE IF NOT EXISTS akceptace_verze (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kod VARCHAR(60) NOT NULL,
  nazev VARCHAR(200) NOT NULL,
  popis TEXT NULL,
  poradi INT NOT NULL DEFAULT 0,
  stav ENUM('otevrena','schvalena') NOT NULL DEFAULT 'otevrena',
  schvalil_id INT UNSIGNED NULL,
  schvaleno_at DATETIME NULL,
  schvaleni_poznamka TEXT NULL,
  -- Kdy se testerům rozeslalo, že je co testovat. NULL = ještě ne.
  oznameno_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_akceptace_verze_kod (kod),
  KEY idx_akceptace_verze_stav (stav, poradi),
  CONSTRAINT fk_akceptace_verze_schvalil FOREIGN KEY (schvalil_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Jeden testovací úkol. `definice_hash` slouží k poznání, že se zadání v repu
-- změnilo - podle toho administrace testerovi ukáže, že testoval starší verzi
-- zadání. `aktivni = 0` znamená, že úkol už v souboru není; nemazáme ho, aby
-- zůstaly výsledky a historie.
CREATE TABLE IF NOT EXISTS akceptace_ukoly (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  verze_id INT UNSIGNED NOT NULL,
  kod VARCHAR(80) NOT NULL,
  nazev VARCHAR(200) NOT NULL,
  postup TEXT NOT NULL,
  ocekavany_vysledek TEXT NOT NULL,
  odkaz VARCHAR(255) NULL,
  oblast VARCHAR(40) NULL,
  poradi INT NOT NULL DEFAULT 0,
  aktivni TINYINT(1) NOT NULL DEFAULT 1,
  definice_hash CHAR(64) NOT NULL,
  zmeneno_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_akceptace_ukol_kod (verze_id, kod),
  KEY idx_akceptace_ukol_verze (verze_id, aktivni, poradi),
  CONSTRAINT fk_akceptace_ukol_verze FOREIGN KEY (verze_id)
    REFERENCES akceptace_verze (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Výsledek jednoho testera u jednoho úkolu. Každý tester má vlastní řádek,
-- takže je vidět, kdo co otestoval a kdy.
CREATE TABLE IF NOT EXISTS akceptace_vysledky (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ukol_id INT UNSIGNED NOT NULL,
  uzivatel_id INT UNSIGNED NOT NULL,
  stav ENUM('funguje','nefunguje','nerozumim','k_pretestovani') NOT NULL,
  komentar TEXT NULL,
  -- Stav před přepnutím na „k přetestování“ - aby bylo poznat, co se opravovalo.
  predchozi_stav ENUM('funguje','nefunguje','nerozumim') NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_akceptace_vysledek (ukol_id, uzivatel_id),
  KEY idx_akceptace_vysledek_uzivatel (uzivatel_id, updated_at),
  CONSTRAINT fk_akceptace_vysledek_ukol FOREIGN KEY (ukol_id)
    REFERENCES akceptace_ukoly (id) ON DELETE CASCADE,
  CONSTRAINT fk_akceptace_vysledek_uzivatel FOREIGN KEY (uzivatel_id)
    REFERENCES uzivatele (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Hlášení problému z tlačítka v hlavičce. Kontext (adresa, prohlížeč,
-- rozlišení) se ukládá automaticky, aby ho tester nemusel opisovat.
CREATE TABLE IF NOT EXISTS akceptace_hlaseni (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  verze_id INT UNSIGNED NULL,
  ukol_id INT UNSIGNED NULL,
  uzivatel_id INT UNSIGNED NULL,
  text TEXT NOT NULL,
  url VARCHAR(500) NULL,
  prohlizec VARCHAR(255) NULL,
  rozliseni VARCHAR(40) NULL,
  stav ENUM('nove','resi_se','vyreseno','zamitnuto') NOT NULL DEFAULT 'nove',
  odpoved TEXT NULL,
  vyresil_id INT UNSIGNED NULL,
  vyreseno_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_akceptace_hlaseni_stav (stav, created_at),
  KEY idx_akceptace_hlaseni_verze (verze_id, stav),
  CONSTRAINT fk_akceptace_hlaseni_verze FOREIGN KEY (verze_id)
    REFERENCES akceptace_verze (id) ON DELETE SET NULL,
  CONSTRAINT fk_akceptace_hlaseni_ukol FOREIGN KEY (ukol_id)
    REFERENCES akceptace_ukoly (id) ON DELETE SET NULL,
  CONSTRAINT fk_akceptace_hlaseni_uzivatel FOREIGN KEY (uzivatel_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL,
  CONSTRAINT fk_akceptace_hlaseni_vyresil FOREIGN KEY (vyresil_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Přílohy (snímky obrazovky). Soubor leží ve volume uploads, v databázi je
-- jen cesta. Dokud se příloha nepřipojí k výsledku nebo hlášení, má obě vazby
-- NULL - takové nepoužité přílohy uklidí údržba.
CREATE TABLE IF NOT EXISTS akceptace_prilohy (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  vysledek_id INT UNSIGNED NULL,
  hlaseni_id INT UNSIGNED NULL,
  uzivatel_id INT UNSIGNED NULL,
  soubor VARCHAR(255) NOT NULL,
  nazev VARCHAR(255) NULL,
  mime VARCHAR(60) NOT NULL,
  velikost INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_akceptace_priloha_vysledek (vysledek_id),
  KEY idx_akceptace_priloha_hlaseni (hlaseni_id),
  KEY idx_akceptace_priloha_nepouzite (created_at),
  CONSTRAINT fk_akceptace_priloha_vysledek FOREIGN KEY (vysledek_id)
    REFERENCES akceptace_vysledky (id) ON DELETE CASCADE,
  CONSTRAINT fk_akceptace_priloha_hlaseni FOREIGN KEY (hlaseni_id)
    REFERENCES akceptace_hlaseni (id) ON DELETE CASCADE,
  CONSTRAINT fk_akceptace_priloha_uzivatel FOREIGN KEY (uzivatel_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
