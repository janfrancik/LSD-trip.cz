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

test('v kódu aplikace není natvrdo napsaná doména', async () => {
  // Přechod na lsd-trip.cz musí být jen změna .env. Kdyby se do src/ vloudila
  // konkrétní doména, tenhle test to chytí dřív, než se na to přijde v produkci.
  const zakazane = [/lsd-trip\.cz/i, /francik\.eu/i];
  const nalezy = [];

  async function projdi(adresar) {
    for (const polozka of await readdir(adresar, { withFileTypes: true })) {
      const cesta = path.join(adresar, polozka.name);
      if (polozka.isDirectory()) {
        await projdi(cesta);
        continue;
      }
      if (!polozka.name.endsWith('.js')) continue;

      const obsah = await readFile(cesta, 'utf8');
      obsah.split('\n').forEach((radek, i) => {
        // Bezpečnostní politika CSP musí starý web zmínit (fotky se z něj
        // do fáze 5 načítají) - to je vědomá výjimka, ne opomenutí.
        if (cesta.endsWith('bezpecnost.js')) return;
        for (const vzor of zakazane) {
          if (vzor.test(radek)) nalezy.push(`${path.relative(rootDir, cesta)}:${i + 1}: ${radek.trim()}`);
        }
      });
    }
  }

  await projdi(path.join(rootDir, 'src'));

  assert.deepEqual(
    nalezy,
    [],
    'Doména patří do APP_URL v .env, ne do kódu:\n' + nalezy.join('\n')
  );
});

test('healthcheck hlásí stav databáze i počet migrací', async () => {
  const odpoved = await fetch(server.url + '/api/health');
  const data = await odpoved.json();

  assert.equal(odpoved.status, 200);
  assert.equal(data.status, 'ok');
  assert.ok(data.migrace >= 3, 'musí být aplikované migrace');
});
