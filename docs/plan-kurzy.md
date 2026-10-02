# Modul Kurzy — schválené zadání

Stav: **schváleno 1. 10. 2026**, implementuje se po etapách E1–E5.
Navazuje na [plan-administrace.md](plan-administrace.md) — tenhle dokument nic
z něj nenahrazuje, jen zužuje na kurzy a doplňuje, co tam chybělo.

---

## 1. Východisko: nový datový model se nepíše

Model schválený v [plan-administrace.md](plan-administrace.md) §3.2–3.4 kurzy
**už pokrývá** — `produkty.typ` má mezi hodnotami `'kurz'`. Nevzniká tabulka
`kurzy`. Kurz je řádek v `produkty`, termín kurzu řádek v `terminy`, přihláška
řádek v `rezervace`.

| Požadavek na modul | Kde v modelu už je |
| --- | --- |
| věk, max. váha | `produkty.min_vek`, `max_vek`, `max_vaha_kg` |
| lékařská prohlídka, zdravotní prohlášení | `produkty.vyzaduje_lekarskou_prohlidku`, `vyzaduje_zdravotni_prohlaseni` |
| souhlas zástupce do 18 | `produkty.souhlas_zastupce_do_let` |
| co je v ceně | `produkty.co_je_v_cene` |
| DPH osvobozeno / 21 % | `dph_sazby` (`osvobozeno61d`) + `produkty.dph_sazba_id` |
| aktivní/skrytý, pořadí | `produkty.aktivni`, `poradi` |
| fotky | `produkt_fotky` + `soubory` |
| termíny, kapacita, stav | `terminy.stav ENUM('otevreno','plno','zruseno','probehlo')` |
| stav přihlášky | `rezervace.stav` (`nova`/`potvrzena`/`zaplacena`/`storno` jsou podmnožina) |
| soupiska k tisku | `GET /terminy/:id/soupiska` |

**Jediná nová tabulka proti plánu: `produkt_kroky`** (průběh kurzu krok za krokem).
`produkt_pozadavky` je checklist „co si vzít a doložit“, ale „jak kurz probíhá“
nemělo kam. Je to přesně tvar, který dnes má natvrdo `TANDEM_STEPS` v `data.js`,
takže ji později využije i tandem.

Proti plánu se naopak **zatím nezavádí** `varianty` a `priplatky` (kurzy je
nepotřebují, přijdou s tandemem) a u `terminy` chybí `kapacita_instruktoru`
a `sloty_letadla` — u kurzů nedávají smysl a doplní se později `ADD COLUMN`.

---

## 2. Migrace 008–012

Všechny tabulky zavádí tatáž verze, která je používá, takže platí výjimka
z pravidla expand/contract v [CLAUDE.md](../CLAUDE.md): **žádný `DROP`, žádný
zápis do `ODEBRANI_SCHVALENA`.** Idempotence: `CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, číselníky přes `INSERT … ON DUPLICATE KEY UPDATE`.
Peníze `INT` v haléřích (`_hal`), mazání měkké (`smazano_at`), auditované tabulky
mají `created_at`, `updated_at`, `vytvoril_id`, `upravil_id`.

**Čas:** `terminy.datum` + `cas_od`/`cas_do` jsou hodiny na letišti (`DATE`+`TIME`,
bez zóny). Všechno ostatní jsou okamžiky → `DATETIME` v UTC, zobrazení přes
`src/cas.js`. Viz [plan-administrace.md §6.3](plan-administrace.md).

### `008_produkty_a_cenik.sql`
```
dph_sazby          id, kod UNIQUE, nazev, procento DECIMAL(5,2),
                   rezim ENUM('standardni','osvobozeno'), pravni_text NULL,
                   vychozi, aktivni, poradi
                   -- seed: zakladni21 (výchozí), snizena12, osvobozeno61d
produkty           id, typ ENUM('tandem','kurz','expedice','helitour','poukaz','jine'),
                   slug UNIQUE, nazev, podtitul, stitek, perex,
                   popis MEDIUMTEXT, co_je_v_cene TEXT,
                   cena_hal INT NULL, cena_na_dotaz TINYINT(1) DEFAULT 0,
                   dph_sazba_id, min_vek, max_vek NULL, max_vaha_kg NULL,
                   souhlas_zastupce_do_let NULL,
                   vyzaduje_lekarskou_prohlidku, vyzaduje_zdravotni_prohlaseni,
                   delka_text, uroven_text, seo_title, seo_description,
                   aktivni, poradi, smazano_at, +audit
                   KEY (typ, aktivni, poradi)
