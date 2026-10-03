-- 016_akceptace_v_produkci.sql
--
-- Nový stav vydání: „V produkci".
--
-- Dosud vydání končilo stavem „schvalena" a dál se o něm nic nevědělo.
-- Jenže mezi „testeři to odsouhlasili" a „běží to zákazníkům" je rozdíl,
-- který se v praxi pletl: schválená verze ještě týden čekala na nasazení
-- a nikdo nepoznal, jestli to, co zrovna vidí na ostrém webu, je ona.
--
-- Stav se nepřebírá z YAML (import synchronizuje jen název, popis a pořadí) -
-- je to rozhodnutí člověka a zapisuje se s tím, kdo a kdy.
--
-- Přidání hodnoty do ENUM je zpětně kompatibilní: starší verze aplikace
-- o ní neví, ale nic jí nerozbije - do stavu ji sama nikdy nezapíše.

ALTER TABLE akceptace_verze
  MODIFY COLUMN stav ENUM('otevrena','schvalena','v_produkci')
    NOT NULL DEFAULT 'otevrena';

-- Kdy se to nasadilo a kam se podívat (commit nebo běh workflow). Odkaz je
-- text, ne cizí klíč - vede ven z aplikace, do GitHubu.
ALTER TABLE akceptace_verze
  ADD COLUMN IF NOT EXISTS nasazeno_at DATETIME NULL AFTER schvaleni_poznamka;

ALTER TABLE akceptace_verze
  ADD COLUMN IF NOT EXISTS nasazeni_odkaz VARCHAR(500) NULL AFTER nasazeno_at;

ALTER TABLE akceptace_verze
  ADD COLUMN IF NOT EXISTS nasadil_id INT UNSIGNED NULL AFTER nasazeni_odkaz;
