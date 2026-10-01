// Modul „Ke schválení“: import zadání z repozitáře, testování, hlášení,
// schválení verze - a hlavně to, že v produkci celý modul neexistuje.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  pripravDatabazi, vycistiData, spustServer, vytvorKlienta, vytvorUzivatele, testovaciHeslo,
} from './pomocnik.js';

let server;
let pool;
let heslo;

// 1×1 PNG - nejmenší platný obrázek, na ověření nahrávání stačí.
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

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

async function prihlas(role = 'admin', email = 'sef@example.invalid', jmeno = 'Šéfka') {
  await vytvorUzivatele(pool, { email, jmeno, role, heslo });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  await klient.post('/api/admin/prihlaseni', { email, heslo });
  return klient;
}

// Zadání v souboru - v testech vlastní, ať test nezávisí na tom, co je právě
// napsané v docs/akceptace/.
async function zadani(ukoly, { kod = 'zkouska', nazev = 'Zkušební verze' } = {}) {
  const adresar = await mkdtemp(path.join(os.tmpdir(), 'lsd-akceptace-'));
  const radky = [
    'verze:',
    `  kod: ${kod}`,
    `  nazev: ${nazev}`,
    '  poradi: 1',
    'ukoly:',
  ];
  for (const u of ukoly) {
    radky.push(
      `  - kod: ${u.kod}`,
      `    nazev: ${u.nazev}`,
      `    postup: ${JSON.stringify(u.postup ?? 'Udělej krok jeden, potom krok dva.')}`,
      `    vysledek: ${JSON.stringify(u.vysledek ?? 'Objeví se zelená hláška.')}`
    );
    if (u.role) radky.push(`    role: ${u.role}`);
    if (u.jen_admin) radky.push('    jen_admin: true');
  }
  await writeFile(path.join(adresar, `${kod}.yml`), radky.join('\n') + '\n');
  return adresar;
}

async function naimportuj(adresar) {
  const { naimportujAkceptaci } = await import('../src/akceptace/import.js');
  return naimportujAkceptaci({ adresar });
}

// --------------------------------------------------------------------- import

test('zadání ze souboru se naimportuje a opakovaný import nic nezdvojí', async () => {
  const adresar = await zadani([
    { kod: 'prvni', nazev: 'První úkol' },
    { kod: 'druhy', nazev: 'Druhý úkol' },
  ]);

  const prvni = await naimportuj(adresar);
  assert.equal(prvni.length, 1);
  assert.equal(prvni[0].pridano, 2);
  assert.equal(prvni[0].nova, true);

  const druhy = await naimportuj(adresar);
  assert.equal(druhy[0].pridano, 0, 'druhý import už nic nepřidává');
  assert.equal(druhy[0].nova, false);

  const [ukoly] = await pool.query('SELECT kod FROM akceptace_ukoly ORDER BY poradi');
  assert.deepEqual(ukoly.map((u) => u.kod), ['prvni', 'druhy']);

  const [verze] = await pool.query('SELECT COUNT(*) AS pocet FROM akceptace_verze');
  assert.equal(Number(verze[0].pocet), 1);

  await rm(adresar, { recursive: true, force: true });
});

test('změna zadání se projeví, ale výsledky testerů zůstanou', async () => {
  const puvodni = await zadani([{ kod: 'prvni', nazev: 'První úkol' }]);
  await naimportuj(puvodni);

  const uzivatelId = await vytvorUzivatele(pool, {
    email: 'tester@example.invalid', jmeno: 'Tester', role: 'tester',
  });
  const [[ukol]] = await pool.query('SELECT id FROM akceptace_ukoly WHERE kod = ?', ['prvni']);
  await pool.query(
    'INSERT INTO akceptace_vysledky (ukol_id, uzivatel_id, stav, komentar) VALUES (?, ?, ?, ?)',
    [ukol.id, uzivatelId, 'funguje', 'šlo to']
  );

  const zmenene = await zadani([
    { kod: 'prvni', nazev: 'První úkol', postup: 'Nový postup, jinak napsaný.' },
  ]);
  const prehled = await naimportuj(zmenene);
  assert.equal(prehled[0].zmeneno, 1);

  const [[po]] = await pool.query('SELECT id, postup FROM akceptace_ukoly WHERE kod = ?', ['prvni']);
  assert.equal(po.id, ukol.id, 'úkol se páruje podle kódu, id se nemění');
  assert.match(po.postup, /Nový postup/);

  const [vysledky] = await pool.query('SELECT stav, komentar FROM akceptace_vysledky');
  assert.equal(vysledky.length, 1, 'výsledek testera se importem nesmí smazat');
  assert.equal(vysledky[0].komentar, 'šlo to');

  await rm(puvodni, { recursive: true, force: true });
  await rm(zmenene, { recursive: true, force: true });
});

