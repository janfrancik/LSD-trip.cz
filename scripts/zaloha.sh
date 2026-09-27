#!/bin/sh
# scripts/zaloha.sh
#
# Denní záloha databáze a nahraných souborů. Běží na VPS z cronu, ne v
# kontejneru - záloha musí vzniknout i tehdy, když aplikace spadne.
#
# Instalace (pro každé prostředí zvlášť):
#   crontab -e
#   20 3 * * * /home/deploy/apps/lsdtrip/zaloha.sh      >> /home/deploy/zaloha.log 2>&1
#   40 3 * * * /home/deploy/apps/lsdtrip-test/zaloha.sh >> /home/deploy/zaloha.log 2>&1
#
# Skript se spouští z adresáře prostředí (tam, kde leží docker-compose.yml
# a .env), takže stejný soubor slouží produkci i testu.
#
# Kontrolní běh bez zálohování - vypíše, co si přečetl z .env:
#   ./zaloha.sh --kontrola

set -eu

ADRESAR="$(cd "$(dirname "$0")" && pwd)"
cd "$ADRESAR"

# Jméno prostředí bereme z adresáře - záloha produkce a testu se tak nepotkají.
PROSTREDI="$(basename "$ADRESAR")"
DEN="$(date +%Y-%m-%d)"
DENNI_DNI=14
TYDENNI_TYDNY=8

# ---------------------------------------------------------------- čtení .env
#
# Soubor .env se SCHVÁLNĚ nenačítá přes ". ./.env". Hodnoty v něm nejsou
# shellové výrazy: EMAIL_ODESILATEL=LSD test <rezervace@...> obsahuje "<",
# které by shell vzal jako přesměrování vstupu a skript by spadl na
# "Syntax error: newline unexpected".
#
# Tahle funkce vytáhne jen holou hodnotu: bere poslední výskyt klíče, vše za
# PRVNÍM rovnítkem (takže "=" v hodnotě nevadí), zahodí CR z Windows konců
# řádků a případné obalující uvozovky. Mezery, "<", ">" ani uvozovky uvnitř
# hodnoty se nijak neinterpretují.
precti_env() {
  klic="$1"
  soubor="${2:-.env}"
  [ -f "$soubor" ] || return 1
  sed -n "s/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}${klic}=//p" "$soubor" \
    | tail -n 1 \
    | sed -e 's/\r$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

if [ ! -f .env ]; then
  echo "CHYBA: v $ADRESAR není soubor .env."
  exit 1
fi

DB_NAME="$(precti_env DB_NAME)"
DB_ROOT_PASSWORD="$(precti_env DB_ROOT_PASSWORD)"
VOLUME_PREFIX="$(precti_env VOLUME_PREFIX)"

chybi=""
[ -n "$DB_NAME" ] || chybi="$chybi DB_NAME"
[ -n "$DB_ROOT_PASSWORD" ] || chybi="$chybi DB_ROOT_PASSWORD"
[ -n "$VOLUME_PREFIX" ] || chybi="$chybi VOLUME_PREFIX"
if [ -n "$chybi" ]; then
  echo "CHYBA: v .env chybí nebo jsou prázdné:$chybi"
  exit 1
fi

KAM="${ZALOHY_ADRESAR:-/home/deploy/backups}/$PROSTREDI"

# Kontrolní režim: ověří, že se .env přečetl správně, a skončí. Heslo se
# nevypisuje, jen jeho délka - ať se dá porovnat, aniž by skončilo v logu.
if [ "${1:-}" = "--kontrola" ]; then
  echo "prostredi=$PROSTREDI"
  echo "db_name=$DB_NAME"
  echo "volume_prefix=$VOLUME_PREFIX"
  echo "delka_hesla=$(printf %s "$DB_ROOT_PASSWORD" | wc -c | tr -d ' ')"
  echo "kam=$KAM"
  exit 0
fi

mkdir -p "$KAM/denni" "$KAM/tydenni"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] záloha $PROSTREDI — start"

