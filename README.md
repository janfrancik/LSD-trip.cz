# LSD-trip.cz

Web spolku **Letecká společnost dobrodruhů z.s.** — tandemové seskoky, parašutistické kurzy,
expedice a helitour. Letiště Jihlava — Henčov.

Node.js 24 + Express (ES moduly) nad MariaDB 11.4. Frontend je čisté HTML, CSS a vanilla JS
bez build kroku — Express ho servíruje jako statické soubory.

Administrace na `/admin` se staví po fázích podle [docs/plan-administrace.md](docs/plan-administrace.md).
**Hotová je fáze 1** (zabezpečení, přihlášení, role, audit, nastavení, poptávky, testovací prostředí).

## Struktura

```
public/index.html            shell webu — hlavička, patička, lightbox
public/assets/               styly, obsahová data a aplikace webu
public/admin/                administrace (samostatná aplikace, ES moduly)
navrh_2/                     alternativní návrh vizuálu, servíruje se na /navrh-2/

src/app.js                   sestavení Express aplikace
src/server.js                spuštění serveru, údržba, ukončení
src/config.js                čtení a validace .env — jediné místo s process.env
src/db.js                    sdílený connection pool (mysql2)
src/bezpecnost.js            hlavičky, CSP, robots.txt
src/cas.js                   formátování data a času (Europe/Prague) — server i administrace
src/nastaveni.js             registr nastavení (popisy v kódu, hodnoty v databázi)
src/audit.js                 zápis do auditu
src/auth/                    hesla, session, CSRF, rate limit, role, 2FA
src/api/verejne.js           veřejné API webu
src/api/admin/               API administrace
src/akceptace/               modul „Ke schválení“ — import zadání, přílohy, souhrn
src/email/                   odesílání přes Resend, šablony a přílohy

docs/akceptace/*.yml         zadání akceptačních testů (importuje se při nasazení)

scripts/migrate.js           spouštěč migrací, stav v tabulce _migrace
scripts/vytvor-uzivatele.js  založení uživatele administrace
scripts/zaloha.sh            denní záloha databáze a fotek (cron na VPS)
migrations/*.sql             číslované migrace schématu
test/                        testy (node:test) proti skutečné databázi
```

## Prostředí

| | produkce | test | vývoj |
| --- | --- | --- | --- |
| větev | `main` | `test` | — |
| adresa | `lsd.francik.eu` → později `www.lsd-trip.cz` | `test-lsd.francik.eu` | `127.0.0.1:3000` |
| adresář na VPS | `/home/deploy/apps/lsdtrip` | `/home/deploy/apps/lsdtrip-test` | — |
| image | `ghcr.io/…:latest` | `ghcr.io/…:test` | build z repozitáře |
| databáze | `lsdtrip` | `lsdtrip_test` | `lsdtrip` |
| volumes | `lsd_main_*` | `lsd_test_*` | `lsd_dev_*` |
| e-maily | `EMAIL_REZIM=live` | `EMAIL_REZIM=schranka` | `EMAIL_REZIM=vypnuto` |
| indexace | `ROBOTS=povolit` | `ROBOTS=zakazat` | `ROBOTS=zakazat` |

O prostředí rozhoduje **`PROSTREDI`**, nikdy `NODE_ENV`: v kontejneru je `NODE_ENV=production`
i na testu (aby se neinstalovaly vývojové závislosti), takže podle něj se test tváří jako
produkce. Zabezpečení cookies a HSTS se řídí tím, jestli `APP_URL` začíná na `https://`.

Stejný `docker-compose.yml` slouží oběma prostředím, liší se jen `.env`. Volumes mají
výslovná jména podle `VOLUME_PREFIX` (`lsd_main_db`, `lsd_main_uploads`, `lsd_test_db`,
`lsd_test_uploads`), ne odvozená od názvu adresáře — přejmenování složky na VPS tedy
nemůže způsobit, že by Docker založil prázdnou databázi a stará data osiřela.
Bez `VOLUME_PREFIX` compose schválně odmítne nastartovat.

