// Bezpečnostní hlavičky, indexace a pravidlo "žádná doména v kódu".

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pripravDatabazi, spustServer, vytvorKlienta } from './pomocnik.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

let server;
let pool;

before(async () => {
  await pripravDatabazi();
  pool = (await import('../src/db.js')).default;
  server = await spustServer();
});

after(async () => {
  await server.zavri();
  await pool.end();
});

test('odpovědi nesou bezpečnostní hlavičky', async () => {
  const odpoved = await fetch(server.url + '/');
  const csp = odpoved.headers.get('content-security-policy');

  assert.ok(csp, 'musí být Content-Security-Policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  // Skripty jen z vlastní domény - žádné inline ani cizí.
  assert.match(csp, /script-src 'self'/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "script-src nesmí mít 'unsafe-inline'");

  assert.equal(odpoved.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(odpoved.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.ok(!odpoved.headers.get('x-powered-by'), 'nehlásíme, na čem běžíme');
});

test('administrace se nikdy nesmí dostat do vyhledávačů', async () => {
  const admin = await fetch(server.url + '/admin');
  assert.match(admin.headers.get('x-robots-tag') ?? '', /noindex/);

  const api = await fetch(server.url + '/api/health');
  assert.match(api.headers.get('x-robots-tag') ?? '', /noindex/);
});

test('robots.txt se řídí nastavením prostředí', async () => {
  const config = (await import('../src/config.js')).default;

  // Testy běží s ROBOTS=zakazat.
  const zakazano = await (await fetch(server.url + '/robots.txt')).text();
  assert.match(zakazano, /Disallow: \//);
  assert.ok(!zakazano.includes('Allow: /'), 'zakázané prostředí nic nepovoluje');

  // A v produkčním nastavení naopak výslovně pouští AI crawlery.
  const puvodni = config.ROBOTS;
  config.ROBOTS = 'povolit';
  try {
    const povoleno = await (await fetch(server.url + '/robots.txt')).text();
    for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'OAI-SearchBot', 'Google-Extended']) {
      assert.ok(povoleno.includes(`User-agent: ${bot}`), `${bot} musí být výslovně povolený`);
    }
    assert.match(povoleno, /Disallow: \/admin/);
    assert.match(povoleno, /Sitemap: /);
  } finally {
    config.ROBOTS = puvodni;
  }
});

test('velké tělo požadavku se odmítne', async () => {
  const klient = vytvorKlienta(server.url);
  const odpoved = await klient.post('/api/poptavky', {
    jmeno: 'Jan',
    email: 'jan@example.invalid',
    zprava: 'x'.repeat(200_000),
  });
  assert.equal(odpoved.status, 413);
});

test('nečitelný JSON nespadne jako 500', async () => {
  const odpoved = await fetch(server.url + '/api/poptavky', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{tohle není json',
  });
  assert.equal(odpoved.status, 400);
});

// Přechod na lsd-trip.cz musí být jen změna .env. Projde zadaný adresář
// a vrátí každý řádek, kde je doména napsaná natvrdo.
const ZAKAZANE_DOMENY = [/lsd-trip\.cz/i, /francik\.eu/i];

async function najdiDomeny(adresar, pripony) {
  const nalezy = [];

  async function projdi(kde) {
    for (const polozka of await readdir(kde, { withFileTypes: true })) {
      const cesta = path.join(kde, polozka.name);
      if (polozka.isDirectory()) {
        await projdi(cesta);
        continue;
      }
      if (!pripony.some((pripona) => polozka.name.endsWith(pripona))) continue;

      const obsah = await readFile(cesta, 'utf8');
      obsah.split('\n').forEach((radek, i) => {
        // Bezpečnostní politika CSP musí starý web zmínit (fotky se z něj
        // do fáze 5 načítají) - to je vědomá výjimka, ne opomenutí.
        if (cesta.endsWith('bezpecnost.js')) return;
        for (const vzor of ZAKAZANE_DOMENY) {
          if (vzor.test(radek)) nalezy.push(`${path.relative(rootDir, cesta)}:${i + 1}: ${radek.trim()}`);
        }
      });
    }
  }

  await projdi(adresar);
  return nalezy;
}

test('v kódu aplikace není natvrdo napsaná doména', async () => {
  // Kdyby se do src/ vloudila konkrétní doména, tenhle test to chytí dřív,
  // než se na to přijde v produkci.
  const nalezy = await najdiDomeny(path.join(rootDir, 'src'), ['.js']);

  assert.deepEqual(
    nalezy,
    [],
    'Doména patří do APP_URL v .env, ne do kódu:\n' + nalezy.join('\n')
  );
});

// Co ve `public/` zbývá ze starého webu. Jsou to adresy fotek na titulce
// (hero, produkty, aktuality, tým, galerie) a kontaktní e-mail. Fotky se
// přenesou do vlastního úložiště až ve fázi 5 ("Migrace fotek ze starého
// webu" v docs/plan-administrace.md §7), do té doby se z něj načítají.
//
// Tohle NENÍ výjimka pro celé soubory - je to vyjmenovaný seznam toho, co
// tam dnes je. Cokoli dalšího test shodí, takže nová natvrdo napsaná doména
// se do webu nedostane. Jak budou fotky ubývat, bude se seznam zkracovat;
// až bude prázdný, zůstane z testu totéž co u `src/`.
const STARY_WEB_ZATIM_POVOLENO = {
  'public/assets/js/app.js': [
    // Kontaktní e-mail. Do nastavení patří taky (provoz.email už existuje),
    // napojí se při převodu obsahu webu na databázi.
    'mailto:info@lsd-trip.cz',
    '>info@lsd-trip.cz</a></div></div>',
  ],
  'public/assets/js/data.js': [
    'https://www.lsd-trip.cz/image/eshop/1512969318_image_gopr3595_00_00_49_00_49.jpg',
    'https://www.lsd-trip.cz/image/eshop/1512893393_image_img_5635ab.jpeg',
    'https://www.lsd-trip.cz/image/eshop/1512986228_image_vlcsnap-2017-04-02-20h56m57s323.png',
    'https://www.lsd-trip.cz/image/carousel/1652266303_1_image_28350.jpg',
    'https://www.lsd-trip.cz/image/carousel/1512896173_1_image_zv2.jpg',
    'https://www.lsd-trip.cz/image/gallery/',
    'https://www.lsd-trip.cz/image/news/1787649526_1_image_srpen1.jpg',
    'https://www.lsd-trip.cz/image/news/1786465737_1_image_bc527bf2-415c-40dc-a6b9-db69180468aa.jpg',
    'https://www.lsd-trip.cz/image/news/1785300889_1_image_vlcsnap-2026-07-28-17h53m57s259.jpg',
    'https://www.lsd-trip.cz/image/member/',
  ],
  'public/index.html': [
    // Obrázek do náhledu při sdílení na sítích.
    'https://www.lsd-trip.cz/image/eshop/1512969318_image_gopr3595_00_00_49_00_49.jpg',
  ],
};

// Celé adresy a e-maily, ne jen řádky - číslo řádku se posune při každé úpravě
// souboru a seznam by se musel přepisovat pořád dokola.
const VZOR_ADRESY = /[^\s'"`(),]*(?:lsd-trip\.cz|francik\.eu)[^\s'"`(),]*/gi;

async function najdiAdresy(adresar, pripony) {
  const podleSouboru = {};

  async function projdi(kde) {
    for (const polozka of await readdir(kde, { withFileTypes: true })) {
      const cesta = path.join(kde, polozka.name);
      if (polozka.isDirectory()) {
        await projdi(cesta);
        continue;
      }
      if (!pripony.some((pripona) => polozka.name.endsWith(pripona))) continue;

      const shody = (await readFile(cesta, 'utf8')).match(VZOR_ADRESY);
      if (!shody) continue;

      const klic = path.relative(rootDir, cesta).split(path.sep).join('/');
      podleSouboru[klic] = [...new Set(shody)];
    }
  }

  await projdi(adresar);
  return podleSouboru;
}

test('ve veřejném webu nepřibyla žádná natvrdo napsaná doména', async (t) => {
  // navrh_2/ je statická ukázka pro majitelku, ne kód aplikace - neprochází se.
  const nalezeno = await najdiAdresy(path.join(rootDir, 'public'), ['.js', '.html', '.css']);

  const nove = [];
  for (const [soubor, adresy] of Object.entries(nalezeno)) {
    const povolene = STARY_WEB_ZATIM_POVOLENO[soubor] ?? [];
    for (const adresa of adresy) {
      if (!povolene.includes(adresa)) nove.push(`${soubor}: ${adresa}`);
    }
  }

  assert.deepEqual(
    nove,
    [],
    'Nová natvrdo napsaná doména ve veřejném webu. Absolutní adresy se skládají\n' +
      'z APP_URL, obrázky se nahrávají do administrace a servírují z /media/:id.\n' +
      'Kdyby to opravdu byla další fotka ze starého webu, doplň ji do\n' +
      'STARY_WEB_ZATIM_POVOLENO i s důvodem:\n' + nove.join('\n')
  );

  // Až se fotka přenese, má zmizet i ze seznamu - jinak by v něm zůstaly
  // položky, které už nic nehlídají, a nikdo by nepoznal, kolik práce zbývá.
  const zbytecne = [];
  for (const [soubor, adresy] of Object.entries(STARY_WEB_ZATIM_POVOLENO)) {
    for (const adresa of adresy) {
      if (!(nalezeno[soubor] ?? []).includes(adresa)) zbytecne.push(`${soubor}: ${adresa}`);
    }
  }
  if (zbytecne.length) {
    t.diagnostic(`Hotovo, ${zbytecne.length}× už ve webu není — vyškrtni ze seznamu:`);
    for (const radek of zbytecne) t.diagnostic(`  ${radek}`);
  }
});

test('healthcheck hlásí stav databáze i počet migrací', async () => {
  const odpoved = await fetch(server.url + '/api/health');
  const data = await odpoved.json();

  assert.equal(odpoved.status, 200);
  assert.equal(data.status, 'ok');
  assert.ok(data.migrace >= 3, 'musí být aplikované migrace');
});
