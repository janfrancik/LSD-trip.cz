# Nasazení na VPS

Příprava prostředí na VPS. Postup je psaný k vkládání do terminálu; doplnit je
potřeba jen hodnoty označené `<DOPLNIT>`.

| | produkce | test |
| --- | --- | --- |
| větev | `main` | `test` |
| doména | `lsd.francik.eu` (později + `www.lsd-trip.cz`) | `test-lsd.francik.eu` |
| adresář | `/home/deploy/apps/lsdtrip` | `/home/deploy/apps/lsdtrip-test` |
| kontejner | `lsdtrip-app` | `lsdtrip-test-app` |
| image | `ghcr.io/janfrancik/lsd-trip.cz:latest` | `…:test` |
| databáze | `lsdtrip` ve volume `lsd_main_db` | `lsdtrip_test` ve volume `lsd_test_db` |
| fotky | `lsd_main_uploads` | `lsd_test_uploads` |
| e-maily | `vypnuto` → později `live` | `vypnuto` → po klíči `test` (vše na jednu adresu) |
| stav | **zatím se nemění** | nasazuje se teď |
| indexace | povolená | zakázaná (`robots.txt` + `X-Robots-Tag`) |

**Volumes mají výslovná jména**, ne odvozená od názvu adresáře — přejmenování složky
tedy nemůže způsobit, že by Docker založil prázdnou databázi a stará data osiřela.
Bez `VOLUME_PREFIX` v `.env` compose schválně odmítne nastartovat.

**Teď se nasazuje jen test.** Produkce (`lsd.francik.eu`) zůstává beze změny —
se stávajícím `.env` i volume — dokud se test neodzkouší. Přechod produkce na novou
verzi je popsaný zvlášť na konci (sekce „Přechod main na novou verzi“).

> **Na VPS běží i jiné aplikace** (Kompas, Todo) ve stejné síti `web`. Žádný příkaz
> v tomhle návodu proto nesahá mimo adresáře `/home/deploy/apps/lsdtrip*` a mimo
> volumes `lsd_*`. Zvlášť: **nikdy nepouštěj `docker system prune` ani `docker image prune`**
> bez filtru — smazaly by i vrstvy cizích aplikací. Nasazovací workflow z téhož důvodu
> uklízí jen visící image `ghcr.io/janfrancik/lsd-trip.cz`.

**Hotovo (27. 9. 2026):** DNS pro `test-lsd.francik.eu`, Caddyfile pro obě domény
včetně `X-Robots-Tag` na testu, adresář `/home/deploy/apps/lsdtrip-test`
a jeho `.env` (práva 600, ověřené). **Caddyfile už neupravuj.**

`docker-compose.yml` ani `zaloha.sh` na server ručně nekopíruj — **nahraje je
nasazovací workflow** při každém běhu, ještě před `pull` a `up`. Soubor `.env`
naopak workflow nikdy nepřepisuje, ten zůstává jen na serveru.

---

## 1. DNS — ✅ hotovo

`test-lsd.francik.eu` existuje a Caddy na něj odpovídá (502, dokud kontejner neběží).
Kontrolní výpis, kdyby bylo potřeba:

```bash
dig +short lsd.francik.eu test-lsd.francik.eu
```

## 2. Adresáře a soubory — ✅ hotovo pro test

`/home/deploy/apps/lsdtrip-test` existuje. `docker-compose.yml` a `zaloha.sh` sem
nahraje workflow, ručně se nic nekopíruje.

```bash
ls -la /home/deploy/apps/lsdtrip-test/
```

Po prvním nasazení tu mají být `docker-compose.yml`, `zaloha.sh` a `.env`.

## 3. Hesla — ✅ hotovo pro test

Hesla testu jsou v jeho `.env`. Produkční se budou generovat až při přechodu `main`
(poslední sekce), a musí být jiná:

```bash
echo "db:   $(openssl rand -base64 24 | tr -d '/+=')"
echo "root: $(openssl rand -base64 24 | tr -d '/+=')"
```

## 4. `.env` pro test — ✅ hotovo

Na serveru je a je ověřený. Níž pro doložení, jak vypadá:

```bash
cat > /home/deploy/apps/lsdtrip-test/.env <<'EOF'
NODE_ENV=production
PORT=3000

APP_URL=https://test-lsd.francik.eu
PROSTREDI=test

DB_HOST=db
DB_PORT=3306
DB_NAME=lsdtrip_test
DB_USER=lsdtrip
DB_PASSWORD=<DOPLNIT-TEST-DB-HESLO>
DB_ROOT_PASSWORD=<DOPLNIT-TEST-ROOT-HESLO>

# Test se nesmí dostat do vyhledávačů.
ROBOTS=zakazat

# Na testu se e-maily OPRAVDU ODESÍLAJÍ, ale všem se přepíše příjemce na
# EMAIL_TEST_PRIJEMCE ještě před voláním Resendu - zákazníkovi z testu dojít
# nemůže nic, i kdyby se v kódu spletl kdokoli. Předmět dostane předponu
# [TEST] a do logu se uloží obojí: komu e-mail patřil i kam doopravdy šel.
#
# Alternativa je EMAIL_REZIM=schranka: ta neodesílá vůbec nic a e-mail jen
# uloží do administrace. Hodí se, když na testu není Resend. Jakmile klíč je,
# je "test" bližší produkci, protože se ověří i skutečné doručení.
EMAIL_REZIM=test

# Kam se přesměruje všechno z testu. Dokud nemá odesílací služba ověřenou
# doménu, musí to být adresa majitele účtu - na jinou vrátí 403.
EMAIL_TEST_PRIJEMCE=lsdtrip.web@gmail.com

# Bez ověřené domény smí Resend odesílat jen z onboarding@resend.dev.
EMAIL_ODESILATEL=LSD test <onboarding@resend.dev>
# Klíč doplň z resend.com. Aplikace si při startu ověří jeho TVAR (jedno "re_",
# bez mezer a zalomení) a s pokaženým klíčem schválně nenastartuje: klíč
# s koncem řádku rozbije sestavení hlavičky a chyba, která z toho vypadne,
# v sobě má jeho vlastní hodnotu. Právě tak jeden klíč unikl do logu.
RESEND_API_KEY=

# Na testu se nenastavuje: upozornění provozu se stejně přesměrují na
# EMAIL_TEST_PRIJEMCE. Platí jen pro režim jen_provoz na produkci.
EMAIL_PROVOZ_PRIJEMCE=

# Platební brána (fáze 4). Test vždy proti testovacímu prostředí Mo.one.
MOONE_BASE_URL=https://api-test.znpay.tech
MOONE_CLIENT_ID=
MOONE_CLIENT_SECRET=

SESSION_DNI=14

# Oddělení prostředí. Bez VOLUME_PREFIX compose nenastartuje.
VOLUME_PREFIX=lsd_test
IMAGE_TAG=test
APP_CONTAINER=lsdtrip-test-app
COMPOSE_PROJECT_NAME=lsdtrip-test
EOF

chmod 600 /home/deploy/apps/lsdtrip-test/.env
```

## 5. Caddy — ✅ hotovo, needituj

Caddyfile je nastavený a ověřený: `lsd.francik.eu` vrací 200,
`test-lsd.francik.eu` zatím 502 (za doménou nic neběží — to se spraví krokem 8).
Níž je jen pro doložení, jak konfigurace vypadá:

```caddyfile
# ---------------------------------------------------------------- produkce
lsd.francik.eu {
    encode zstd gzip
    reverse_proxy lsdtrip-app:3000
}

# ------------------------------------------------------------------- test
test-lsd.francik.eu {
    encode zstd gzip

    # Aplikace si hlavičku posílá sama podle ROBOTS=zakazat. Tohle je druhá
    # pojistka pro případ, že by se .env na testu omylem přepnulo.
    header X-Robots-Tag "noindex, nofollow, noarchive"

    reverse_proxy lsdtrip-test-app:3000
}
```

Co si můžeš ověřit, aniž bys do Caddy sahal — v síti `web` musí být Caddy
i obě aplikace LSD (a vedle nich klidně Kompas a Todo, ty tam patří):

```bash
docker network inspect web --format '{{range .Containers}}{{.Name}} {{end}}'
```

## 6. První nasazení testu

Na svém počítači:

```bash
git push -u origin test
```

Workflow postaví image `:test` a nasadí ho. Průběh v Actions na GitHubu.
Na VPS se dá sledovat:

```bash
cd /home/deploy/apps/lsdtrip-test
docker compose logs -f app
```

## 7. První uživatel administrace

```bash
cd /home/deploy/apps/lsdtrip-test
docker compose exec app node scripts/vytvor-uzivatele.js <DOPLNIT-EMAIL> "<DOPLNIT-JMÉNO>" admin
```

Skript vypíše odkaz na nastavení hesla (platí 3 dny, použitelný jednou).
Dokud není nastavený Resend, e-mail neodejde — použij odkaz z výpisu.

## 8. Ověření

```bash
# a) test odpovídá a hlásí své jméno
curl -s https://test-lsd.francik.eu/api/health; echo
#    musí vrátit "prostredi":"test"

# b) produkce běží dál a nic se jí nestalo
curl -s https://lsd.francik.eu/api/health; echo

# c) za doménou je správný kontejner
docker inspect -f '{{.Name}} → {{.Config.Image}}' lsdtrip-test-app

# d) test má vlastní volumes, produkční se nedotkly
docker volume ls | grep -i lsd

# e) test vidí jen svou databázi
cd /home/deploy/apps/lsdtrip-test && docker compose exec -T db \
  mariadb -uroot -p"$(grep DB_ROOT_PASSWORD .env | cut -d= -f2)" -e "SHOW DATABASES" | grep lsdtrip
#    musí ukázat lsdtrip_test, nikdy lsdtrip

# f) test se nesmí dostat do vyhledávačů
curl -s  https://test-lsd.francik.eu/robots.txt          # Disallow: /
curl -sI https://test-lsd.francik.eu/ | grep -i robots   # X-Robots-Tag: noindex, nofollow

# g) administrace se neindexuje
curl -sI https://test-lsd.francik.eu/admin | grep -i robots
```

Nakonec otevři `https://test-lsd.francik.eu/admin` a přihlas se.

## 9. Zálohy

Skript na server nahrává workflow, ručně se nekopíruje. Nejdřív si ověř, že si
správně přečetl `.env` — kontrolní režim se nedotkne databáze ani souborů:

```bash
/home/deploy/apps/lsdtrip-test/zaloha.sh --kontrola
```

Má vypsat `db_name=lsdtrip_test`, `volume_prefix=lsd_test` a délku hesla.
Pak ostrý běh:

```bash
/home/deploy/apps/lsdtrip-test/zaloha.sh
ls -la /home/deploy/backups/lsdtrip-test/denni/
```

Záloha se přejmenuje z `.tmp` na finální název, **až** projde `gzip -t` a až
je v dumpu poslední řádek `-- Dump completed`. Nedokončená nebo poškozená
záloha tedy nikdy nevypadá jako hotová.

Ověřit, že jde skutečně obnovit (na testu, do dočasné databáze):

```bash
cd /home/deploy/apps/lsdtrip-test
ROOT=$(grep '^DB_ROOT_PASSWORD=' .env | cut -d= -f2-)
gzip -dc /home/deploy/backups/lsdtrip-test/denni/db-$(date +%F).sql.gz \
  | docker compose exec -T -e MYSQL_PWD="$ROOT" db sh -c \
    'mariadb -u root -e "DROP DATABASE IF EXISTS obnova_test; CREATE DATABASE obnova_test" && mariadb -u root obnova_test'
docker compose exec -T -e MYSQL_PWD="$ROOT" db mariadb -u root \
  -e "SELECT COUNT(*) AS tabulek FROM information_schema.tables WHERE table_schema='obnova_test'; DROP DATABASE obnova_test;"
```

Teprve až tohle projde, nastav cron:

```
40 3 * * * /home/deploy/apps/lsdtrip-test/zaloha.sh >> /home/deploy/zaloha.log 2>&1
```

Řádek pro produkci se přidá až při jejím přechodu.

### Zálohy leží na stejném VPS

To je potřeba mít na paměti: chrání před smazáním dat, chybnou migrací nebo
rozbitým kontejnerem — **ne** před ztrátou serveru. Když odejde disk nebo
zmizí celý stroj, zmizí i zálohy.

Pro produkci proto doporučuji přidat kopii mimo server. **Zatím jen návrh,
nic z toho není implementované** — probereme, až bude produkce naostro:

| Varianta | Jak to funguje | Pro a proti |
| --- | --- | --- |
| **Contabo Object Storage** | S3 kompatibilní úložiště u stejného poskytovatele, `rclone`/`aws s3 cp` na konci `zaloha.sh` | nejjednodušší, přenos po vnitřní síti zdarma; ale pořád jeden poskytovatel |
| **rclone na Google Drive** | `rclone copy` do složky na Drive, autorizace tokenem | data u jiného poskytovatele; Drive není pro tohle stavěný a token je potřeba hlídat |
| **Jiný VPS nebo NAS** | `rsync` přes SSH klíč jen pro zálohy | plná kontrola, ale další stroj k údržbě |

Ať tak či tak, platí tři věci: klíč nebo token do vzdáleného úložiště musí mít
**právo jen zapisovat** (aby útočník s přístupem na VPS nemohl zálohy smazat),
kopie se má šifrovat (`age` nebo `gpg`), protože obsahuje osobní údaje zákazníků,
a jednou za čas je potřeba zkusit obnovu — záloha, kterou nikdo nezkusil obnovit,
je jen soubor.

---

# Přechod main na novou verzi

**Nedělej nic z téhle sekce, dokud není test odzkoušený a dokud se nedohodneme.**
Do té doby produkce běží ve staré podobě: staré `.env`, staré volume, image `:latest`
z posledního nasazení. Nové verze se do ní nedostanou, protože se do `main` nic nepushuje.

Až přijde řada, postup je: kontrola staré databáze → nové `.env` → odstranění
starého volume → sloučení větve.

## P0. Kontrola staré produkce

**Tohle se dělá první, se starým `.env`, a nedá se to odložit na později.**
Stará verze má v migraci `001` tabulku `poptavky` a endpoint `POST /api/poptavky`
byl na produkci veřejný (`GET` taky — bez přihlášení vrací 200). Žádná stránka
starého webu ho nevolá, v celém `main` na něj neodkazuje jediný řádek
frontendu, takže tabulka **má být** prázdná. „Má být“ ale není „je“, a co se
v P3 smaže, se nevrátí.

Proč právě teď a ne až u P3: dotaz musí jít proti **starému** volume
`lsdtrip_db_data` a se **starým** `.env`. Jakmile se `.env` přepíše (P2), má
compose `VOLUME_PREFIX=lsd_main` — `docker compose up -d db` by založil nový,
prázdný volume `lsd_main_db`, dotaz by se ptal té špatné databáze a vrátil by
`0` i v případě, že ve staré něco je. Navíc by do nového volume šlo nové root
heslo, které ke starému nepatří.

```bash
cd /home/deploy/apps/lsdtrip && docker compose up -d db && sleep 8 && docker compose exec -T db sh -c 'mariadb -u root -p"$MARIADB_ROOT_PASSWORD" -e "SELECT COUNT(*) AS poptavek FROM lsdtrip.poptavky;"'
```

Pro kontrolu, že se ptáš opravdu starého volume (má vyjít `lsdtrip_db_data`):

```bash
cd /home/deploy/apps/lsdtrip && docker inspect -f '{{range .Mounts}}{{.Name}}{{end}}' "$(docker compose ps -q db)"
```

Vyjde-li `0` poptávek, pokračuj na P1 bez váhání. Vyjde-li cokoli jiného,
**nemaž nic** a nejdřív si data vytáhni — jsou to jména, e-maily a zprávy od
lidí, kteří čekají na odpověď:

```bash
cd /home/deploy/apps/lsdtrip && docker compose exec -T db sh -c 'mariadb -u root -p"$MARIADB_ROOT_PASSWORD" --batch lsdtrip -e "SELECT * FROM poptavky ORDER BY created_at;"' > ~/poptavky-ze-stare-produkce.tsv
```

Soubor si odnes ze serveru a poptávky vyřiď ručně; do nové databáze se
nepřenášejí (schéma je jiné a je jich málo).

## P1. Hesla produkce

Jiná než na testu:

```bash
echo "db:   $(openssl rand -base64 24 | tr -d '/+=')"
echo "root: $(openssl rand -base64 24 | tr -d '/+=')"
```

## P2. `.env` pro produkci