Postup zprovoznění obou prostředí včetně příkazů k vložení je v
[docs/nasazeni-vps.md](docs/nasazeni-vps.md).

### Na testu nemůže odejít e-mail zákazníkovi

Na testu běží `EMAIL_REZIM=schranka`: `posliEmail()` se k odesílací službě vůbec nedostane,
e-mail se celý uloží do administrace (`/admin/emaily`) a `emaily.prijemce_skutecny` zůstane
prázdné. Resend je tam zbytečný a **žádný klíč se na test nedává** — co není nastavené,
nemůže nic poslat.

Kdyby bylo někdy potřeba ověřit i doručení, je tu `EMAIL_REZIM=test`: příjemce se přepíše
na `EMAIL_TEST_PRIJEMCE` **před** voláním Resendu, do logu se uloží obojí (komu e-mail patří
i kam doopravdy šel) a předmět dostane předponu `[TEST]`. Hlídá to test `test/emaily.test.js`.

Výchozí hodnota je `vypnuto`: dokud se režim nenastaví vědomě, e-mail se jen zaloguje.

`RESEND_API_KEY` je povinný **jen pro `live`** — `schranka` ani `vypnuto` ven nic neposílají,
takže po nich klíč nemá kdo chtít. Naopak `schranka` je v produkci zakázaná: znamenala by,
že zákazníkům tiše nic nechodí. Obojí hlídá `test/konfigurace.test.js`, který aplikaci
startuje s kopií skutečného `.env` z testovacího serveru.

## Vývoj

Zkopírovat `.env.example` do `.env` a doplnit hesla, pak:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

Aplikace běží na <http://127.0.0.1:3000>, databáze na `127.0.0.1:3306` — oboje jen
z localhostu, nikdy ne na veřejném rozhraní.

Migrace se spouštějí zvlášť a jsou bezpečně opakovatelné:

```bash
docker compose -f docker-compose.dev.yml exec app npm run migrate
```

První uživatel administrace (heslo si nastaví sám přes vypsaný odkaz):

```bash
docker compose -f docker-compose.dev.yml exec app node scripts/vytvor-uzivatele.js sefka@example.cz "Kateřina Fojtová" admin
```

Administrace pak žije na <http://127.0.0.1:3000/admin>.

## Testy

Testy běží proti skutečné MariaDB z vývojového composu, ale do oddělené databáze
`lsdtrip_test`, takže vývojová data nechají na pokoji.

```bash
npm test
```

Pokrývají: přihlášení a zámek účtu, CSRF, oprávnění rolí, měkké mazání, odpověď na poptávku,
audit bez úniku hesel, jednorázovost odkazu na heslo, bezpečnostní hlavičky, `robots.txt`,
čtení `.env` v zálohovacím skriptu (hodnoty s `<`, `>`, mezerami a uvozovkami)
a pravidlo „žádná doména natvrdo v kódu".

## Migrace

Číslované SQL soubory v `migrations/`. Stav drží tabulka `_migrace`, takže `npm run migrate`
lze pustit opakovaně. MariaDB u DDL příkazů commituje implicitně — migrace proto pište tak,
aby šly spustit znovu (`IF NOT EXISTS`, `DROP ... IF EXISTS`).

### Migrace musí být zpětně kompatibilní (expand/contract)

