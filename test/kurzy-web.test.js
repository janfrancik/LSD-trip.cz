// Veřejná část kurzů: API a stránky vykreslené na serveru (etapa E4).
//
// Testy jdou po tom, co se nesmí rozbít: nezveřejněný kurz se na web
// nedostane ani přes přímou adresu, stránka má obsah i bez JavaScriptu
// (na tom stojí celý SSR pilot) a ven neodcházejí osobní údaje.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  pripravDatabazi, vycistiData, spustServer, vytvorKlienta, vytvorUzivatele, testovaciHeslo,
} from './pomocnik.js';

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
  const { zapomenCache } = await import('../src/nastaveni.js');
  zapomenCache();
  heslo = testovaciHeslo();
});

async function prihlas(role = 'admin') {
  const email = `${role}@example.invalid`;
  await vytvorUzivatele(pool, { email, jmeno: 'Testovací člověk', role, heslo });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  await klient.post('/api/admin/prihlaseni', { email, heslo });
  return klient;
}

// Kurz tak, jak ho založí majitelka v administraci - přes API, ne přímo
// do databáze, ať se testuje i cesta, kterou to opravdu chodí.
async function zalozKurz(klient, zmeny = {}) {
  const { data } = await klient.post('/api/admin/produkty', {
    typ: 'kurz',
    nazev: 'Parašutistický výcvik',
    perex: 'Čtyřicet osm hodin výuky a dva samostatné seskoky.',
    popis: 'První odstavec popisu.\n\nDruhý odstavec popisu.',
    co_je_v_cene: 'Teorie, výstroj, dva seskoky.',
    cena_hal: 490000,
    min_vek: 15,
    max_vaha_kg: 95,
    vyzaduje_lekarskou_prohlidku: true,
    aktivni: true,
    ...zmeny,
  });
  return data;
}

function zaDni(pocet) {
  return new Date(Date.now() + pocet * 86400000).toISOString().slice(0, 10);
}

async function text(cesta) {
  const odpoved = await fetch(server.url + cesta);
  return { stav: odpoved.status, html: await odpoved.text() };
}

// --------------------------------------------------------------- API

test('přehled kurzů vrací jen zveřejněné, v pořadí z administrace', async () => {
  const klient = await prihlas();
  const prvni = await zalozKurz(klient, { nazev: 'Základní kurz' });
  const druhy = await zalozKurz(klient, { nazev: 'Kurz IAFF', cena_na_dotaz: true, cena_hal: null });
  await zalozKurz(klient, { nazev: 'Chystaný kurz', aktivni: false });

  // Pořadí se v administraci přehazuje šipkami - web ho musí respektovat.
  await klient.post('/api/admin/produkty/poradi', { poradi: [druhy.id, prvni.id] });

  const odpoved = await fetch(`${server.url}/api/produkty?typ=kurz`);
  const data = await odpoved.json();

  assert.equal(odpoved.status, 200);
  assert.deepEqual(data.data.map((k) => k.nazev), ['Kurz IAFF', 'Základní kurz']);
  assert.equal(data.data[0].cena_na_dotaz, true);
  assert.equal(data.data[0].cena_hal, null);
  assert.equal(data.data[1].cena_hal, 490000);
});

test('detail skrytého kurzu veřejné API nevydá', async () => {
  const klient = await prihlas();
  const skryty = await zalozKurz(klient, { nazev: 'Tajný kurz', aktivni: false });

  const odpoved = await fetch(`${server.url}/api/produkty/${skryty.slug}`);
  assert.equal(odpoved.status, 404);

  const telo = await odpoved.text();
  assert.doesNotMatch(telo, /Tajný/, 'ani jméno kurzu nesmí uniknout');
});

test('smazaný kurz z webu zmizí', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  await klient.del(`/api/admin/produkty/${kurz.id}`);

  const seznam = await (await fetch(`${server.url}/api/produkty?typ=kurz`)).json();
  assert.equal(seznam.data.length, 0);
  assert.equal((await fetch(`${server.url}/api/produkty/${kurz.slug}`)).status, 404);
});