Teprve po P0 — dokud neproběhla kontrola staré databáze, tenhle soubor se
nepřepisuje.

Nejdřív odlož ten stávající. Jsou v něm staré přístupy k databázi, které můžou
být potřeba, kdyby se ke starému volume ještě muselo vrátit (`-p` zachová práva,
takže záloha nezůstane čitelná pro kohokoli):

```bash
cd /home/deploy/apps/lsdtrip && cp -p .env ".env.stary-$(date +%F)" && ls -la .env*
```

Pak nové:

```bash
cat > /home/deploy/apps/lsdtrip/.env <<'EOF'
NODE_ENV=production
PORT=3000

APP_URL=https://lsd.francik.eu
PROSTREDI=produkce

DB_HOST=db
DB_PORT=3306
DB_NAME=lsdtrip
DB_USER=lsdtrip
DB_PASSWORD=<DOPLNIT-PRODUKCE-DB-HESLO>
DB_ROOT_PASSWORD=<DOPLNIT-PRODUKCE-ROOT-HESLO>

# Zakázat, dokud produkce jede na lsd.francik.eu: na www.lsd-trip.cz běží pořád
# starý web na jiném hostingu, takže by v Googlu soutěžily dvě kopie téhož webu.
# Na "povolit" se přepne s přechodem na ostrou doménu (viz "Přechod na
# lsd-trip.cz" v README). Pozor, "zakazat" je i výchozí hodnota - na tomhle
# řádku není poznat, že je nastavený schválně.
ROBOTS=zakazat

# Režimy odesílání: vypnuto | jen_provoz | schranka | test | live
#
#   vypnuto    - neodejde nic, ani zákazníkům, ani provozu
#   jen_provoz - upozornění provozu odejdou, zákazníkům se neposílá nic.
#                Tohle je stav, dokud Resend nemá ověřenou doménu.
#   live       - ostré odesílání (až po ověření domény)
#
# "schranka" produkce odmítne a nenastartuje, "test" sem nepatří.
#
# POZOR: v "vypnuto" i "jen_provoz" projde přihláška z webu, ale zákazník
# potvrzení NEDOSTANE. V administraci je to vidět na přihlášce i v E-mailech
# (stav "neodesláno") a po přepnutí na live se dá rozeslat dodatečně.
# Podrobnosti v 2.1a v checklist-kurzy-spusteni.md.
EMAIL_REZIM=jen_provoz
EMAIL_TEST_PRIJEMCE=

# Kam chodí upozornění provozu v režimu jen_provoz. Dokud není ověřená doména,
# musí to být adresa majitele účtu u Resendu - na jinou Resend vrátí 403.
EMAIL_PROVOZ_PRIJEMCE=lsdtrip.web@gmail.com
# Dokud není ověřená doména, smí Resend odesílat jen z onboarding@resend.dev.
# Po ověření domény se změní na LSD <rezervace@lsd-trip.cz> (nebo na doménu,
# která bude ověřená) - viz "Přepnutí na ostré odesílání" níž.
EMAIL_ODESILATEL=LSD <onboarding@resend.dev>
RESEND_API_KEY=

# POZOR: tahle adresa je TESTOVACÍ brána Mo.one, i když je v produkčním .env.
# Platby jsou fáze 4 a zatím se nepoužívají, takže to nikomu nevadí - ale až se
# platby zapnou, MUSÍ se tyhle tři řádky přepnout na ostrou bránu i s ostrými
# přístupy. Kdyby se to zapomnělo, zákazník by platil do testovacího prostředí
# a peníze by nikam nedošly. Přepnutí je změna .env a restart, žádné nasazování.
MOONE_BASE_URL=https://api-test.znpay.tech
MOONE_CLIENT_ID=
MOONE_CLIENT_SECRET=

SESSION_DNI=14

VOLUME_PREFIX=lsd_main
IMAGE_TAG=latest
APP_CONTAINER=lsdtrip-app
COMPOSE_PROJECT_NAME=lsdtrip
EOF

chmod 600 /home/deploy/apps/lsdtrip/.env
ls -la /home/deploy/apps/lsdtrip/.env
```