Migrace běží **před** startem nové verze (viz [Nasazení](#nasazení)), takže mezi doběhnutím
migrace a záměnou kontejneru chvíli běží **stará** aplikace nad **novým** schématem. Migrace
proto nesmí rozbít předchozí verzi kódu.

Pravidlo: **v jednom kroku nikdy nemaž ani nepřejmenovávej sloupec nebo tabulku.**
Rozděl to na dvě nasazení:

| Krok | Migrace | Kód |
| --- | --- | --- |
| **expand** (verze N) | přidej nový sloupec / tabulku, data převeď (`UPDATE … SET nove = stare`) | umí obojí — zapisuje do nového, čte nové s fallbackem na staré |
| **contract** (verze N+1) | starý sloupec / tabulku odeber | čte a zapisuje už jen nové |

Z toho plyne:

- Přejmenování sloupce = přidat nový + zkopírovat data + (příští verze) zahodit starý.
  Nikdy `RENAME COLUMN` v jednom kroku.
- Nový `NOT NULL` sloupec musí mít `DEFAULT`, jinak stará verze neuloží řádek.
- Zúžení typu, přidání `UNIQUE` nebo cizího klíče patří až do kroku, kdy už žádná běžící
  verze nezapisuje data, která by tomu odporovala.
- Odebrání hodnoty z `ENUM` je taky contract — nejdřív ji kód přestane používat.
- `DROP TABLE` až poté, co ji žádná nasazená verze nečte.

Výjimka je jediná: tabulka, kterou zavádí tatáž verze, co ji používá — tam žádná
předchozí verze není, o co se opřít.

Hlídá to test v `test/nasazeni.test.js`: `DROP COLUMN`, `DROP TABLE`, `RENAME`/`CHANGE COLUMN`
v migraci shodí testy. Když jde opravdu o krok *contract* (předchozí verze už sloupec
nepoužívá), připíše se soubor do seznamu `ODEBRANI_SCHVALENA` i s důvodem — ať je ta úvaha
vidět v diffu.

Migrace `003` tohle pravidlo porušuje (`DROP COLUMN vyrizeno` hned po převodu na `stav`)
a v seznamu výjimek je proto od začátku. Prošlo to, protože produkční databáze byla prázdná
a testovací prostředí ještě neexistovalo — ne proto, že by to bylo správně.

Příkazy se dělí podle středníku, ale s ohledem na komentáře i řetězce. Pokud migrace obsahuje
středník uvnitř těla (trigger, procedura), oddělte příkazy řádkem `-- >>>`.

| Migrace | Obsah |
| --- | --- |
| `001_init.sql` | poptávky z kontaktního formuláře |
| `002_uzivatele_role_audit.sql` | uživatelé, přihlášení, reset hesla, audit, nastavení |
| `003_emaily_poptavky.sql` | log e-mailů, rozšíření poptávek o stavy a vazby |

## API

### Veřejné
| Metoda | Cesta | Popis |
| --- | --- | --- |
| `POST` | `/api/poptavky` | Odeslání kontaktního formuláře (rate limit 5/h, past na roboty) |
| `GET` | `/api/health` | Stav aplikace, databáze a počet migrací |

Čtení obsahu z databáze (`/api/bootstrap`, produkty, termíny) přijde ve fázi 2.

### Administrace (`/api/admin/*`)
Session cookie `lsd_admin` (httpOnly, Secure v produkci, SameSite=Strict) a u všech zápisů
povinná hlavička `X-CSRF-Token` shodná s cookie `lsd_csrf`.

| Skupina | Endpointy |
| --- | --- |
| Přihlášení | `GET /ja`, `POST /prihlaseni`, `POST /odhlaseni`, `POST /zmena-hesla`, `POST /reset-hesla`, `GET|POST /reset-hesla/:token`, `POST /2fa/zapnout|potvrdit|vypnout` |
| Přehled | `GET /dashboard` |
| Uživatelé | `GET|POST /uzivatele`, `GET|PATCH|DELETE /uzivatele/:id`, `POST /uzivatele/:id/obnovit`, `POST /uzivatele/:id/reset-hesla` |
| Poptávky | `GET /poptavky`, `GET|PATCH|DELETE /poptavky/:id`, `POST /poptavky/:id/odpovedet`, `POST /poptavky/:id/obnovit` |
| Audit | `GET /audit` |
| Nastavení | `GET|PATCH /nastaveni`, `GET /nastaveni/integrace` |
| E-maily | `GET /emaily`, `GET /emaily/:id`, `GET /emaily/:id/telo`, `GET /emaily/:id/priloha/:prilohaId` |
| Ke schválení (jen mimo produkci) | `GET /akceptace`, `GET /akceptace/pocty`, `GET /akceptace/verze/:kod`, `PUT /akceptace/ukoly/:id/vysledek`, `POST /akceptace/ukoly/:id/k-pretestovani`, `POST /akceptace/verze/:kod/k-pretestovani|schvalit|oznamit`, `GET|PUT /akceptace/verze/:kod/testeri`, `GET /akceptace/verze/:kod/export`, `GET|POST /akceptace/hlaseni`, `GET|PATCH /akceptace/hlaseni/:id`, `POST|GET /akceptace/prilohy[/:id]`, `POST /akceptace/import` |

Seznamy berou `?strana=&na_strane=&q=` a vracejí `{ data, celkem, strana, na_strane }`.
Chyby vracejí `{ chyba: "česky", detaily: { pole: "zpráva" } }`.

## Role

| | admin | provoz | instruktor | účetní | tester |
| --- | --- | --- | --- | --- | --- |
| přehled | ✓ | ✓ | čtení | čtení | – |
| poptávky, zákazníci | ✓ | ✓ | – | čtení | – |
| termíny, rezervace | ✓ | ✓ | soupiska | čtení | – |
| platby, doklady | ✓ | čtení | – | ✓ | – |
| obsah, galerie | ✓ | ✓ | – | – | – |
| uživatelé, audit, nastavení | ✓ | – | – | – | – |
| e-maily (schránka / log) | ✓ | čtení | – | – | – |
| ke schválení (jen na testu) | ✓ | ✓ | – | – | ✓ |

Role `ucetni` je připravená, ale zatím se pro ni nezakládá účet.
Role `tester` slouží k akceptačnímu testování na testu — víc nevidí a v produkci
pro ni není co dělat, protože tam modul Ke schválení neexistuje.
Hesla se nikdy neposílají e-mailem — nový člověk dostane jednorázový odkaz platný 3 dny.

## Čas: v databázi UTC, na obrazovce Praha

**V databázi je všechno v UTC.** Spojení má `time_zone = '+00:00'` (`src/db.js`), kontejnery
běží s `TZ=UTC`, takže `NOW()` i výchozí hodnoty sloupců píšou UTC bez ohledu na nastavení
serveru. Pražský čas „na hodinách“ by byl nejednoznačný: poslední říjnovou neděli proběhne
hodina 2:00–3:00 dvakrát, takže `2026-10-25 02:30:00` jsou dva různé okamžiky hodinu od sebe —
a držení rezervace na 48 h, splatnosti ani pořadí plateb by se z toho nedaly spočítat.

**Na Europe/Prague se převádí až při zobrazení**, jedinou funkcí ze `src/cas.js`, v českém
tvaru (`27. 9. 2026 22:49`). Administrace si ten samý soubor načítá jako
`/admin/assets/js/cas.js`, takže server i prohlížeč počítají stejně.

| Funkce | K čemu |
| --- | --- |
| `datum()`, `cas()`, `datumCas()`, `datumSlovy()` | zobrazení člověku |
| `pred()` | „před 5 minutami“ do seznamů |
| `okamzik()` | řetězec z databáze → `Date` (pro porovnání a rozdíly) |
| `proDb()` | `Date` → `YYYY-MM-DD HH:MM:SS` v UTC |
| `isoDatum()` | `YYYY-MM-DD` pro názvy souborů, v pražském dni |

V kódu se nepoužívá `toISOString()`, `toLocaleString()`, `new Date(<řetězec z databáze>)`
ani vlastní skládání data — `new Date('2026-09-27 20:49:00')` přečte řetězec jako místní čas
stroje a výsledek je posunutý. Výjimka je `/api/health`, kde je ISO čas v UTC záměrně:
to je strojový výstup, ne čas pro člověka.

Testy v `test/cas.test.js` hlídají přechody letního i zimního času, zápis a čtení proti
skutečné databázi a to, že výsledek nezávisí na časové zóně stroje.

## Zabezpečení

- Hesla: **argon2id** (19 MiB, 2 iterace) — v databázi nikdy heslo, jen hash.
- Session: token 32 B v cookie, v databázi jen jeho SHA-256. Změna hesla nebo role odhlásí všechna zařízení.
- Rate limit: přihlášení 10 / 15 min, reset hesla 5 / h, poptávky 5 / h, veřejné API 120 / min.
  Navíc zámek účtu v databázi po 10 neúspěších — ten přežije i restart kontejneru.
- CSRF: `SameSite=Strict` + double-submit token v hlavičce.
- CSP bez `unsafe-inline` u skriptů, `frame-ancestors 'none'`, `object-src 'none'`.
- Limit těla požadavku 100 kB (výjimka: nahrání snímku v akceptaci 8 MB), validace všech
  vstupů přes zod. Typ nahraného souboru se určuje z jeho obsahu, ne z toho, co tvrdí prohlížeč.
- Audit každé změny (kdo, kdy, co, před/po) s automatickým vyčištěním hesel a tajemství.
- Měkké mazání — „smazat" nikdy neznamená ztrátu dat.

## Nasazení

**Vyvíjí se ve větvi `test`.** Do `main` se nic nepíše přímo — jen se do něj slučuje
ověřený `test` (`git merge --ff-only test`), a to až po schválení.

Produkce i test běží v Dockeru na VPS za Caddy reverse proxy v externí síti `web`.
Kontejnery nejsou publikované na hostitele, Caddy na ně míří přes `reverse_proxy <kontejner>:3000`.

Push do `main` nebo `test` spustí `.github/workflows/deploy.yml`:

1. build image pro `linux/amd64` a push do `ghcr.io/janfrancik/lsd-trip.cz:{latest|test}`,
2. SSH na VPS (uživatel `deploy`, secrets `VPS_HOST` a `VPS_SSH_KEY`),
3. nahrání `docker-compose.yml` a `scripts/zaloha.sh` do adresáře podle větve (`.env` nikdy),
4. `docker compose pull`,
5. **migrace před startem**: `docker compose run --rm -T app npm run migrate` —
   jednorázový kontejner z nového image vedle běžící aplikace. Když migrace selže,
   deploy skončí, `up -d` se neprovede a dál běží stará verze nad svým schématem,
6. `docker compose up -d`,
7. **čekání na `healthy`** (max 60 s). Když se aplikace nerozběhne, deploy skončí chybou
   a vypíše posledních 50 řádků logu — `up -d` sám o sobě úspěch neznamená,
   kontejner se může točit v restartu,
8. úklid jen vlastních visících image (ne `prune`, na VPS běží i cizí aplikace).

Pořadí kroků 5 a 6 je podstatné: opačně by nová verze chvíli běžela nad starým
schématem. Hlídá to `test/nasazeni.test.js`.

Jméno repozitáře je `LSD-trip.cz`, ale ghcr.io přijímá jen malá písmena — proto je image
ve workflow zapsaný natvrdo, ne přes `${{ github.repository }}`.

Na VPS musí vedle `docker-compose.yml` ležet `.env` se stejnými proměnnými jako `.env.example`.

### Zálohy

`scripts/zaloha.sh` zkopírujte do adresáře prostředí na VPS a přidejte do cronu:

```
20 3 * * * /home/deploy/apps/lsdtrip/zaloha.sh      >> /home/deploy/zaloha.log 2>&1
40 3 * * * /home/deploy/apps/lsdtrip-test/zaloha.sh >> /home/deploy/zaloha.log 2>&1
```

Zálohuje databázi (`--single-transaction`, bez zamykání) i volume s fotkami a drží
14 denních a 8 týdenních kopií. Záloha se přejmenuje z `.tmp` na finální název až po
ověření `gzip -t` a přítomnosti `-- Dump completed` v dumpu — nedokončená nebo
poškozená se tedy nikdy netváří jako hotová.

Heslo roota se nepředává v příkazové řádce (ani `-p`, ani `docker compose exec -e`),
posílá se na stdin a uvnitř kontejneru se z něj udělá `MYSQL_PWD` — v seznamu procesů
se neobjeví ani na hostiteli, ani v kontejneru. Soubor `.env` skript **nenačítá jako
shell**: hodnoty v něm obsahují `<`, `>` i mezery a `. ./.env` by na nich spadlo.

Kontrola bez zálohování (vypíše, co si skript přečetl z `.env`):

```bash
/home/deploy/apps/lsdtrip-test/zaloha.sh --kontrola
```

Zálohy leží na stejném VPS, takže chrání před chybou v datech, ne před ztrátou serveru.
Návrh kopie mimo server je v [docs/nasazeni-vps.md](docs/nasazeni-vps.md) (zatím neimplementováno).

## E-maily a testovací schránka

Všechno odesílání jde přes `src/email/posli.js`, který podle `EMAIL_REZIM` rozhodne,
co se stane. Režim se nastavuje v `.env` a v administraci se ukazuje v sekci **E-maily**:

| `EMAIL_REZIM` | Co dělá | Kde se používá |
| --- | --- | --- |
| `live` | posílá zákazníkům přes Resend (ostrý režim se jmenuje takhle, ne `ostry`) | produkce |
| `schranka` | **neodesílá nic**, ukládá celý e-mail (HTML, text, přílohy) do administrace | test |
| `test` | přepíše příjemce na `EMAIL_TEST_PRIJEMCE` a odešle | když je potřeba ověřit doručení |
| `vypnuto` | jen záznam v logu, tělo se neukládá | výchozí, dokud se režim nenastaví |

Testovací schránka (`/admin/emaily`) je plnohodnotný náhled: hledání podle adresáta,
předmětu a šablony, přepínač HTML/text, přílohy ke stažení a vypsané odkazy z e-mailu,
na které jde kliknout — pozvánka i reset hesla se tak dají na testu projít celé.
HTML e-mailu se vykresluje v sandboxovaném `iframe` přes `srcdoc`: neběží v něm skripty
a nemá přístup ke stránce administrace ani k session.

Po každé akci, která posílá e-mail, administrace řekne, co se stalo — a v režimu
`schranka` nabídne odkaz „Zobrazit e-mail“. Nikdy netvrdí „odesláno“, když se neodeslalo.

## Ke schválení (akceptační testování)

Modul `/admin/akceptace` běží **jen mimo produkci** (`PROSTREDI` ≠ `produkce`).
V produkci se router vůbec nenamontuje, `/ja` hlásí `akceptace: false` a v administraci
tedy není ani položka v menu, ani tlačítko „Nahlásit problém“.

Jak to funguje:

1. Ke každé fázi je v repozitáři soubor `docs/akceptace/<faze>.yml` — verze a testovací
   úkoly (postup krok za krokem, očekávaný výsledek, odkaz na obrazovku).
2. Při startu aplikace se zadání naimportuje. Import je idempotentní a páruje se podle
   `kod` úkolu: změněný úkol se aktualizuje, chybějící se zhasne (`aktivni = 0`),
   **výsledky testerů zůstanou**. Ručně jde import spustit tlačítkem „Znovu načíst zadání“.
3. Tester u úkolu zvolí Funguje / Nefunguje / Nerozumím zadání, napíše komentář a může
   přiložit snímek obrazovky (PNG, JPEG, WebP, do 6 MB; vložením ze schránky, přetažením
   nebo výběrem souboru; ukládá se do volume `uploads`). U „nefunguje“ je komentář povinný.
4. **Výsledek má každý tester svůj.** Zvoneček, karta na přehledu i seznam úkolů ukazují
   stav přihlášeného člověka — to, že úkol zkusil někdo jiný, nikoho jiného nezbavuje
   povinnosti zkusit ho taky.
5. Kdo verzi testuje, vybírá admin tlačítkem „Kdo testuje“. Bez výběru platí výchozí stav:
   všichni s rolí `tester`, `provoz` nebo `admin`. Úkol může být omezený na role
   (`role: provoz` v YAML) nebo jen pro admina (`jen_admin: true`) — ostatním se neukáže.
6. Provoz a admin mají navíc záložku **Přehled testerů**: tabulka úkoly × testeři
   (✓ funguje, ✕ nefunguje, ? nejasné zadání, ↻ k přetestování, · neotestováno, – netýká se),
   kliknutí na buňku ukáže komentář, přílohy, čas a zařízení. Filtry: jen problémové,
   podle testera. Nahoře je vidět, kolik má kdo hotovo (`Majitelka 12/24`).
7. Po opravě a novém nasazení vrátí provoz nebo admin úkol tlačítkem
   „Poslat k přetestování“ — ve výchozím stavu **jen těm, komu nefungoval**; volba
   „poslat všem“ je pro případ, kdy oprava změnila chování pro všechny.
8. Verzi schvaluje **jen admin** a jen tehdy, když **všichni přiřazení testeři** mají
   všechno otestované a v pořádku a hlášení jsou vyřízená. Odmítnutí říká jmenovitě,
   na koho se čeká („Majitelka: 3 úkoly neotestované“). Schválení se zapíše do auditu,
   souhrn (kdo co testoval a kdy, včetně tabulky úkoly × testeři) jde stáhnout
   jako Markdown do `docs/akceptace/`.

Upozornění: zvoneček v hlavičce s počtem neotestovaných úkolů, karta na přehledu
s průběhem a e-mail testerům při nové verzi (odchází jen když je zapnuté odesílání;
jinak zůstane oznámení v administraci a rozešle se tlačítkem „Oznámit testerům“).

Kdo je tester: aktivní uživatelé přiřazení k verzi, jinak všichni s rolí `tester`,
`provoz` nebo `admin`.

## Přechod na lsd-trip.cz

V kódu není žádná doména natvrdo — hlídá to test v `test/bezpecnost.test.js`. Všechny
absolutní adresy (canonical, OG, odkazy v e-mailech, návratové a callback URL platební brány)
se skládají z `APP_URL`. Přechod je proto jen konfigurace:

1. **DNS** — `A` záznam `www.lsd-trip.cz` a `lsd-trip.cz` na IP VPS.
2. **Caddy** — přidat blok pro novou doménu s `reverse_proxy lsdtrip-app:3000`, ponechat i starou, ať běží přesměrování.
3. **`.env` v produkci** — `APP_URL=https://www.lsd-trip.cz`, `EMAIL_ODESILATEL` na novou doménu, `ROBOTS=povolit`.
4. **Mo.one** — zaregistrovat nové `ReturnUrl` a `CallbackUrl` (fáze 4).
5. **Resend** — ověřit novou odesílací doménu (DNS záznamy viz sekce 9 plánu) a teprve pak přepnout `EMAIL_ODESILATEL`.
6. **301 ze staré domény** — nasadit mapu přesměrování (fáze 2), `lsd.francik.eu` přesměrovat na novou doménu.
7. **Vyhledávače** — aktualizovat `sitemap.xml` v Search Console, zkontrolovat `canonical` a OG na několika stránkách.

Restart aplikace není potřeba kvůli kódu, jen kvůli načtení nového `.env`.

## Stránky webu

Routování zatím běží na hashi; normální URL a serverové renderování přijdou ve fázi 2.

| Route | Obsah |
| --- | --- |
| `#/` | Domů — hero, statistiky, produkty, nejbližší termíny, aktuality |
| `#/tandem` | Tandemový seskok — průběh a ceníkové varianty |
| `#/kurzy` | Kurzy a výcvik |
| `#/kalendar` | Kalendář termínů s filtrováním |
| `#/termin/:id` | Detail termínu + výběr počtu osob |
| `#/booking` | Rezervační tok (prototyp, napojení na API ve fázi 3) |
| `#/poukaz` | Dárkový poukaz s živým náhledem |
| `#/expedice` | Expedice & Helitour |
| `#/galerie` | Galerie s lightboxem |
| `#/onas` | O spolku a tým |
| `#/faq` | Časté otázky |
| `#/kontakt` | Kontaktní údaje a formulář |

## Návrhy vizuálu

Složka `navrh_2/` se servíruje na `/navrh-2/`, `navrh_3/` na `/navrh-3/` a tak dál — mapování
dělá `src/app.js` obecně podle názvu složky. Návrhy jsou dostupné jen přímou adresou.
Produkcí je návrh 1 v `public/`; administrace používá jeho design tokeny.

## Poznámka

Rezervační a platební tok je zatím prototyp — data se nikam neodesílají a žádná platba
neproběhne. Fotografie se do fáze 5 načítají z `www.lsd-trip.cz`.