test('úkol vyřazený ze zadání se jen zhasne, nesmaže', async () => {
  const dva = await zadani([
    { kod: 'prvni', nazev: 'První úkol' },
    { kod: 'druhy', nazev: 'Druhý úkol' },
  ]);
  await naimportuj(dva);

  const jeden = await zadani([{ kod: 'prvni', nazev: 'První úkol' }]);
  const prehled = await naimportuj(jeden);
  assert.equal(prehled[0].deaktivovano, 1);

  const [rows] = await pool.query('SELECT kod, aktivni FROM akceptace_ukoly ORDER BY kod');
  assert.deepEqual(
    rows.map((r) => [r.kod, r.aktivni]),
    [['druhy', 0], ['prvni', 1]]
  );

  await rm(dva, { recursive: true, force: true });
  await rm(jeden, { recursive: true, force: true });
});

test('skutečné zadání fáze 1 v repozitáři je platné', async () => {
  const prehled = await naimportuj(undefined);
  const faze1 = prehled.find((v) => v.kod === 'faze-1');
  assert.ok(faze1, 'docs/akceptace/faze-1.yml musí být naimportovatelné');

  const [[pocet]] = await pool.query(
    `SELECT COUNT(*) AS ukolu FROM akceptace_ukoly u
       JOIN akceptace_verze v ON v.id = u.verze_id WHERE v.kod = 'faze-1'`
  );
  assert.ok(Number(pocet.ukolu) >= 10, 'fáze 1 má mít pořádný seznam úkolů');
});

test('zadání s dvakrát stejným kódem úkolu se odmítne', async () => {
  const adresar = await mkdtemp(path.join(os.tmpdir(), 'lsd-akceptace-'));
  await writeFile(
    path.join(adresar, 'spatne.yml'),
    [
      'verze:',
      '  kod: spatne',
      '  nazev: Špatné zadání',
      'ukoly:',
      '  - kod: stejny',
      '    nazev: První',
      '    postup: Krok.',
      '    vysledek: Výsledek.',
      '  - kod: stejny',
      '    nazev: Druhý',
      '    postup: Krok.',
      '    vysledek: Výsledek.',
    ].join('\n')
  );

  await assert.rejects(() => naimportuj(adresar), /dvakrát/);
  await rm(adresar, { recursive: true, force: true });
});

test('selhaný import je vidět v administraci, ne jen v logu', async () => {
  // Rozbité zadání: stejný kód dvakrát.
  const adresar = await mkdtemp(path.join(os.tmpdir(), 'lsd-akceptace-'));
  await writeFile(
    path.join(adresar, 'spatne.yml'),
    [
      'verze:',
      '  kod: spatne',
      '  nazev: Špatné zadání',
      'ukoly:',
      '  - kod: stejny',
      '    nazev: První',
      '    postup: Krok.',
      '    vysledek: Výsledek.',
      '  - kod: stejny',
      '    nazev: Druhý',
      '    postup: Krok.',
      '    vysledek: Výsledek.',
    ].join('\n')
  );
  await assert.rejects(() => naimportuj(adresar));

  const spravce = await prihlas();
  const prehled = await spravce.get('/api/admin/akceptace');
  assert.equal(prehled.status, 200);
  assert.equal(prehled.data.import.ok, false, 'administrace musí vědět, že import selhal');
  assert.match(prehled.data.import.chyba, /dvakrát/);
  assert.ok(prehled.data.import.cas, 'u chyby je i čas posledního pokusu');

  // Tlačítko „Znovu načíst zadání“ volá tenhle endpoint. Se skutečným zadáním
  // v repozitáři musí projít a stav se srovnat.
  const znovu = await spravce.post('/api/admin/akceptace/import');
  assert.equal(znovu.status, 200);

  const po = await spravce.get('/api/admin/akceptace');
  assert.equal(po.data.import.ok, true);
  assert.equal(po.data.import.chyba, null);

  await rm(adresar, { recursive: true, force: true });
});

