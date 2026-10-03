-- 013_emaily_jen_provoz.sql
--
-- Režim `jen_provoz`: interní upozornění odejdou provozu, zákazníkům se
-- neposílá nic. Je to stav na dobu, kdy Resend ještě nemá ověřenou doménu -
-- bez ní odešle jen z onboarding@resend.dev a jen na adresu majitele účtu,
-- takže zákaznický e-mail by skončil chybou 403.
--
-- Všechno je přidání hodnoty do ENUM nebo nový řádek v číselníku. Starší
-- verze aplikace o nových hodnotách neví, ale nic jí nerozbije: `jen_provoz`
-- nikdy nezapíše a neznámý stav si administrace vypíše tak, jak je.

-- Nový režim do logu a nový stav "neodesláno".
--
-- `neodeslano` je schválně oddělené od `chyba`. Dosud se do `chyba` psalo
-- obojí: "Resend vrátil 403" i "odesílání je vypnuté". To první je problém,
-- co se má řešit, to druhé je úmysl - a mícháním obojího nešlo ani jedno
-- spolehlivě najít. Na `neodeslano` se navíc váže "Odeslat znovu".
ALTER TABLE emaily
  MODIFY COLUMN rezim ENUM('live','test','vypnuto','schranka','jen_provoz') NOT NULL;

ALTER TABLE emaily
  MODIFY COLUMN stav ENUM('ve_fronte','ve_schrance','neodeslano','odeslano','doruceno',
                          'otevreno','kliknuto','bounce','stiznost','chyba')
    NOT NULL DEFAULT 've_fronte';

-- E-maily, které se neodeslaly jen proto, že bylo odesílání vypnuté, patří
-- pod `neodeslano`, ne pod `chyba`. Bez tohohle by se na ně nedalo použít
-- "Odeslat znovu" a produkce by si je navždy pamatovala jako chyby - přitom
-- je to přesně ta skupina, kterou chceme po ověření domény rozeslat.
UPDATE emaily
   SET stav = 'neodeslano'
 WHERE stav = 'chyba'
   AND chyba LIKE 'Odesílání e-mailů je vypnuté%';

-- --------------------------------------------------------- interní šablony

-- Poptávka z kontaktního formuláře dosud neposílala vůbec nic: zpráva se
-- uložila a čekala, až se někdo podívá do administrace.
INSERT INTO email_sablony (klic, nazev, popis, predmet, telo, promenne) VALUES
('poptavka_provoz', 'Nová poptávka (provozu)',
 'Upozornění pro provoz, že přišla zpráva z kontaktního formuláře. Chodí na adresu z Nastavení → Provoz → Kontaktní e-mail.',
 'Nová poptávka od {{jmeno}}',
 'Přišla nová poptávka z webu.\n\nOd: {{jmeno}}\nE-mail: {{email}}\nTelefon: {{telefon}}\n\nZpráva:\n{{zprava}}\n\nOtevřít v administraci:\n{{odkaz_admin}}',
 'jmeno, email, telefon, zprava, odkaz_admin')
ON DUPLICATE KEY UPDATE klic = klic;

-- Upozornění na novou přihlášku mělo dvě vady: chyběl odkaz do administrace
-- (provoz musel přihlášku hledat podle čísla) a vypisovalo u každého
-- účastníka věk, váhu a varování z limitů. Do upozornění "ozvi se jim" to
-- nepatří - provoz si tyhle údaje přečte na detailu, kde je k nim i kontext.
--
-- Tělo se přepisuje JEN tehdy, když je pořád ve výchozí podobě z migrace 012.
-- Co si majitelka upravila, zůstává - texty e-mailů jsou její, ne moje.
UPDATE email_sablony
   SET telo = 'Přišla nová přihláška.\n\nKurz: {{kurz}}\nTermín: {{termin}}, {{misto}}\nZákazník: {{jmeno}}, {{email}}, {{telefon}}\nPočet osob: {{pocet_osob}}\nČíslo: {{kod}}\n\nOtevřít v administraci:\n{{odkaz_admin}}',
       promenne = 'jmeno, email, telefon, kurz, termin, misto, kod, pocet_osob, odkaz_admin'
 WHERE klic = 'prihlaska_provoz'
   AND telo = 'Přišla nová přihláška.\n\nKurz: {{kurz}}\nTermín: {{termin}}, {{misto}}\nZákazník: {{jmeno}}, {{email}}, {{telefon}}\nPočet osob: {{pocet_osob}}\nČíslo: {{kod}}\n\nÚčastníci:\n{{ucastnici}}';
