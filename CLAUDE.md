# Pokyny pro práci na tomhle projektu

Web a administrace spolku LSD-trip.cz. Podrobnosti jsou v [README.md](README.md)
(struktura, prostředí, API, role, nasazení) a v [docs/plan-administrace.md](docs/plan-administrace.md)
(schválený plán, datový model, rozhodnutí). Tenhle soubor drží jen pravidla,
která se nesmí porušit ani omylem.

## Migrace: zpětně kompatibilní, expand/contract

Migrace běží **před** startem nové verze aplikace (`docker compose run --rm app npm run migrate`
před `up -d`). Mezi doběhnutím migrace a záměnou kontejneru proto chvíli běží **stará** verze
kódu nad **novým** schématem — a když se v tu chvíli aplikace zeptá na sloupec, který migrace
právě zahodila, spadne.

**V jedné migraci nikdy nemaž ani nepřejmenovávej sloupec, tabulku ani hodnotu `ENUM`,
kterou předchozí verze kódu používá.** Rozděl to na dvě nasazení:

1. **expand** (verze N): přidej nový sloupec nebo tabulku, převeď data
   (`UPDATE … SET nove = stare`). Kód umí obojí: zapisuje do nového, čte nové
   s fallbackem na staré. Starého se nedotýkáš.
2. **contract** (verze N+1): teprve teď starý sloupec nebo tabulku odeber.
   V té chvíli už žádná nasazená verze nečte a nezapisuje.

Z toho plyne:

- Přejmenování sloupce = nový sloupec + kopie dat + (příští verze) `DROP` starého.
  Žádné `RENAME COLUMN` v jednom kroku.
- Nový `NOT NULL` sloupec musí mít `DEFAULT` — stará verze o něm neví a bez výchozí
  hodnoty by jí každý `INSERT` selhal.
- Zúžení typu, přidání `UNIQUE` nebo cizího klíče patří do kroku contract, ne expand.
- `DROP TABLE` až poté, co ji žádná nasazená verze nečte.

Výjimka je jediná: tabulka, kterou zavádí tatáž verze, co ji používá (nová funkce) —
tam žádná předchozí verze není, o co se opřít.

Hlídá to test v `test/nasazeni.test.js`. Když jde opravdu o krok contract, doplň soubor
do seznamu `ODEBRANI_SCHVALENA` i s důvodem — ne proto, aby test mlčel, ale aby byla ta
úvaha vidět v diffu.

Vedle toho platí, co je v README: migrace musí jít spustit **opakovaně**
(`IF NOT EXISTS`, `DROP … IF EXISTS`), protože MariaDB u DDL commituje implicitně
a rollback neexistuje.

## Prostředí se pozná z PROSTREDI, ne z NODE_ENV

V kontejneru je `NODE_ENV=production` i na testu. Cokoli, co se má chovat jinak v produkci
(přísnější validace konfigurace, vypnutá akceptace, indexace), se proto rozhoduje podle
`config.jeProdukce`, který čte **`PROSTREDI`**. Zabezpečení cookies, HSTS a
upgrade-insecure-requests se řídí `config.jeHttps` (podle `APP_URL`), protože to je otázka
HTTPS, ne prostředí.

Na tomhle spadl start testu po přepnutí na `EMAIL_REZIM=schranka`: validace si myslela,
že běží v produkci, a chtěla `RESEND_API_KEY`, který na testu není a nemá být.

## Nasazení

- Vyvíjí se ve větvi `test`. **Do `main` nic bez výslovného souhlasu majitele repozitáře.**
- Deploy čeká, až kontejner nahlásí `healthy`; když ne, selže a vypíše log. `docker compose up -d`
  sám o sobě neznamená, že aplikace běží.
- Soubor `.env` na serveru vytváří člověk; workflow ho nikdy nepřepisuje.
- Na VPS běží vedle i cizí aplikace (Kompas, Todo) ve sdílené síti `web`. Žádný
  `docker system prune`, žádný zásah mimo adresáře `lsdtrip*` a volumes `lsd_*`.

## Ostatní pravidla, která se snadno poruší

- **Na testu nesmí odejít e-mail zákazníkovi.** Všechno jde přes `src/email/posli.js`,
  který v režimu `test` přepíše příjemce na `EMAIL_TEST_PRIJEMCE` ještě před odesláním.
- **Žádná doména natvrdo v kódu.** Absolutní adresy se skládají z `APP_URL` (`config.url()`).
  Hlídá to test v `test/bezpecnost.test.js`.
- **Nic natvrdo v kódu, co má spravovat majitelka.** Texty, ceny a lhůty patří do
  nastavení nebo do databáze, ne do zdrojáku.
- **V databázi je čas vždy v UTC.** Spojení má `time_zone = '+00:00'` (src/db.js),
  kontejnery běží s `TZ=UTC`. Pražský čas „na hodinách“ je nejednoznačný: poslední
  říjnovou neděli proběhne hodina 2:00–3:00 dvakrát, takže by se rozbilo držení
  rezervace na 48 h, splatnosti i pořadí plateb. `NOW()`, `DATE_ADD` a porovnání
  v SQL proto počítají v UTC a jsou správně; nikdy nepřičítej ani neodečítej hodiny,
  aby „to sedělo“.
- **Na Europe/Prague se převádí až při zobrazení, a jen přes `src/cas.js`** —
  `datum()`, `cas()`, `datumCas()`, `pred()`, `isoDatum()`, `okamzik()`, `proDb()`.
  Platí pro administraci, e-maily, exporty i doklady. Nikdy `toISOString()`,
  `toLocaleString()`, `new Date(retezecZDatabaze)` ani vlastní skládání data:
  `new Date('2026-09-27 20:49:00')` si řetězec přečte jako místní čas stroje a výsledek
  je posunutý. Administrace si ten samý soubor načítá jako `/admin/assets/js/cas.js`,
  takže existuje jedna implementace, ne dvě.
- Peníze v haléřích (`INT`), mazání měkké (`smazano_at`).
- Administrace je česky a pro netechnického člověka: chybová hláška říká, co se stalo
  a co s tím, ne „Invalid input“.
- Popisky akcí pro lidi piš jako podstatná jména („úprava poptávky“), ne slovesa
  v minulém čase — čeština by vyžadovala rod a v týmu jsou ženy i muži.
- Každá fáze = migrace + API + UI + testy + aktualizovaný README, odzkoušeno lokálně
  a nasazeno na `test`.