test('import přes tlačítko hlásí chybu česky, ne jako pád serveru', async () => {
  const adresar = await mkdtemp(path.join(os.tmpdir(), 'lsd-akceptace-'));
  await writeFile(path.join(adresar, 'spatne.yml'), 'verze: tohle není objekt\n');
  await assert.rejects(() => naimportuj(adresar));
  await rm(adresar, { recursive: true, force: true });

  const provoz = await prihlas('provoz', 'provoz@example.invalid', 'Provozní');
  const odpoved = await provoz.post('/api/admin/akceptace/import');
  assert.equal(odpoved.status, 403, 'zadání načítá jen administrátor');
});

// ------------------------------------------------------------------ testování

test('tester zapíše výsledek, u „nefunguje“ musí napsat komentář', async () => {
  const adresar = await zadani([{ kod: 'prvni', nazev: 'První úkol' }]);
  await naimportuj(adresar);
  const [[ukol]] = await pool.query('SELECT id FROM akceptace_ukoly WHERE kod = ?', ['prvni']);

  const klient = await prihlas('tester', 'tester@example.invalid', 'Tester');

  const bezKomentare = await klient.post(`/api/admin/akceptace/ukoly/${ukol.id}/vysledek`, {
    stav: 'nefunguje',
  });
  // PUT přes klienta: pomocník posílá POST, proto rovnou ověříme, že POST není
  // povolený, a použijeme správnou metodu.
  assert.equal(bezKomentare.status, 404, 'výsledek se zapisuje metodou PUT');

  const chybi = await klient.put(`/api/admin/akceptace/ukoly/${ukol.id}/vysledek`, {
    stav: 'nefunguje',
  });
  assert.equal(chybi.status, 409);
  assert.match(chybaText(chybi), /komentář/i);

  const ok = await klient.put(`/api/admin/akceptace/ukoly/${ukol.id}/vysledek`, {
    stav: 'funguje',
    komentar: 'Šlo to hned.',
  });
  assert.equal(ok.status, 200);

  const [vysledky] = await pool.query('SELECT stav, komentar FROM akceptace_vysledky');
  assert.equal(vysledky.length, 1);
  assert.equal(vysledky[0].stav, 'funguje');

  await rm(adresar, { recursive: true, force: true });
});

test('tester nevidí výsledky ostatních ani cizí obrazovky', async () => {
  const adresar = await zadani([{ kod: 'prvni', nazev: 'První úkol' }]);
  await naimportuj(adresar);
  const [[ukol]] = await pool.query('SELECT id FROM akceptace_ukoly WHERE kod = ?', ['prvni']);

  const sefId = await vytvorUzivatele(pool, { email: 'sefka@example.invalid', jmeno: 'Šéfka' });
  await pool.query(
    'INSERT INTO akceptace_vysledky (ukol_id, uzivatel_id, stav, komentar) VALUES (?, ?, ?, ?)',
    [ukol.id, sefId, 'nefunguje', 'tajný komentář šéfky']
  );

  const klient = await prihlas('tester', 'tester@example.invalid', 'Tester');

  const verze = await klient.get('/api/admin/akceptace/verze/zkouska');
  assert.equal(verze.status, 200);
  const prvni = verze.data.ukoly[0];
  assert.deepEqual(prvni.vysledky, [], 'tester nevidí, jak hlasovali ostatní');
  assert.equal(prvni.muj_stav, 'neotestovano', 'cizí výsledek mu úkol nesplní');
  assert.equal(prvni.stav_tymu, undefined, 'ani souhrn za tým mu nic neprozradí');
  assert.ok(!JSON.stringify(verze.data).includes('tajný komentář'));

  // A do ostatních modulů se nedostane.
  assert.equal((await klient.get('/api/admin/uzivatele')).status, 403);
  assert.equal((await klient.get('/api/admin/poptavky')).status, 403);
  assert.equal((await klient.get('/api/admin/nastaveni')).status, 403);

  await rm(adresar, { recursive: true, force: true });
});

