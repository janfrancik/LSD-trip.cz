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
src/nastaveni.js             registr nastavení (popisy v kódu, hodnoty v databázi)
src/audit.js                 zápis do auditu
src/auth/                    hesla, session, CSRF, rate limit, role, 2FA
src/api/verejne.js           veřejné API webu
src/api/admin/               API administrace
src/email/                   odesílání přes Resend a šablony

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
| e-maily | `EMAIL_REZIM=live` | `EMAIL_REZIM=test` | `EMAIL_REZIM=vypnuto` |
| indexace | `ROBOTS=povolit` | `ROBOTS=zakazat` | `ROBOTS=zakazat` |

Stejný `docker-compose.yml` slouží oběma prostředím, liší se jen `.env`. Volumes mají
výslovná jména podle `VOLUME_PREFIX` (`lsd_main_db`, `lsd_main_uploads`, `lsd_test_db`,
`lsd_test_uploads`), ne odvozená od názvu adresáře — přejmenování složky na VPS tedy
nemůže způsobit, že by Docker založil prázdnou databázi a stará data osiřela.
Bez `VOLUME_PREFIX` compose schválně odmítne nastartovat.

Postup zprovoznění obou prostředí včetně příkazů k vložení je v
[docs/nasazeni-vps.md](docs/nasazeni-vps.md).

### Na testu nemůže odejít e-mail zákazníkovi

`EMAIL_REZIM=test` není podmínka u odesílání, ale jediná cesta ven: `posliEmail()` přepíše
příjemce na `EMAIL_TEST_PRIJEMCE` **před** voláním Resendu. Do logu se uloží obojí —
komu e-mail patří (`emaily.prijemce`) i kam doopravdy šel (`emaily.prijemce_skutecny`).
Předmět dostane předponu `[TEST]`. Hlídá to i test `test/emaily.test.js`.

Výchozí hodnota je `vypnuto`: dokud se režim nenastaví vědomě, e-mail se jen zaloguje.

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
audit bez úniku hesel, jednorázovost odkazu na heslo, bezpečnostní hlavičky, `robots.txt`
a pravidlo „žádná doména natvrdo v kódu".

## Migrace

Číslované SQL soubory v `migrations/`. Stav drží tabulka `_migrace`, takže `npm run migrate`
lze pustit opakovaně. MariaDB u DDL příkazů commituje implicitně — migrace proto pište tak,
aby šly spustit znovu (`IF NOT EXISTS`, `DROP ... IF EXISTS`).

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

Seznamy berou `?strana=&na_strane=&q=` a vracejí `{ data, celkem, strana, na_strane }`.
Chyby vracejí `{ chyba: "česky", detaily: { pole: "zpráva" } }`.

## Role

| | admin | provoz | instruktor | účetní |
| --- | --- | --- | --- | --- |
| přehled | ✓ | ✓ | čtení | čtení |
| poptávky, zákazníci | ✓ | ✓ | – | čtení |
| termíny, rezervace | ✓ | ✓ | soupiska | čtení |
| platby, doklady | ✓ | čtení | – | ✓ |
| obsah, galerie | ✓ | ✓ | – | – |
| uživatelé, audit, nastavení | ✓ | – | – | – |

Role `ucetni` je připravená, ale zatím se pro ni nezakládá účet.
Hesla se nikdy neposílají e-mailem — nový člověk dostane jednorázový odkaz platný 3 dny.

## Zabezpečení

- Hesla: **argon2id** (19 MiB, 2 iterace) — v databázi nikdy heslo, jen hash.
- Session: token 32 B v cookie, v databázi jen jeho SHA-256. Změna hesla nebo role odhlásí všechna zařízení.
- Rate limit: přihlášení 10 / 15 min, reset hesla 5 / h, poptávky 5 / h, veřejné API 120 / min.
  Navíc zámek účtu v databázi po 10 neúspěších — ten přežije i restart kontejneru.
- CSRF: `SameSite=Strict` + double-submit token v hlavičce.
- CSP bez `unsafe-inline` u skriptů, `frame-ancestors 'none'`, `object-src 'none'`.
- Limit těla požadavku 100 kB, validace všech vstupů přes zod.
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
3. `docker compose pull` + `up -d` v adresáři podle větve,
4. `npm run migrate` v běžícím kontejneru,
5. `docker image prune -f`.

Jméno repozitáře je `LSD-trip.cz`, ale ghcr.io přijímá jen malá písmena — proto je image
ve workflow zapsaný natvrdo, ne přes `${{ github.repository }}`.

Na VPS musí vedle `docker-compose.yml` ležet `.env` se stejnými proměnnými jako `.env.example`.

### Zálohy

`scripts/zaloha.sh` zkopírujte do adresáře prostředí na VPS a přidejte do cronu:

```
20 3 * * * /home/deploy/apps/lsdtrip/zaloha.sh      >> /home/deploy/zaloha.log 2>&1
40 3 * * * /home/deploy/apps/lsdtrip-test/zaloha.sh >> /home/deploy/zaloha.log 2>&1
```

Zálohuje databázi (`--single-transaction`, bez zamykání) i volume s fotkami,
drží 14 denních a 8 týdenních kopií a nedokončenou zálohu nikdy nevydává za hotovou.

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