Ten `ls` není kosmetika: `.env` má mít práva `-rw-------`. Kdyby se `chmod`
neprovedl (třeba proto, že se do terminálu nedostal celý blok), zůstane soubor
s hesly čitelný pro kohokoli na stroji — a na VPS běží vedle i cizí aplikace.

Hodnoty si ověř bez vypsání hesel:

```bash
cd /home/deploy/apps/lsdtrip && sed 's/=.*/=…/' .env
```

Aplikace si konfiguraci při startu zkontroluje. Když něco chybí nebo zůstane výchozí
hodnota, **nenastartuje** a do logu napíše co — nikdy neběží s poloviční konfigurací.

## P3. Zastavení staré produkce a záloha starého volume

Nový volume (`lsd_main_db`) se založí sám při prvním nasazení. Starý
(`lsdtrip_db_data`) se **nemaže hned** — zůstane na stroji jako záloha, dokud
se nová verze neosvědčí. Nic nekoliduje: nová verze na něj nesahá, protože
compose míří na jiná jména.

**Předpoklad: P0 proběhlo a vyšlo `0` poptávek.** Tady už se zpětně ověřit
nedá — `.env` je nové, takže `docker compose` míří na `lsd_main_db`.

```bash
cd /home/deploy/apps/lsdtrip
docker compose down                       # zastaví kontejnery, volume nechá
docker volume ls | grep -i lsd            # přehled, co na stroji je
```

Záloha starého volume do souboru (ten pak přežije i smazání volume):

```bash
mkdir -p /home/deploy/zalohy && docker run --rm -v lsdtrip_db_data:/data:ro \
  -v /home/deploy/zalohy:/zaloha alpine \
  tar czf "/zaloha/stary-volume-$(date +%F).tar.gz" -C /data . 2>/dev/null \
  && echo "záloha uložena" || echo "volume neexistuje, není co zálohovat"
```

Ověř, že archiv není prázdný a jde rozbalit — záloha, kterou nikdo nezkusil
otevřít, je jen soubor:

```bash
ls -la /home/deploy/zalohy/ && tar tzf /home/deploy/zalohy/stary-volume-*.tar.gz | head -5
```

### Smazání starého volume (až později)

**Provedeno 3. 10. 2026:** stará aplikace zastavená, volume zazálohovaný do
`/home/deploy/zalohy/` a **ponechaný**. Smaže se ručně, až nová verze
odběhne týden v provozu — tedy **po 10. 10. 2026**.

Do té doby starý volume zabírá místo a nic nedělá; to je záměr, ne nedodělek.
Až přijde čas:

```bash
docker volume rm lsdtrip_db_data lsdtrip_uploads
docker volume ls | grep -i lsd            # zbýt mají jen lsd_main_* a lsd_test_*
```

Maž **jen tahle dvě jména**. Volumes cizích aplikací na stroji zůstávají bez dotyku
a hromadné příkazy (`docker volume prune`) se tu nepoužívají.

Kdyby `docker volume rm` hlásil, že je volume používaný, běží ještě nějaký kontejner:

```bash
docker ps -a --filter volume=lsdtrip_db_data
docker rm -f <jméno kontejneru>
```

Po smazání zůstává záloha v `/home/deploy/zalohy/` — tu zahoď teprve tehdy,
až bude jasné, že ze staré produkce nic nikdo nechce.

## P4. Sloučení test → main

Do `main` se od teď nevyvíjí — jen se do něj slučuje ověřený `test`:

```bash
git checkout main
git merge --ff-only test
git push origin main
git checkout test          # a pokračuje se zase v testu
```

Push do `main` nasadí produkci a spustí migrace. Produkce má dosud jen migraci
`001`, takže se najednou dohání `002`–`012` — celá fáze 1 i modul kurzů. Pak
zopakuj ověření z kroku 10 pro `lsd.francik.eu`.

## P4a. První účet na produkci

Databáze je po P3 prázdná a migrace žádný účet nezakládají, takže se do
administrace nemá kdo přihlásit. Bez tohohle kroku je produkce nepoužitelná:

```bash
cd /home/deploy/apps/lsdtrip
docker compose exec app node scripts/vytvor-uzivatele.js <DOPLNIT-EMAIL> "<DOPLNIT-JMÉNO>" admin
```

Skript vypíše heslo pro první přihlášení; mění se při něm a nastaví se druhý
faktor. Další účty (provoz, instruktoři) už se zakládají v administraci.