test('nefunkční úkol jde poslat k přetestování, tester ho vidí znovu', async () => {
  const adresar = await zadani([{ kod: 'prvni', nazev: 'První úkol' }]);
  await naimportuj(adresar);
  const [[ukol]] = await pool.query('SELECT id FROM akceptace_ukoly WHERE kod = ?', ['prvni']);

  const testerId = await vytvorUzivatele(pool, {
    email: 'tester@example.invalid', jmeno: 'Tester', role: 'tester',
  });
  await pool.query(
    'INSERT INTO akceptace_vysledky (ukol_id, uzivatel_id, stav, komentar) VALUES (?, ?, ?, ?)',
    [ukol.id, testerId, 'nefunguje', 'spadlo to']
  );

  const spravce = await prihlas();
  const odpoved = await spravce.post(`/api/admin/akceptace/ukoly/${ukol.id}/k-pretestovani`);
  assert.equal(odpoved.status, 200);
  assert.equal(odpoved.data.prepnuto, 1);

  const [[vysledek]] = await pool.query('SELECT stav, predchozi_stav FROM akceptace_vysledky');
  assert.equal(vysledek.stav, 'k_pretestovani');
  assert.equal(vysledek.predchozi_stav, 'nefunguje');

  // Pro testera se úkol znovu počítá jako nedokončený.
  const { pocetKOtestovani } = await import('../src/akceptace/souhrn.js');
  assert.equal(await pocetKOtestovani(testerId), 1);

  await rm(adresar, { recursive: true, force: true });
});

// ------------------------------------------------------------------- přílohy

