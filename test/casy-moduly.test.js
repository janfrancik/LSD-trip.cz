// Čas v každém modulu: v databázi UTC, na obrazovce pražský čas.
//
// Vzniklo z chyby, kdy audit ukazoval reset hesla v 9:59, i když proběhl
// v 11:59 pražského času. Server i data byly v pořádku - v otevřené záložce
// běžel starý kód administrace. Testy proto jdou po obou stranách:
//   1. API vrací čas tak, jak je v databázi (UTC), a sdílený formátovač
//      ze src/cas.js z něj udělá pražský čas,
//   2. žádná obrazovka si čas neformátuje po svém.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pripravDatabazi, vycistiData, spustServer, vytvorKlienta, vytvorUzivatele, testovaciHeslo,
} from './pomocnik.js';
import { datumCas, okamzik } from '../src/cas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Letní čas (Praha = UTC+2) i zimní (UTC+1) - posun se nesmí nikde "zafixovat".
const LETNI_UTC = '2026-07-15 10:00:00';
const LETNI_PRAHA = '15. 7. 2026 12:00';
const ZIMNI_UTC = '2026-01-15 10:00:00';
const ZIMNI_PRAHA = '15. 1. 2026 11:00';

let server;
let pool;
let heslo;

before(async () => {
  await pripravDatabazi();
  pool = (await import('../src/db.js')).default;
  server = await spustServer();
});

after(async () => {
  await server.zavri();
  await pool.end();
});

beforeEach(async () => {
  await vycistiData(pool);
  const { vynulujLimity } = await import('../src/auth/limit.js');
  await vynulujLimity();
  heslo = testovaciHeslo();
});

async function prihlasSpravce() {
  await vytvorUzivatele(pool, { email: 'sef@example.invalid', jmeno: 'Šéfka', heslo });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  await klient.post('/api/admin/prihlaseni', { email: 'sef@example.invalid', heslo });
  return klient;
}

// Co uvidí člověk: hodnota z API protažená stejným formátovačem, jaký používá
// administrace v prohlížeči.
function naObrazovce(hodnotaZApi) {
  return datumCas(hodnotaZApi);
}

test('audit: čas zásahu se ukáže v pražském čase', async () => {
  const klient = await prihlasSpravce();
  await pool.query(
    `INSERT INTO audit_log (uzivatel_email, akce, entita, popis, created_at)
     VALUES ('sef@example.invalid', 'reset_hesla_odeslan', 'uzivatel', 'Reset hesla', ?)`,
    [LETNI_UTC]
  );

  const odpoved = await klient.get('/api/admin/audit');
  // Seznam je seřazený od nejnovějšího, takže první je přihlášení z téhle chvíle.
  const zaznam = odpoved.data.data.find((a) => a.akce === 'reset_hesla_odeslan');
  assert.ok(zaznam, 'záznam o resetu hesla musí být v auditu');

  assert.equal(zaznam.created_at, LETNI_UTC, 'API vrací čas tak, jak je v databázi (UTC)');
  assert.equal(naObrazovce(zaznam.created_at), LETNI_PRAHA, 'na obrazovce musí být pražský čas');
});

test('poptávky: příchod i odpověď v pražském čase', async () => {
  const klient = await prihlasSpravce();
  const [vlozeni] = await pool.query(
    `INSERT INTO poptavky (jmeno, email, zprava, created_at, odpovezeno_at)
     VALUES ('Martina', 'martina@example.invalid', 'Dotaz', ?, ?)`,
    [ZIMNI_UTC, ZIMNI_UTC]
  );

  const seznam = await klient.get('/api/admin/poptavky');
  assert.equal(naObrazovce(seznam.data.data[0].created_at), ZIMNI_PRAHA);

  const detail = await klient.get(`/api/admin/poptavky/${vlozeni.insertId}`);
  assert.equal(naObrazovce(detail.data.created_at), ZIMNI_PRAHA);
  assert.equal(naObrazovce(detail.data.odpovezeno_at), ZIMNI_PRAHA);
});

test('e-maily a schránka: vznik i odeslání v pražském čase', async () => {
  const klient = await prihlasSpravce();
  const [vlozeni] = await pool.query(
    `INSERT INTO emaily (prijemce, predmet, telo_snapshot, stav, rezim, created_at, odeslano_at)
     VALUES ('kdo@example.invalid', 'Zkouška', '<p>ahoj</p>', 'odeslano', 'schranka', ?, ?)`,
    [LETNI_UTC, LETNI_UTC]
  );

  const seznam = await klient.get('/api/admin/emaily');
  assert.equal(naObrazovce(seznam.data.data[0].created_at), LETNI_PRAHA);

  const detail = await klient.get(`/api/admin/emaily/${vlozeni.insertId}`);
  assert.equal(naObrazovce(detail.data.created_at), LETNI_PRAHA);
  assert.equal(naObrazovce(detail.data.odeslano_at), LETNI_PRAHA);
});

