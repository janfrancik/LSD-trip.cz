-- 005_casy_v_utc.sql
--
-- Všechny časy v databázi přecházejí na UTC. Do teď se ukládal pražský čas
-- "na hodinách", což je nejednoznačné: poslední říjnovou neděli proběhne hodina
-- 2:00-3:00 dvakrát, takže "2026-10-25 02:30:00" jsou dva různé okamžiky.
-- U držení rezervace 48 h, splatnosti faktur a pořadí plateb je to chyba, která
-- se nedá opravit dodatečně - proto se to mění teď, dokud jsou v databázi
-- jen testovací data.
--
-- Od téhle migrace platí: v databázi UTC, na Europe/Prague se převádí až při
-- zobrazení (src/cas.js). Spojení do databáze má time_zone '+00:00' (src/db.js)
-- a kontejnery běží s TZ=UTC, takže výsledek nezávisí na nastavení serveru.
--
-- Pozor: tahle migrace přepisuje data, není tedy opakovatelná. Chrání ji
-- záznam v tabulce _migrace a transakce (samé DML, žádné DDL).

-- Pojistka: bez načtených časových zón vrací CONVERT_TZ prázdnou hodnotu
-- a migrace by tiše vynulovala všechny časy. Oficiální image MariaDB zóny
-- načítá, ale ověřit se to musí.
SET @zony_funguji := CONVERT_TZ('2026-07-15 12:00:00', 'Europe/Prague', 'UTC') IS NOT NULL;
SET @kontrola := IF(@zony_funguji,
  'DO 0',
  'SELECT * FROM v_mariadb_chybi_casove_zony_spust_mysql_tzinfo_to_sql');
PREPARE pojistka FROM @kontrola;
EXECUTE pojistka;
DEALLOCATE PREPARE pojistka;

-- Sloupce s ON UPDATE CURRENT_TIMESTAMP se přepisují výslovně, jinak by je
-- UPDATE přepsal na "teď" a původní čas změny by se ztratil.

UPDATE poptavky SET
  created_at = CONVERT_TZ(created_at, 'Europe/Prague', 'UTC'),
  updated_at = CONVERT_TZ(updated_at, 'Europe/Prague', 'UTC'),
  odpovezeno_at = CONVERT_TZ(odpovezeno_at, 'Europe/Prague', 'UTC'),
  smazano_at = CONVERT_TZ(smazano_at, 'Europe/Prague', 'UTC');

UPDATE uzivatele SET
  created_at = CONVERT_TZ(created_at, 'Europe/Prague', 'UTC'),
  updated_at = CONVERT_TZ(updated_at, 'Europe/Prague', 'UTC'),
  totp_potvrzeno_at = CONVERT_TZ(totp_potvrzeno_at, 'Europe/Prague', 'UTC'),
  posledni_prihlaseni_at = CONVERT_TZ(posledni_prihlaseni_at, 'Europe/Prague', 'UTC'),
  zamceno_do = CONVERT_TZ(zamceno_do, 'Europe/Prague', 'UTC'),
  smazano_at = CONVERT_TZ(smazano_at, 'Europe/Prague', 'UTC');

UPDATE sessions SET
  created_at = CONVERT_TZ(created_at, 'Europe/Prague', 'UTC'),
  expires_at = CONVERT_TZ(expires_at, 'Europe/Prague', 'UTC');

UPDATE reset_hesla SET
  created_at = CONVERT_TZ(created_at, 'Europe/Prague', 'UTC'),
  expires_at = CONVERT_TZ(expires_at, 'Europe/Prague', 'UTC'),
  pouzito_at = CONVERT_TZ(pouzito_at, 'Europe/Prague', 'UTC');

UPDATE prihlaseni_pokusy SET
  created_at = CONVERT_TZ(created_at, 'Europe/Prague', 'UTC');

UPDATE audit_log SET
  created_at = CONVERT_TZ(created_at, 'Europe/Prague', 'UTC');

UPDATE nastaveni SET
  updated_at = CONVERT_TZ(updated_at, 'Europe/Prague', 'UTC');

UPDATE emaily SET
  created_at = CONVERT_TZ(created_at, 'Europe/Prague', 'UTC'),
  odeslano_at = CONVERT_TZ(odeslano_at, 'Europe/Prague', 'UTC'),
  stav_at = CONVERT_TZ(stav_at, 'Europe/Prague', 'UTC');

UPDATE email_udalosti SET
  created_at = CONVERT_TZ(created_at, 'Europe/Prague', 'UTC');

UPDATE akceptace_verze SET
  created_at = CONVERT_TZ(created_at, 'Europe/Prague', 'UTC'),
  updated_at = CONVERT_TZ(updated_at, 'Europe/Prague', 'UTC'),
  schvaleno_at = CONVERT_TZ(schvaleno_at, 'Europe/Prague', 'UTC'),
  oznameno_at = CONVERT_TZ(oznameno_at, 'Europe/Prague', 'UTC');

UPDATE akceptace_ukoly SET
  created_at = CONVERT_TZ(created_at, 'Europe/Prague', 'UTC'),
  updated_at = CONVERT_TZ(updated_at, 'Europe/Prague', 'UTC'),
  zmeneno_at = CONVERT_TZ(zmeneno_at, 'Europe/Prague', 'UTC');

UPDATE akceptace_vysledky SET
  created_at = CONVERT_TZ(created_at, 'Europe/Prague', 'UTC'),
  updated_at = CONVERT_TZ(updated_at, 'Europe/Prague', 'UTC');

UPDATE akceptace_hlaseni SET
  created_at = CONVERT_TZ(created_at, 'Europe/Prague', 'UTC'),
  updated_at = CONVERT_TZ(updated_at, 'Europe/Prague', 'UTC'),
  vyreseno_at = CONVERT_TZ(vyreseno_at, 'Europe/Prague', 'UTC');

UPDATE akceptace_prilohy SET
  created_at = CONVERT_TZ(created_at, 'Europe/Prague', 'UTC');

UPDATE _migrace SET
  applied_at = CONVERT_TZ(applied_at, 'Europe/Prague', 'UTC');
