-- 014_emaily_pocet_pokusu.sql
--
-- Pořadí pokusu o odeslání. Slouží jako součást `Idempotency-Key`, který se
-- posílá Resendu.
--
-- Proč: zámek v databázi (`UPDATE … WHERE stav = 'neodeslano'`) zabrání tomu,
-- aby dva kliky spustily dvě odeslání. Nezabrání ale tomu, aby jedno odeslání
-- doletělo k Resendu dvakrát - typicky když se odpověď ztratí v síti a klient
-- požadavek zopakuje. Resend v takovém případě bere `Idempotency-Key` a druhý
-- požadavek se stejným klíčem nevyřídí znovu, jen vrátí původní výsledek.
--
-- Klíč je `email-<id>-pokus-<pokusu>`:
--   * síťové zopakování TÉHOŽ pokusu má stejný klíč  -> Resend ho zahodí,
--   * vědomé odeslání znovu zvýší `pokusu`           -> nový klíč, odešle se.
--
-- Nový sloupec má DEFAULT, takže předchozí verze aplikace, která o něm neví,
-- může dál zapisovat do `emaily` (expand krok podle CLAUDE.md).

ALTER TABLE emaily
  ADD COLUMN IF NOT EXISTS pokusu INT UNSIGNED NOT NULL DEFAULT 0 AFTER rezim;

-- Co už je odeslané, mělo právě jeden pokus. U neodeslaných zůstává nula:
-- první odeslání se o pokus teprve pokusí.
UPDATE emaily SET pokusu = 1 WHERE pokusu = 0 AND odeslano_at IS NOT NULL;