produkt_pozadavky  id, produkt_id, text, poradi
produkt_kroky      id, produkt_id, cislo, nadpis, text, poradi        -- NOVÁ
cenik_historie     id, entita, entita_id, cena_hal_pred NULL, cena_hal_po,
                   duvod, uzivatel_id, created_at
                   KEY (entita, entita_id, created_at)
```

### `009_soubory_a_fotky.sql`
```
soubory            id, kod UNIQUE, cesta UNIQUE, puvodni_nazev, mime, velikost_b, sirka, vyska,
                   varianty JSON, alt, zdroj ENUM('upload','import'), zdroj_url NULL,
                   hash_sha256 CHAR(64), nahral_id, smazano_at, created_at
                   KEY (hash_sha256)
produkt_fotky      produkt_id, soubor_id, poradi, titulni    PK (produkt_id, soubor_id)
```

### `010_soubory_kod.sql` (doplněno po E2)
```
soubory.kod CHAR(24) UNIQUE   -- náhodný kód do veřejné adresy /media/<kod>
```
Pořadové číslo v adrese se dalo projít po řadě, a tím i prohlédnout fotky
kurzu, který ještě není zveřejněný. Ve stejné dávce přibylo zmenšování na
1600 px pro web (`sharp`, sloupce `sirka`/`vyska`/`varianty` už z `009`) —
proto má E3 migraci `011`, ne `010`.

### `011_mista_a_terminy.sql`
```
mista              id, nazev, adresa, gps_lat, gps_lon, poznamka, aktivni,
                   poradi, smazano_at, +audit
termin_serie       id, nazev, pravidlo JSON, vytvoril_id, created_at
terminy            id, produkt_id, serie_id NULL, nazev_prepis NULL,
                   datum DATE, cas_od TIME NULL, cas_do TIME NULL,
                   popis_casu VARCHAR(100), misto_id,
                   kapacita_mist INT, obsazeno_mist INT NOT NULL DEFAULT 0,
                   cena_hal_prepis NULL, popis TEXT,
                   stav ENUM('otevreno','plno','zruseno','probehlo') DEFAULT 'otevreno',
                   zruseno_duvod, zruseno_at, viditelny, smazano_at, +audit
                   KEY (datum, stav), KEY (produkt_id, datum)
termin_instruktori termin_id, uzivatel_id, role ENUM('tandem','aff','kamera','balic')
                   PK (termin_id, uzivatel_id, role)
```
`obsazeno_mist` je **cache pro výpisy**. Autoritativní je součet z `rezervace`
uvnitř transakce (§5), cache se přepočítá v téže transakci.

**Upřesněno při E3:** `kapacita_mist = 0` znamená bez omezení — kurz kapacitu má
vždycky, ale den otevřených dveří ne a vymyšlené číslo by bylo horší než jedna
domluvená nula. Včerejší a starší termíny přepíná hodinová údržba z „otevřeno“
na „proběhlo“; zrušených se to netýká. Místa i seznam lidí k přiřazení
(`GET /terminy/instruktori`) jdou pod právo `terminy`, aby si provoz vystačil
sám — na `uzivatele` právo nemá a bez toho by k termínu nikoho nepřiřadil.

### `012_zakaznici_a_prihlasky.sql`
```
zakaznici          id, email, jmeno, telefon, mesto, ulice, psc, ico NULL, dic NULL,
                   poznamka, gdpr_souhlas_at, marketing_souhlas_at,
                   anonymizovano_at NULL, smazano_at, created_at, updated_at
                   UNIQUE (email), KEY (telefon)
rezervace          id, kod VARCHAR(20) UNIQUE, zakaznik_id, termin_id NULL, produkt_id,
                   pocet_osob, zdroj ENUM('web','telefon','email','admin'),
                   stav ENUM('nova','potvrzena','zaplacena','probehla','storno',
                             'presunuta','no_show') DEFAULT 'nova',
                   cena_hal, sleva_hal, k_uhrade_hal, uhrazeno_hal,
                   splatnost DATE NULL, drzeni_do DATETIME NULL,     -- UTC
                   souhlas_vop_at, souhlas_gdpr_at, souhlas_zdravi_at,
                   interni_poznamka, storno_duvod, storno_at, smazano_at, +audit
                   KEY (termin_id, stav), KEY (zakaznik_id), KEY (stav, splatnost)
rezervace_polozky  id, rezervace_id, typ, entita_id, nazev_snapshot,
                   mnozstvi, cena_jed_hal, dph_procento, celkem_hal