test('akceptace: výsledek testera i export v pražském čase', async () => {
  const klient = await prihlasSpravce();

  const [verze] = await pool.query(
    "INSERT INTO akceptace_verze (kod, nazev) VALUES ('zkouska', 'Zkušební verze')"
  );
  const [ukol] = await pool.query(
    `INSERT INTO akceptace_ukoly (verze_id, kod, nazev, postup, ocekavany_vysledek, definice_hash)
     VALUES (?, 'prvni', 'První úkol', 'Krok.', 'Výsledek.', 'x')`,
    [verze.insertId]
  );
  const [[spravce]] = await pool.query('SELECT id FROM uzivatele WHERE email = ?', [
    'sef@example.invalid',
  ]);
  await pool.query(
    `INSERT INTO akceptace_vysledky (ukol_id, uzivatel_id, stav, komentar, created_at, updated_at)
     VALUES (?, ?, 'funguje', 'šlo to', ?, ?)`,
    [ukol.insertId, spravce.id, LETNI_UTC, LETNI_UTC]
  );

  const detail = await klient.get('/api/admin/akceptace/verze/zkouska');
  const vysledek = detail.data.ukoly[0].vysledky[0];
  assert.equal(naObrazovce(vysledek.updated_at), LETNI_PRAHA);

  // Export si formátuje sám na serveru - musí vyjít to samé.
  const export_ = await klient.get('/api/admin/akceptace/verze/zkouska/export');
  assert.match(
    export_.data.obsah,
    new RegExp(LETNI_PRAHA.replace(/\./g, '\\.')),
    'v exportu musí být pražský čas, ne UTC'
  );
});

test('hlášení problému: čas nahlášení v pražském čase', async () => {
  const klient = await prihlasSpravce();
  await pool.query(
    `INSERT INTO akceptace_hlaseni (text, url, stav, created_at)
     VALUES ('Nejde uložit', 'https://priklad.invalid/admin', 'nove', ?)`,
    [ZIMNI_UTC]
  );

  const odpoved = await klient.get('/api/admin/akceptace/hlaseni');
  assert.equal(naObrazovce(odpoved.data.data[0].created_at), ZIMNI_PRAHA);
});

test('uživatelé: poslední přihlášení a zámek účtu v pražském čase', async () => {
  const klient = await prihlasSpravce();
  const id = await vytvorUzivatele(pool, {
    email: 'provoz@example.invalid', jmeno: 'Provozní', role: 'provoz',
  });
  await pool.query(
    'UPDATE uzivatele SET posledni_prihlaseni_at = ?, zamceno_do = ? WHERE id = ?',
    [LETNI_UTC, LETNI_UTC, id]
  );

  const odpoved = await klient.get('/api/admin/uzivatele');
  const radek = odpoved.data.data.find((u) => u.email === 'provoz@example.invalid');

  assert.equal(naObrazovce(radek.posledni_prihlaseni_at), LETNI_PRAHA);
  assert.equal(
    okamzik(radek.zamceno_do).toISOString(),
    '2026-07-15T10:00:00.000Z',
    'zámek se musí číst jako UTC, jinak by platil o dvě hodiny jinak'
  );
});

test('přihlášení: platnost session se počítá v UTC', async () => {
  const klient = await prihlasSpravce();
  const [[session]] = await pool.query('SELECT expires_at FROM sessions LIMIT 1');

  const zbyva = okamzik(session.expires_at).getTime() - Date.now();
  const dni = zbyva / (24 * 60 * 60 * 1000);
  assert.ok(dni > 13.5 && dni < 14.5, `session má platit 14 dní, vyšlo ${dni.toFixed(2)}`);
});

test('dashboard: poslední aktivita nese čas z databáze v UTC', async () => {
  const klient = await prihlasSpravce();
  await pool.query(
    `INSERT INTO audit_log (uzivatel_email, akce, entita, popis, created_at)
     VALUES ('sef@example.invalid', 'zmena', 'nastaveni', 'Zkouška', ?)`,
    [LETNI_UTC]
  );

  const odpoved = await klient.get('/api/admin/dashboard');
  const zaznam = odpoved.data.aktivita.find((a) => a.popis === 'Zkouška');
  assert.equal(naObrazovce(zaznam.created_at), LETNI_PRAHA);
});

// --------------------------------------------------- žádné vlastní formáty

