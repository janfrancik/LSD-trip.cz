// Nahrané soubory a fotky u kurzu (etapa E2 modulu Kurzy).
//
// Testy jdou po tom, co se nesmí rozbít: typ souboru se pozná z obsahu,
// ne z toho, co tvrdí prohlížeč; táž fotka se neukládá dvakrát; titulní
// fotka je vždycky první; a obrázek se dá zobrazit bez přihlášení, ale
// nic kolem něj neuteče.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
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

// Opravdové 1×1 PNG, ne jen správná hlavička - ať se testuje to, co projde
// i prohlížečem.
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Druhý obrázek s jiným obsahem - jiná šířka, takže i jiný otisk.
const PNG_2X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAADgdz34AAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function dataUrl(base64) {
  return `data:image/png;base64,${base64}`;
}

async function nahraj(klient, base64 = PNG_1X1, nazev = 'fotka.png') {
  return klient.post('/api/admin/soubory', { obsah: dataUrl(base64), nazev });
}

async function zalozKurz(klient) {
  const { data } = await klient.post('/api/admin/produkty', {
    typ: 'kurz', nazev: 'Kurz s fotkami', cena_na_dotaz: true,
  });
  return data;
}

// ------------------------------------------------------------------ nahrání

test('nahraná fotka se uloží na disk i do databáze', async () => {
  const klient = await prihlas();
  const odpoved = await nahraj(klient);

  assert.equal(odpoved.status, 201);
  assert.equal(odpoved.data.mime, 'image/png');
  assert.equal(odpoved.data.nazev, 'fotka.png');
  assert.equal(odpoved.data.url, `/media/${odpoved.data.id}`, 'klient dostane adresu, ne cestu na disku');
  assert.equal(odpoved.data.cesta, undefined, 'cesta na disku ven nepatří');

  const [rows] = await pool.query('SELECT * FROM soubory WHERE id = ?', [odpoved.data.id]);
  assert.equal(rows[0].zdroj, 'upload');
  assert.equal(rows[0].hash_sha256.length, 64);

  const config = (await import('../src/config.js')).default;
  const naDisku = await stat(path.join(config.uploadDir, rows[0].cesta));
  assert.ok(naDisku.size > 0, 'soubor opravdu leží ve volume');
});

test('typ se pozná z obsahu, ne z toho, co tvrdí prohlížeč', async () => {
  const klient = await prihlas();

  // Tváří se jako PNG, uvnitř je text.
  const podvrh = Buffer.from('tohle rozhodně není obrázek').toString('base64');
  const odpoved = await klient.post('/api/admin/soubory', {
    obsah: `data:image/png;base64,${podvrh}`,
    nazev: 'virus.png',
  });

  assert.equal(odpoved.status, 400);
  assert.match(odpoved.data.chyba, /jen obrázek/i);

  const [rows] = await pool.query('SELECT COUNT(*) AS pocet FROM soubory');
  assert.equal(rows[0].pocet, 0, 'nic se nesmí uložit');
});

test('prázdný soubor se odmítne', async () => {
  const klient = await prihlas();
  const odpoved = await klient.post('/api/admin/soubory', { obsah: 'data:image/png;base64,' });
  assert.equal(odpoved.status, 400);
});

test('tatáž fotka nahraná podruhé nevytvoří druhý soubor', async () => {
  const klient = await prihlas();

  const prvni = await nahraj(klient, PNG_1X1, 'puvodni.png');
  // Jiný název, stejný obsah - pozná se podle otisku, ne podle jména.
  const druha = await nahraj(klient, PNG_1X1, 'uplne-jiny-nazev.png');

  assert.equal(prvni.status, 201);
  assert.equal(druha.status, 200, 'druhé nahrání není nový záznam');
  assert.equal(druha.data.id, prvni.data.id);
  assert.equal(druha.data.uz_je_nahrany, true);

  const [rows] = await pool.query('SELECT COUNT(*) AS pocet FROM soubory');
  assert.equal(rows[0].pocet, 1);
});

// ---------------------------------------------------------------- popis (alt)

test('popis fotky se dá doplnit a uloží se k souboru', async () => {
  const klient = await prihlas();
  const { data: fotka } = await nahraj(klient);

  const po = await klient.patch(`/api/admin/soubory/${fotka.id}`, {
    alt: 'Instruktor s účastníkem po přistání',
  });

  assert.equal(po.status, 200);
  assert.equal(po.data.alt, 'Instruktor s účastníkem po přistání');
});

test('prázdný popis se uloží jako nevyplněný, ne jako prázdný řetězec', async () => {
  const klient = await prihlas();
  const { data: fotka } = await nahraj(klient);
  await klient.patch(`/api/admin/soubory/${fotka.id}`, { alt: 'Něco' });

  const po = await klient.patch(`/api/admin/soubory/${fotka.id}`, { alt: '   ' });
  assert.equal(po.data.alt, null);
});

// -------------------------------------------------------------- fotky u kurzu

