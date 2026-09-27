// Zálohovací skript čte .env, který obsahuje hodnoty jako
//   EMAIL_ODESILATEL=LSD test <rezervace@lsd.francik.eu>
// Načítání přes ". ./.env" na tomhle řádku spadlo ("<" je pro shell
// přesměrování vstupu). Testy hlídají, že se to nevrátí.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skript = path.join(__dirname, '..', 'scripts', 'zaloha.sh');

// Spustí zálohovací skript v dočasném adresáři s daným .env.
// Režim --kontrola jen přečte .env a vypíše, co v něm našel - nesahá na Docker.
function spust(obsahEnv, { nazevAdresare = 'lsdtrip-test' } = {}) {
  const koren = mkdtempSync(path.join(tmpdir(), 'lsd-zaloha-'));
  const adresar = path.join(koren, nazevAdresare);
  execFileSync('mkdir', ['-p', adresar]);
  copyFileSync(skript, path.join(adresar, 'zaloha.sh'));
  writeFileSync(path.join(adresar, '.env'), obsahEnv);

  try {
    const vystup = execFileSync('sh', [path.join(adresar, 'zaloha.sh'), '--kontrola'], {
      encoding: 'utf8',
      env: { ...process.env, ZALOHY_ADRESAR: path.join(koren, 'zalohy') },
    });
    return Object.fromEntries(
      vystup.trim().split('\n').map((radek) => {
        const i = radek.indexOf('=');
        return [radek.slice(0, i), radek.slice(i + 1)];
      })
    );
  } finally {
    rmSync(koren, { recursive: true, force: true });
  }
}

// Přesně ten .env, který skript na VPS shodil.
const ENV_Z_VPS = `NODE_ENV=production
PORT=3000
APP_URL=https://test-lsd.francik.eu
PROSTREDI=test
DB_HOST=db
DB_PORT=3306
DB_NAME=lsdtrip_test
DB_USER=lsdtrip
DB_PASSWORD=abc123xyz
DB_ROOT_PASSWORD=rootheslo456
ROBOTS=zakazat
EMAIL_REZIM=vypnuto
EMAIL_TEST_PRIJEMCE=honza.francik@gmail.com
EMAIL_ODESILATEL=LSD test <rezervace@lsd.francik.eu>
RESEND_API_KEY=
MOONE_BASE_URL=https://api-test.znpay.tech
SESSION_DNI=14
VOLUME_PREFIX=lsd_test
IMAGE_TAG=test
APP_CONTAINER=lsdtrip-test-app
COMPOSE_PROJECT_NAME=lsdtrip-test
`;

test('.env s lomenými závorkami skript neshodí', () => {
  // Původní chyba: ./.env: Syntax error: newline unexpected
  const v = spust(ENV_Z_VPS);

  assert.equal(v.db_name, 'lsdtrip_test');
  assert.equal(v.volume_prefix, 'lsd_test');
  assert.equal(v.delka_hesla, '12');
  assert.equal(v.prostredi, 'lsdtrip-test');
});

test('hodnoty s mezerami, uvozovkami a rovnítkem se přečtou celé', () => {
  const v = spust(`DB_NAME=lsdtrip_test
VOLUME_PREFIX=lsd_test
DB_ROOT_PASSWORD=a b"c'd=e<f>g
EMAIL_ODESILATEL=LSD test <rezervace@example.invalid>
POZNAMKA=hodnota s $(prikazem) a \`backtickem\`
`);

  // "=" uvnitř hodnoty nesmí hodnotu uříznout, znaky se nesmí interpretovat.
  assert.equal(v.delka_hesla, String('a b"c\'d=e<f>g'.length));
  assert.equal(v.db_name, 'lsdtrip_test');
});

test('obalující uvozovky se odstraní, vnitřní zůstanou', () => {
  const v = spust(`DB_NAME="lsdtrip_test"
VOLUME_PREFIX='lsd_test'
DB_ROOT_PASSWORD="he"slo"
`);

  assert.equal(v.db_name, 'lsdtrip_test');
  assert.equal(v.volume_prefix, 'lsd_test');
  assert.equal(v.delka_hesla, String('he"slo'.length));
});

test('podobně pojmenovaný klíč se neplete s tím správným', () => {
  const v = spust(`STARE_DB_NAME=nespravna
DB_NAME=lsdtrip_test
VOLUME_PREFIX=lsd_test
DB_ROOT_PASSWORD=heslo123
`);

  assert.equal(v.db_name, 'lsdtrip_test');
});

test('konce řádků z Windows nezanesou do hodnoty CR', () => {
  const v = spust('DB_NAME=lsdtrip_test\r\nVOLUME_PREFIX=lsd_test\r\nDB_ROOT_PASSWORD=heslo123\r\n');

  assert.equal(v.db_name, 'lsdtrip_test');
  assert.equal(v.volume_prefix, 'lsd_test');
  assert.equal(v.delka_hesla, '8', 'CR by hodnotu prodloužil o znak');
});

test('chybějící povinná proměnná skript zastaví se srozumitelnou hláškou', () => {
  assert.throws(
    () => spust('DB_NAME=lsdtrip_test\nVOLUME_PREFIX=lsd_test\n'),
    (err) => {
      const vystup = String(err.stderr ?? '') + String(err.stdout ?? '');
      assert.match(vystup, /DB_ROOT_PASSWORD/);
      return true;
    }
  );
});

test('bez .env se záloha vůbec nerozjede', () => {
  const koren = mkdtempSync(path.join(tmpdir(), 'lsd-zaloha-'));
  copyFileSync(skript, path.join(koren, 'zaloha.sh'));
  try {
    assert.throws(
      () => execFileSync('sh', [path.join(koren, 'zaloha.sh'), '--kontrola'], { encoding: 'utf8' }),
      (err) => {
        assert.match(String(err.stderr ?? '') + String(err.stdout ?? ''), /není soubor \.env/);
        return true;
      }
    );
  } finally {
    rmSync(koren, { recursive: true, force: true });
  }
});

test('archiv fotek nevzniká jako root', () => {
  // Bez --user běží kontejner jako root a tar.gz na hostiteli patří root:root.
  // Uživatel deploy by se k němu nedostal a rotace by ho nesmazala.
  const zdroj = execFileSync('cat', [skript], { encoding: 'utf8' });

  assert.match(
    zdroj,
    /docker run --rm --user "\$\(id -u\):\$\(id -g\)"/,
    'docker run pro archiv fotek musí běžet pod uživatelem, který skript spustil'
  );
});

test('heslo se nikde nepředává v příkazové řádce', () => {
  // Kdyby se heslo dostalo do argumentů, bylo by vidět v ps - jak na
  // hostiteli (docker compose exec -e), tak v kontejneru (mariadb-dump -p).
  const zdroj = execFileSync('cat', [skript], { encoding: 'utf8' });

  assert.ok(!/-p"\$DB_ROOT_PASSWORD"/.test(zdroj), 'mariadb-dump nesmí dostat -p s heslem');
  assert.ok(!/-e MYSQL_PWD=/.test(zdroj), 'docker compose exec -e by heslo ukázal v ps hostitele');
  assert.match(zdroj, /printf '%s\\n' "\$DB_ROOT_PASSWORD" \| docker compose exec -T/,
    'heslo se má posílat na stdin');
});