## P5. Ověření produkce

```bash
curl -s https://lsd.francik.eu/api/health; echo      # "prostredi":"produkce"
curl -s https://lsd.francik.eu/robots.txt | head -5  # Allow: /
curl -sI https://lsd.francik.eu/admin | grep -i robots
docker inspect -f '{{.Name}} → {{.Config.Image}}' lsdtrip-app
docker volume ls | grep -i lsd                        # lsd_main_* a lsd_test_*
```

A přidej produkční řádek do cronu:

```
20 3 * * * /home/deploy/apps/lsdtrip/zaloha.sh >> /home/deploy/zaloha.log 2>&1
```

---

## Kam chodí upozornění provozu

Adresy jsou dvě a snadno se popletou. Platí **jedno pravidlo**:

> **Je-li v `.env` vyplněné `EMAIL_PROVOZ_PRIJEMCE`, upozornění chodí tam.
> Není-li, chodí na Kontaktní e-mail z Nastavení → Provoz.**
> Když není vyplněné ani jedno, neodejde nikam nic.

| `EMAIL_PROVOZ_PRIJEMCE` v `.env` | Kontaktní e-mail v administraci | Kam to odejde |
| --- | --- | --- |
| vyplněné | vyplněný | **na adresu z `.env`** |
| vyplněné | prázdný | **na adresu z `.env`** |
| prázdné | vyplněný | na adresu z administrace |
| prázdné | prázdný | nikam — a administrace to u toho pole červeně řekne |

Proč to tak je: Resend bez ověřené domény odešle jen na adresu majitele účtu,
takže kontaktní adresa z administrace by skončila chybou 403.
`EMAIL_PROVOZ_PRIJEMCE` je **dočasná objížďka, ne druhé nastavení**.

**Po ověření domény se z `.env` smaže** — tím se pravidlo samo vrátí k adrese,
kterou si spravuje majitelka. Dokud se nesmaže, administrace u toho pole
ukazuje oranžovou poznámku, že platí adresa ze serveru, a jakou.

Rozhoduje o tom jediné místo v kódu (`src/email/provoz.js`), takže se to
nemůže rozejít mezi přihláškou a poptávkou.

## Přepnutí na ostré odesílání (po ověření domény)

Dokud doména není ověřená, běží produkce na `EMAIL_REZIM=jen_provoz`: provoz
dostává upozornění, zákazníci nedostávají nic. Jakmile je doména v Resendu
ověřená, přepnutí je změna `.env` a restart — žádné nasazování ani migrace.

```bash
cd /home/deploy/apps/lsdtrip && cp -p .env ".env.pred-live-$(date +%F)" && ls -la .env*
```

V `.env` se mění tři řádky:

| Řádek | Z | Na |
| --- | --- | --- |
| `EMAIL_REZIM` | `jen_provoz` | `live` |
| `EMAIL_ODESILATEL` | `LSD <onboarding@resend.dev>` | `LSD <rezervace@ověřená-doména>` |
| `EMAIL_PROVOZ_PRIJEMCE` | adresa majitele účtu | **nechat prázdné** — viz „Kam chodí upozornění provozu“ |

`EMAIL_PROVOZ_PRIJEMCE` se musí **vyprázdnit**, jinak by upozornění dál chodila
na adresu ze serveru a kontaktní e-mail, který si majitelka nastaví
v administraci, by se neuplatnil. Administrace na to u toho pole upozorňuje,
dokud je proměnná vyplněná.

Pak restart a kontrola, že aplikace naběhla (bez `RESEND_API_KEY` by `live`
schválně nenastartovalo):

```bash
cd /home/deploy/apps/lsdtrip && docker compose up -d && sleep 8 && curl -s https://lsd.francik.eu/api/health; echo
```

Teprve potom **rozeslat, co zákazníkům nedošlo**: v administraci
**E-maily → Rozeslat neodeslané…**. Ukáže se počet a období; v jedné dávce
jde nejvýš 50 e-mailů, takže u většího množství se akce spustí víckrát.
Posílá se uložené znění, takže zákazník dostane přesně to, co mu tehdy mělo
přijít. Upozornění provozu se nedoposílají.