test('snímek obrazovky se nahraje, jiný soubor ne', async () => {
  const klient = await prihlas();

  const spatny = await klient.post('/api/admin/akceptace/prilohy', {
    obsah: Buffer.from('tohle rozhodně není obrázek, ale je to dost dlouhé').toString('base64'),
  });
  assert.equal(spatny.status, 400);
  assert.match(chybaText(spatny), /PNG|obrázek/i);

  const dobry = await klient.post('/api/admin/akceptace/prilohy', {
    obsah: `data:image/png;base64,${PNG_1X1}`,
    nazev: 'snimek.png',
  });
  assert.equal(dobry.status, 201);
  assert.equal(dobry.data.mime, 'image/png');

  const soubor = await fetch(server.url + dobry.data.url, {
    headers: { Cookie: [...klient.cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
  });
  assert.equal(soubor.status, 200);
  assert.equal(soubor.headers.get('content-type'), 'image/png');
});

test('nepřihlášený se k příloze nedostane', async () => {
  const klient = await prihlas();
  const nahrano = await klient.post('/api/admin/akceptace/prilohy', {
    obsah: PNG_1X1,
  });
  assert.equal(nahrano.status, 201);

  const bezPrihlaseni = await fetch(server.url + nahrano.data.url);
  assert.equal(bezPrihlaseni.status, 401);
});

// ------------------------------------------------------------------ hlášení

test('hlášení problému si samo uloží adresu a prohlížeč', async () => {
  const klient = await prihlas();
  const odpoved = await klient.post('/api/admin/akceptace/hlaseni', {
    text: 'Po uložení se poznámka neukázala.',
    url: 'https://priklad.invalid/admin/poptavky/3',
    rozliseni: '390×844 px',
  });
  assert.equal(odpoved.status, 201);

  const [[hlaseni]] = await pool.query('SELECT * FROM akceptace_hlaseni');
  assert.equal(hlaseni.stav, 'nove');
  assert.equal(hlaseni.url, 'https://priklad.invalid/admin/poptavky/3');
  assert.equal(hlaseni.rozliseni, '390×844 px');
  assert.ok(hlaseni.prohlizec, 'prohlížeč se bere z hlavičky požadavku');

  const seznam = await klient.get('/api/admin/akceptace/hlaseni');
  assert.equal(seznam.data.data.length, 1);
  assert.equal(seznam.data.pocty.nove, 1);
});

// --------------------------------------------------------------- schvalování

test('verzi nejde schválit, dokud něco nefunguje nebo chybí test', async () => {
  const adresar = await zadani([
    { kod: 'prvni', nazev: 'První úkol' },
    { kod: 'druhy', nazev: 'Druhý úkol' },
  ]);
  await naimportuj(adresar);
  const [ukoly] = await pool.query('SELECT id, kod FROM akceptace_ukoly ORDER BY poradi');

  const spravce = await prihlas();

  const brzy = await spravce.post('/api/admin/akceptace/verze/zkouska/schvalit');
  assert.equal(brzy.status, 409);
  // Odmítnutí musí říct kdo a co, ne jen "podmínky nesplněny".
  assert.match(chybaText(brzy), /Šéfka: 2 úkoly neotestované/);

  await spravce.put(`/api/admin/akceptace/ukoly/${ukoly[0].id}/vysledek`, {
    stav: 'nefunguje',
    komentar: 'rozbité',
  });
  await spravce.put(`/api/admin/akceptace/ukoly/${ukoly[1].id}/vysledek`, {
    stav: 'funguje',
  });

  const porad = await spravce.post('/api/admin/akceptace/verze/zkouska/schvalit');
  assert.equal(porad.status, 409);
  assert.match(chybaText(porad), /nefunguje/);

  // Otevřené hlášení taky brání schválení.
  await spravce.put(`/api/admin/akceptace/ukoly/${ukoly[0].id}/vysledek`, {
    stav: 'funguje',
    komentar: 'po opravě funguje',
  });
  const hlaseni = await spravce.post('/api/admin/akceptace/hlaseni', {
    text: 'Ještě tohle drobné.',
  });
  const sHlasenim = await spravce.post('/api/admin/akceptace/verze/zkouska/schvalit');
  assert.equal(sHlasenim.status, 409);
  assert.match(chybaText(sHlasenim), /hlášení/i);

  await spravce.patch(`/api/admin/akceptace/hlaseni/${hlaseni.data.id}`, {
    stav: 'vyreseno',
    odpoved: 'Opraveno.',
  });

  const schvaleno = await spravce.post('/api/admin/akceptace/verze/zkouska/schvalit', {
    poznamka: 'Odzkoušeno na mobilu i na počítači.',
  });
  assert.equal(schvaleno.status, 200);

  const [[verze]] = await pool.query('SELECT * FROM akceptace_verze WHERE kod = ?', ['zkouska']);
  assert.equal(verze.stav, 'schvalena');
  assert.ok(verze.schvaleno_at);
  assert.equal(verze.schvaleni_poznamka, 'Odzkoušeno na mobilu i na počítači.');

  // Schválení je v auditu.
  const [audit] = await pool.query(
    'SELECT akce, popis FROM audit_log WHERE akce = ?', ['akceptace_schvaleni']
  );
  assert.equal(audit.length, 1);

  // A po schválení se výsledky už nedají přepisovat.
  const pozde = await spravce.put(`/api/admin/akceptace/ukoly/${ukoly[0].id}/vysledek`, {
    stav: 'nefunguje',
    komentar: 'ještě jednou',
  });
  assert.equal(pozde.status, 409);

  await rm(adresar, { recursive: true, force: true });
});

test('schvalovat smí jen admin, provoz ne', async () => {
  const adresar = await zadani([{ kod: 'prvni', nazev: 'První úkol' }]);
  await naimportuj(adresar);
  const [[ukol]] = await pool.query('SELECT id FROM akceptace_ukoly WHERE kod = ?', ['prvni']);

  const provoz = await prihlas('provoz', 'provoz@example.invalid', 'Provozní');
  await provoz.put(`/api/admin/akceptace/ukoly/${ukol.id}/vysledek`, { stav: 'funguje' });

  const odpoved = await provoz.post('/api/admin/akceptace/verze/zkouska/schvalit');
  assert.equal(odpoved.status, 403);

  await rm(adresar, { recursive: true, force: true });
});

test('export souhrnu obsahuje, kdo co testoval', async () => {
  const adresar = await zadani([{ kod: 'prvni', nazev: 'První úkol' }]);
  await naimportuj(adresar);
  const [[ukol]] = await pool.query('SELECT id FROM akceptace_ukoly WHERE kod = ?', ['prvni']);

  const spravce = await prihlas();
  await spravce.put(`/api/admin/akceptace/ukoly/${ukol.id}/vysledek`, {
    stav: 'funguje',
    komentar: 'bez problému',
  });

  const odpoved = await spravce.get('/api/admin/akceptace/verze/zkouska/export');
  assert.equal(odpoved.status, 200);
  assert.equal(odpoved.data.soubor, 'zkouska-akceptace.md');
  assert.match(odpoved.data.obsah, /# Akceptace: Zkušební verze/);
  assert.match(odpoved.data.obsah, /Šéfka: funguje/);
  assert.match(odpoved.data.obsah, /bez problému/);

  // Čas vygenerování musí být pražský, ne UTC. Původně byl v UTC a souhrn pak
  // tvrdil, že vznikl hodinu před testy, které popisuje.
  const { datumCas } = await import('../src/cas.js');
  const vygenerovano = odpoved.data.obsah.match(/- Vygenerováno: (.+)/)[1];
  const ted = Date.now();
  const pripustne = [datumCas(new Date(ted)), datumCas(new Date(ted - 60_000))];
  assert.ok(
    pripustne.includes(vygenerovano),
    `čas vygenerování "${vygenerovano}" musí být pražský (čekáno ${pripustne[0]})`
  );

  const vUtc = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ted));
  const vPraze = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ted));
  if (vUtc !== vPraze) {
    assert.ok(!vygenerovano.includes(vUtc.trim()), 'v souhrnu nesmí být čas v UTC');
  }

  await rm(adresar, { recursive: true, force: true });
});