test('u termínu jde ven počet volných míst, ne lidé', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const { data: misto } = await klient.post('/api/admin/mista', { nazev: 'Letiště Jihlava' });
  const { data: termin } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(14), cas_od: '8:00', misto_id: misto.id, kapacita_mist: 6,
  });
  await pool.query('UPDATE terminy SET obsazeno_mist = 2 WHERE id = ?', [termin.id]);

  const detail = await (await fetch(`${server.url}/api/produkty/${kurz.slug}`)).json();
  assert.equal(detail.terminy.length, 1);

  const t = detail.terminy[0];
  assert.equal(t.volno, 4);
  assert.equal(t.kapacita, 6);
  assert.equal(t.misto, 'Letiště Jihlava');
  assert.equal(t.obsazeno_mist, undefined, 'interní sloupce ven nepatří');
  assert.equal(t.instruktori, undefined, 'jména instruktorů na web nepatří');
  assert.equal(t.vytvoril_id, undefined);
});

test('zrušený, skrytý ani proběhlý termín se na webu nenabízí', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);

  const { data: zruseny } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(10), kapacita_mist: 6,
  });
  await klient.post(`/api/admin/terminy/${zruseny.id}/zrusit`, { duvod: 'Nepřeje počasí.' });

  await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(11), kapacita_mist: 6, viditelny: false,
  });
  await klient.post('/api/admin/terminy', { produkt_id: kurz.id, datum: zaDni(-3) });
  const { data: platny } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(12), kapacita_mist: 6,
  });

  const detail = await (await fetch(`${server.url}/api/produkty/${kurz.slug}`)).json();
  assert.deepEqual(detail.terminy.map((t) => t.id), [platny.id]);
});

// ------------------------------------------------- stránky ze serveru

test('přehled kurzů má obsah i bez JavaScriptu', async () => {
  // Na tomhle stojí celý SSR pilot: vyhledávače JavaScript spustí, AI
  // crawlery většinou ne. Proto se kontroluje čisté HTML, ne prohlížeč.
  const klient = await prihlas();
  await zalozKurz(klient, { nazev: 'Základní kurz', perex: 'Dva seskoky a vlastní licence.' });

  const { stav, html } = await text('/kurzy');

  assert.equal(stav, 200);
  assert.match(html, /<h1[^>]*>Kurzy a výcvik<\/h1>/);
  assert.match(html, /Základní kurz/);
  assert.match(html, /Dva seskoky a vlastní licence\./);
  assert.match(html, /href="\/kurz\/zakladni-kurz"/, 'karta vede na vlastní adresu kurzu');
  assert.match(html, /<link rel="canonical"/);
});

test('bez zveřejněného kurzu stránka nezeje prázdnotou', async () => {
  // Mimo sezónu nebo než majitelka první kurz zveřejní: místo prázdné mřížky
  // má být věta a odkaz, kudy se ozvat.
  const klient = await prihlas();
  await zalozKurz(klient, { nazev: 'Chystaný kurz', aktivni: false });

  const { stav, html } = await text('/kurzy');

  assert.equal(stav, 200);
  assert.match(html, /Kurzy právě chystáme/);
  assert.match(html, /Napsat nám/);
  assert.doesNotMatch(html, /Chystaný/, 'nezveřejněný kurz se nesmí ukázat ani tady');
});