# --- databáze ---------------------------------------------------------------
#
# --single-transaction drží konzistentní obraz bez zamykání tabulek, takže
# rezervace během zálohy nespadnou.
#
# Heslo se nepředává ani přes "-p" (bylo by vidět v ps uvnitř kontejneru),
# ani přes "docker compose exec -e" (bylo by vidět v ps na hostiteli).
# Posílá se na stdin a uvnitř kontejneru se z něj udělá MYSQL_PWD, takže
# se nikde neobjeví v seznamu procesů.
SOUBOR_DB="$KAM/denni/db-$DEN.sql.gz"

printf '%s\n' "$DB_ROOT_PASSWORD" | docker compose exec -T db sh -c '
  read -r MYSQL_PWD
  export MYSQL_PWD
  exec mariadb-dump --single-transaction --routines --events -u root "$0"
' "$DB_NAME" | gzip -9 > "$SOUBOR_DB.tmp"

# --- ověření zálohy ---------------------------------------------------------
#
# Kontrola velikosti tu schválně není: na skoro prázdné testovací databázi by
# padala každou noc. Smysl dává ověřit, že archiv není poškozený a že dump
# doběhl do konce - mariadb-dump na závěr píše "-- Dump completed".
if ! gzip -t "$SOUBOR_DB.tmp" 2>/dev/null; then
  echo "CHYBA: záloha databáze je poškozená (gzip -t neprošel). Nechávám .tmp k prozkoumání."
  exit 1
fi

if ! gzip -dc "$SOUBOR_DB.tmp" | tail -n 5 | grep -q '^-- Dump completed'; then
  echo "CHYBA: dump nedoběhl do konce (chybí '-- Dump completed'). Nechávám .tmp k prozkoumání."
  exit 1
fi

# Přejmenování až po ověření - nedokončená záloha se nesmí tvářit jako hotová.
mv "$SOUBOR_DB.tmp" "$SOUBOR_DB"
echo "  databáze: $(du -h "$SOUBOR_DB" | cut -f1)"

# --- nahrané soubory --------------------------------------------------------
# Fotky jsou v pojmenovaném volume; tar je vytáhne přes dočasný kontejner.
SOUBOR_UP="$KAM/denni/uploads-$DEN.tar.gz"
VOLUME="${VOLUME_PREFIX}_uploads"

if docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  # --user: bez něj běží kontejner jako root a archiv vznikne jako root:root,
  # takže by k němu uživatel deploy neměl přístup a rotace by ho nesmazala.
  # Fotky ukládá aplikace s právy 0644, takže je non-root přečte; kdyby ne,
  # tar skončí chybou a skript spadne - což je lepší než tichá neúplná záloha.
  docker run --rm --user "$(id -u):$(id -g)" \
    -v "$VOLUME:/data:ro" -v "$KAM/denni:/zaloha" alpine \
    tar czf "/zaloha/uploads-$DEN.tar.gz.tmp" -C /data .
  if gzip -t "$SOUBOR_UP.tmp" 2>/dev/null; then
    mv "$SOUBOR_UP.tmp" "$SOUBOR_UP"
    echo "  fotky: $(du -h "$SOUBOR_UP" | cut -f1)"
  else
    echo "CHYBA: archiv fotek je poškozený. Nechávám .tmp k prozkoumání."
    exit 1
  fi
else
  echo "  fotky: volume $VOLUME zatím neexistuje (přijdou ve fázi 5) — přeskakuji"
fi

# --- týdenní kopie ----------------------------------------------------------
# V neděli si necháme kopii stranou, ať je z čeho obnovit i starší stav.
if [ "$(date +%u)" = "7" ]; then
  cp "$SOUBOR_DB" "$KAM/tydenni/"
  [ -f "$SOUBOR_UP" ] && cp "$SOUBOR_UP" "$KAM/tydenni/"
fi

# --- rotace -----------------------------------------------------------------
find "$KAM/denni" -name '*.gz' -mtime "+$DENNI_DNI" -delete
find "$KAM/tydenni" -name '*.gz' -mtime "+$((TYDENNI_TYDNY * 7))" -delete
find "$KAM" -name '*.tmp' -mtime +1 -delete

echo "[$(date '+%Y-%m-%d %H:%M:%S')] záloha $PROSTREDI — hotovo ($(du -sh "$KAM" | cut -f1))"