rezervace_ucastnici id, rezervace_id, jmeno, vaha_kg, datum_narozeni NULL,
                   telefon, email, souhlas_zastupce, zdravotni_prohlaseni_at,
                   dorazil, poznamka
```
`nazev_snapshot` a `cena_jed_hal` v položkách jsou záměrné: po změně ceníku se
stará přihláška ani doklad nesmí přepočítat.

---

## 3. API

Cesty jsou **generické podle `typ`, ne kurzové** — kdyby bylo API kurzové, u tandemu
by se psalo podruhé. Obrazovka v administraci se přitom jmenuje `/admin/#/kurzy`;
filtr je věc UI.

### Veřejné
| Metoda | Cesta | Poznámka |
| --- | --- | --- |
| GET | `/api/produkty?typ=kurz` | přehled: perex, cena, štítek, titulní foto, nejbližší termín, volná místa |
| GET | `/api/produkty/:slug` | detail: popis, co je v ceně, průběh, požadavky, fotky, termíny |
| GET | `/api/terminy?typ=kurz&od=&do=&volna=1` | termíny s volnými místy |
| GET | `/api/terminy/:id` | detail termínu |
| POST | `/api/prihlasky` | transakčně, rate limit, honeypot; vrací `kod` |
| GET | `/api/prihlasky/:kod?t=<podepsaný token>` | účastník vidí svou přihlášku |

Veřejné odpovědi **nikdy nevracejí osobní údaje** — u termínu jde ven jen počet
volných míst, ne jména. Stejná zásada jako dnes v `src/api/verejne.js`.

### Administrace (`/api/admin/*`, session + CSRF + role)
| Skupina | Endpointy |
| --- | --- |
| Produkty | `GET/POST /produkty?typ=kurz`, `GET/PATCH/DELETE /produkty/:id`, `POST /produkty/poradi`, `…/pozadavky`, `…/kroky`, `…/fotky`, `GET /produkty/:id/cenik-historie` |
| DPH | `GET/POST/PATCH /dph-sazby` |
| Soubory | `POST /soubory` (multipart), `GET /soubory?q=`, `PATCH /soubory/:id` (alt), `DELETE /soubory/:id` |
| Termíny | `GET /terminy?typ=kurz&od=&do=&stav=`, `POST /terminy`, `POST /terminy/hromadne`, `POST /terminy/:id/kopie`, `PATCH /terminy/:id`, `POST /terminy/:id/zrusit`, `GET /terminy/:id/soupiska`, `GET /terminy/:id/soupiska.csv`, `POST /terminy/:id/email` |
| Přihlášky | `GET /rezervace?typ=kurz&stav=&termin=&q=`, `POST /rezervace`, `GET/PATCH /rezervace/:id`, `POST /rezervace/:id/stav`, `POST /rezervace/:id/storno`, `POST /rezervace/:id/poznamka`, `GET /rezervace/export.csv` |

**Konvence:** seznamy `?strana=&na_strane=&q=&razeni=`, odpověď
`{ data, celkem, strana }`, validace `zod` u těla i query, chyby
`{ chyba, detaily }` česky a rovnou zobrazitelné.

**Role** podle matice v [plan-administrace.md §4](plan-administrace.md): produkty
a ceník admin zapisuje / provoz čte, termíny admin + provoz, přihlášky admin +
provoz, soupiska i instruktor.

---

## 4. Obrazovky

### Administrace
Vše ovladatelné z mobilu podle zásad v [plan-administrace.md §5](plan-administrace.md).

| Cesta | Co |
| --- | --- |
| `/admin/#/kurzy` | seznam, přetahování pořadí, přepínač aktivní/skrytý, cena, počet termínů |
| `/admin/#/kurz/:id` | karta po sekcích: **Texty** · **Cena a DPH** · **Požadavky** · **Průběh** · **Fotky** · **Termíny** · **Historie cen** |
| `/admin/#/kurz/:id/terminy` | termíny kurzu: datum, čas, kapacita, obsazenost, stav |
| `/admin/#/terminy/nove` | jednotlivě i hromadně (rozsah dat, dny v týdnu, kopie dne) |
| `/admin/#/termin/:id` | detail: soupiska přihlášek, kapacita, instruktoři, zrušení s důvodem |
| `/admin/#/termin/:id/soupiska` | **tisková soupiska** (print CSS) |
| `/admin/#/prihlasky` | seznam: filtr stav / termín / fulltext |
| `/admin/#/prihlaska/:id` | detail: účastníci, souhlasy, stav, poznámky, odeslané e-maily |

