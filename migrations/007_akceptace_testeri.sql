-- 007_akceptace_testeri.sql
--
-- Akceptace po testerech. Do teď platilo, že když úkol otestoval kdokoli,
-- ukázal se jako otestovaný všem - takže majitelka viděla hotovo něco,
-- co sama nezkusila. Nově má každý svůj vlastní seznam.
--
-- K tomu dvě věci navíc:
--   - kdo verzi testuje (bez záznamu platí výchozí: testeři, provoz a admini),
--   - které úkoly komu patří (schvalování verze nemá co dělat provozákovi).

-- Kdo je k verzi přiřazený. Bez řádku pro verzi platí výchozí výběr,
-- takže starší verze fungují dál beze změny.
CREATE TABLE IF NOT EXISTS akceptace_testeri (
  verze_id INT UNSIGNED NOT NULL,
  uzivatel_id INT UNSIGNED NOT NULL,
  prirazeno_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (verze_id, uzivatel_id),
  KEY idx_akceptace_testeri_uzivatel (uzivatel_id),
  CONSTRAINT fk_akceptace_testeri_verze FOREIGN KEY (verze_id)
    REFERENCES akceptace_verze (id) ON DELETE CASCADE,
  CONSTRAINT fk_akceptace_testeri_uzivatel FOREIGN KEY (uzivatel_id)
    REFERENCES uzivatele (id) ON DELETE CASCADE,
  CONSTRAINT fk_akceptace_testeri_prirazeno FOREIGN KEY (prirazeno_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Komu se úkol vůbec ukáže. `role_filtr` je seznam rolí oddělený čárkou
-- (kvůli FIND_IN_SET bez mezer), `jen_admin` je zkratka pro úkoly typu
-- "schval verzi" nebo "stáhni souhrn".
ALTER TABLE akceptace_ukoly
  ADD COLUMN IF NOT EXISTS role_filtr VARCHAR(120) NULL AFTER oblast,
  ADD COLUMN IF NOT EXISTS jen_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER role_filtr;

-- Z čeho tester testoval. Bez toho se u hlášení "nefunguje" nedá poznat,
-- jestli šlo o mobil, nebo o počítač.
ALTER TABLE akceptace_vysledky
  ADD COLUMN IF NOT EXISTS zarizeni VARCHAR(255) NULL AFTER komentar;