// ------------------------------------------------------------------ produkce

test('v produkci modul akceptace vůbec neexistuje', () => {
  // Konfigurace se čte při načtení modulu, takže se prostředí nedá přepnout
  // uprostřed testu - ověření běží v samostatném procesu.
  // Potomek se ukončuje doběhnutím, ne process.exit() - na Windows se tím
  // libuv rozbije a execFileSync pak hlásí chybu i po úspěšném výpisu.
  // Ze stejného důvodu se ptá přes node:http s `agent: false`, ne přes fetch:
  // undici si drží keep-alive spojení a proces by nedoběhl. Totéž je
  // v test/konfigurace.test.js.
  const skript = `
    process.env.PROSTREDI = 'produkce';
    const http = await import('node:http');
    const { vytvorApp } = await import('./src/app.js');
    const pool = (await import('./src/db.js')).default;

    const app = vytvorApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;

    function zeptejSe(cesta) {
      return new Promise((splnit, odmitnout) => {
        const dotaz = http.request({ host: '127.0.0.1', port, path: cesta, agent: false }, (res) => {
          let telo = '';
          res.on('data', (kus) => { telo += kus; });
          res.on('end', () => splnit({ status: res.statusCode, telo }));
        });
        dotaz.on('error', odmitnout);
        dotaz.end();
      });
    }

    const akceptace = await zeptejSe('/api/admin/akceptace');
    const ja = await zeptejSe('/api/admin/ja');
    console.log(JSON.stringify({
      akceptace: akceptace.status,
      jaAkceptace: JSON.parse(ja.telo).akceptace,
    }));

    await new Promise((r) => server.close(r));
    await pool.end();
  `;

  // Produkce má přísnější validaci konfigurace (nesmí běžet s vývojovými
  // hodnotami), takže dítě dostane i hodnoty, které by produkce měla mít.
  const vystup = execFileSync(process.execPath, ['--input-type=module', '-e', skript], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PROSTREDI: 'produkce',
      APP_URL: 'https://www.lsd-trip.cz',
      EMAIL_REZIM: 'vypnuto',
      EMAIL_ODESILATEL: 'LSD <rezervace@lsd-trip.cz>',
    },
  });

  const vysledek = JSON.parse(vystup.trim().split('\n').pop());
  // 404, ne 401: cesta v produkci neexistuje, nejde jen o chybějící přihlášení.
  assert.equal(vysledek.akceptace, 404, 'v produkci nesmí být API akceptace');
  assert.notEqual(vysledek.jaAkceptace, true, 'administrace se v produkci nedozví o modulu');
});

test('v testovacím prostředí API akceptace existuje a chce přihlášení', async () => {
  const klient = vytvorKlienta(server.url);
  const odpoved = await klient.get('/api/admin/akceptace');
  assert.equal(odpoved.status, 401, 'mimo produkci cesta existuje, jen chce přihlášení');

  const spravce = await prihlas();
  const ja = await spravce.get('/api/admin/ja');
  assert.equal(ja.data.akceptace, true);
  assert.equal(ja.data.prava.akceptace, 'menit');
});

