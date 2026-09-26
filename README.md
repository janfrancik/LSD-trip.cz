# LSD-trip.cz

Web spolku **Letecká společnost dobrodruhů z.s.** — tandemové seskoky, parašutistické kurzy,
expedice a helitour. Letiště Jihlava — Henčov.

Node.js 24 + Express (ES moduly) nad MariaDB 11.4. Frontend zůstává beze změny:
čisté HTML, CSS a vanilla JS, které Express servíruje jako statické soubory.

## Struktura

```
public/index.html            shell — hlavička, patička, lightbox
public/assets/css/style.css  kompletní styly včetně responzivních breakpointů
public/assets/js/data.js     obsahová data (termíny, kurzy, tým, FAQ, …)
public/assets/js/app.js      router, stav aplikace a renderování stránek
navrh_2/                     alternativní návrh vizuálu, servíruje se na /navrh-2/
src/server.js                Express — statika, návrhy, API, SPA fallback
src/db.js                    sdílený connection pool (mysql2)
scripts/migrate.js           spouštěč migrací, stav v tabulce _migrace
migrations/*.sql             číslované migrace schématu
docker-compose.dev.yml       vývojové prostředí (app + db)
docker-compose.yml           produkce na VPS za Caddy
netlify.toml                 původní statický deploy (řeší se zvlášť)
```

## Stránky

Routování běží na hashi, takže web funguje i z `file://`:

| Route | Obsah |
| --- | --- |
| `#/` | Domů — hero, statistiky, produkty, nejbližší termíny, aktuality |
| `#/tandem` | Tandemový seskok — průběh a ceníkové varianty |
| `#/kurzy` | Kurzy a výcvik |
| `#/kalendar` | Kalendář termínů s filtrováním |
| `#/termin/:id` | Detail termínu + výběr počtu osob |
| `#/booking` | Rezervační tok (účastníci → kontakt → platba → hotovo) |
| `#/poukaz` | Dárkový poukaz s živým náhledem |
| `#/expedice` | Expedice & Helitour |
| `#/galerie` | Galerie s lightboxem |
| `#/onas` | O spolku a tým |
| `#/faq` | Časté otázky |
| `#/kontakt` | Kontaktní údaje a formulář |

## Návrhy vizuálu

Vedle produkčního webu v `public/` se dají servírovat alternativní návrhy pro
majitelku. Složka `navrh_2/` se objeví na `/navrh-2/`, `navrh_3/` na `/navrh-3/`
a tak dál — mapování dělá `src/server.js` obecně podle názvu složky, takže nový
návrh stačí přidat jako složku s vlastním `index.html` a nic se nenastavuje.

Návrhy jsou dostupné jen přímou adresou, z webu na rootu na ně nic neodkazuje.
Vstup bez koncového lomítka (`/navrh-2`) se přesměrovává na `/navrh-2/`, jinak
by relativní cesty k assets mířily do rootu. Do Docker image se kopíruje jen to,
co se servíruje — předlohy z Claude Designu (`*.dc.html`, `support.js`) jsou
vyřazené v `.dockerignore`.

## API

| Metoda | Cesta | Popis |
| --- | --- | --- |
| `GET` | `/api/poptavky` | Seznam poptávek, nejnovější první |
| `GET` | `/api/poptavky/:id` | Detail poptávky |
| `POST` | `/api/poptavky` | Uložení poptávky (`jmeno`, `email`, `zprava`) |
| `PATCH` | `/api/poptavky/:id/vyrizeno` | Přepnutí stavu vyřízeno |
| `DELETE` | `/api/poptavky/:id` | Smazání poptávky |
| `GET` | `/api/health` | Kontrola dostupnosti databáze |

## Vývoj

Zkopírovat `.env.example` do `.env` a doplnit hesla, pak:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

Aplikace běží na <http://127.0.0.1:3000>, databáze na `127.0.0.1:3306` — oboje
jen z localhostu, nikdy ne na veřejném rozhraní.

Migrace se spouštějí zvlášť a jsou bezpečně opakovatelné (už aplikované soubory
se přeskočí):

```bash
docker compose -f docker-compose.dev.yml exec app npm run migrate
```

## Migrace

Číslované SQL soubory v `migrations/` (`001_init.sql`, `002_…`). Stav drží
tabulka `_migrace`, takže `npm run migrate` lze pustit opakovaně. MariaDB u DDL
příkazů commituje implicitně — migrace proto pište tak, aby šly spustit znovu
(`IF NOT EXISTS` apod.).

## Nasazení

Produkce běží v Dockeru na VPS za Caddy reverse proxy ve externí síti `web`.
Kontejner `lsdtrip-app` není publikovaný na hostitele, Caddy na něj míří přes
`reverse_proxy lsdtrip-app:3000`.

Push do větve `main` spustí workflow `.github/workflows/deploy.yml`:

1. build image pro `linux/amd64` a push do `ghcr.io/janfrancik/lsd-trip.cz:latest`,
2. SSH na VPS (uživatel `deploy`, secrets `VPS_HOST` a `VPS_SSH_KEY`),
3. `docker compose pull` + `up -d` v `/home/deploy/apps/lsdtrip`,
4. `npm run migrate` v běžícím kontejneru,
5. `docker image prune -f`.

Jméno repozitáře je `LSD-trip.cz`, ale ghcr.io přijímá jen malá písmena —
proto je image ve workflow zapsaný natvrdo, ne přes `${{ github.repository }}`.

Na VPS musí vedle `docker-compose.yml` ležet `.env` se stejnými proměnnými
jako `.env.example`.

## Responzivita

Breakpointy: `1080px` (přepnutí na hamburger menu), `1024px` (rozpad dvousloupcových
layoutů), `900px` (tabulka kalendáře se mění na karty), `780px`, `560px` a `380px`.
Zvlášť je ošetřena i krajina na nízkých displejích.

## Poznámka

Rezervační a platební tok je zatím prototyp — data se nikam neodesílají a žádná
platba neproběhne. Fotografie se načítají z `www.lsd-trip.cz`.
