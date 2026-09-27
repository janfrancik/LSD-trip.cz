# Administrace LSD — plán (Fáze 0)

Stav: **návrh ke schválení**, nic z toho není implementované.
Datum: 26. 9. 2026

---

## 1. Co je v repozitáři dnes

### Aplikace
| Soubor | Stav |
| --- | --- |
| `src/server.js` | Express 4, ES moduly. Statika `public/`, mapování `navrh_N/` → `/navrh-N/`, 6 endpointů pro poptávky, `/api/health`, SPA fallback. 150 řádků, žádné routery ani middleware vrstvy. |
| `src/db.js` | mysql2 pool, `dateStrings: true`, connectionLimit 10. V pořádku, jen doplním `timezone`. |
| `scripts/migrate.js` | Funkční, stav v `_migrace`, idempotentní. **Slabina:** `splitStatements()` dělí SQL podle `;`, takže rozbije triggery, procedury a jakýkoli středník v řetězci. Migrace pro administraci budou obsahovat `ENUM('a','b')` — středník v nich není, takže to projde, ale u budoucích `CREATE TRIGGER` ne. Navrhuji přidat podporu oddělovače `-- >>>` pro víceřádkové bloky. |
| `migrations/001_init.sql` | Jediná tabulka `poptavky`. |
| `public/` | Návrh 1 (produkce): tmavý vizuál, Oswald + Archivo, akcent `#FF3B12`. |
| `navrh_2/` | Návrh 2 (náhled): světlý, Plus Jakarta Sans, akcent `#FF4D1C`. |

### Frontend
- `public/assets/js/data.js` (192 ř.) — globální `window.LSD_DATA` s 16 kolekcemi.
- `public/assets/js/app.js` (977 ř.) — hash router, 12 views, `state` objekt, delegované eventy.
- **Nic z frontendu dnes nekomunikuje s API.** Ani kontaktní formulář — `send-contact` jen přepne `state.contactSent`. Rezervace i platba jsou čistá atrapa (`bookingNext()` vygeneruje náhodný kód `LSD-#####`).
- `navrh_2/assets/js/data.js` má o 5 kolekcí víc: `STATS`, `REASONS`, `COURSE_BRING`, `VOUCHER_PERKS`, `PAGE_HEAD`. Datový model musí pokrýt oba návrhy, aby překlopení na návrh 2 nevyžadovalo migraci.

### Obsah, který **není** v `data.js`, ale je natvrdo v kódu
Tohle je podstatné zjištění — samotný převod `data.js` do DB nestačí:

| Kde | Co |
| --- | --- |
| `app.js` `viewHome()` | hero eyebrow / titulek / text, 4 statistiky (včetně labelu „Volných míst v září"), 2 „feature" dlaždice, banner poukazu |
| `app.js` `viewOnas()` | dva odstavce o spolku, mezititulek „Naši lidé" + jeho perex |
| `app.js` `viewKontakt()` | telefon, e-mail, sídlo spolku, letiště |
| `app.js` `viewTandem/viewKurzy/viewExpedice/viewGalerie/viewFaq` | eyebrow, H1 a lead každé stránky (v návrhu 2 už vytažené do `PAGE_HEAD`) |
| `public/index.html` | `<title>`, meta description, všechny OG tagy, celá patička (4 sloupce odkazů + provozní informace + copyright), favicon |

### Nasazení
- `.github/workflows/deploy.yml` — spouští se **jen na `main`**, image `ghcr.io/janfrancik/lsd-trip.cz:latest`, SSH deploy do `/home/deploy/apps/lsdtrip`, po `up -d` spustí migrace.
- `docker-compose.yml` — produkce: `container_name: lsdtrip-app` natvrdo, sítě `internal` + externí `web` pro Caddy, bez publikovaných portů.
- **Větev `test` neexistuje** (`git branch -a` → jen `main` a `origin/main`). Testovací prostředí se musí celé postavit — viz sekce 2.
- Caddyfile není v repozitáři, konfigurace reverse proxy je ruční krok na VPS.
- `netlify.toml` a `.netlify/` jsou pozůstatek po statickém hostingu. Navrhuji smazat, aby nebylo pochybnosti, odkud web běží.

### Bezpečnostní nálezy (k opravě hned ve fázi 1)
1. **Všech 5 endpointů `/api/poptavky` je veřejných** — kdokoli si přečte, upraví i smaže všechny poptávky včetně e-mailů. `DELETE` maže natvrdo, bez soft delete.
2. Žádný `helmet`, žádné CSP, žádný rate limit, žádná autentizace, žádná ochrana proti CSRF.
3. `express.json()` bez limitu velikosti těla.
4. Error handler loguje `err` do konzole a vrací generickou 500 — to je správně, ale chybí strukturované logování a request id.
5. `app.get('*')` posílá `index.html` i na cesty jako `/.env` — Express statika to zvládne, ale po přidání `/admin` musí být fallback rozdělený.

---

## 2. Testovací prostředí (návrh)

Cíl: `test` větev = plnohodnotná kopie produkce s vlastní DB, vlastním úložištěm a **nulovou šancí, že odejde e-mail reálnému zákazníkovi**.

### Jeden compose soubor pro obě prostředí
`docker-compose.yml` parametrizuji proměnnými z `.env`, takže soubor zůstane jediný:

```yaml
services:
  app:
    image: ghcr.io/janfrancik/lsd-trip.cz:${IMAGE_TAG:-latest}
    container_name: ${APP_CONTAINER:-lsdtrip-app}
    volumes:
      - uploads:/app/uploads
```

Volumes dostanou **výslovná jména** z `VOLUME_PREFIX` (`lsd_main_db`, `lsd_main_uploads`,
`lsd_test_db`, `lsd_test_uploads`), ne odvozená od názvu adresáře nebo projektu.
Přejmenování složky na VPS tím nemůže způsobit, že by Docker mlčky založil prázdnou
databázi a stará data osiřela. Bez `VOLUME_PREFIX` compose schválně nenastartuje.

**Rozhodnuto:** `lsd.francik.eu` = **produkce** (větev `main`), `test-lsd.francik.eu` =
**test** (větev `test`). Majitelka zůstává na adrese, kterou zná, a vývoj se jí nepleze do cesty.
Obě prostředí zatím míří na **testovací** Mo.one (`api-test.znpay.tech`) — ostrá brána se
zapne až na tvůj pokyn změnou `MOONE_BASE_URL` a klíčů v produkčním `.env`, bez nasazování.

| | produkce | test |
| --- | --- | --- |
| větev | `main` | `test` |
| image tag | `:latest` | `:test` |
| `VOLUME_PREFIX` | `lsd_main` | `lsd_test` |
| `APP_CONTAINER` | `lsdtrip-app` | `lsdtrip-test-app` |
| adresář na VPS | `/home/deploy/apps/lsdtrip` | `/home/deploy/apps/lsdtrip-test` |
| `DB_NAME` | `lsdtrip` | `lsdtrip_test` |
| doména | `lsd.francik.eu` → později + `www.lsd-trip.cz` | `test-lsd.francik.eu` |
| `EMAIL_REZIM` | `live` | `test` — **všichni příjemci přepsáni** na `EMAIL_TEST_PRIJEMCE` |
| platební brána Mo.one | zatím `https://api-test.znpay.tech` (přepnutí na ostrou = jen `.env`) | `https://api-test.znpay.tech` |
| indexace | normální | `X-Robots-Tag: noindex` + `robots.txt` disallow |

Produkce zůstává na `lsd.francik.eu`, test je přírůstek: nová větev, nový adresář na VPS,
nová subdoména, nová databáze. Produkční databáze je prázdná, takže se při přechodu na
nové jméno volume nic neztrácí — starý volume se odstraní (postup v `docs/nasazeni-vps.md`).

### Žádná URL v kódu
Přechod na `lsd-trip.cz` musí být **jen změna konfigurace**. Proto je v `.env` jediný zdroj pravdy:

| Proměnná | K čemu |
| --- | --- |
| `APP_URL` | základ všech absolutních adres: `canonical`, OG `url`, `sitemap.xml`, odkazy v e-mailech, `ReturnUrl` a `CallbackUrl` pro Mo.one |
| `EMAIL_ODESILATEL` | odesílatel včetně domény ověřené v Resendu (dnes `lsd.francik.eu`) |
| `VOLUME_PREFIX` | jména volumes — `lsd_main` vs. `lsd_test` |
| `ROBOTS` | `povolit` / `zakazat` — řídí `robots.txt` i hlavičku `X-Robots-Tag` |
| `MOONE_BASE_URL` | `api-test.znpay.tech` vs. `api.znpay.tech` |

V kódu se nikde nesmí objevit `lsd.francik.eu` ani `lsd-trip.cz` jako literál. Hlídá to
test v `test/bezpecnost.test.js`, který projde `src/` a při nalezení natvrdo napsané domény
spadne — jinak by se to za půl roku někam vloudilo.

Checklist přechodu na novou doménu je v README (sekce „Přechod na lsd-trip.cz“):
DNS → Caddy → `APP_URL` a e-mailové proměnné v `.env` → registrace nové `ReturnUrl`/`CallbackUrl`
u Mo.one → ověření odesílací domény v Resendu → 301 ze staré domény → `sitemap.xml`
a Search Console → kontrola `canonical` a OG.

### Indexace
- Produkce: `robots.txt` povoluje (sekce 8, včetně výslovného povolení AI crawlerů), `X-Robots-Tag` se neposílá.
- Test: `ROBOTS=zakazat` → `robots.txt` s `Disallow: /` **a** hlavička
  `X-Robots-Tag: noindex, nofollow` na každou odpověď (samotný robots.txt nestačí,
  indexaci zabrání spolehlivě až hlavička). Bez basic auth, ať se dá poslat odkaz.

### Workflow
`deploy.yml` dostane `on: push: branches: [main, test]` a krok, který podle `github.ref_name`
nastaví tag a cílový adresář. Jeden job, žádná duplikace.

### Jak se vyvíjí
**Píše se jen do `test`.** Do `main` nic přímo — po odsouhlasení se do něj ověřený `test`
sloučí (`git merge --ff-only test`) a tím se nasadí produkce. Každá fáze tedy jde:
lokálně → `test` → tvoje kontrola na `test-lsd.francik.eu` → tvůj souhlas → `main`.

### Co musíš udělat ty (nejde z repozitáře)
1. Projít `docs/nasazeni-vps.md` — adresáře, `.env` a Caddy pro obě prostředí (příkazy k vložení, hodnoty k doplnění jsou označené).
2. Registrovat u Mo.one návratové a callback URL pro obě prostředí (fáze 4).

### Pojistka v kódu, ne jen v konfiguraci
`EMAIL_REZIM=test` nebude jen podmínka u odesílání — bude to jediná cesta, kterou e-mail
opouští aplikaci: `posliEmail()` si příjemce přepíše **před** voláním Resendu a do
`emaily.prijemce` uloží původní adresu, do `emaily.prijemce_skutecny` testovací.
V logu administrace tak uvidíš, komu by e-mail v produkci šel. Navíc:
pokud `NODE_ENV !== 'production'` a `EMAIL_REZIM` není nastaven, aplikace e-mail
**neodešle vůbec** a jen ho zaloguje — bezpečné výchozí chování.

---

## 3. Datový model

### Konvence
- Názvy tabulek i sloupců česky, `snake_case`, množné číslo (držím se `poptavky` a `_migrace`).
- **Peníze:** vždy `INT` v haléřích, sloupce končí `_hal`. Nikdy `FLOAT`, nikdy `DECIMAL` pro součty.
- **Čas:** kontejner i MariaDB v `TZ=Europe/Prague`, `DATETIME` v místním čase, `DATE` pro dny.
  `mysql2` dostane `timezone: 'local'` + `dateStrings: true` (už je).
- **Mazání:** `smazano_at DATETIME NULL` (soft delete) u všeho, co má vazby. Tvrdě se maže jen `_soubory` po potvrzení.
- **Auditované tabulky** mají `created_at`, `updated_at`, `vytvoril_id`, `upravil_id`.
- Všechny `ENGINE=InnoDB`, `utf8mb4_unicode_ci`.
- Cizí klíče `ON DELETE RESTRICT` (data se nemají tichounce ztrácet), u čistě podřízených tabulek `CASCADE`.

### 3.1 Systém, uživatelé, audit
```
uzivatele          id, email UNIQUE, heslo_hash (argon2id), jmeno, telefon,
                   role ENUM('admin','provoz','instruktor','ucetni'),
                   aktivni, totp_secret NULL, totp_potvrzeno_at,
                   posledni_prihlaseni_at, smazano_at, created_at, updated_at
sessions           id CHAR(64) PK (sha256 tokenu), uzivatel_id, ip, user_agent,
                   expires_at, created_at         KEY (uzivatel_id), KEY (expires_at)
reset_hesla        id, uzivatel_id, token_hash UNIQUE, expires_at, pouzito_at
prihlaseni_pokusy  id, email, ip, uspech, created_at    KEY (email, created_at), KEY (ip, created_at)
audit_log          id, uzivatel_id NULL, akce VARCHAR(64), entita VARCHAR(64),
                   entita_id INT NULL, pred JSON NULL, po JSON NULL, ip,
                   created_at        KEY (entita, entita_id, created_at), KEY (uzivatel_id, created_at)
nastaveni          klic VARCHAR(100) PK, hodnota TEXT, typ ENUM('text','cislo','bool','json','datum'),
                   skupina VARCHAR(50), popis, upravil_id, updated_at
```
`nastaveni` drží údaje spolku, lhůty, platnosti, storno podmínky, sezónu, časy startů —
tedy všechno z modulu 13. API klíče tam **nejsou**, jen příznak „nastaveno / nenastaveno“
odvozený z `.env`.

### 3.2 Produkty a ceník
```
dph_sazby          id, kod VARCHAR(20) UNIQUE ('zakladni21','snizena12','osvobozeno61d'),
                   nazev, procento DECIMAL(5,2),
                   rezim ENUM('standardni','osvobozeno'),
                   pravni_text VARCHAR(255) NULL,  -- text na fakturu u osvobozených položek
                   vychozi, aktivni, poradi
produkty           id, typ ENUM('tandem','kurz','expedice','helitour','poukaz','jine'),
                   slug UNIQUE, nazev, podtitul, stitek ('Nejžádanější'),
                   perex, popis MEDIUMTEXT, co_je_v_cene TEXT,
                   cena_hal INT NULL, cena_na_dotaz BOOL,
                   dph_sazba_id,       -- režim DPH volitelný u KAŽDÉHO produktu zvlášť
                   min_vek, max_vek NULL, max_vaha_kg NULL,
                   souhlas_zastupce_do_let NULL, vyzaduje_lekarskou_prohlidku BOOL,
                   vyzaduje_zdravotni_prohlaseni BOOL,
                   delka_text ('48 hodin'), uroven_text ('Začátečník'),
                   seo_title, seo_description, og_soubor_id NULL,
                   aktivni, poradi, smazano_at, +audit
varianty           id, produkt_id, nazev, popis, cena_hal NULL, cena_na_dotaz BOOL,
                   sleva_procent NULL, min_osob NULL, aktivni, poradi, smazano_at
priplatky          id, nazev, popis, cena_hal, dph_sazba_id, aktivni, poradi, smazano_at
produkt_priplatky  produkt_id, priplatek_id, povinny, poradi     PK (produkt_id, priplatek_id)
produkt_pozadavky  id, produkt_id, text, poradi      -- checklist „co si vzít / co doložit“
produkt_fotky      produkt_id, soubor_id, poradi, titulni        PK (produkt_id, soubor_id)
cenik_historie     id, entita ENUM('produkt','varianta','priplatek'), entita_id,
                   cena_hal_pred NULL, cena_hal_po, duvod, uzivatel_id, created_at
                   KEY (entita, entita_id, created_at)
```
`cenik_historie` plní trigger v aplikaci (ne v DB) — jeden zápis při každé změně ceny.

### 3.3 Termíny
```
mista              id, nazev, adresa, gps_lat, gps_lon, aktivni
termin_serie       id, nazev, pravidlo JSON, vytvoril_id, created_at  -- jen pro hromadné úpravy
terminy            id, produkt_id, serie_id NULL, nazev_prepis NULL,
                   datum DATE, cas_od TIME NULL, cas_do TIME NULL,
                   popis_casu VARCHAR(100) ('starty 7:30 — 15:00'),
                   misto_id, kapacita_mist INT, kapacita_instruktoru NULL,
                   sloty_letadla NULL, obsazeno_mist INT NOT NULL DEFAULT 0,
                   cena_hal_prepis NULL, popis TEXT,
                   stav ENUM('otevreno','plno','zruseno','probehlo') DEFAULT 'otevreno',
                   zruseno_duvod, zruseno_at, viditelny BOOL, smazano_at, +audit
                   KEY (datum, stav), KEY (produkt_id, datum)
termin_instruktori termin_id, uzivatel_id, role ENUM('tandem','aff','kamera','balic')
                   PK (termin_id, uzivatel_id, role)
```
`obsazeno_mist` je **cache pro výpisy**. Autoritativní je součet z `rezervace` uvnitř
transakce (viz 6.4) — cache se přepočítá v téže transakci, takže se nemůže rozejít.

Opakování termínů **negeneruji z pravidla za běhu**, ale vytvořím řádky. Provozu je potřeba
každý den ručně přiohnout (jiný čas, jiná kapacita) a pravidlo by to překrývalo.
`serie_id` slouží jen k tomu, aby šlo „všech 12 pátků" upravit nebo zrušit najednou.

### 3.4 Zákazníci a rezervace
```
zakaznici          id, email, jmeno, telefon, mesto, ulice, psc, ico NULL, dic NULL,
                   poznamka, gdpr_souhlas_at, marketing_souhlas_at,
                   anonymizovano_at NULL, smazano_at, created_at, updated_at
                   UNIQUE KEY uq_email (email), KEY (telefon)
rezervace          id, kod VARCHAR(20) UNIQUE ('LSD-2026-0042'),
                   zakaznik_id, termin_id NULL, produkt_id, varianta_id NULL,
                   pocet_osob INT, zdroj ENUM('web','telefon','email','admin'),
                   stav ENUM('nova','potvrzena','zaplacena','probehla','storno',
                             'presunuta','no_show'),
                   cena_hal, sleva_hal, poukaz_sleva_hal, k_uhrade_hal, uhrazeno_hal,
                   splatnost DATE NULL, drzeni_do DATETIME NULL,  -- rezervace drží místo do…
                   poukaz_id NULL, presunuto_z_id NULL,
                   souhlas_vop_at, souhlas_gdpr_at, souhlas_rizika_at, souhlas_zdravi_at,
                   interni_poznamka TEXT, storno_duvod, storno_at, smazano_at, +audit
                   KEY (termin_id, stav), KEY (zakaznik_id), KEY (stav, splatnost)
rezervace_polozky  id, rezervace_id, typ ENUM('produkt','varianta','priplatek'),
                   entita_id, nazev_snapshot, mnozstvi, cena_jed_hal,
                   dph_procento DECIMAL(5,2), celkem_hal
rezervace_ucastnici id, rezervace_id, jmeno, vaha_kg, datum_narozeni NULL, vek NULL,
                   telefon, email, souhlas_zastupce BOOL, zdravotni_prohlaseni_at,
                   dorazil BOOL, poznamka
```
`nazev_snapshot` a `cena_jed_hal` v položkách jsou klíčové: po změně ceníku se stará
rezervace ani faktura nesmí přepočítat.

### 3.5 Poukazy
```
poukazy            id, kod VARCHAR(16) UNIQUE, typ ENUM('hodnotovy','produktovy'),
                   ucel ENUM('jednoucelovy','viceucelovy'),  -- odvozeno z typu, viz 3.7
                   produkt_id NULL, varianta_id NULL,
                   hodnota_hal NULL, zbyva_hal NULL,
                   platnost_do DATE, prodlouzeno_do DATE NULL, prodlouzeno_duvod,
                   stav ENUM('vystaveny','prodany','uplatneny','castecne_uplatneny',
                             'propadly','storno'),
                   objednavka_rezervace_id NULL, zakaznik_id NULL,
                   pro_koho VARCHAR(160), vzkaz TEXT,
                   pdf_soubor_id NULL, vystaveno_at, uplatneno_at NULL,
                   poznamka, smazano_at, +audit
                   KEY (stav, platnost_do)
poukaz_pohyby      id, poukaz_id, typ ENUM('uplatneni','prodlouzeni','storno','vystaveni'),
                   castka_hal NULL, rezervace_id NULL, uzivatel_id NULL, poznamka, created_at
```
Kód generuji z abecedy bez záměnitelných znaků (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`),
8 znaků ve skupinách po 4 — čitelné do telefonu.

### 3.6 Platby
```
platby             id, rezervace_id, typ ENUM('prevod','brana','hotove','karta_na_miste',
                                              'poukaz','refundace'),
                   stav ENUM('ocekavana','zaplacena','castecna','selhala','zrusena',
                             'k_proseteni','refundovana'),
                   castka_hal, vs VARCHAR(10),
                   -- platební brána Mo.one
                   brana VARCHAR(20) NULL,                  -- 'moone'
                   externi_uuid CHAR(36) NULL UNIQUE,       -- naše ExternalTransactionID (GUID)
                   brana_transakce_id VARCHAR(40) NULL UNIQUE, -- Mo.one PublicID ('UDPVPE')
                   brana_stav VARCHAR(30) NULL,             -- Created…Success/Fail/Cancelled
                   brana_redirect_url TEXT NULL,
                   posledni_kontrola_at DATETIME NULL,      -- kdy jsme se ptali status API
                   bankovni_transakce_id INT NULL,
                   zaplaceno_at, refundace_platby_id NULL, poznamka, +audit
                   KEY (rezervace_id, stav), KEY (vs), KEY (stav, posledni_kontrola_at)
bankovni_transakce id, banka VARCHAR(20), banka_id VARCHAR(64) UNIQUE,
                   datum DATE, castka_hal, vs, ks, ss, protiucet, nazev_protiuctu,
                   zprava, sparovano_platba_id NULL, importovano_at
                   KEY (vs), KEY (datum)
webhook_udalosti   id, zdroj ENUM('brana','resend','banka'), externi_id VARCHAR(160),
                   typ VARCHAR(64), payload JSON, zpracovano_at NULL, chyba TEXT,
                   created_at        UNIQUE KEY uq_zdroj_id (zdroj, externi_id)
```
`webhook_udalosti` s unikátním `(zdroj, externi_id)` je **jediný** mechanismus idempotence:
webhook se nejprve zapíše (duplikát spadne na unique a vrátí 200 bez zpracování), pak se
teprve zpracuje. Retry z brány tak nikdy nezaplatí rezervaci dvakrát.

### 3.7 Fakturace
```
ciselne_rady       id, typ ENUM('zaloha','faktura','dobropis'), rok INT,
                   format VARCHAR(40) ('{RRRR}{NNNN}'), aktualni_cislo INT,
                   UNIQUE KEY uq_typ_rok (typ, rok)
doklady            id, typ ENUM('zaloha','faktura','dobropis'), cislo VARCHAR(30) UNIQUE,
                   rezervace_id, zakaznik_id,
                   datum_vystaveni DATE, datum_splatnosti DATE, datum_duzp DATE NULL,
                   zaklad_hal, dph_hal, celkem_hal, mena CHAR(3) DEFAULT 'CZK',
                   vs VARCHAR(10), platce_dph BOOL,
                   stav ENUM('vystaveno','zaplaceno','stornovano'),
                   storno_dokladu_id NULL, pdf_soubor_id NULL,
                   snapshot JSON NOT NULL, vytvoril_id, created_at
                   KEY (rezervace_id), KEY (datum_vystaveni)
doklad_polozky     id, doklad_id, nazev, mnozstvi, cena_jed_hal,
                   dph_procento, zaklad_hal, dph_hal, celkem_hal, poradi
```
**Režimy DPH na jednom dokladu.** Spolek je plátce, výchozí sazba 21 %, ale každý produkt
má vlastní `dph_sazba_id`. Jedna faktura tak může mít položky ve třech režimech
(např. kurz osvobozený podle § 61 písm. d) + kamerový záznam 21 %). Proto:
- `doklad_polozky` drží `dph_procento` a `dph_sazba_kod` u **každé položky**,
- doklad má **rekapitulaci po sazbách** (`snapshot.rekapitulace`: základ, DPH a celkem pro každou sazbu),
- u osvobozených položek se na doklad vypíše `pravni_text` ze sazby
  („Osvobozeno od DPH podle § 61 písm. d) zákona č. 235/2004 Sb.“),
- změna sazby u produktu se **nikdy nepropisuje do vystavených dokladů** — ty mají hodnoty
  v `doklad_polozky` a v `snapshot`,
- export pro účetní je rozdělený podle režimu DPH, protože spolek s osvobozenými plněními
  krátí nárok na odpočet.

**Poukazy a DUZP.** Typ poukazu určuje, kdy vzniká daňová povinnost:
- `produktovy` → **jednoúčelový** poukaz (konkrétní služba, známá sazba): daňový doklad se
  vystaví **při prodeji** poukazu, DUZP = datum prodeje.
- `hodnotovy` → **víceúčelový** poukaz (nevíme, co si obdarovaný vybere): při prodeji
  **není** daňové plnění, vystaví se jen doklad o přijaté platbě; DPH a daňový doklad
  vznikají **až při uplatnění** na konkrétní rezervaci.

Tohle rozdělení je v kódu jen jedno rozhodnutí (`poukazy.ucel`), ale je potřeba ho mít
správně od první vystavené faktury — přepsat to zpětně by znamenalo opravné doklady.

`doklady` **nemá `updated_at` ani `smazano_at`** — vystavený doklad je neměnný.
`snapshot JSON` drží kompletní data (dodavatel, odběratel, položky, texty) v podobě,
v jaké byl doklad vystaven, takže PDF půjde znovu vygenerovat i po změně nastavení spolku.
Oprava = dobropis, který odkazuje `storno_dokladu_id`.

### 3.8 E-maily
```
email_sablony      id, klic VARCHAR(60) UNIQUE, nazev, popis,
                   predmet VARCHAR(255), telo MEDIUMTEXT,
                   promenne JSON (dokumentace pro UI), aktivni, upravil_id, updated_at
emaily             id, resend_id VARCHAR(100) NULL UNIQUE, sablona_klic NULL,
                   prijemce VARCHAR(255), prijemce_skutecny VARCHAR(255),
                   predmet, telo_snapshot MEDIUMTEXT,
                   rezervace_id NULL, zakaznik_id NULL, termin_id NULL,
                   stav ENUM('ve_fronte','odeslano','doruceno','otevreno','kliknuto',
                             'bounce','stiznost','chyba'),
                   rezim ENUM('live','test','vypnuto'), chyba TEXT,
                   odeslano_at, stav_at, created_at
                   KEY (rezervace_id, created_at), KEY (prijemce), KEY (stav)
email_udalosti     id, email_id, typ VARCHAR(40), payload JSON, created_at
newsletter         id, email UNIQUE, jmeno, stav ENUM('ceka_potvrzeni','aktivni','odhlasen'),
                   potvrzovaci_token_hash, odhlasovaci_token UNIQUE,
                   potvrzeno_at, odhlaseno_at, zdroj, ip_souhlasu, created_at
```
Šablony: `{{promenna}}` a `{{#if}}` nad vlastním mini-renderem (~40 řádků), žádná
šablonovací knihovna. Proměnné se escapují vždy; HTML se povoluje jen v samotné šabloně.

### 3.9 Soubory a galerie
```
soubory            id, cesta VARCHAR(255) UNIQUE, puvodni_nazev, mime, velikost_b,
                   sirka, vyska, varianty JSON ({"320":"...", "800":"...", "1600":"..."}),
                   alt VARCHAR(255), zdroj ENUM('upload','import'),
                   zdroj_url TEXT NULL, hash_sha256 CHAR(64),
                   nahral_id, smazano_at, created_at      KEY (hash_sha256)
albumy             id, nazev, slug UNIQUE, popis, titulni_soubor_id NULL,
                   poradi, viditelne, smazano_at, +audit
album_soubory      album_id, soubor_id, poradi, alt_prepis   PK (album_id, soubor_id)
```
`hash_sha256` zabrání dvojímu importu téže fotky ze starého webu.
`zdroj_url` drží původní adresu, takže po migraci fotek půjde přepsat odkazy v obsahu.

### 3.10 Obsah webu
```
stranky            id, slug UNIQUE ('home','tandem',...), nazev,
                   seo_title, seo_description, og_soubor_id NULL,
                   viditelna, poradi, +audit
bloky              id, klic VARCHAR(120) UNIQUE ('home.hero.titulek'), stranka_id NULL,
                   typ ENUM('text','textarea','html','cislo','obrazek','odkaz'),
                   hodnota MEDIUMTEXT, popis (label pro administraci),
                   skupina VARCHAR(60) ('Hero', 'Statistiky'), poradi, upravil_id, updated_at
seznamy            id, klic VARCHAR(60) UNIQUE ('home.statistiky','onas.duvody'), nazev, popis
seznam_polozky     id, seznam_id, hodnoty JSON, poradi, viditelne
faq                id, otazka, odpoved TEXT, kategorie, poradi, viditelne, smazano_at, +audit
tym                id, jmeno, role, bio TEXT, soubor_id NULL, poradi, viditelne, smazano_at
aktuality          id, titulek, text TEXT, soubor_id NULL, datum DATE,
                   viditelne, poradi, smazano_at, +audit
bannery            id, text, typ ENUM('info','vystraha','uspech'), odkaz_text, odkaz_url,
                   aktivni_od DATETIME NULL, aktivni_do DATETIME NULL, aktivni, poradi
navigace           id, umisteni ENUM('header','mobil','patka_zazitky','patka_info'),
                   label, route, poradi, viditelne
```
Klíč k použitelnosti pro netechnického člověka: **schéma bloků je v kódu, hodnoty v DB.**
Registr v `src/obsah/registr.js` popíše každý blok (klíč, label, typ, nápověda, max délka)
a administrace z něj vygeneruje formulář rozdělený podle `skupina`. Majitelka tedy
nevidí „klíč `home.hero.titulek`“, ale pole **„Hlavní titulek na úvodu“** s nápovědou.
Migrace naplní hodnoty z dnešního `data.js` i z natvrdo napsaných textů v `app.js`.

### 3.11 Poptávky (úprava existující tabulky)
```sql
ALTER TABLE poptavky
  ADD COLUMN telefon VARCHAR(40) NULL,
  ADD COLUMN produkt_id INT UNSIGNED NULL,
  ADD COLUMN termin_id INT UNSIGNED NULL,
  ADD COLUMN zakaznik_id INT UNSIGNED NULL,
  ADD COLUMN stav ENUM('nova','vyrizuje_se','vyrizeno','spam') NOT NULL DEFAULT 'nova',
  ADD COLUMN prirazeno_id INT UNSIGNED NULL,
  ADD COLUMN odpoved TEXT NULL,
  ADD COLUMN odpovezeno_at DATETIME NULL,
  ADD COLUMN zdroj VARCHAR(40) NULL,
  ADD COLUMN ip VARCHAR(45) NULL,
  ADD COLUMN smazano_at DATETIME NULL;
UPDATE poptavky SET stav = 'vyrizeno' WHERE vyrizeno = 1;
ALTER TABLE poptavky DROP COLUMN vyrizeno;
```

**Celkem ~40 tabulek**, rozdělených do 6 migrací podle fází.

---

## 4. API

### Veřejné (bez přihlášení, rate limit, jen čtení + 4 zápisy)
| Metoda | Cesta | Poznámka |
| --- | --- | --- |
| GET | `/api/bootstrap` | **jeden dotaz pro celý web**: navigace, bloky, produkty, termíny, FAQ, tým, aktuality, galerie, banner, provozní info. Odpověď má přesně tvar dnešního `LSD_DATA`. Cache 60 s v paměti, invalidace při zápisu v administraci. |
| GET | `/api/terminy` | `?od=&do=&typ=&volna=1` — pro kalendář a live obsazenost |
| GET | `/api/terminy/:id` | detail + volná místa |
| GET | `/api/produkty/:slug` | detail produktu s variantami a příplatky |
| GET | `/api/galerie/:slug` | album |
| GET | `/api/stranky/:slug` | SEO meta pro serverový render `<head>` |
| POST | `/api/poptavky` | honeypot + rate limit 5/h/IP |
| POST | `/api/rezervace` | transakčně, vrací `kod`, pokyny k platbě, QR |
| GET | `/api/rezervace/:kod` | `?t=<podepsaný token>` — zákazník vidí svou rezervaci |
| POST | `/api/poukazy/overit` | ověření kódu při rezervaci |
| POST | `/api/poukazy/koupit` | vytvoří poukaz + platbu |
| POST | `/api/newsletter` | double opt-in (jen pokud schválíš) |
| GET | `/api/newsletter/potvrdit` · `/odhlasit` | tokenem |
| POST | `/api/webhooky/platby/:brana` | ověření podpisu, idempotence |
| POST | `/api/webhooky/resend` | ověření podpisu (svix) |
| GET | `/api/health` | zůstává |

### Administrace (`/api/admin/*`, session cookie + CSRF + role)
| Skupina | Endpointy |
| --- | --- |
| Auth | `POST /prihlaseni`, `POST /odhlaseni`, `GET /ja`, `POST /zmena-hesla`, `POST /reset-hesla`, `POST /reset-hesla/:token`, `POST /2fa/zapnout`, `POST /2fa/potvrdit`, `POST /2fa/vypnout` |
| Dashboard | `GET /dashboard`, `GET /dashboard/trzby?od=&do=` |
| Produkty | `GET/POST /produkty`, `GET/PATCH/DELETE /produkty/:id`, `POST /produkty/poradi`, `…/varianty`, `…/priplatky`, `…/fotky`, `GET /produkty/:id/cenik-historie`, `GET/POST/PATCH /dph-sazby` |
| Termíny | `GET /terminy?od=&do=&stav=`, `POST /terminy`, `POST /terminy/hromadne`, `POST /terminy/:id/kopie`, `PATCH /terminy/:id`, `POST /terminy/:id/zrusit` (+ `nabidnout_presun`, `poslat_email`), `POST /terminy/den/:datum/zrusit`, `GET /terminy/:id/manifest`, `GET /terminy/:id/manifest.csv`, `GET /terminy/:id/manifest.pdf`, `POST /terminy/:id/email` |
| Rezervace | `GET /rezervace?stav=&termin=&q=&od=&do=`, `POST /rezervace`, `GET/PATCH /rezervace/:id`, `POST /rezervace/:id/stav`, `POST /rezervace/:id/presun`, `POST /rezervace/:id/storno`, `POST /rezervace/:id/platba`, `POST /rezervace/:id/refundace`, `POST /rezervace/:id/poukaz`, `POST /rezervace/:id/email`, `GET /rezervace/:id/emaily`, `POST /rezervace/:id/poznamka`, `GET /rezervace/export.csv` |
| Poukazy | `GET/POST /poukazy`, `GET/PATCH /poukazy/:id`, `POST /poukazy/:id/prodlouzit`, `POST /poukazy/:id/uplatnit`, `POST /poukazy/:id/storno`, `GET /poukazy/:id/pdf`, `POST /poukazy/:id/poslat` |
| Platby | `GET /platby?stav=&od=&do=`, `POST /platby/:id/zaplaceno`, `POST /platby/:id/refundace`, `GET /platby/qr/:rezervace_id`, `GET /banka/transakce`, `POST /banka/import`, `POST /banka/transakce/:id/sparovat`, `GET /platby/neparovane` |
| Doklady | `GET /doklady?typ=&od=&do=`, `POST /doklady` (ručně), `GET /doklady/:id`, `GET /doklady/:id/pdf`, `POST /doklady/:id/storno`, `POST /doklady/:id/poslat`, `GET /doklady/export.csv`, `GET /doklady/export.isdoc.zip`, `GET/PATCH /ciselne-rady` |
| E-maily | `GET /email/sablony`, `GET/PATCH /email/sablony/:klic`, `POST /email/sablony/:klic/nahled`, `POST /email/sablony/:klic/test`, `GET /email/log?stav=&q=`, `GET /email/log/:id`, `POST /email/hromadny` |
| Galerie | `POST /soubory` (multipart, více souborů), `GET /soubory?q=`, `PATCH /soubory/:id` (alt), `DELETE /soubory/:id`, `GET/POST /albumy`, `PATCH/DELETE /albumy/:id`, `POST /albumy/:id/poradi`, `POST /albumy/:id/titulni` |
| Obsah | `GET /obsah/stranky`, `GET/PATCH /obsah/stranky/:slug`, `GET/PATCH /obsah/bloky`, `GET/POST/PATCH/DELETE /obsah/faq`, `…/tym`, `…/aktuality`, `…/bannery`, `…/navigace`, `POST /obsah/*/poradi` |
| Poptávky | `GET /poptavky?stav=&q=`, `GET/PATCH /poptavky/:id`, `POST /poptavky/:id/odpovedet`, `POST /poptavky/:id/stav`, `DELETE /poptavky/:id` (soft) |
| Zákazníci | `GET /zakaznici?q=`, `GET /zakaznici/:id` (historie rezervací, poukazů, e-mailů, dokladů), `PATCH /zakaznici/:id`, `GET /zakaznici/:id/gdpr-export`, `POST /zakaznici/:id/anonymizovat` |
| Uživatelé | `GET/POST /uzivatele`, `PATCH/DELETE /uzivatele/:id`, `POST /uzivatele/:id/reset-hesla` |
| Audit | `GET /audit?entita=&entita_id=&uzivatel=&od=&do=` |
| Nastaveni | `GET/PATCH /nastaveni`, `GET /nastaveni/integrace` (maskované stavy klíčů) |

**Konvence:** všechny seznamy `?strana=&na_strane=&q=&razeni=`, odpověď
`{ data: [...], celkem: N, strana: 1 }`. Validace `zod` u každého těla i query.
Chyby: `{ chyba: "...", detaily: { pole: "zpráva" } }` — česky, rovnou zobrazitelné.

### Role → oprávnění
| | admin | provoz | instruktor | účetní | tester |
| --- | --- | --- | --- | --- | --- |
| dashboard | ✓ | ✓ | dnešní termíny | tržby | – |
| produkty, ceník | ✓ | čtení | – | čtení | – |
| termíny | ✓ | ✓ | čtení + manifest | – | – |
| rezervace | ✓ | ✓ | manifest (jméno, váha, zaplaceno) | čtení | – |
| poukazy | ✓ | ✓ | – | ✓ | – |
| platby, doklady | ✓ | čtení | – | ✓ | – |
| e-maily (šablony) | ✓ | – | – | – | – |
| e-maily (odeslat účastníkům) | ✓ | ✓ | – | – | – |
| galerie, obsah | ✓ | ✓ | – | – | – |
| zákazníci, GDPR | ✓ | ✓ | – | čtení | – |
| uživatelé, audit, nastavení | ✓ | – | – | – | – |
| ke schválení (jen mimo produkci) | ✓ | ✓ | – | – | ✓ |

---

## 5. Obrazovky administrace

`/admin` bude **samostatná SPA** (`public/admin/index.html` + vlastní `admin.css`, `admin.js`),
ne součást webového `app.js`. Sdílí design tokeny (`:root` proměnné) s webem, ale má vlastní
layout: mobilní spodní lišta se 5 ikonami, na desktopu levý sloupec.

```
/admin/#/                    Dashboard
/admin/#/prihlaseni          Přihlášení (+ 2FA, zapomenuté heslo)
/admin/#/kalendar            Kalendář — měsíc / týden / seznam, obsazenost barevně
/admin/#/termin/:id          Detail termínu: soupiska, kapacita, instruktoři, zrušení, hromadný e-mail
/admin/#/termin/:id/manifest Tisková soupiska (print CSS, funguje z mobilu i tabletu)
/admin/#/terminy/nove        Vytvoření — jednotlivě i hromadně (rozsah dat, dny v týdnu, kopie dne)
/admin/#/rezervace           Seznam: filtry stav / termín / zaplaceno / fulltext
/admin/#/rezervace/:id       Detail: účastníci, souhlasy, platby, doklady, e-maily, poznámky, akce
/admin/#/rezervace/nova      Ruční rezervace (telefonická) — 1 obrazovka, ne wizard
/admin/#/produkty            Seznam s přetahováním pořadí
/admin/#/produkt/:id         Karta: texty, fotky, cena + DPH, požadavky, varianty, příplatky, historie cen
/admin/#/poukazy             Seznam + filtr „blíží se platnost“
/admin/#/poukaz/:id          Detail, prodloužení, uplatnění, PDF
/admin/#/platby              Nezaplacené / po splatnosti / nepárované bankovní pohyby
/admin/#/doklady             Doklady, storno dobropisem, export pro účetní
/admin/#/emaily              Šablony (editor + náhled + testovací odeslání)
/admin/#/emaily/log          Log odeslaných e-mailů se stavy doručení
/admin/#/galerie             Alba, drag & drop upload, řazení, alt texty
/admin/#/obsah               Stránky, bloky, FAQ, tým, aktuality, banner, SEO
/admin/#/poptavky            Poptávky + odpověď
/admin/#/zakaznici           Kartotéka, GDPR export a anonymizace
/admin/#/uzivatele           Uživatelé a role
/admin/#/audit               Audit log s filtry
/admin/#/nastaveni           Spolek, lhůty, storno podmínky, připomínky, stavy integrací
/admin/akceptace             Ke schválení — verze k otestování (JEN mimo produkci)
/admin/akceptace/:kod        Úkoly verze, výsledky testerů, schválení, export souhrnu
/admin/akceptace/hlaseni     Hlášení problémů z tlačítka v hlavičce
```

### Zásady UI (pro použití na letišti z mobilu)
- **Rychlé akce na dashboardu** jsou velká tlačítka, ne skryté v menu: „Dnes se neskáče“ (zruší dnešní termíny + nabídne přesun + rozešle e-mail, ve dvou potvrzovacích krocích), „Nová rezervace“, „Soupiska na dnes“.
- Destruktivní akce: modál s přepsáním důsledku česky („Zruší 3 termíny, dotkne se 41 rezervací. Rozeslat e-mail o zrušení?“) a potvrzovacím tlačítkem s konkrétním textem, ne „OK“.
- Žádné mazání natvrdo. „Smazat“ = skrýt; obnovení z filtru „smazané“.
- Formuláře ukládají na jedno tlačítko, chyby u polí, česky, bez žargonu.
- Seznamy: fulltext + filtry + stránkování po 25, „načíst další“ na mobilu.
- Vše funguje bez JS buildu — `<script type="module">`, `fetch`, `template` literály. Žádný framework.

---

## 6. Technická rozhodnutí

### 6.1 Stack zůstává (zdůvodnění)
Express + vanilla JS **bez build kroku doporučuji ponechat**. Důvody:
- Administrace je ~25 obrazovek CRUD. Vanilla JS s jedním malým render helperem to zvládne; framework by přinesl build, watch, source mapy a další věc, která se za dva roky nedá přeložit.
- Deploy je dnes `docker build` bez node_modules pro build → jednoduchý a rychlý. Přidání bundleru znamená druhou fázi buildu v Dockerfile.
- Nasazení nové verze webu nesmí rozbít vizuál — a `public/` zůstane netknuté.

Přidám jen serverové závislosti, žádný frontend balík:

| Balík | K čemu | Alternativa, kterou jsem zamítl |
| --- | --- | --- |
| `@node-rs/argon2` | hashování hesel (argon2id) | `bcrypt` — slabší, `argon2` — nativní build v Alpine |
| `zod` | validace všech vstupů | ruční kontroly — neudržitelné u 100 endpointů |
| `helmet` | bezpečnostní hlavičky + CSP | ruční hlavičky |
| `express-rate-limit` | login, poptávky, veřejné API | vlastní |
| `cookie-parser` | session cookie | ruční parsování |
| `multer` | upload fotek (disk storage, limity) | ruční multipart parser |
| `sharp` | WebP, náhledy, odstranění EXIF | ImageMagick v kontejneru — větší image |
| `resend` | e-maily | nodemailer + SMTP (bez logu doručení) |
| `pdfkit` | PDF faktur a poukazů | Puppeteer — na Contabu zbytečných ~400 MB a pomalý start |
| `qrcode` | QR platba (SPAYD) | externí služba — data o platbách třetí straně |
| `otpauth` | TOTP 2FA | – |

Testy: **`node:test` + vestavěný `fetch`** (Node 24), žádný Jest ani supertest.

### 6.2 Bezpečnost
- Heslo: argon2id, `memoryCost 19456 KiB, timeCost 2, parallelism 1` (OWASP 2024).
- Session: 64znakový token z `crypto.randomBytes(32)`, v DB jen `sha256`. Cookie `lsd_admin`: `httpOnly`, `secure` (v produkci), `SameSite=Strict`, `Path=/`, expirace 14 dní s posunutím při aktivitě.
- CSRF: `SameSite=Strict` + double-submit — druhá cookie `lsd_csrf` (čitelná JS) a povinná hlavička `X-CSRF-Token` u každého `POST/PATCH/DELETE` v `/api/admin`.
- Rate limit: login 5 pokusů / 15 min na `(IP, email)` + zámek účtu na 15 min po 10 pokusech, poptávky 5/h/IP, veřejné API 120/min/IP. Každý neúspěšný login do `prihlaseni_pokusy` a `audit_log`.
- Reset hesla: token 32 B, hash v DB, platnost 60 min, jednorázový, e-mail neprozradí, zda účet existuje.
- CSP (helmet): `default-src 'self'`; `img-src 'self' data: https://www.lsd-trip.cz` (dokud neproběhne migrace fotek); `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` — `unsafe-inline` je nutné, protože `app.js` používá `style="..."` atributy; `font-src https://fonts.gstatic.com`; `script-src 'self'`; `frame-ancestors 'none'`.
- `express.json({ limit: '100kb' })`, upload limit 15 MB/soubor a 30 souborů/request.
- Veřejný web nedostane žádný endpoint, který vrací osobní údaje bez podepsaného tokenu.

### 6.3 Časová zóna a formáty
- `TZ=Europe/Prague` v obou kontejnerech + `MARIADB_INITDB_SKIP_TZINFO` nenastavovat (tabulky časových zón potřebujeme).
- Datum uživateli vždy `26. 9. 2026`, čas `13:30`, peníze `4 700 Kč` — jedna funkce `formatuj.js` na serveru i v administraci.
- Sezóna a „dnes“ se počítají z pražského data, ne z UTC.

### 6.4 Transakce u kapacity
```sql
START TRANSACTION;
SELECT kapacita_mist, stav FROM terminy WHERE id = ? FOR UPDATE;
SELECT COALESCE(SUM(pocet_osob),0) FROM rezervace
  WHERE termin_id = ? AND stav IN ('nova','potvrzena','zaplacena','probehla')
    AND smazano_at IS NULL;
-- kontrola kapacity míst, tandemových instruktorů i slotů letadla
INSERT INTO rezervace ...;  INSERT INTO rezervace_polozky ...;
UPDATE terminy SET obsazeno_mist = ?, stav = IF(? >= kapacita_mist,'plno',stav) WHERE id = ?;
COMMIT;
```
Stejný vzor u uplatnění poukazu (`FOR UPDATE` na `poukazy`), u přidělení čísla dokladu
(`FOR UPDATE` na `ciselne_rady`) a u párování platby.

### 6.5 Úložiště a zálohy
- Fotky v pojmenovaném volume `uploads` → `/app/uploads`, struktura `RRRR/MM/<id>-<varianta>.webp`.
- `scripts/zaloha.sh` (cron na VPS, 3:20 ráno): `mariadb-dump --single-transaction --routines` → gzip, `tar` uploadů, rotace 14 denních + 8 týdenních, kontrola velikosti a zápis do logu. Do repozitáře přidám skript i `crontab` řádek a popis v README. Výstup do `/home/deploy/backups/{produkce,test}/`.
- Healthcheck `/api/health` rozšířím o kontrolu zápisu do uploads a poslední úspěšné migrace.

### 6.6 Veřejný web: server-side rendering a normální URL

Původně jsem chtěl nechat hash router a jen vyměnit `data.js` za `fetch('/api/bootstrap')`.
To ale nestačí na požadavek, aby obsah viděly AI crawlery: **GPTBot, ClaudeBot ani
PerplexityBot nespouštějí JavaScript.** Na dnešním webu by tak z každé stránky viděly
prázdné `<main>`. Proto se ve fázi 2 dělá obojí naráz — napojení na DB i SSR — ať se
frontend nepřepisuje dvakrát.

**Jak to udělám, aby se vizuál nezměnil ani o pixel:** renderovací funkce z `app.js`
jsou už dnes čisté funkce „data → HTML string“ (`viewHome()`, `viewTandem()`, …). Vytáhnu je
do `public/assets/js/views.js` jako ES modul **bez jediného dotyku DOM**, který se importuje
na dvou místech:
- na serveru (`src/render/ssr.js`) — vygeneruje kompletní HTML dokument,
- v prohlížeči (`app.js`) — po navigaci překreslí `<main>`.

Jeden a týž kód, jeden výstup. CSS, třídy ani struktura se nemění, takže není co rozbít.
Server vrací hotové HTML, prohlížeč si jen navěsí posluchače (hydratace bez překreslení).

**URL se mění z `#/tandem` na `/tandem`** (history API):

| dnes | nově |
| --- | --- |
| `#/` | `/` |
| `#/tandem` · `#/kurzy` · `#/kalendar` | `/tandem` · `/kurzy` · `/kalendar` |
| `#/termin/904` | `/termin/904-parasutisticky-vycvik-4-9-2026` (slug kvůli SEO, ID rozhoduje) |
| `#/booking` | `/rezervace` |
| `#/poukaz` · `#/expedice` · `#/galerie` | `/darkovy-poukaz` · `/expedice` · `/galerie` |
| `#/onas` · `#/faq` · `#/kontakt` | `/o-nas` · `/faq` · `/kontakt` |

Staré hashové adresy, které už někdo mohl uložit, přesměruje krátký skript v `<head>`:
`#/tandem` → `/tandem` přes `location.replace()`. Serverově to nejde, hash se na server neposílá.

**Bez build kroku to jde:** `<script type="module">` s relativními importy funguje
v prohlížeči nativně a Node 24 umí `import` z ESM stejně. Žádný bundler, žádný watch.

Fallback: když dotaz do DB selže, server vrátí naposledy vyrenderovanou verzi stránky
z paměťové cache (60 s) — web nikdy neukáže prázdnou stránku ani chybu.

### 6.7 Platební brána Mo.one

Podklad: `docs/moone-platebni-brana.pdf` (integrační dokumentace ZS-548, redirect flow).
Tok: `POST /payment/api/auth/token` (ClientID + ClientSecret → Bearer JWT, platnost 1 h) →
`POST /payment/api/transactions/initiate` → přesměrování zákazníka na `Transaction.RedirectUrl` →
návrat na `ReturnUrl?status=&transactionId=` → webhook na `CallbackUrl` →
`GET /payment/api/transactions/{publicID}/status` jako autoritativní stav.

**Tři věci z dokumentace, které určují návrh:**

1. **Webhook není podepsaný** (HMAC je teprve plánovaný) a návratová URL je manipulovatelná
   zákazníkem. Ani jedno proto nesmí platbu označit za zaplacenou. Jediné místo, kde se mění
   `platby.stav` na `zaplacena`, je funkce `overStavUMoone(platba)`, která si zavolá status API.
   Webhook i návrat jsou pro nás **jen spouštěč** téhle kontroly. Navíc porovnáváme
   `Amount` a `CurrencyCode` z odpovědi s naším `castka_hal` / `CZK` — když se neshodují,
   platba jde do stavu `k_proseteni` a nikomu se nevystaví faktura.
2. **Webhook se může ztratit** (5 pokusů, pak nic). Proto přidám periodickou kontrolu
   (každých 5 minut): platby ve stavu `ocekavana` s vyplněným `brana_transakce_id`
   a `created_at` do 24 h se doptají na status. Sloupec `posledni_kontrola_at` zabrání
   tomu, aby se brána zatloukla dotazy.
3. **SSRF ochrana Mo.one blokuje loopback a privátní IP.** `CallbackUrl` tedy nemůže mířit na
   `localhost` — **na lokálním stroji webhook nikdy nepřijde**. Lokální vývoj se proto
   testuje přes status API a ruční „zkontrolovat stav" v administraci; ostré ověření
   webhooku proběhne až na `lsd.francik.eu`, které je veřejné.

Další detaily, které si zapíšu do implementace, ať se na ně nezapomene:
- **Casing:** REST PascalCase (`ClientID`, `Amount`, `AccessToken`), webhook camelCase
  s velkým ID (`transactionPublicID`, `externalID`), návratová query doslova
  `status` / `transactionId`. Hodnota zrušení je `cancel`, ne `cancelled`.
- **Částka je decimal, my držíme haléře.** Převod jedinou funkcí
  `halNaDecimal(hal)` → `(hal/100).toFixed(2)` a zpět `Math.round(Number(x)*100)`.
  Nikde v kódu se nesmí objevit násobení 100 „ručně".
- **`ExternalTransactionID` musí být GUID** → `crypto.randomUUID()` do `platby.externi_uuid`
  při zakládání platby, takže webhook (`externalID`) dohledá platbu i bez `PublicID`.
- **Token se cachuje** (1 h, obnova při 55 min) — rate limit je 10 požadavků/min/IP,
  takže volat token před každou platbou by bránu zbytečně tlouklo. Jeden in-memory cache
  s ochranou proti souběžnému obnovení.
- **Stav `InvestigationNeeded`** mapuji na `k_proseteni` a v administraci se zobrazí
  červeně na dashboardu — obsluha musí vědět, že u téhle platby je něco divně.
- **Storno:** `PUT /payment/api/transactions/{publicID}/cancel` u nezaplacených,
  volá se při stornu rezervace.
- `.env`: `MOONE_BASE_URL`, `MOONE_CLIENT_ID`, `MOONE_CLIENT_SECRET`, `VEREJNA_URL`
  (z ní se skládá `ReturnUrl` a `CallbackUrl`). Secret nikdy do DB ani do logu —
  v administraci jen „nastaveno / nenastaveno".
- Webhook endpoint `POST /api/webhooky/platby/moone` je bez přihlášení a bez CSRF,
  odpoví `200` okamžitě po zápisu do `webhook_udalosti` a zpracuje se až potom.
  Idempotence: unique `(zdroj, externi_id)` = `('brana', transactionPublicID + ':' + status)`.

Rozhraní `src/platby/brana.js` (`zalozPlatbu`, `overStav`, `zrus`) zůstává — Mo.one bude
první implementace, případná druhá brána se přidá bez zásahu do rezervací.

### 6.8 Když brána selže (a ona zpočátku selhávat bude)

Mo.one se teprve dolaďuje na straně bank, takže **selhání platby není výjimka, ale běžný
provozní stav**. Návrh z toho vychází: rezervace nikdy nezávisí na tom, že brána projde.

**Zákazník** po `status=fail` nebo `cancel` skončí na návratové stránce, která hned nabízí
obojí — bez kliknutí navíc a bez hledání:
1. **QR platba** (SPAYD) se stejným variabilním symbolem a částkou, plus číslo účtu
   a částka opsatelné ručně. Rezervace je pořád platná, jen nezaplacená.
2. **„Zkusit znovu přes bránu“** — založí novou transakci Mo.one na tutéž rezervaci
   (nová platba, nové `PublicID`, stejný VS).

**Rezervace drží místo** do `drzeni_do` (výchozí **48 h**, nastavitelné v administraci
`rezervace.drzeni_hodin`). Po vypršení **nepadá do automatického storna** — přejde do
`k_proseteni` a zůstane v kapacitě, dokud ji obsluha nevyřeší. Nikdo nesmí přijít o místo
proto, že mu nesedla platba.

**Víc plateb na jednu rezervaci.** `rezervace` už má `uhrazeno_hal`, ale autoritativní je
součet: rezervace je zaplacená, když `SUM(platby.castka_hal WHERE stav='zaplacena') >= k_uhrade_hal`.
Tím se bez dalšího zařizování řeší doplatky, částečné platby a kombinace poukaz + převod.
Přeplatek se označí a nabídne se refundace nebo převedení na jinou rezervaci.

**Co má obsluha v detailu rezervace a v seznamu nezaplacených:**
- „Poslat QR platbu e-mailem“ — šablona `platba_se_nezdarila` s QR kódem **v těle e-mailu
  i jako příloha** (některé klienty obrázky blokují, PNG v příloze projde vždy).
- „Poslat nový odkaz na bránu“ — nová transakce + e-mail s odkazem.
- „Označit jako zaplaceno“ — dialog s volbou způsobu (převod / hotovost / karta na místě /
  jiné) a povinnou poznámkou. Zapíše se jako samostatná platba, ne jen příznak, takže
  účetní vidí, čím zákazník zaplatil.
- „Zkontrolovat stav u Mo.one“ — ruční dotaz na status API, hodí se u nejasných stavů.

**Dashboard — sekce „K prošetření“** sdružuje tři věci, které obsluha musí vidět hned:
nezaplacené po `drzeni_do`, platby selhané na bráně a stavy `InvestigationNeeded`
nebo neshodu částky z Mo.one.

### 6.9 Modul „Ke schválení“ (akceptační testování)

Doplněno 27. 9. 2026, po fázi 1.

Nová verze se nasazuje nejdřív na test a do `main` jde až po odsouhlasení. Aby bylo
z čeho odsouhlasit, má administrace na testu modul, který drží zadání testů a jejich
výsledky. **V produkci modul neexistuje** — router se nenamontuje (`config.akceptaceZapnuta`,
tedy `PROSTREDI ≠ produkce`), `/ja` hlásí `akceptace: false` a administrace ho ani neukáže.

- **Zadání je v repozitáři**, ne v databázi: `docs/akceptace/<faze>.yml`. Patří ke commitu
  se změnou kódu a při startu aplikace se naimportuje.
- **Import je idempotentní**, páruje se podle `kod` úkolu. Změněné zadání se aktualizuje
  a orazítkuje `zmeneno_at` (tester pak vidí, že testoval starší verzi), vyřazený úkol
  se zhasne (`aktivni = 0`). Výsledky testerů se nikdy nemažou.
- **Výsledek má každý tester vlastní** (`akceptace_vysledky`, unikát ukol+uživatel):
  funguje / nefunguje / nerozumím zadání + komentář + přílohy. U „nefunguje“ je komentář
  povinný. Souhrnný stav úkolu určuje nejhorší výsledek.
- **Po opravě** vrátí provoz nebo admin úkol do stavu `k_pretestovani`, hromadně i jednotlivě.
- **Schválení** může jen admin a jen když všechny úkoly fungují a hlášení jsou vyřízená;
  jinak API vrátí 409 se seznamem důvodů. Schválení se zapisuje do auditu, souhrn se dá
  stáhnout jako Markdown do `docs/akceptace/`.
- **Hlášení problému** je na každé obrazovce administrace; adresu, prohlížeč, rozlišení
  a přihlášeného člověka sbírá samo.
- **Přílohy** (PNG/JPEG/WebP do 6 MB) jdou do volume `uploads`, v databázi je jen cesta.
  Typ se pozná z obsahu souboru. Servírují se přes API za přihlášením, ne staticky.
  Zpracování obrázků (sharp, WebP, EXIF) přijde s galerií ve fázi 5.
- **Role `tester`** vidí jen tenhle modul a svoje výsledky — ne, jak hlasovali ostatní.

---

## 7. Migrace fotek ze starého webu

`scripts/import-fotek.js`:
1. Sesbírá adresy ze tří zdrojů: (a) seznamy v dnešním `data.js` (`image/eshop`, `image/gallery`, `image/member`, `image/news`, `image/carousel`), (b) HTML stránek starého `www.lsd-trip.cz` — vytáhne všechny `/image/…` odkazy, (c) volitelně ručně doplněný seznam v `scripts/fotky-navic.txt`.
2. Stáhne s omezením souběhu (3), respektuje `Retry-After`, ukládá `zdroj_url` a `hash_sha256` → opakovaný běh nic nezduplikuje.
3. `sharp`: odstranění EXIF (včetně GPS), WebP v šířkách 320 / 800 / 1600 + zachování originálu, zápis do `soubory`.
4. Přiřadí: `image/member/*` → `tym.soubor_id` podle jména v mapování, `image/news/*` → `aktuality`, `image/gallery/*` → album „Archiv“, `image/eshop/*` → `produkt_fotky`.
5. Vypíše přehled: stáhnuto / přeskočeno / selhalo + seznam nespárovaných, ať se dá dokončit ručně.
6. Po ověření přepíše odkazy v `bloky` a `produkty` z `https://www.lsd-trip.cz/image/...` na `/uploads/...` — a teprve pak se z CSP smaže `https://www.lsd-trip.cz`.

Skript je idempotentní a spustitelný na VPS: `docker compose exec app node scripts/import-fotek.js`.

---

## 8. SEO, indexace a AI vyhledávání

Cíl není jen Google, ale i to, aby se spolek správně objevoval v odpovědích AI asistentů.
Ty čtou HTML bez JS a mají rády strukturovaná data — proto SSR (6.6) a všechno níže.

### Meta tagy — editovatelné, s rozumným výchozím stavem
Každá stránka v tabulce `stranky`: `seo_title` (max 60 znaků, v administraci s počítadlem),
`seo_description` (max 155), `og_soubor_id`. Když je pole prázdné, poskládá se automaticky
z obsahu stránky (H1 + perex + název spolku), takže **nikdy nevznikne stránka bez title**.
`canonical` a OG `url` se skládají z `APP_URL`, nikdy z `Host` hlavičky (ochrana před
podvrženými canonical adresami).

### Strukturovaná data JSON-LD
| Typ | Kde | Z čeho |
| --- | --- | --- |
| `Organization` | všude v `<head>` | nastavení spolku (název, IČO, logo, telefon, sociální sítě) |
| `SportsActivityLocation` | `/` a `/kontakt` | letiště Jihlava–Henčov: adresa, GPS, `openingHoursSpecification` ze sezóny a časů startů, telefon |
| `Product` + `Offer` | detail produktu | cena, měna, dostupnost, `priceValidUntil` |
| `Event` (`SportsEvent`) | `/kalendar` a detail termínu | datum, čas, místo, kapacita, cena, `eventStatus` (včetně `EventCancelled` u zrušených kvůli počasí) |
| `FAQPage` | `/faq` | tabulka `faq` |
| `BreadcrumbList` | podstránky | z routeru |
| `ImageObject` | galerie | alt texty a rozměry |

Zrušení kvůli počasí se tak propíše i do vyhledávačů jako `EventCancelled` — ne že
by tam zůstal termín, který se nekoná.

### `robots.txt`, `sitemap.xml`, `llms.txt`
- **`sitemap.xml`** generovaná z DB (statické stránky + produkty + termíny + albumy),
  `lastmod` z `updated_at`, cache 1 h. Zrušené a skryté termíny v ní nejsou.
- **`robots.txt`** podle `ROBOTS` v `.env`. V produkci **výslovně povoluje** AI crawlery,
  protože některé respektují jen explicitní pravidlo:
  `GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `ClaudeBot`, `Claude-User`, `PerplexityBot`,
  `Google-Extended`, `Applebot-Extended`, `CCBot`, `Bytespider`, `meta-externalagent`.
  Zakázané zůstává `/admin` a `/api/admin`.
- **`/llms.txt`** — strukturovaný souhrn pro jazykové modely: kdo spolek je, co nabízí,
  aktuální ceny, kde se skáče, sezóna, limity (věk, váha), jak rezervovat, kontakt,
  odkazy na klíčové stránky. Generuje se **z DB**, takže po změně ceníku nezůstane zastaralý.
- Test: `ROBOTS=zakazat` → `Disallow: /` + hlavička `X-Robots-Tag: noindex, nofollow`.

### 301 přesměrování ze starého webu
Starý web je OpenCart-like s adresami typu
`/e-shop/kategorie:tandemove-seskoky/produkt:tandemovy-seskok`. Postup:
1. Skript `scripts/stahni-stare-url.js` posbírá adresy ze `sitemap.xml` starého webu,
   z interních odkazů a z Wayback Machine (`web.archive.org/cdx` API), ať se najdou i stránky,
   na které už nikdo neodkazuje.
2. Vznikne `docs/301-mapa.csv` (stará URL → nová URL → jak jsem se rozhodl) **k tvé kontrole**.
   Automatika navrhne, ruční rozhodnutí zůstává na tobě — u nejednoznačných případů je
   lepší přesměrovat na kategorii než na špatný produkt.
3. Mapa se nasadí jako tabulka `presmerovani` (stara_cesta UNIQUE, nova_cesta, typ 301/410,
   pocet_pouziti, editovatelná v administraci) — přidání dalšího přesměrování pak nevyžaduje deploy.
4. Cokoli nenamapované vrátí vlastní 404 s odkazy na kalendář a hlavní produkty, ne prázdnou stránku.

Tohle bude fungovat až po převodu domény — do té doby je mapa připravená a otestovaná.

### Výkon (Core Web Vitals)
- SSR = obsah v první odpovědi, LCP bez čekání na JS.
- Obrázky: WebP + `srcset` ve třech šířkách (320/800/1600), `width`/`height` proti CLS,
  `loading="lazy"` kromě hero obrázku, ten má `fetchpriority="high"` (už to tak je).
- `Cache-Control: public, max-age=31536000, immutable` na `/uploads/*` (názvy obsahují ID),
  krátká cache na HTML.
- Fonty: `preconnect` už je, přidám `font-display: swap` a preload jednoho řezu.
- Žádná JS knihovna → ~15 kB skriptu celkem.

---

## 9. Resend — DNS záznamy

**Odesílací doména: `lsd.francik.eu`** (DNS spravuješ ty). Odesílací adresa i doména jsou
v `.env`, takže pozdější přepnutí na `lsd-trip.cz` znamená ověřit novou doménu v Resendu
a změnit dvě proměnné — žádný zásah do kódu.

V Resendu přidej domain **`lsd.francik.eu`** a vyber region **EU (Ireland)** kvůli GDPR.
Resend pak vypíše tyto čtyři záznamy (DKIM hodnotu zkopíruj z dashboardu, je unikátní):

| # | Typ | Název (host) | Hodnota | Priorita | TTL |
| --- | --- | --- | --- | --- | --- |
| 1 | `MX` | `send.lsd.francik.eu` | `feedback-smtp.eu-west-1.amazonses.com` | `10` | 3600 |
| 2 | `TXT` | `send.lsd.francik.eu` | `v=spf1 include:amazonses.com ~all` | – | 3600 |
| 3 | `TXT` | `resend._domainkey.lsd.francik.eu` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ…` ← **zkopírovat z Resend dashboardu** | – | 3600 |
| 4 | `TXT` | `_dmarc.lsd.francik.eu` | `v=DMARC1; p=none; adkim=r; aspf=r` | – | 3600 |

Na co si dát pozor:
- **MX hodnotu ověř proti tomu, co Resend zobrazí.** Pro US region je to
  `feedback-smtp.us-east-1.amazonses.com`. Musí souhlasit s vybraným regionem, jinak se
  ztratí bounce zprávy.
- **Záznam 1 a 2 jdou na subdoménu `send.`**, ne na `lsd.francik.eu` samotnou. Tvoje
  případná pošta na `lsd.francik.eu` nebo `francik.eu` se tím nijak nedotkne.
- Když už na `lsd.francik.eu` nějaký `TXT` se SPF je, **nesmí vzniknout druhý** — SPF záznam
  smí být jeden. Ale záznam 2 je na `send.lsd.francik.eu`, takže ke kolizi nedojde.
- **DMARC začneme na `p=none`** (jen reporty). Po dvou týdnech bez chyb přepneme na
  `p=quarantine`.
- **`rua=` zatím vynecháváme** (rozhodnuto 27. 9. 2026). DMARC funguje i bez něj,
  jen nechodí souhrnné reporty. Kdyby se později hodily, adresa musí být na doméně,
  kterou spravuješ (`francik.eu`), ne na Gmailu: pro adresu na cizí doméně vyžaduje
  DMARC (RFC 7489, § 7.1) autorizační záznam u té domény
  (`lsd.francik.eu._report._dmarc.gmail.com`), který u Gmailu nezaložíš — většina
  odesílatelů by reporty stejně neposlala.
- Když přidáš i `DKIM` pro doménu `francik.eu` jinde, tyhle záznamy s tím nekolidují —
  selektor `resend` je unikátní.
- **Na testu žádné DNS nepotřebuješ.** Test posílá přes tentýž Resend a tutéž doménu, ale
  všichni příjemci se přepíšou na `EMAIL_TEST_PRIJEMCE`.

Po nastavení pošlu výpis `dig` pro všechny čtyři záznamy a testovací e-mail, ať je vidět,
že DKIM i SPF projdou (`Authentication-Results: dkim=pass spf=pass dmarc=pass`).

### Šablony, které připravím
`rezervace_prijata`, `vyzva_k_platbe` (s QR), **`platba_se_nezdarila`** (QR v těle i v příloze),
`platba_prijata` (+ faktura v příloze), `pripominka_termin` (X dní předem, X z nastavení),
`termin_zrusen_pocasi` (+ nabídka přesunu), `termin_presunut`, `poukaz_vystaven` (+ PDF),
`podekovani_po_seskoku` (odkaz na fotky a recenzi), `odpoved_na_poptavku`,
`reset_hesla` (interní), `newsletter_potvrzeni` (double opt-in).

---

## 10. Pořadí implementace

Každá fáze = migrace + API + UI + testy + README, odzkoušené lokálně, nasazené na `test`.
Po každé fázi dostaneš seznam, co otestovat. Do `main` nic bez tvého souhlasu.

| Fáze | Obsah | Migrace |
| --- | --- | --- |
| **1** | Testovací prostředí (workflow, compose, Caddy podklady). Zabezpečení: helmet, CSP, rate limit, limity těla. Přihlášení (argon2, session v DB, CSRF, reset hesla, 2FA volitelně), uživatelé, role, audit log, nastavení. Zabezpečení `/api/poptavky` → `/api/admin/poptavky`. Skelet `/admin` + dashboard s prázdnými kartami. Modul **Ke schválení** (akceptační testování, jen mimo produkci) včetně zadání pro fázi 1. | `002`, `003`, `004` |
| **2** | DPH (3 režimy), produkty, varianty, příplatky, historie cen. Místa, termíny, kalendář, hromadné vytváření, kopie dne, zrušení kvůli počasí (bez e-mailů). Obsah: stránky, bloky, navigace, FAQ, tým, aktuality, banner. **Veřejný web: SSR + normální URL + napojení na DB** (vizuál bit za bitem stejný) a k tomu celé SEO ze sekce 8 — meta, JSON-LD, sitemap, robots, `llms.txt`, mapa 301. | `005`, `006` |
| **3** | Zákazníci, rezervace (transakční kapacita), ruční rezervace, přesun, storno, manifest (tisk + CSV + PDF). Napojení `#/booking`. Resend: šablony, render, log, webhooky, hromadný e-mail účastníkům termínu, automatika u zrušení kvůli počasí. | `007`, `008` |
| **4** | Platby: převod + QR (SPAYD) + VS, **brána Mo.one**, **záložní tok při selhání brány** (QR na návratové stránce, držení místa 48 h, `k_proseteni`), víc plateb na rezervaci a doplatky, ruční označení zaplaceno se způsobem platby, refundace. Fakturace: číselné řady, zálohy, faktury, dobropisy, **rekapitulace DPH po sazbách včetně osvobozených položek**, PDF, automatické vystavení po zaplacení, export pro účetní rozdělený podle režimu DPH. Dárkové poukazy (jedno/víceúčelové) včetně PDF a uplatnění. | `009`, `010` |
| **5** | Galerie: upload (drag & drop, mobil), sharp → WebP + náhledy, EXIF, alba, řazení, alt. **Migrace fotek ze starého webu** a odstřihnutí `www.lsd-trip.cz`. Dokončení SEO a OG obrázků. | `011` |
| **6** | Dashboard naostro (obsazenost, nezaplacené, po splatnosti, tržby), reporty, kartotéka zákazníků, GDPR export a anonymizace, zálohy + cron + healthcheck, **newsletter** (formulář, double opt-in, rozesílání, odhlášení). | `012` |

### Testy (node:test, proti testovací DB)
- Kapacita: 20 paralelních rezervací na 5 míst → přesně 5 uspěje, žádné přebookování.
- Přesun a částečné storno nemění součet obsazenosti nekonzistentně.
- Platba → faktura → e-mail: webhook 2× se stejným `externi_id` vystaví jednu fakturu a pošle jeden e-mail.
- Mo.one: podvržený návrat `?status=success` **nezaplatí** rezervaci (status API řekne `Fail`); webhook s nesouhlasící částkou skončí ve stavu `k_proseteni` a nevystaví doklad; ztracený webhook dohoní periodická kontrola.
- Poukaz: dvojí uplatnění téhož kódu selže; hodnotový poukaz odečte správně a zbytek zůstane.
- Číselná řada: 50 paralelních dokladů → 50 unikátních čísel bez děr.
- Autorizace: každý admin endpoint bez session vrací 401, s cizí rolí 403, bez CSRF tokenu 403.
- Akceptace: v produkci (`PROSTREDI=produkce`) vrací `/api/admin/akceptace` 404, ne 401 — modul tam neexistuje. Opakovaný import zadání nezduplikuje úkoly a nesmaže výsledky testerů.
- `EMAIL_REZIM=test` nikdy neodešle na jinou adresu než `EMAIL_TEST_PRIJEMCE`.
- V `src/` ani `public/` není natvrdo napsaná doména (`lsd.francik.eu`, `lsd-trip.cz`) — vše z `APP_URL`.
- SSR vrací kompletní obsah bez JS: `curl` na každou routu obsahuje H1, perex a JSON-LD (test proti crawlerům).
- Faktura se třemi režimy DPH (21 % + 12 % + osvobozeno) má správnou rekapitulaci a součet.
- Změna sazby u produktu nezmění už vystavený doklad.

---

## 11. Rozhodnutá zadání (schváleno 27. 9. 2026)

| # | Téma | Rozhodnutí |
| --- | --- | --- |
| 1 | Prostředí | `lsd.francik.eu` = **produkce** (`main`), `test-lsd.francik.eu` = **test** (`test`). Obě zatím na testovací Mo.one. Vyvíjí se jen do `test`, do `main` se slučuje po schválení. Volumes výslovně `lsd_main_*` / `lsd_test_*`. |
| 2 | Domény bez zásahu do kódu | Všechny absolutní URL z `APP_URL` v `.env`. Test hlídá, že v kódu není natvrdo napsaná doména. Checklist přechodu v README. |
| 3 | Platební brána | **Mo.one** (`docs/moone-platebni-brana.pdf`), návrh v 6.7. Stav vždy z status API, webhook je jen spouštěč. |
| 4 | Selhání brány | Návratová stránka hned nabídne **QR platbu** i „zkusit znovu“. Držení místa **48 h** (nastavitelné), pak `k_proseteni`, **nikdy automatické storno**. Víc plateb na rezervaci, doplatky, ruční zaplaceno se způsobem platby. Dashboard „K prošetření“. E-mail `platba_se_nezdarila` s QR v těle i v příloze. |
| 5 | SEO a AI | **SSR + normální URL** (history API) ve fázi 2 spolu s napojením na DB. JSON-LD, sitemap, robots s výslovným povolením AI crawlerů, `/llms.txt` z DB, mapa 301 ze staré domény, WebP + srcset. Detaily v sekci 8. |
| 6 | DPH | Plátce. Výchozí **21 %**, nastavitelně u každého produktu: 21 %, 12 %, **osvobozeno § 61 písm. d)**. Jedna faktura zvládne víc režimů + rekapitulaci po sazbách. Zatím vše 21 %, přepnutí bez zásahu do kódu a **jen pro nové doklady**. Produktový poukaz = jednoúčelový (DPH při prodeji), hodnotový = víceúčelový (DPH při uplatnění). Export pro účetní rozdělený podle režimu. |
| 7 | Netlify | `netlify.toml` a `.netlify/` **smazat** (fáze 1). |
| 8 | Resend | Odesílací doména zatím **`lsd.francik.eu`**, adresa i doména z `.env`. DNS záznamy v sekci 9. |
| 9 | Newsletter | **Ano**, fáze 6, s double opt-in. |
| 10 | Role | **admin, provoz, instruktor**. `ucetni` zůstává v `ENUM` a v matici oprávnění pro pozdější přidání. |
| 11 | Návrh | **Návrh 1 — tmavý** (`public/`). Administrace používá jeho design tokeny. |

### Předpoklady k ověření u daňového poradce (ne blokující)
Tvůj odhad, se kterým souhlasím, ale potvrdit ho musí účetní nebo daňový poradce:
- **výcvik a letenky pro parašutisty** → pravděpodobně osvobozeno § 61 písm. d) (služby úzce související se sportem poskytované neziskovou organizací),
- **tandemový seskok** → 21 % (jde o zážitek pro veřejnost, ne o sportovní činnost člena),
- **kamerový záznam a fotografie** → 21 %.

Do potvrzení je **všechno nastavené na 21 %**. Přepnutí je změna sazby u produktu
v administraci a projeví se jen na nově vystavených dokladech.

### Co ještě potřebuji od tebe (nic z toho neblokuje fázi 1)
- `EMAIL_TEST_PRIJEMCE` — adresa, na kterou mají chodit e-maily z testu.
- Jména a e-maily pro roli `provoz` a `instruktor`. Do té doby vytvořím jen účet pro majitelku (`admin`) a skript, kterým se další účty zakládají jedním příkazem.
- Resend API klíč (fáze 3; klíč se hodí dřív kvůli ověření domény).
- Před fází 4: DIČ a fakturační údaje spolku, testovací `MOONE_CLIENT_ID` / `MOONE_CLIENT_SECRET`, potvrzení base URL u Mo.one, lhůta splatnosti a storno podmínky.
- Před fází 5: potvrzení, že fotky ze starého webu můžeme převzít (autorská práva).