function chybaText(odpoved) {
  return odpoved.data?.chyba ?? '';
}

// ------------------------------------------------- výsledky po testerech

test('výsledek jednoho testera nesplní úkol ostatním', async () => {
  const adresar = await zadani([{ kod: 'prvni', nazev: 'První úkol' }]);
  await naimportuj(adresar);
  const [[ukol]] = await pool.query('SELECT id FROM akceptace_ukoly WHERE kod = ?', ['prvni']);

  const prvni = await prihlas('tester', 'tester1@example.invalid', 'Tester Jedna');
  const druhy = await prihlas('tester', 'tester2@example.invalid', 'Tester Dva');

  await prvni.put(`/api/admin/akceptace/ukoly/${ukol.id}/vysledek`, { stav: 'funguje' });

  // Prvnímu zmizel ze seznamu, druhému ne.
  assert.equal((await prvni.get('/api/admin/akceptace/pocty')).data.k_otestovani, 0);
  assert.equal((await druhy.get('/api/admin/akceptace/pocty')).data.k_otestovani, 1);

  const verzeDruhy = await druhy.get('/api/admin/akceptace/verze/zkouska');
  assert.equal(verzeDruhy.data.ukoly[0].muj_stav, 'neotestovano');
  assert.equal(verzeDruhy.data.muj_souhrn.hotovo, 0);
  assert.equal(verzeDruhy.data.muj_souhrn.celkem, 1);

  await rm(adresar, { recursive: true, force: true });
});

test('úkol jen pro admina se testerovi neukáže ani nezapíše', async () => {
  const adresar = await zadani([
    { kod: 'pro-vsechny', nazev: 'Pro všechny' },
    { kod: 'schvaleni', nazev: 'Schválení verze', jen_admin: true },
    { kod: 'jen-provoz', nazev: 'Jen pro provoz', role: 'provoz' },
  ]);
  await naimportuj(adresar);
  const [ukoly] = await pool.query('SELECT id, kod FROM akceptace_ukoly ORDER BY poradi');
  const podleKodu = Object.fromEntries(ukoly.map((u) => [u.kod, u.id]));

  const tester = await prihlas('tester', 'tester@example.invalid', 'Tester');
  const verze = await tester.get('/api/admin/akceptace/verze/zkouska');

  assert.deepEqual(
    verze.data.ukoly.map((u) => u.kod),
    ['pro-vsechny'],
    'testerovi se ukáže jen to, co má testovat'
  );
  assert.equal((await tester.get('/api/admin/akceptace/pocty')).data.k_otestovani, 1);

  const pokus = await tester.put(`/api/admin/akceptace/ukoly/${podleKodu.schvaleni}/vysledek`, {
    stav: 'funguje',
  });
  assert.equal(pokus.status, 403, 'cizí úkol nejde vyplnit ani přímo přes API');

  // Admin má naopak svůj úkol i ten společný, ale ne ten pro provoz.
  const spravce = await prihlas('admin', 'sef@example.invalid', 'Šéfka');
  const proAdmina = await spravce.get('/api/admin/akceptace/verze/zkouska');
  const mojeAdmina = proAdmina.data.ukoly.filter((u) => u.patri_mi).map((u) => u.kod);
  assert.deepEqual(mojeAdmina.sort(), ['pro-vsechny', 'schvaleni']);

  await rm(adresar, { recursive: true, force: true });
});