test('detail kurzu má v HTML nadpis, perex, termíny i strukturovaná data', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient, { nazev: 'Kurz AFF' });
  await klient.put(`/api/admin/produkty/${kurz.id}/kroky`, {
    polozky: [{ cislo: '01', nadpis: 'Teorie', text: 'Celý pátek na hangáru.' }],
  });
  await klient.put(`/api/admin/produkty/${kurz.id}/pozadavky`, {
    polozky: [{ text: 'Sportovní obuv nad kotník.' }],
  });
  const { data: misto } = await klient.post('/api/admin/mista', { nazev: 'Letiště Jihlava' });
  await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(20), misto_id: misto.id, kapacita_mist: 6,
  });

  const { stav, html } = await text(`/kurz/${kurz.slug}`);

  assert.equal(stav, 200);
  assert.match(html, /<h1 class="hero__title">Kurz AFF<\/h1>/);
  assert.match(html, /Čtyřicet osm hodin výuky/, 'perex');
  assert.match(html, /První odstavec popisu\./, 'popis z administrace');
  assert.match(html, /Teorie/, 'průběh kurzu');
  assert.match(html, /Sportovní obuv nad kotník\./, 'checklist');
  assert.match(html, /Letiště Jihlava/, 'termín i s místem');
  assert.match(html, /Od 15 let\./, 'požadavky složené z polí kurzu');
  assert.match(html, /4\s900\sKč/, 'cena s pevnou mezerou, aby se nezalomila');

  const jsonLd = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.ok(jsonLd, 'strukturovaná data pro vyhledávače a AI');
  const data = JSON.parse(jsonLd[1]);
  assert.equal(data['@type'], 'Course');
  assert.equal(data.name, 'Kurz AFF');
  assert.equal(data.offers.price, '4900');
  assert.equal(data.hasCourseInstance.length, 1);
});

test('skrytý kurz nevydá stránku ani přes přímou adresu', async () => {
  const klient = await prihlas();
  const skryty = await zalozKurz(klient, { nazev: 'Tajný kurz', aktivni: false });

  const { stav, html } = await text(`/kurz/${skryty.slug}`);

  assert.equal(stav, 404, 'ne 200 se shellem aplikace — to by si vyhledávač zaindexoval');
  assert.doesNotMatch(html, /Tajný/);
  // Neexistující kurz vypadá stejně, aby z odpovědi nešlo poznat, co existuje.
  const neznamy = await text('/kurz/takovy-kurz-neni');
  assert.equal(neznamy.stav, 404);
});

test('stránka kurzu nabízí poptávku, ne přihlášku', async () => {
  // Přihlášky přijdou s E5. Do té doby končí zájem o kurz poptávkou -
  // stejnou cestou jako průvodce rezervací na titulce.
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);

  const { html } = await text(`/kurz/${kurz.slug}`);
  assert.match(html, /data-poptavka/);
  assert.match(html, /Mám zájem o kurz/);
  assert.doesNotMatch(html, /Přihlásit se na kurz/);

  // A ta poptávka opravdu projde.
  const odpoved = await fetch(`${server.url}/api/poptavky`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jmeno: 'Jana Zkoušková',
      email: 'jana@example.invalid',
      zprava: `Kurz: ${kurz.nazev}\nTermín: 10. 10. 2026`,
    }),
  });
  assert.equal(odpoved.status, 201);

  const [rows] = await pool.query('SELECT zprava FROM poptavky ORDER BY id DESC LIMIT 1');
  assert.match(rows[0].zprava, /Kurz: /, 'provoz u poptávky vidí, o který kurz jde');
});

test('fotka kurzu se na web dostane pod svým kódem', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const { data: fotka } = await klient.post('/api/admin/soubory', {
    obsah: `data:image/png;base64,${PNG}`, alt: 'Instruktor s účastníkem',
  });
  await klient.put(`/api/admin/produkty/${kurz.id}/fotky`, { fotky: [fotka.id] });

  const seznam = await (await fetch(`${server.url}/api/produkty?typ=kurz`)).json();
  assert.match(seznam.data[0].foto.url, /^\/media\/[0-9a-f]{24}$/);
  assert.equal(seznam.data[0].foto.alt, 'Instruktor s účastníkem');

  const { html } = await text(`/kurz/${kurz.slug}`);
  assert.match(html, /\/media\/[0-9a-f]{24}/);
  assert.doesNotMatch(html, /produkty\/20\d\d-\d\d/, 'cesta na disku do HTML nepatří');
});

