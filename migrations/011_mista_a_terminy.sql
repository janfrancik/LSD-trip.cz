-- 011_mista_a_terminy.sql
--
-- Etapa E3 modulu Kurzy (docs/plan-kurzy.md): kde se létá a kdy.
--
-- Čas je tady schválně dvojí povahy a nesmí se to smíchat:
--
--   - `terminy.datum`, `cas_od`, `cas_do` jsou hodiny na letišti. DATE a TIME
--     bez zóny, protože "sraz v 8:00" platí v 8:00 bez ohledu na to, jestli
--     zrovna běží letní čas. Nikdy se nepřevádějí.
--   - `zruseno_at`, `created_at`, `updated_at` jsou okamžiky na ose času,
--     tedy DATETIME v UTC jako všude jinde (CLAUDE.md).
--
-- Opakované termíny se **nedopočítávají z pravidla za běhu**, ale zakládají
-- se řádky. Provoz každý den ručně přiohne (jiný čas, jiná kapacita) a
-- pravidlo by mu to přepisovalo. `termin_serie` slouží jen k tomu, aby šlo
-- "všech 12 pátků" najednou najít, upravit nebo zrušit.
--
-- Zpětná kompatibilita: všechny tabulky zavádí tatáž verze aplikace, která
-- je používá, takže platí výjimka z pravidla expand/contract v CLAUDE.md.
-- Nic se nemaže ani nepřejmenovává.

-- Kde se létá. Číselník, ne volný text u termínu - jinak by na webu byla
-- "Jihlava", "Jihlava LKJI" i "jihlava" jako tři různá místa.
CREATE TABLE IF NOT EXISTS mista (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nazev VARCHAR(160) NOT NULL,
  adresa VARCHAR(255) NULL,
  -- Souřadnice pro odkaz do mapy. DECIMAL, ne FLOAT: u souřadnic se zaokrouhlení
  -- pozná na desítkách metrů.
  gps_lat DECIMAL(10, 7) NULL,
  gps_lon DECIMAL(10, 7) NULL,
  poznamka VARCHAR(500) NULL,
  aktivni TINYINT(1) NOT NULL DEFAULT 1,
  poradi INT NOT NULL DEFAULT 0,
  smazano_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  vytvoril_id INT UNSIGNED NULL,
  upravil_id INT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_mista_aktivni (aktivni, poradi),
  CONSTRAINT fk_mista_vytvoril FOREIGN KEY (vytvoril_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL,
  CONSTRAINT fk_mista_upravil FOREIGN KEY (upravil_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Z čeho hromadné zakládání vzniklo. `pravidlo` je JSON s tím, co se zadalo
-- do formuláře (od, do, dny v týdnu, časy) - aby se dalo později zopakovat
-- nebo aby bylo vidět, proč těch termínů je zrovna dvanáct.
CREATE TABLE IF NOT EXISTS termin_serie (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nazev VARCHAR(160) NULL,
  pravidlo JSON NULL,
  vytvoril_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_termin_serie_vytvoril FOREIGN KEY (vytvoril_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS terminy (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  produkt_id INT UNSIGNED NOT NULL,
  serie_id INT UNSIGNED NULL,
  -- Když se termín jmenuje jinak než kurz ("AFF květen — víkendový běh").
  nazev_prepis VARCHAR(200) NULL,

  -- Hodiny na letišti, bez zóny. Viz hlavička.
  datum DATE NOT NULL,
  cas_od TIME NULL,
  cas_do TIME NULL,
  -- Když přesný čas nedává smysl: "starty 7:30 — 15:00", "po domluvě".
  popis_casu VARCHAR(100) NULL,

  misto_id INT UNSIGNED NULL,
  -- 0 = bez omezení. Kurzy kapacitu mají vždycky, ale den otevřených dveří ne
  -- a nutit do něj vymyšlené číslo by bylo horší než jedna domluvená nula.
  kapacita_mist INT UNSIGNED NOT NULL DEFAULT 0,
  -- Cache pro výpisy. Autoritativní je součet z `rezervace` uvnitř transakce
  -- (docs/plan-kurzy.md §5), která tenhle sloupec přepočítá v téže transakci.
  obsazeno_mist INT UNSIGNED NOT NULL DEFAULT 0,
  -- Cena jen pro tenhle termín (zvýhodněný běh). NULL = platí cena kurzu.
  cena_hal_prepis INT UNSIGNED NULL,
  popis TEXT NULL,

  stav ENUM('otevreno','plno','zruseno','probehlo') NOT NULL DEFAULT 'otevreno',
  zruseno_duvod VARCHAR(500) NULL,
  zruseno_at DATETIME NULL,
  -- Skrytý termín existuje v administraci, ale na web nejde - třeba dokud
  -- není jisté, že se poletí.
  viditelny TINYINT(1) NOT NULL DEFAULT 1,

  smazano_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  vytvoril_id INT UNSIGNED NULL,
  upravil_id INT UNSIGNED NULL,

  PRIMARY KEY (id),
  KEY idx_terminy_datum (datum, stav),
  KEY idx_terminy_produkt (produkt_id, datum),
  KEY idx_terminy_serie (serie_id),
  KEY idx_terminy_smazano (smazano_at),
  -- RESTRICT schválně: smazat produkt, na kterém visí termíny, musí být
  -- vědomé rozhodnutí, ne vedlejší účinek. V administraci se maže měkce.
  CONSTRAINT fk_terminy_produkt FOREIGN KEY (produkt_id)
    REFERENCES produkty (id) ON DELETE RESTRICT,
  CONSTRAINT fk_terminy_misto FOREIGN KEY (misto_id)
    REFERENCES mista (id) ON DELETE SET NULL,
  CONSTRAINT fk_terminy_serie FOREIGN KEY (serie_id)
    REFERENCES termin_serie (id) ON DELETE SET NULL,
  CONSTRAINT fk_terminy_vytvoril FOREIGN KEY (vytvoril_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL,
  CONSTRAINT fk_terminy_upravil FOREIGN KEY (upravil_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kdo na termínu je. Jeden člověk může mít na jednom dni víc rolí (balí
-- a zároveň létá kameru), proto je role součástí klíče.
CREATE TABLE IF NOT EXISTS termin_instruktori (
  termin_id INT UNSIGNED NOT NULL,
  uzivatel_id INT UNSIGNED NOT NULL,
  role ENUM('tandem','aff','kamera','balic') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (termin_id, uzivatel_id, role),
  KEY idx_termin_instruktori_uzivatel (uzivatel_id),
  CONSTRAINT fk_termin_instruktori_termin FOREIGN KEY (termin_id)
    REFERENCES terminy (id) ON DELETE CASCADE,
  CONSTRAINT fk_termin_instruktori_uzivatel FOREIGN KEY (uzivatel_id)
    REFERENCES uzivatele (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