> Než to spustíte, projděte si, komu to odejde. Pokud jste se s lidmi mezitím
> spojila telefonem, bude to pro ně druhá zpráva — u starých přihlášek může
> být lepší nechat je být a rozeslat jen novější období.

Na závěr si pošlete jeden ostrý e-mail sama (bod 8 v
[checklist-kurzy-spusteni.md](checklist-kurzy-spusteni.md)).

## Resend na produkci

Na testu Resend není a nebude — tam stačí testovací schránka. Ostré odesílání se zapne
až v produkci, na doméně spolku. Co k tomu bude potřeba:

**Od spolku (majitelka):**

1. **Účet u Resendu** ([resend.com](https://resend.com)) na e-mail spolku, ne na osobní.
   Zdarma je 3 000 e-mailů měsíčně, 100 denně; na tandemovou sezónu to stačí, placený tarif
   (~20 USD) se dá zapnout později bez zásahu do kódu.
2. **Přístup k DNS domény `lsd-trip.cz`** — kde je doména registrovaná a kdo tam umí přidat
   záznamy. Bez toho e-maily skončí ve spamu.
3. **Adresa odesílatele**, ze které se bude psát zákazníkům (návrh: `rezervace@lsd-trip.cz`),
   a adresa pro odpovědi, pokud má být jiná.

**DNS záznamy pro `lsd-trip.cz`** (přesné hodnoty vygeneruje Resend při přidání domény,
tohle je, co se bude zadávat):

| Typ | Název | Hodnota |
| --- | --- | --- |
| TXT | `resend._domainkey` | DKIM klíč z Resendu |
| MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` (priorita 10) |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none; adkim=r; aspf=r` |

Doménu je potřeba v Resendu ověřit (tlačítko *Verify*) — teprve pak se dá posílat.

**API klíč:** vytvořit v Resendu s právem **jen odesílat** (*Sending access*) a omezením
na doménu `lsd-trip.cz`. Klíč se nikam necommituje, patří jen do `.env` na serveru:

```bash
nano /home/deploy/apps/lsdtrip/.env
```

```ini
EMAIL_REZIM=live
EMAIL_ODESILATEL=LSD <rezervace@lsd-trip.cz>
RESEND_API_KEY=re_<doplnit>
```

```bash
cd /home/deploy/apps/lsdtrip && docker compose up -d
```

Restart stačí — nic se nenasazuje. Po přepnutí pošli přes administraci jeden e-mail sobě
a zkontroluj v sekci E-maily, že má stav „odesláno“ a že v poště opravdu je.

Dokud tohle není hotové, nech produkci na `EMAIL_REZIM=vypnuto` (nebo `schranka`, pokud
chceš mít uložené, co by odešlo). Nikdy `live` bez ověřené domény — e-maily by odcházely,
ale končily by ve spamu a doména by si tím pokazila pověst.

## Když se něco pokazí

| Příznak | Co s tím |
| --- | --- |
| kontejner naběhne a hned spadne | `docker compose logs app` — aplikace píše konkrétní chybějící proměnnou |
| `required variable VOLUME_PREFIX is missing` | v `.env` chybí `VOLUME_PREFIX`, compose to schválně nepustí dál |
| Caddy vrací 502 | kontejner neběží, nebo není v síti `web`: `docker network connect web <kontejner>` |
| deploy spadne na migraci | nová verze se schválně nespustila a běží dál ta stará; oprav migraci a pusť deploy znovu |
| deploy selže na „aplikace nenaběhla do 60 s" | v logu pod tím je důvod; nejčastěji chybná hodnota v `.env`. Stará verze mezitím běží dál |
| na testu nechodí e-maily | tak to má být: `EMAIL_REZIM=schranka`, e-maily jsou v administraci v sekci E-maily |
| časy jsou posunuté o hodinu | v databázi je UTC schválně; kontroluj, co ukazuje administrace, ne co je v tabulce |
| `Table '...' doesn't exist` v logu aplikace | migrace neproběhla; `docker compose run --rm app npm run migrate` a pak `docker compose up -d` |
| test začne posílat e-maily ven | okamžitě `EMAIL_REZIM=vypnuto` a `docker compose up -d`; pak zkontroluj `EMAIL_TEST_PRIJEMCE` |
