-- 012_zakaznici_a_prihlasky.sql
--
-- Etapa E5 modulu Kurzy (docs/plan-kurzy.md): přihlášky na termín.
--
-- Osobních údajů je tu jen tolik, kolik přihláška opravdu potřebuje:
-- jméno a kontakt kvůli domluvě, váha a datum narození kvůli limitům kurzu
-- a souhlasu zákonného zástupce. Žádné rodné číslo, žádné zdravotní údaje -
-- lékařskou prohlídku účastník ukazuje na místě papírově (rozhodnutí 4).
--
-- `zakaznici.anonymizovano_at` je příprava na výmaz podle GDPR: údaje se
-- přepíšou, řádek zůstane. Tvrdé mazání by vzalo i vazby na doklady, které
-- musí zůstat kvůli účetnictví.
--
-- Čas: `splatnost` je datum na kalendáři (DATE), všechno ostatní jsou okamžiky
-- v UTC (CLAUDE.md). `terminy.datum` zůstává hodinami na letišti.
--
-- Zpětná kompatibilita: všechny tabulky zavádí tatáž verze aplikace, která je
-- používá, takže platí výjimka z pravidla expand/contract v CLAUDE.md.

CREATE TABLE IF NOT EXISTS zakaznici (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- NULL schválně: po anonymizaci se e-mail maže, řádek zůstává. MariaDB
  -- bere každou NULL jako jinou hodnotu, takže UNIQUE tím netrpí.
  email VARCHAR(255) NULL,
  jmeno VARCHAR(160) NOT NULL,
  telefon VARCHAR(40) NULL,
  ulice VARCHAR(160) NULL,
  mesto VARCHAR(100) NULL,
  psc VARCHAR(20) NULL,
  ico VARCHAR(20) NULL,
  dic VARCHAR(20) NULL,
  -- Poznámka provozu, ne zákazníka. Nikdy nejde ven na web.
  poznamka TEXT NULL,
  gdpr_souhlas_at DATETIME NULL,
  marketing_souhlas_at DATETIME NULL,
  anonymizovano_at DATETIME NULL,
  smazano_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_zakaznici_email (email),
  KEY idx_zakaznici_telefon (telefon),
  KEY idx_zakaznici_jmeno (jmeno)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rezervace (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Lidsky čitelný kód do e-mailu a na telefon: LSD-2026-0042.
  kod VARCHAR(20) NOT NULL,
  -- Náhodný klíč k veřejnému zobrazení přihlášky. Schválně token v databázi,
  -- ne podpis tajemstvím z .env: dá se zneplatnit a nepřidává povinnou
  -- proměnnou do prostředí, které vytváří člověk.
  verejny_token CHAR(32) NOT NULL,

  zakaznik_id INT UNSIGNED NOT NULL,
  termin_id INT UNSIGNED NULL,
  produkt_id INT UNSIGNED NOT NULL,
  pocet_osob INT UNSIGNED NOT NULL DEFAULT 1,
  zdroj ENUM('web','telefon','email','admin') NOT NULL DEFAULT 'web',
  stav ENUM('nova','potvrzena','zaplacena','probehla','storno','presunuta','no_show')
    NOT NULL DEFAULT 'nova',

  cena_hal INT UNSIGNED NOT NULL DEFAULT 0,
  sleva_hal INT UNSIGNED NOT NULL DEFAULT 0,
  k_uhrade_hal INT UNSIGNED NOT NULL DEFAULT 0,
  uhrazeno_hal INT UNSIGNED NOT NULL DEFAULT 0,
  splatnost DATE NULL,
  drzeni_do DATETIME NULL,

  -- Souhlasy: kdy a s čím. Text se ukládá v době přihlášky, protože
  -- podmínky se časem mění a platí ty, které měl člověk před očima.
  souhlas_vop_at DATETIME NULL,
  souhlas_vop_text TEXT NULL,
  souhlas_gdpr_at DATETIME NULL,
  souhlas_gdpr_text TEXT NULL,
  souhlas_zdravi_at DATETIME NULL,
  souhlas_zdravi_text TEXT NULL,

  interni_poznamka TEXT NULL,
  zprava TEXT NULL,
  storno_duvod VARCHAR(500) NULL,
  storno_at DATETIME NULL,
  smazano_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  vytvoril_id INT UNSIGNED NULL,
  upravil_id INT UNSIGNED NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_rezervace_kod (kod),
  KEY idx_rezervace_termin (termin_id, stav),
  KEY idx_rezervace_zakaznik (zakaznik_id),
  KEY idx_rezervace_stav (stav, splatnost),
  KEY idx_rezervace_smazano (smazano_at),
  CONSTRAINT fk_rezervace_zakaznik FOREIGN KEY (zakaznik_id)
    REFERENCES zakaznici (id) ON DELETE RESTRICT,
  CONSTRAINT fk_rezervace_termin FOREIGN KEY (termin_id)
    REFERENCES terminy (id) ON DELETE SET NULL,
  CONSTRAINT fk_rezervace_produkt FOREIGN KEY (produkt_id)
    REFERENCES produkty (id) ON DELETE RESTRICT,
  CONSTRAINT fk_rezervace_vytvoril FOREIGN KEY (vytvoril_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL,
  CONSTRAINT fk_rezervace_upravil FOREIGN KEY (upravil_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Co si zákazník objednal, v cenách platných v den přihlášky. `nazev_snapshot`
-- a `cena_jed_hal` jsou záměrné kopie: po změně ceníku se stará přihláška
-- ani doklad k ní nesmí přepočítat.
CREATE TABLE IF NOT EXISTS rezervace_polozky (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  rezervace_id INT UNSIGNED NOT NULL,
  typ ENUM('produkt','varianta','priplatek','sleva','jine') NOT NULL DEFAULT 'produkt',
  entita_id INT UNSIGNED NULL,
  nazev_snapshot VARCHAR(255) NOT NULL,
  mnozstvi INT UNSIGNED NOT NULL DEFAULT 1,
  cena_jed_hal INT NOT NULL DEFAULT 0,
  dph_procento DECIMAL(5,2) NULL,
  celkem_hal INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_rezervace_polozky_rezervace (rezervace_id),
  CONSTRAINT fk_rezervace_polozky_rezervace FOREIGN KEY (rezervace_id)
    REFERENCES rezervace (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kdo doopravdy skáče. Datum narození je tu kvůli dvěma věcem: věkovému
-- limitu kurzu a souhlasu zákonného zástupce - nic jiného se z něj nepočítá.
--
-- `doklada_prohlidku` a `zajisti_souhlas_zastupce` jsou jen zaškrtnutí
-- (rozhodnutí 4 a 5): papír se odevzdává na místě, do databáze se nenahrává.
CREATE TABLE IF NOT EXISTS rezervace_ucastnici (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  rezervace_id INT UNSIGNED NOT NULL,
  jmeno VARCHAR(160) NOT NULL,
  datum_narozeni DATE NULL,
  vaha_kg INT UNSIGNED NULL,
  telefon VARCHAR(40) NULL,
  email VARCHAR(255) NULL,
  doklada_prohlidku TINYINT(1) NOT NULL DEFAULT 0,
  zajisti_souhlas_zastupce TINYINT(1) NOT NULL DEFAULT 0,
  -- Odškrtne provoz na letišti (modul Manifest, fáze 3).
  dorazil TINYINT(1) NOT NULL DEFAULT 0,
  poznamka VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rezervace_ucastnici_rezervace (rezervace_id),
  CONSTRAINT fk_rezervace_ucastnici_rezervace FOREIGN KEY (rezervace_id)
    REFERENCES rezervace (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- E-mailové šablony. Do teď byly texty v kódu; od téhle verze je upravuje
-- majitelka v administraci. `telo` je prostý text s odstavci a proměnnými
-- {{takhle}} - žádné HTML, obálku a formátování doplní aplikace.
CREATE TABLE IF NOT EXISTS email_sablony (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  klic VARCHAR(60) NOT NULL,
  nazev VARCHAR(160) NOT NULL,
  popis VARCHAR(500) NULL,
  predmet VARCHAR(255) NOT NULL,
  telo MEDIUMTEXT NOT NULL,
  -- Nápověda pro editor: které proměnné dávají v téhle šabloně smysl.
  promenne VARCHAR(500) NULL,
  aktivni TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  upravil_id INT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_sablony_klic (klic),
  CONSTRAINT fk_email_sablony_upravil FOREIGN KEY (upravil_id)
    REFERENCES uzivatele (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Výchozí texty. ON DUPLICATE KEY UPDATE klic = klic znamená "když už tam je,
-- nesahej na to" - opakovaná migrace nepřepíše, co majitelka upravila.
INSERT INTO email_sablony (klic, nazev, popis, predmet, telo, promenne) VALUES
('prihlaska_prijata', 'Přihláška přijatá (účastníkovi)',
 'Odejde hned po odeslání přihlášky z webu.',
 'Přihláška na {{kurz}} — LSD',
 'Dobrý den, {{jmeno}},\n\npřihlášku na kurz {{kurz}} máme. Termín {{termin}} vám držíme a ozveme se s potvrzením.\n\nČíslo přihlášky: {{kod}}\nPočet osob: {{pocet_osob}}\nCena: {{cena}}\n\nPodrobnosti najdete tady: {{odkaz}}\n\nKdyby cokoli, stačí odpovědět na tenhle e-mail.',
 'jmeno, kurz, termin, misto, kod, pocet_osob, cena, odkaz'),

('prihlaska_provoz', 'Nová přihláška (provozu)',
 'Upozornění pro provoz, že přišla nová přihláška. Chodí na adresu z nastavení.',
 'Nová přihláška: {{kurz}} {{termin}}',
 'Přišla nová přihláška.\n\nKurz: {{kurz}}\nTermín: {{termin}}, {{misto}}\nZákazník: {{jmeno}}, {{email}}, {{telefon}}\nPočet osob: {{pocet_osob}}\nČíslo: {{kod}}\n\nÚčastníci:\n{{ucastnici}}',
 'jmeno, email, telefon, kurz, termin, misto, kod, pocet_osob, ucastnici'),

('prihlaska_potvrzena', 'Přihláška potvrzená',
 'Posílá provoz ručně při přepnutí stavu na potvrzenou.',
 'Potvrzení přihlášky {{kod}} — LSD',
 'Dobrý den, {{jmeno}},\n\npřihlášku na kurz {{kurz}} potvrzujeme. Těšíme se na vás {{termin}} na {{misto}}.\n\nČíslo přihlášky: {{kod}}\nK úhradě: {{cena}}\n\nCo s sebou a jak to proběhne, najdete na stránce kurzu.',
 'jmeno, kurz, termin, misto, kod, cena, odkaz'),

('prihlaska_zaplacena', 'Přihláška zaplacená',
 'Potvrzení přijetí platby. Posílá provoz ručně.',
 'Platba přijata — {{kod}}',
 'Dobrý den, {{jmeno}},\n\nplatbu k přihlášce {{kod}} máme. Vše je připravené, uvidíme se {{termin}}.',
 'jmeno, kurz, termin, misto, kod, cena'),

('prihlaska_zrusena', 'Přihláška zrušená',
 'Posílá provoz při stornu přihlášky. Důvod se doplní z dialogu.',
 'Zrušení přihlášky {{kod}} — LSD',
 'Dobrý den, {{jmeno}},\n\npřihlášku {{kod}} na kurz {{kurz}} jsme zrušili.\n\nDůvod: {{duvod}}\n\nKdyby to byl omyl nebo chcete jiný termín, ozvěte se nám.',
 'jmeno, kurz, termin, kod, duvod'),

('termin_zruseny', 'Zrušený termín',
 'Odejde přihlášeným, když se zruší celý termín.',
 'Zrušený termín {{termin}} — LSD',
 'Dobrý den, {{jmeno}},\n\nmusíme zrušit termín {{termin}} kurzu {{kurz}}.\n\nDůvod: {{duvod}}\n\nVaše přihláška {{kod}} zůstává v platnosti — ozveme se vám s náhradním termínem.',
 'jmeno, kurz, termin, misto, kod, duvod')
ON DUPLICATE KEY UPDATE klic = klic;
