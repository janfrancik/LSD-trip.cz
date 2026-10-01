-- 008_produkty_a_cenik.sql
--
-- Etapa E1 modulu Kurzy (docs/plan-kurzy.md).
--
-- Zavádí produkty a ceník. Kurz NENÍ vlastní tabulka - je to řádek v `produkty`
-- s `typ = 'kurz'`, přesně podle modelu v docs/plan-administrace.md §3.2.
-- Tandem, expedice a poukazy půjdou později toutéž cestou, aniž by se schéma
-- muselo měnit.
--
-- Zpětná kompatibilita: všechny tabulky zavádí tatáž verze aplikace, která je
-- používá, takže platí výjimka z pravidla expand/contract v CLAUDE.md. Nic se
-- nemaže ani nepřejmenovává.
--
-- Opakované spuštění: samé CREATE TABLE IF NOT EXISTS, číselník DPH se plní
-- přes ON DUPLICATE KEY UPDATE s no-op zápisem, takže druhý běh nepřepíše
-- sazby, které už majitelka upravila v administraci.

-- ----------------------------------------------------------------- DPH

-- Režim DPH je volitelný u KAŽDÉHO produktu zvlášť. Zatím je všechno na 21 %;
-- `osvobozeno61d` je připravené pro výcvik, až to potvrdí daňový poradce
-- (docs/plan-administrace.md §11). Přepnutí je pak změna u produktu, ne v kódu,
-- a projeví se jen na nově vystavených dokladech.
CREATE TABLE IF NOT EXISTS dph_sazby (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kod VARCHAR(20) NOT NULL,
  nazev VARCHAR(100) NOT NULL,
  procento DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  rezim ENUM('standardni','osvobozeno') NOT NULL DEFAULT 'standardni',
  -- Text, který musí být na faktuře u osvobozených položek.
  pravni_text VARCHAR(255) NULL,
  vychozi TINYINT(1) NOT NULL DEFAULT 0,
  aktivni TINYINT(1) NOT NULL DEFAULT 1,
  poradi INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dph_sazby_kod (kod),
  KEY idx_dph_sazby_aktivni (aktivni, poradi)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- `kod = kod` je schválně no-op: při druhém běhu migrace se nic nepřepíše.
INSERT INTO dph_sazby (kod, nazev, procento, rezim, pravni_text, vychozi, poradi) VALUES
  ('zakladni21', 'Základní sazba 21 %', 21.00, 'standardni', NULL, 1, 1),
  ('snizena12', 'Snížená sazba 12 %', 12.00, 'standardni', NULL, 0, 2),
  ('osvobozeno61d', 'Osvobozeno podle § 61 písm. d)', 0.00, 'osvobozeno',
   'Osvobozeno od DPH podle § 61 písm. d) zákona o DPH.', 0, 3)
ON DUPLICATE KEY UPDATE kod = kod;

-- ------------------------------------------------------------- produkty

-- `cena_hal` v haléřích (INT), nikdy FLOAT. `cena_na_dotaz` se liší od ceny 0:
-- kurz IAFF cenu má, ale závisí na rozsahu tunelových minut.
--
-- Požadavky na účastníka jsou tady, ne v textu popisu, protože podle nich
-- později pozná přihláška, na co se ptát, a soupiska, co zvýraznit.
CREATE TABLE IF NOT EXISTS produkty (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  typ ENUM('tandem','kurz','expedice','helitour','poukaz','jine') NOT NULL DEFAULT 'kurz',
  slug VARCHAR(160) NOT NULL,
  nazev VARCHAR(200) NOT NULL,
  podtitul VARCHAR(255) NULL,
  -- Štítek na kartě, například "Nejžádanější" nebo "Zrychlený výcvik".
  stitek VARCHAR(60) NULL,
  perex VARCHAR(500) NULL,
  popis MEDIUMTEXT NULL,
  co_je_v_cene TEXT NULL,
  cena_hal INT UNSIGNED NULL,
  cena_na_dotaz TINYINT(1) NOT NULL DEFAULT 0,
  dph_sazba_id INT UNSIGNED NULL,
  min_vek TINYINT UNSIGNED NULL,
  max_vek TINYINT UNSIGNED NULL,
  max_vaha_kg SMALLINT UNSIGNED NULL,
  -- Do kolika let je potřeba písemný souhlas zákonného zástupce.
  souhlas_zastupce_do_let TINYINT UNSIGNED NULL,
  vyzaduje_lekarskou_prohlidku TINYINT(1) NOT NULL DEFAULT 0,
  vyzaduje_zdravotni_prohlaseni TINYINT(1) NOT NULL DEFAULT 0,
  -- Volný text, protože "48 hodin" a "5 dní" se nedají porovnávat.
  delka_text VARCHAR(60) NULL,
  uroven_text VARCHAR(60) NULL,
  seo_title VARCHAR(200) NULL,
  seo_description VARCHAR(400) NULL,
  aktivni TINYINT(1) NOT NULL DEFAULT 0,
  poradi INT NOT NULL DEFAULT 0,
  smazano_at DATETIME NULL,
  vytvoril_id INT UNSIGNED NULL,
  upravil_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_produkty_slug (slug),
  KEY idx_produkty_typ (typ, aktivni, poradi),
  KEY idx_produkty_smazano (smazano_at),
  CONSTRAINT fk_produkty_dph FOREIGN KEY (dph_sazba_id)
    REFERENCES dph_sazby (id) ON DELETE RESTRICT,
  CONSTRAINT fk_produkty_vytvoril FOREIGN KEY (vytvoril_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL,
  CONSTRAINT fk_produkty_upravil FOREIGN KEY (upravil_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Checklist "co si vzít a co doložit". Vlastní tabulka, ne odrážky v textu -
-- majitelka s nimi v administraci hýbe po jednom a web je vypisuje jako seznam.
CREATE TABLE IF NOT EXISTS produkt_pozadavky (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  produkt_id INT UNSIGNED NOT NULL,
  text VARCHAR(500) NOT NULL,
  poradi INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_produkt_pozadavky (produkt_id, poradi),
  CONSTRAINT fk_produkt_pozadavky_produkt FOREIGN KEY (produkt_id)
    REFERENCES produkty (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Průběh kurzu krok za krokem. Proti plánu administrace je to jediná nová
-- tabulka: `produkt_pozadavky` je checklist, ale "jak to probíhá" nemělo kam.
-- Tvarem odpovídá dnešnímu TANDEM_STEPS v public/assets/js/data.js, takže
-- stejnou tabulku později využije i tandem.
CREATE TABLE IF NOT EXISTS produkt_kroky (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  produkt_id INT UNSIGNED NOT NULL,
  -- "01", "02" - číslo je text, protože se vypisuje tak, jak je napsané.
  cislo VARCHAR(4) NULL,
  nadpis VARCHAR(160) NOT NULL,
  text TEXT NULL,
  poradi INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_produkt_kroky (produkt_id, poradi),
  CONSTRAINT fk_produkt_kroky_produkt FOREIGN KEY (produkt_id)
    REFERENCES produkty (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historie cen. Plní ji aplikace při každé změně ceny, ne trigger v databázi -
-- jinak by se nedalo uložit, KDO a PROČ cenu změnil.
--
-- `entita` je připravená i na varianty a příplatky, které přijdou s tandemem.
-- Cizí klíč tu schválně není: řádek musí přežít i smazání produktu, jinak by
-- historie zmizela právě ve chvíli, kdy je potřeba.
CREATE TABLE IF NOT EXISTS cenik_historie (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  entita ENUM('produkt','varianta','priplatek') NOT NULL DEFAULT 'produkt',
  entita_id INT UNSIGNED NOT NULL,
  cena_hal_pred INT UNSIGNED NULL,
  cena_hal_po INT UNSIGNED NULL,
  duvod VARCHAR(255) NULL,
  uzivatel_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cenik_historie (entita, entita_id, created_at),
  CONSTRAINT fk_cenik_historie_uzivatel FOREIGN KEY (uzivatel_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