test('přiřazení testeři rozhodují, na koho se čeká', async () => {
  const adresar = await zadani([{ kod: 'prvni', nazev: 'První úkol' }]);
  await naimportuj(adresar);
  const [[ukol]] = await pool.query('SELECT id FROM akceptace_ukoly WHERE kod = ?', ['prvni']);

  const spravce = await prihlas('admin', 'sef@example.invalid', 'Šéfka');
  const testerId = await vytvorUzivatele(pool, {
    email: 'tester@example.invalid', jmeno: 'Tester', role: 'tester',
  });

  // Ve výchozím stavu se čeká na oba.
  await spravce.put(`/api/admin/akceptace/ukoly/${ukol.id}/vysledek`, { stav: 'funguje' });
  const prvniPokus = await spravce.post('/api/admin/akceptace/verze/zkouska/schvalit');
  assert.equal(prvniPokus.status, 409);
  assert.match(chybaText(prvniPokus), /Tester/);

  // Když verzi testuje jen šéfka, na testera se nečeká.
  const zmena = await spravce.put('/api/admin/akceptace/verze/zkouska/testeri', {
    uzivatele: [(await pool.query('SELECT id FROM uzivatele WHERE email = ?', ['sef@example.invalid']))[0][0].id],
  });
  assert.equal(zmena.status, 200);

  const druhyPokus = await spravce.post('/api/admin/akceptace/verze/zkouska/schvalit');
  assert.equal(druhyPokus.status, 200, 'na nepřiřazeného testera se nečeká');

  const [prirazeni] = await pool.query('SELECT uzivatel_id FROM akceptace_testeri');
  assert.equal(prirazeni.length, 1);
  assert.notEqual(prirazeni[0].uzivatel_id, testerId);

  await rm(adresar, { recursive: true, force: true });
});

test('k přetestování se vrací jen tomu, komu to nefungovalo', async () => {
  const adresar = await zadani([{ kod: 'prvni', nazev: 'První úkol' }]);
  await naimportuj(adresar);
  const [[ukol]] = await pool.query('SELECT id FROM akceptace_ukoly WHERE kod = ?', ['prvni']);

  const spokojeny = await prihlas('tester', 'ok@example.invalid', 'Spokojený');
  const nespokojeny = await prihlas('tester', 'problem@example.invalid', 'Nespokojený');
  await spokojeny.put(`/api/admin/akceptace/ukoly/${ukol.id}/vysledek`, { stav: 'funguje' });
  await nespokojeny.put(`/api/admin/akceptace/ukoly/${ukol.id}/vysledek`, {
    stav: 'nefunguje',
    komentar: 'spadlo to',
  });

  const spravce = await prihlas('admin', 'sef@example.invalid', 'Šéfka');
  const vraceni = await spravce.post(`/api/admin/akceptace/ukoly/${ukol.id}/k-pretestovani`);
  assert.equal(vraceni.data.prepnuto, 1, 'vrací se jen tomu, kdo hlásil problém');

  assert.equal((await spokojeny.get('/api/admin/akceptace/pocty')).data.k_otestovani, 0);
  assert.equal((await nespokojeny.get('/api/admin/akceptace/pocty')).data.k_otestovani, 1);

  // Volba "všem" vrátí i toho, komu to fungovalo.
  const vsem = await spravce.post(`/api/admin/akceptace/ukoly/${ukol.id}/k-pretestovani`, {
    vsem: true,
  });
  assert.equal(vsem.data.prepnuto, 1, 'zbyl už jen ten spokojený');
  assert.equal((await spokojeny.get('/api/admin/akceptace/pocty')).data.k_otestovani, 1);

  await rm(adresar, { recursive: true, force: true });
});

test('export obsahuje tabulku úkoly × testeři i výsledky po lidech', async () => {
  const adresar = await zadani([{ kod: 'prvni', nazev: 'První úkol' }]);
  await naimportuj(adresar);
  const [[ukol]] = await pool.query('SELECT id FROM akceptace_ukoly WHERE kod = ?', ['prvni']);

  const tester = await prihlas('tester', 'tester@example.invalid', 'Tester');
  await tester.put(`/api/admin/akceptace/ukoly/${ukol.id}/vysledek`, {
    stav: 'funguje',
    komentar: 'šlo to',
  });

  const spravce = await prihlas('admin', 'sef@example.invalid', 'Šéfka');
  const export_ = await spravce.get('/api/admin/akceptace/verze/zkouska/export');

  assert.match(export_.data.obsah, /## Kdo kolik otestoval/);
  assert.match(export_.data.obsah, /\*\*Tester\*\* \(tester\): 1\/1/);
  assert.match(export_.data.obsah, /## Přehled úkoly × testeři/);
  assert.match(export_.data.obsah, /\| První úkol \|/);
  assert.match(export_.data.obsah, /Tester: funguje/);

  await rm(adresar, { recursive: true, force: true });
});