// ------------------------------------------------------- úklid data.js

test('kurzy už nejsou natvrdo v data.js', async () => {
  // Kdyby se vrátily, web by ukazoval něco jiného než administrace a nikdo
  // by nepoznal, která verze platí.
  const data = await readFile(new URL('../public/assets/js/data.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/assets/js/app.js', import.meta.url), 'utf8');

  for (const znacka of ['COURSES', 'COURSE_CHECKLIST']) {
    assert.doesNotMatch(data, new RegExp(znacka), `${znacka} patří do databáze, ne do data.js`);
    assert.doesNotMatch(app, new RegExp(`D\\.${znacka}`), `app.js už ${znacka} nesmí číst`);
  }
  assert.doesNotMatch(data, /kind: 'kurz'/, 'termíny kurzů jsou v databázi');
});

// --------------------------------------------------- kotvy na stránce kurzu

test('odkaz "Přihlásit se" vede na kotvu, kterou stránka opravdu má', async () => {
  // Kotva `#prihlaska` spadla do hash routeru aplikace, ten ji nepoznal,
  // přepnul na titulku a přepsal serverem vykreslenou stránku - zákazník
  // se na přihlášku nedostal vůbec. Router teď kotvy ignoruje; tady se
  // hlídá druhá polovina: že odkaz míří na id, které na stránce existuje.
  const klient = await prihlas();
  const kurz = await zalozKurz(klient, { nazev: 'Kurz s termínem' });
  const { data: misto } = await klient.post('/api/admin/mista', { nazev: 'Letiště Jihlava' });
  await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(21), cas_od: '8:00',
    misto_id: misto.id, kapacita_mist: 6,
  });

  const { stav, html } = await text(`/kurz/${kurz.slug}`);
  assert.equal(stav, 200);

  // Na co odkazy míří a co stránka nabízí.
  const kotvy = [...html.matchAll(/href="#([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.ok(kotvy.length, 'stránka kurzu má mít aspoň jeden odkaz na kotvu');

  for (const kotva of kotvy) {
    assert.ok(
      html.includes(`id="${kotva}"`),
      `odkaz #${kotva} nemá na stránce cíl - klik by nikam nevedl`
    );
  }

  // S volným termínem se musí dát dojít na formulář přihlášky.
  assert.ok(kotvy.includes('prihlaska'), 's volným termínem má vést odkaz na přihlášku');
  assert.ok(html.includes('id="prihlaska"'), 'formulář přihlášky na stránce chybí');
});

test('kurz bez termínu nabízí poptávku a kotva na ni existuje', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient, { nazev: 'Kurz bez termínu' });

  const { html } = await text(`/kurz/${kurz.slug}`);
  const kotvy = [...html.matchAll(/href="#([a-z0-9-]+)"/g)].map((m) => m[1]);

  for (const kotva of kotvy) {
    assert.ok(html.includes(`id="${kotva}"`), `odkaz #${kotva} nemá cíl`);
  }
  assert.ok(kotvy.includes('poptavka'), 'bez termínu má vést odkaz na poptávku');
});

test('router aplikace pouští kotvy dál a nepřepisuje SSR stránky', async () => {
  // Kontrola zdrojáku: trasa je jen `#/…`, cokoli jiného je kotva. Kdyby
  // se tahle podmínka ztratila, vrátí se chyba, kvůli které nešlo otevřít
  // přihlášku - a z HTTP testu výš by to nebylo poznat.
  const app = await readFile(new URL('../public/assets/js/app.js', import.meta.url), 'utf8');

  assert.match(app, /function jeKotva/, 'router musí umět rozlišit kotvu od trasy');
  assert.match(
    app,
    /if \(jeKotva\(location\.hash\)\)/,
    'hashchange musí kotvu vyřídit dřív, než sáhne na router'
  );
  assert.match(
    app,
    /if \(ssrStranka\) return;/,
    'stránku vykreslenou serverem aplikace nesmí přepsat'
  );
});