test('první fotka v pořadí je titulní', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const a = (await nahraj(klient, PNG_1X1)).data;
  const b = (await nahraj(klient, PNG_2X1)).data;

  const po = await klient.put(`/api/admin/produkty/${kurz.id}/fotky`, { fotky: [a.id, b.id] });

  assert.equal(po.status, 200);
  assert.deepEqual(po.data.fotky.map((f) => f.id), [a.id, b.id]);
  assert.equal(po.data.fotky[0].titulni, 1);
  assert.equal(po.data.fotky[1].titulni, 0);

  // Přehození pořadí přehodí i titulní.
  const prehozene = await klient.put(`/api/admin/produkty/${kurz.id}/fotky`, { fotky: [b.id, a.id] });
  assert.deepEqual(prehozene.data.fotky.map((f) => f.id), [b.id, a.id]);
  assert.equal(prehozene.data.fotky[0].id, b.id);
  assert.equal(prehozene.data.fotky[0].titulni, 1);

  const [pocty] = await pool.query(
    'SELECT COUNT(*) AS pocet FROM produkt_fotky WHERE produkt_id = ? AND titulni = 1',
    [kurz.id]
  );
  assert.equal(pocty[0].pocet, 1, 'titulní je vždycky právě jedna');
});

test('táž fotka dvakrát u jednoho kurzu se uloží jednou', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const a = (await nahraj(klient)).data;

  const po = await klient.put(`/api/admin/produkty/${kurz.id}/fotky`, { fotky: [a.id, a.id] });

  assert.equal(po.status, 200);
  assert.equal(po.data.fotky.length, 1);
});

test('fotku, která neexistuje, nejde ke kurzu připojit', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);

  const po = await klient.put(`/api/admin/produkty/${kurz.id}/fotky`, { fotky: [9999] });

  assert.equal(po.status, 404);
  assert.match(po.data.chyba, /už neexistuje/i);
});

test('prázdný seznam fotky od kurzu odpojí', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const a = (await nahraj(klient)).data;
  await klient.put(`/api/admin/produkty/${kurz.id}/fotky`, { fotky: [a.id] });

  const po = await klient.put(`/api/admin/produkty/${kurz.id}/fotky`, { fotky: [] });
  assert.equal(po.data.fotky.length, 0);

  // Samotný soubor smazaný není - jen už nevisí u kurzu.
  const [rows] = await pool.query('SELECT smazano_at FROM soubory WHERE id = ?', [a.id]);
  assert.equal(rows[0].smazano_at, null);
});

test('smazaná fotka zmizí i z kurzu', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const a = (await nahraj(klient, PNG_1X1)).data;
  const b = (await nahraj(klient, PNG_2X1)).data;
  await klient.put(`/api/admin/produkty/${kurz.id}/fotky`, { fotky: [a.id, b.id] });

  const smazani = await klient.del(`/api/admin/soubory/${a.id}`);
  assert.equal(smazani.status, 200);

  const detail = await klient.get(`/api/admin/produkty/${kurz.id}`);
  assert.deepEqual(detail.data.fotky.map((f) => f.id), [b.id]);
  assert.equal(detail.data.fotky[0].titulni, 1, 'zbylá fotka se stane titulní');
});

// ------------------------------------------------------------------- /media

test('obrázek se zobrazí i bez přihlášení', async () => {
  const klient = await prihlas();
  const { data: fotka } = await nahraj(klient);

  const host = vytvorKlienta(server.url);
  const odpoved = await fetch(server.url + fotka.url);

  assert.equal(odpoved.status, 200);
  assert.match(odpoved.headers.get('content-type') ?? '', /image\/png/);
  assert.match(odpoved.headers.get('cache-control') ?? '', /immutable/);
  assert.ok((await odpoved.arrayBuffer()).byteLength > 0);
  assert.ok(host, 'veřejný klient nepotřebuje session');
});

test('neexistující ani smazaný obrázek se nezobrazí', async () => {
  const klient = await prihlas();
  const { data: fotka } = await nahraj(klient);

  assert.equal((await fetch(`${server.url}/media/999999`)).status, 404);

  await klient.del(`/api/admin/soubory/${fotka.id}`);
  assert.equal((await fetch(server.url + fotka.url)).status, 404, 'smazaná fotka se přestane zobrazovat');
});

test('cesta k souboru nevede mimo adresář s uploady', async () => {
  const { cestaKSouboru } = await import('../src/soubory.js');

  assert.equal(cestaKSouboru('../../etc/passwd'), null);
  assert.equal(cestaKSouboru('produkty/../../tajne.txt'), null);
  assert.ok(cestaKSouboru('produkty/2026-10/abc.jpg'), 'běžná cesta projde');
});

// --------------------------------------------------------------- oprávnění

test('bez přihlášení nejde nahrát ani smazat', async () => {
  const host = vytvorKlienta(server.url);
  await host.get('/api/admin/ja'); // CSRF token

  assert.equal((await host.post('/api/admin/soubory', { obsah: dataUrl(PNG_1X1) })).status, 401);
  assert.equal((await host.del('/api/admin/soubory/1')).status, 401);
});

test('instruktor fotky nahrávat nesmí, provoz ano', async () => {
  const instruktor = await prihlas('instruktor');
  assert.equal((await nahraj(instruktor)).status, 403);

  const provoz = await prihlas('provoz');
  assert.equal((await nahraj(provoz)).status, 201, 'provoz spravuje galerii');
});

test('provoz fotky nahraje, ale ke kurzu je nepřipojí', async () => {
  const spravce = await prihlas('admin');
  const kurz = await zalozKurz(spravce);

  const provoz = await prihlas('provoz');
  const { data: fotka } = await nahraj(provoz);

  // Produkty provoz jen čte (docs/plan-administrace.md §4).
  const po = await provoz.put(`/api/admin/produkty/${kurz.id}/fotky`, { fotky: [fotka.id] });
  assert.equal(po.status, 403);
});