**Soupiska obsahuje:** jméno, váhu, věk, telefon, stav platby, „doloží lékařskou
prohlídku“, „zajistí souhlas zástupce“. Účastníci **mimo limit věku nebo váhy jsou
zvýraznění** — provoz to na místě musí vidět na první pohled.

### Veřejná část
| Cesta | Co | Dnes |
| --- | --- | --- |
| `/kurzy` | přehled kurzů z API | hotovo v E4 (ze serveru) |
| `/kurz/:slug` | **detail kurzu** — popis, co je v ceně, průběh, požadavky, fotky, termíny, cena | hotovo v E4 (ze serveru) |
| `/termin/:id` | detail termínu + přihláška | je, z `data.js` |
| `/prihlaska` | formulář: účastníci, kontakt, souhlasy, rekapitulace | dnes končí poptávkou |

### E-maily
Přes `src/email/posli.js`, lokálně i na testu `EMAIL_REZIM=schranka` → ven nic nejde.
Šablony v databázi, texty editovatelné majitelkou — nic natvrdo.

`prihlaska_prijata` (účastníkovi) · `prihlaska_provoz` (na `provoz.email`
z nastavení) · `prihlaska_potvrzena` · `prihlaska_zrusena`.

---

## 5. Etapy

Každá etapa = migrace + API + UI + testy + README, odzkoušené lokálně, nasazené
na `test`. Po každé etapě jde majitelce seznam, co projít. **Do další etapy až po
jejím potvrzení. Do `main` nic bez výslovného souhlasu.**

| # | Obsah | Migrace |
| --- | --- | --- |
| **E1** | DPH číselník + kurzy v administraci: texty, cena, DPH, požadavky, průběh, aktivní/skrytý, pořadí, historie cen. Veřejný web beze změny. | `008` |
| **E2** | Fotky: `soubory` + `produkt_fotky`, upload z mobilu, alt texty, titulní foto. Hlídač natvrdo napsaných domén nad `public/` se **přepne z varování na tvrdý assert** — viz poznámku pod tabulkou. | `009` |
| **E3** | Místa + termíny kurzů: kapacita, stav, hromadné vytvoření, kopie dne, zrušení s důvodem, instruktoři. Soupiska zatím prázdná. | `011` |
| **E4** | **Veřejná část kurzů z API** + **SSR pilot** pro `/kurzy` a `/kurz/:slug` (normální URL). Titulka bere kurzy z databáze. Odstřiženo `COURSES`, `COURSE_CHECKLIST` i termíny kurzů z `data.js`. | — |
| **E5** | Přihlášky: zákazníci, transakční kapacita, veřejný formulář, e-maily, stavy, soupiska naostro, export CSV. | `012` |

**SSR a poptávka (upřesněno při E4).** Stránky `/kurzy` a `/kurz/:slug` vykresluje
server; zbytek webu zůstává na `#` adresách. Skořápka se nepíše podruhé — bere se
`public/index.html` a server do `<html>` přidá `data-stranka`, podle čeho aplikace
pozná, že obsah už je vykreslený, a nepřepíše ho. Odkazy jsou obyčejné odkazy, takže
zpět, dopředu i nový panel fungují samy a není co hydratovat.

Tlačítko „Mám zájem" na stránce kurzu končí **poptávkou** přímo tam, ne odskokem do
průvodce na titulce: průvodce je stavěný na termín z `data.js` a kurz do něj nepatří.
Do zprávy jde kurz i vybraný termín, takže provoz vidí, o co jde. Přihlášky s vlastními
sloupci přijdou v E5.

Kalendář na webu zůstává tandemový (`data.js`); termíny kurzů jsou na stránce kurzu
a v seznamu „Nejbližší termíny" na titulce, kam se slučují s tandemovými dny. Celý
kalendář z databáze patří k tandemovému modulu, ne do modulu kurzů.

**Hlídač domén nad `public/` (upřesněno při E2).** Úplně prázdný být ještě nemůže:
třináct zbylých adres jsou fotky na titulce (hero, produkty, aktuality, tým, galerie)
a kontaktní e-mail, a ty se stěhují až ve fázi 5 („Migrace fotek ze starého webu",
[plan-administrace.md §7](plan-administrace.md)). Hlídač je proto **západka**:
v `test/bezpecnost.test.js` je vyjmenovaný seznam toho, co tam dnes je, a cokoli
dalšího test shodí. Není to výjimka pro celé soubory — nová natvrdo napsaná doména
se do webu nedostane. Jak budou fotky ubývat, seznam se bude zkracovat; až bude
prázdný, zůstane z testu totéž co u `src/`.

