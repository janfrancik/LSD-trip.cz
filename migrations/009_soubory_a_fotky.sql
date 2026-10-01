-- 009_soubory_a_fotky.sql
--
-- Etapa E2 modulu Kurzy (docs/plan-kurzy.md).
--
-- Nahrané soubory a jejich napojení na produkty. `soubory` je obecná tabulka
-- podle docs/plan-administrace.md §3.9 - použije ji později i fotogalerie
-- a obrázky v obsahu webu, ne jen kurzy.
--
-- Samotná data souboru leží ve volume uploads, v databázi je jen cesta.
-- Obrázky tak nenadýmají zálohu databáze a přežijí přestavbu image.
--
-- Zpětná kompatibilita: obě tabulky zavádí tatáž verze aplikace, která je
-- používá, takže platí výjimka z pravidla expand/contract v CLAUDE.md.
-- Nic se nemaže ani nepřejmenovává.

CREATE TABLE IF NOT EXISTS soubory (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Cesta relativní k UPLOAD_DIR, například "produkty/2026-10/<hex>.jpg".
  cesta VARCHAR(255) NOT NULL,
  puvodni_nazev VARCHAR(255) NULL,
  mime VARCHAR(100) NOT NULL,
  velikost_b INT UNSIGNED NOT NULL,
  -- Rozměry a varianty doplní až zpracování obrázků (sharp) ve fázi 5.
  -- Sloupce jsou tu od začátku, aby se kvůli nim nemusela měnit tabulka,
  -- kterou už bude něco číst.
  sirka INT UNSIGNED NULL,
  vyska INT UNSIGNED NULL,
  varianty JSON NULL,
  -- Popis pro čtečky a pro případ, kdy se obrázek nenačte. Povinný není,
  -- ale administrace na chybějící upozorňuje.
  alt VARCHAR(255) NULL,
  zdroj ENUM('upload','import') NOT NULL DEFAULT 'upload',
  -- U fotek přenesených ze starého webu původní adresa, aby šlo po migraci
  -- přepsat odkazy v obsahu (fáze 5).
  zdroj_url TEXT NULL,
  -- Stejná fotka nahraná podruhé se pozná podle otisku, ne podle názvu.
  hash_sha256 CHAR(64) NOT NULL,
  nahral_id INT UNSIGNED NULL,
  smazano_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_soubory_cesta (cesta),
  KEY idx_soubory_hash (hash_sha256),
  KEY idx_soubory_smazano (smazano_at),
  CONSTRAINT fk_soubory_nahral FOREIGN KEY (nahral_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fotky produktu. `titulni` je ta velká na kartě ve výpisu; že je právě
-- jedna, hlídá aplikace v transakci - unikátní index by to neuhlídal,
-- protože MariaDB bere každou NULL jako jinou hodnotu.
--
-- ON DELETE CASCADE u obou klíčů: vazba sama o sobě nenese žádná data,
-- takže když zmizí produkt nebo soubor, nemá co zůstat.
CREATE TABLE IF NOT EXISTS produkt_fotky (
  produkt_id INT UNSIGNED NOT NULL,
  soubor_id INT UNSIGNED NOT NULL,
  poradi INT NOT NULL DEFAULT 0,
  titulni TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (produkt_id, soubor_id),
  KEY idx_produkt_fotky_poradi (produkt_id, poradi),
  KEY idx_produkt_fotky_soubor (soubor_id),
  CONSTRAINT fk_produkt_fotky_produkt FOREIGN KEY (produkt_id)
    REFERENCES produkty (id) ON DELETE CASCADE,
  CONSTRAINT fk_produkt_fotky_soubor FOREIGN KEY (soubor_id)
    REFERENCES soubory (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
