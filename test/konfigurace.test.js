// Start aplikace s konfigurací, která je doopravdy na serveru.
//
// Vzniklo z pádu na testu: kontejner se po přepnutí na EMAIL_REZIM=schranka
// zacyklil na hlášce "V produkci musí být nastaveno: RESEND_API_KEY". Příčina
// byla v tom, že se "produkce" poznávala podle NODE_ENV, který je production
// i na testu. V testech ta kombinace (PROSTREDI=test + NODE_ENV=production)
// do té doby nebyla, takže to nic nechytlo.
//
// Proto se .env pro test nepíše tady znovu, ale bere se z návodu
// (docs/nasazeni-vps.md) - když se rozejde s tím, co aplikace umí, spadne test.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pripravDatabazi } from './pomocnik.js';
import { REZIMY_EMAILU } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

before(async () => {
  // Aplikace se při startu ptá databáze na healthcheck, takže musí existovat.
  await pripravDatabazi();
});

// .env pro test tak, jak ho má server - vytažené z návodu.
function envZNavodu() {
  const navod = readFileSync(path.join(rootDir, 'docs', 'nasazeni-vps.md'), 'utf8');
  const blok = navod.match(/cat > \/home\/deploy\/apps\/lsdtrip-test\/\.env <<'EOF'\n([\s\S]*?)\nEOF/);
  assert.ok(blok, 'v docs/nasazeni-vps.md musí být .env pro test');

  const env = {};
  for (const radek of blok[1].split('\n')) {
    if (!radek.trim() || radek.trim().startsWith('#')) continue;
    const index = radek.indexOf('=');
    if (index < 0) continue;
    env[radek.slice(0, index).trim()] = radek.slice(index + 1).trim();
  }

  assert.equal(env.PROSTREDI, 'test');
  assert.equal(env.NODE_ENV, 'production', 'v kontejneru je NODE_ENV=production i na testu');

  return {
    ...env,
    // Hesla jsou v návodu jako <DOPLNIT-...>; připojení míří na testovací
    // databázi téhle sady testů, ne na server.
    DB_HOST: '127.0.0.1',
    // pomocnik.js už na testovací databázi ukazuje, přidávat "_test" znovu
    // by vedlo na lsdtrip_test_test.
    DB_NAME: process.env.DB_NAME,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_ROOT_PASSWORD: process.env.DB_ROOT_PASSWORD,
    UPLOAD_DIR: process.env.UPLOAD_DIR,
  };
}