test('žádná obrazovka administrace si čas neformátuje po svém', () => {
  const adresare = [
    path.join(rootDir, 'public', 'admin', 'assets', 'js'),
    path.join(rootDir, 'public', 'admin', 'assets', 'js', 'obrazovky'),
  ];

  const podezrele = [
    // Vlastní parsování času z databáze - přesně tím vznikl posun o dvě hodiny.
    /new Date\(\s*(?!\)|Date\.now|\d)/,
    /toLocaleDateString|toLocaleTimeString/,
    /getHours\(\)|getMinutes\(\)|getFullYear\(\)/,
    /\.replace\(' ', 'T'\)/,
  ];

  for (const adresar of adresare) {
    for (const soubor of readdirSync(adresar).filter((f) => f.endsWith('.js'))) {
      // cas.js je jediný, kdo s časem počítá.
      if (soubor === 'cas.js') continue;
      const obsah = readFileSync(path.join(adresar, soubor), 'utf8');

      for (const radek of obsah.split('\n')) {
        // kc() v ui.js formátuje peníze přes toLocaleString - to je v pořádku.
        if (/koruny\.toLocaleString/.test(radek)) continue;
        if (/^\s*(\/\/|\*)/.test(radek)) continue;

        for (const vzor of podezrele) {
          const nalez = radek.match(vzor);
          assert.ok(
            !nalez,
            `${soubor} si formátuje nebo parsuje čas sám ("${nalez?.[0]}") — ` +
              'patří to do src/cas.js, jinak se to rozejde s tím, co ukazuje server'
          );
        }
      }
    }
  }
});

test('server nikde neformátuje čas mimo src/cas.js', () => {
  const projdi = (adresar) => {
    for (const polozka of readdirSync(adresar, { withFileTypes: true })) {
      const cesta = path.join(adresar, polozka.name);
      if (polozka.isDirectory()) {
        projdi(cesta);
        continue;
      }
      if (!polozka.name.endsWith('.js') || polozka.name === 'cas.js') continue;

      const obsah = readFileSync(cesta, 'utf8');
      assert.ok(
        !/toLocaleDateString|toLocaleTimeString|toLocaleString\(/.test(obsah),
        `${polozka.name} formátuje čas mimo src/cas.js`
      );
      // toISOString je v pořádku jen u strojových výstupů (healthcheck).
      const iso = obsah.match(/toISOString\(\)/g) ?? [];
      const povoleno = polozka.name === 'verejne.js' || polozka.name === 'prilohy.js';
      assert.ok(
        iso.length === 0 || povoleno,
        `${polozka.name} skládá čas přes toISOString() — použij src/cas.js`
      );
    }
  };

  projdi(path.join(rootDir, 'src'));
});

// ------------------------------------------ stará záložka pozná, že je stará

test('administrace pozná, že v záložce běží starý kód', async () => {
  const klient = await prihlasSpravce();

  const odpoved = await fetch(`${server.url}/api/admin/ja`, {
    headers: { Cookie: [...klient.cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
  });
  const verze = odpoved.headers.get('X-Admin-Verze');

  assert.ok(verze, 'každá odpověď administrace nese otisk klientské části');

  const { spocitejVerziKlienta } = await import('../src/verze.js');
  assert.equal(verze, spocitejVerziKlienta(), 'otisk odpovídá souborům administrace');

  // Když se klient změní, změní se i otisk - administrace pak nabídne
  // načtení znovu. Přesně tohle chybělo, když audit v otevřené záložce
  // ukazoval časy podle starých pravidel.
  const soubor = path.join(rootDir, 'public', 'admin', 'assets', 'js', 'ui.js');
  const puvodni = statSync(soubor);
  try {
    utimesSync(soubor, puvodni.atime, new Date(puvodni.mtime.getTime() + 60_000));
    assert.notEqual(
      spocitejVerziKlienta(),
      verze,
      'po změně souboru administrace se musí otisk změnit'
    );
  } finally {
    utimesSync(soubor, puvodni.atime, puvodni.mtime);
  }

  assert.equal(spocitejVerziKlienta(), verze, 'po vrácení souboru sedí otisk zas');
});

test('soubory administrace se nesmí cachovat bez ověření u serveru', async () => {
  for (const cesta of ['/admin/assets/js/ui.js', '/admin/assets/js/cas.js', '/admin/assets/css/admin.css']) {
    const odpoved = await fetch(server.url + cesta);
    assert.equal(odpoved.status, 200, cesta);
    assert.match(
      odpoved.headers.get('cache-control') ?? '',
      /no-cache/,
      `${cesta} se musí u serveru ověřovat, jinak po nasazení zůstane starý kód`
    );
  }

  // Shell administrace: /admin/ obslouží statická složka (no-cache),
  // /admin/cokoli vlastní routa (no-store). Obojí znamená "zeptej se serveru".
  for (const cesta of ['/admin/', '/admin/poptavky']) {
    const shell = await fetch(server.url + cesta);
    assert.match(shell.headers.get('cache-control') ?? '', /no-cache|no-store/, cesta);
  }
});
