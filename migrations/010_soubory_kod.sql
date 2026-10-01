-- 010_soubory_kod.sql
--
-- Veřejná adresa fotky přestává být pořadové číslo.
--
-- /media/12 se dalo projít po řadě, a tím i prohlédnout fotky kurzu, který
-- ještě není zveřejněný. Nově má každý soubor náhodný kód a adresa je
-- /media/<kod>; `id` zůstává jen pro administraci za přihlášením.
--
-- 24 hexadecimálních znaků = 96 bitů náhody. Hex schválně, ne base64:
-- tabulka má collation utf8mb4_unicode_ci, takže by se "aB" a "Ab"
-- porovnávalo jako totéž a kódy by se tím zbytečně slily.
--
-- Zpětná kompatibilita (CLAUDE.md, expand/contract): sloupec je NULL-ovatelný,
-- takže stará verze aplikace, která o něm neví, zapisuje dál. UNIQUE smí
-- přijít hned v témže kroku - stará verze do sloupce nic nevkládá a MariaDB
-- bere každou NULL jako jinou hodnotu, takže duplicitu vyrobit nemůže.

ALTER TABLE soubory
  ADD COLUMN IF NOT EXISTS kod CHAR(24) NULL AFTER id;

-- Doplnění kódů souborům, které už v databázi jsou. RANDOM_BYTES() se
-- vyhodnocuje pro každý řádek zvlášť, takže každý dostane svůj vlastní.
-- Opakovaný běh migrace už nemá co doplnit.
UPDATE soubory SET kod = LOWER(HEX(RANDOM_BYTES(12))) WHERE kod IS NULL;

ALTER TABLE soubory
  ADD UNIQUE KEY IF NOT EXISTS uq_soubory_kod (kod);