// Spustí aplikaci v samostatném procesu (config.js se čte při načtení modulu,
// v jednom procesu by se přepnout nedalo) a zkusí healthcheck.
//
// Potomek se NEUKONČUJE přes process.exit(). Na Windows se tím libuv rozbije
// ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)", návratový kód 127)
// a execFileSync to vyhodnotí jako nenastartovanou aplikaci, i když se výsledek
// už stihl vypsat. Místo toho se poctivě zavře server i databázový pool
// a proces doběhne sám, protože nezbude žádný handle.
//
// Ze stejného důvodu se na healthcheck neptá přes fetch: undici si drží spojení
// v keep-alive poolu, který proces udržuje naživu. `node:http` s `agent: false`
// zavře socket hned.
function spustAplikaci(zmeny) {
  const skript = `
    const http = await import('node:http');
    const { vytvorApp } = await import('./src/app.js');
    const config = (await import('./src/config.js')).default;
    const pool = (await import('./src/db.js')).default;

    const server = vytvorApp().listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;

    const odpoved = await new Promise((splnit, odmitnout) => {
      const dotaz = http.request(
        { host: '127.0.0.1', port, path: '/api/health', agent: false },
        (res) => {
          let telo = '';
          res.on('data', (kus) => { telo += kus; });
          res.on('end', () => splnit({ status: res.statusCode, telo }));
        }
      );
      dotaz.on('error', odmitnout);
      dotaz.end();
    });
    const data = JSON.parse(odpoved.telo);

    console.log('VYSLEDEK ' + JSON.stringify({
      health: odpoved.status,
      prostredi: data.prostredi,
      jeProdukce: config.jeProdukce,
      jeHttps: config.jeHttps,
      rezim: config.EMAIL_REZIM,
    }));

    await new Promise((r) => server.close(r));
    await pool.end();
  `;

  try {
    const vystup = execFileSync(process.execPath, ['--input-type=module', '-e', skript], {
      cwd: rootDir,
      encoding: 'utf8',
      env: { ...process.env, ...envZNavodu(), ...zmeny },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const radek = vystup.split('\n').find((r) => r.startsWith('VYSLEDEK '));
    return { nastartovala: true, ...JSON.parse(radek.slice('VYSLEDEK '.length)) };
  } catch (chyba) {
    return {
      nastartovala: false,
      vystup: `${chyba.stdout ?? ''}${chyba.stderr ?? ''}`.trim(),
    };
  }
}

test('testovací .env ze serveru nastartuje ve všech režimech e-mailů', () => {
  for (const rezim of ['vypnuto', 'schranka', 'test']) {
    const vysledek = spustAplikaci({ EMAIL_REZIM: rezim, RESEND_API_KEY: '' });

    assert.equal(
      vysledek.nastartovala,
      true,
      `EMAIL_REZIM=${rezim} musí nastartovat i bez RESEND_API_KEY:\n${vysledek.vystup ?? ''}`
    );
    assert.equal(vysledek.health, 200);
    assert.equal(vysledek.prostredi, 'test');
    assert.equal(vysledek.rezim, rezim);
  }
});

test('test se netváří jako produkce, ale cookies má zabezpečené', () => {
  const vysledek = spustAplikaci({ EMAIL_REZIM: 'schranka', RESEND_API_KEY: '' });

  // NODE_ENV=production tady je, ale o prostředí rozhoduje PROSTREDI.
  assert.equal(vysledek.jeProdukce, false, 'test není produkce, i když má NODE_ENV=production');
  // Zabezpečení cookies se řídí adresou (https), ne prostředím.
  assert.equal(vysledek.jeHttps, true, 'test jede po HTTPS, cookie musí být Secure');
});

test('ostrý režim bez klíče aplikaci nepustí dál', () => {
  const vysledek = spustAplikaci({ EMAIL_REZIM: 'live', RESEND_API_KEY: '' });

  assert.equal(vysledek.nastartovala, false, 'live bez klíče by tiše neposílalo e-maily');
  assert.match(vysledek.vystup, /EMAIL_REZIM=live vyžaduje RESEND_API_KEY/);
  assert.ok(
    !/V produkci musí být nastaveno/.test(vysledek.vystup),
    'hláška nesmí mluvit o produkci, když běží test'
  );
});

test('ostrý režim s klíčem na testu nastartuje', () => {
  const vysledek = spustAplikaci({ EMAIL_REZIM: 'live', RESEND_API_KEY: 're_zkouska' });
  assert.equal(vysledek.nastartovala, true, vysledek.vystup ?? '');
  assert.equal(vysledek.rezim, 'live');
});

test('v produkci nesmí zůstat testovací schránka', () => {
  const vysledek = spustAplikaci({
    PROSTREDI: 'produkce',
    APP_URL: 'https://www.lsd-trip.cz',
    EMAIL_ODESILATEL: 'LSD <rezervace@lsd-trip.cz>',
    EMAIL_REZIM: 'schranka',
  });

  assert.equal(vysledek.nastartovala, false, 'schránka v produkci = zákazníkům nic nechodí');
  assert.match(vysledek.vystup, /schranka je jen pro test/);
});

test('produkce se nespustí s vývojovými hodnotami', () => {
  const vysledek = spustAplikaci({
    PROSTREDI: 'produkce',
    APP_URL: 'http://127.0.0.1:3000',
    EMAIL_REZIM: 'vypnuto',
  });

  assert.equal(vysledek.nastartovala, false);
  assert.match(vysledek.vystup, /v produkci musí být nastaveno: APP_URL/);
});

test('ostrý režim se jmenuje live a překlep to řekne', () => {
  const vysledek = spustAplikaci({ EMAIL_REZIM: 'ostry' });

  assert.equal(vysledek.nastartovala, false);
  // Seznam režimů se bere z REZIMY_EMAILU, ne z opisu tady - jinak by test
  // padal při každém přidání režimu a nutil opravovat sám sebe.
  assert.match(vysledek.vystup, /EMAIL_REZIM smí být: /);
  for (const rezim of REZIMY_EMAILU) {
    assert.ok(
      vysledek.vystup.includes(rezim),
      `nápověda musí vypsat i režim "${rezim}", jinak ho člověk nenajde`
    );
  }
  assert.match(vysledek.vystup, /ne "ostry"/);
});

test('v repozitáři se ostrému režimu nikde neříká jinak než live', () => {
  const soubory = ['README.md', 'CLAUDE.md', '.env.example', 'docs/nasazeni-vps.md'];
  for (const soubor of soubory) {
    const obsah = readFileSync(path.join(rootDir, soubor), 'utf8');
    assert.ok(
      !/EMAIL_REZIM\s*=\s*ostry/.test(obsah),
      `${soubor} používá jiný název ostrého režimu než "live"`
    );
  }
});
