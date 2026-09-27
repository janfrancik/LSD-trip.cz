#!/bin/sh
# scripts/zaloha.sh
#
# Denní záloha databáze a nahraných souborů. Běží na VPS z cronu, ne v
# kontejneru - záloha musí vzniknout i tehdy, když aplikace spadne.
#
# Instalace (pro každé prostředí zvlášť):
#   crontab -e
#   20 3 * * * /home/deploy/apps/lsdtrip/zaloha.sh >> /home/deploy/zaloha.log 2>&1
#   40 3 * * * /home/deploy/apps/lsdtrip-test/zaloha.sh >> /home/deploy/zaloha.log 2>&1
#
# Skript se spouští z adresáře prostředí (tam, kde leží docker-compose.yml
# a .env), takže stejný soubor slouží produkci i testu.

set -eu

ADRESAR="$(cd "$(dirname "$0")" && pwd)"
cd "$ADRESAR"

# Jméno prostředí bereme z adresáře - záloha produkce a testu se tak nepotkají.
PROSTREDI="$(basename "$ADRESAR")"
KAM="${ZALOHY_ADRESAR:-/home/deploy/backups}/$PROSTREDI"
DEN="$(date +%Y-%m-%d)"
DENNI_DNI=14
TYDENNI_TYDNY=8

# shellcheck disable=SC1091
. ./.env

mkdir -p "$KAM/denni" "$KAM/tydenni"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] záloha $PROSTREDI — start"

# --- databáze ---------------------------------------------------------------
# --single-transaction drží konzistentní obraz bez zamykání tabulek, takže
# rezervace během zálohy nespadnou.
SOUBOR_DB="$KAM/denni/db-$DEN.sql.gz"
docker compose exec -T db \
  mariadb-dump --single-transaction --routines --events \
  -u root -p"$DB_ROOT_PASSWORD" "$DB_NAME" | gzip -9 > "$SOUBOR_DB.tmp"

# Přejmenování až po úspěchu - nedokončená záloha se nesmí tvářit jako hotová.
mv "$SOUBOR_DB.tmp" "$SOUBOR_DB"

VELIKOST="$(stat -c%s "$SOUBOR_DB" 2>/dev/null || stat -f%z "$SOUBOR_DB")"
if [ "$VELIKOST" -lt 10240 ]; then
  echo "CHYBA: záloha databáze má jen $VELIKOST B, to nesedí. Ponechávám k prozkoumání."
  exit 1
fi

# --- nahrané soubory --------------------------------------------------------
# Fotky jsou v pojmenovaném volume; tar je vytáhne přes dočasný kontejner.
SOUBOR_UP="$KAM/denni/uploads-$DEN.tar.gz"
VOLUME="${VOLUME_PREFIX}_uploads"
if docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  docker run --rm -v "$VOLUME:/data:ro" -v "$KAM/denni:/zaloha" alpine \
    tar czf "/zaloha/uploads-$DEN.tar.gz.tmp" -C /data . 2>/dev/null
  mv "$SOUBOR_UP.tmp" "$SOUBOR_UP"
else
  echo "volume $VOLUME zatím neexistuje (fotky přijdou ve fázi 5) — přeskakuji"
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