### Transakce u kapacity (E5)
```sql
START TRANSACTION;
SELECT kapacita_mist, stav FROM terminy WHERE id = ? FOR UPDATE;
SELECT COALESCE(SUM(pocet_osob),0) FROM rezervace
  WHERE termin_id = ? AND stav IN ('nova','potvrzena','zaplacena','probehla')
    AND smazano_at IS NULL;
INSERT INTO rezervace ...;  INSERT INTO rezervace_polozky ...;
UPDATE terminy SET obsazeno_mist = ?, stav = IF(? >= kapacita_mist,'plno',stav) WHERE id = ?;
COMMIT;
```

### Testy k modulu
- 20 souběžných přihlášek na 5 míst → projde přesně 5, žádné přebookování.
- Zrušený ani proběhlý termín nejde přihlásit.
- Přihláška pod `EMAIL_REZIM=schranka` neodešle nic ven.
- Změna ceny kurzu nepřepíše už uloženou přihlášku (`nazev_snapshot`, `cena_jed_hal`).
- Každý admin endpoint: bez session 401, s cizí rolí 403, bez CSRF tokenu 403.
- Termín uložený v databázi se zobrazí ve stejný den i přes přechod letního času.
- Účastník nad limitem váhy/věku se uloží, ale je označený (nesmí projít tiše ani být odmítnut).
- SSR (E4): `curl` na `/kurzy` i `/kurz/:slug` vrátí H1, perex a JSON-LD bez JavaScriptu.

---

## 6. Rozhodnutí (schváleno 1. 10. 2026)

| # | Téma | Rozhodnutí |
| --- | --- | --- |
| 1 | SSR | **Ano**, pilot pro `/kurzy` a `/kurz/:slug` v E4. Kurzy jsou obsah, který má být k nalezení, a AI crawlery JavaScript nespouštějí. |
| 2 | Časová zóna | **UTC** podle migrace `005` a `CLAUDE.md`. §3 a §6.3 v [plan-administrace.md](plan-administrace.md) opraveny. |
| 3 | Věk a váha | Přihlášku **pustit dál s varováním**, rozhodnutí na provozu. Na soupisce zvýraznit. |
| 4 | Lékařská prohlídka, zdravotní prohlášení | **Papírově na místě.** V přihlášce jen zaškrtnutí „doložím“, sloupec na soupisce. Žádné nahrávání zdravotních údajů. |
| 5 | Souhlas zástupce | Zaškrtnutí „zajistím písemný souhlas“ + příznak na soupisce, provoz kontroluje na místě. |
| 6 | DPH | Všechno **21 %**, sazba `osvobozeno61d` připravená v číselníku. Přepnutí = změna u produktu, bez zásahu do kódu, jen pro nové doklady. |
| 7 | Zrušený termín | Přihlášky **zůstanou**, odejde e-mail o zrušení, **přesun dělá provoz ručně**. Žádný automatický přesun. |
| 8 | Platby | V tomhle modulu **nejsou** (fáze 4). Stav `zaplacena` nastavuje provoz ručně. |
| 9 | Jiné druhy kurzů | Nejsou — všechny se vejdou do schématu výše. Nový kurz = řádek v `produkty`, žádná změna kódu. |
| 10 | Titulka | Vyřešena samostatnou dávkou před E1 (proběhlé termíny, průvodce končící poptávkou, čitelný eyebrow). |

### Co je potřeba od majitelky
- **Fotka kurzu IAFF** místo `carousel/1652266303_1_image_28350.jpg` — ta dnešní má
  v sobě vypálenou cenu „13.500,-“, zatímco karta vedle říká „Cena na dotaz“.
  Potřeba **1600 × 1067 px** (poměr 3:2), JPG, bez textu a bez ceny v obraze.
- **Fotka týmu** místo `carousel/1512896173_1_image_zv2.jpg` — dnes je to marketingový
  banner s nápisem „ZÁKLADNÍ PARAŠUTISTICKÝ VÝCVIK“ a tlačítkem „KOUPIT“, použitý
  jako dlaždice „Lidé, kterým věříš život“. Potřeba **1600 × 1000 px** (poměr 16:10),
  JPG, skupinová fotka instruktorů bez textu.

Obojí se po nahrání do galerie (E2) dostane do databáze; do té doby se dá vyměnit
adresa v `public/assets/js/data.js`.
