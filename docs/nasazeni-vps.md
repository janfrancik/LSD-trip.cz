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

# Na testu se e-maily NEODESÍLAJÍ. Ukládají se celé do administrace
# (menu E-maily = testovací schránka), včetně odkazů, na které jde kliknout -
# pozvánka i reset hesla se tak dají projít bez Resendu. Klíč sem nepatří.
EMAIL_REZIM=schranka
# Používá se jen v režimu EMAIL_REZIM=test (kdyby bylo potřeba ověřit
# i skutečné doručení). V režimu schranka se neuplatní.
EMAIL_TEST_PRIJEMCE=honza.francik@gmail.com
EMAIL_ODESILATEL=LSD test <rezervace@lsd.francik.eu>
RESEND_API_KEY=

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

Až přijde řada, postup je: nové `.env` → odstranění starého volume → sloučení větve.

## P1. Hesla produkce

Jiná než na testu:

```bash
echo "db:   $(openssl rand -base64 24 | tr -d '/+=')"
echo "root: $(openssl rand -base64 24 | tr -d '/+=')"
```

## P2. `.env` pro produkci

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

ROBOTS=povolit

# Produkce zůstává na "vypnuto", dokud nebude ověřená doména v Resendu.
# Teprve pak EMAIL_REZIM=live - do té doby se e-maily jen zapisují do logu.
EMAIL_REZIM=vypnuto
EMAIL_TEST_PRIJEMCE=
EMAIL_ODESILATEL=LSD <rezervace@lsd.francik.eu>
RESEND_API_KEY=

# I produkce jede zatím proti testovacímu Mo.one. Přepnutí na ostrou bránu
# je změna těchhle tří řádků a restart, žádné nasazování.
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
```

Aplikace si konfiguraci při startu zkontroluje. Když něco chybí nebo zůstane výchozí
hodnota, **nenastartuje** a do logu napíše co — nikdy neběží s poloviční konfigurací.

## P3. Odstranění starého volume produkce

Produkční databáze je prázdná, nic se nezachovává. Starý volume proto zmizí a
nový (`lsd_main_db`) se založí při prvním nasazení.

```bash
cd /home/deploy/apps/lsdtrip
docker compose down                       # zastaví kontejnery, volume nechá
docker volume ls | grep -i lsd            # přehled, co na stroji je
```

Zálohu si pro jistotu udělej i tak — stojí to deset vteřin:

```bash
docker run --rm -v lsdtrip_db_data:/data:ro -v /home/deploy:/zaloha alpine \
  tar czf /zaloha/stary-volume-$(date +%F).tar.gz -C /data . 2>/dev/null \
  && echo "záloha uložena" || echo "volume neexistuje, není co zálohovat"
```

Teprve potom:

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

## P4. Sloučení test → main

Do `main` se od teď nevyvíjí — jen se do něj slučuje ověřený `test`:

```bash
git checkout main
git merge --ff-only test
git push origin main
git checkout test          # a pokračuje se zase v testu
```

Push do `main` nasadí produkci a spustí migrace. Pak zopakuj ověření z kroku 10
pro `lsd.francik.eu`.


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
| na testu nechodí e-maily | tak to má být: `EMAIL_REZIM=schranka`, e-maily jsou v administraci v sekci E-maily |
| časy jsou posunuté o hodinu | v databázi je UTC schválně; kontroluj, co ukazuje administrace, ne co je v tabulce |
| `Table '...' doesn't exist` v logu aplikace | migrace neproběhla; `docker compose run --rm app npm run migrate` a pak `docker compose up -d` |
| test začne posílat e-maily ven | okamžitě `EMAIL_REZIM=vypnuto` a `docker compose up -d`; pak zkontroluj `EMAIL_TEST_PRIJEMCE` |
