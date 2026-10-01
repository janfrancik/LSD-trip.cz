// Nahrané soubory a fotky u kurzu (etapa E2 modulu Kurzy).
//
// Testy jdou po tom, co se nesmí rozbít: typ souboru se pozná z obsahu,
// ne z toho, co tvrdí prohlížeč; táž fotka se neukládá dvakrát; titulní
// fotka je vždycky první; a obrázek se dá zobrazit bez přihlášení, ale
// nic kolem něj neuteče.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
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
  assert.match(odpoved.data.url, /^\/media\/[0-9a-f]{24}$/, 'adresa je náhodný kód, ne pořadové číslo');
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

  assert.equal((await fetch(`${server.url}/media/${'a'.repeat(24)}`)).status, 404);

  await klient.del(`/api/admin/soubory/${fotka.id}`);
  assert.equal((await fetch(server.url + fotka.url)).status, 404, 'smazaná fotka se přestane zobrazovat');
});

test('fotka se nedá najít podle pořadového čísla', async () => {
  // Jinak by stačilo projít /media/1, /media/2, ... a prohlédnout si i fotky
  // kurzu, který ještě není zveřejněný.
  const klient = await prihlas();
  const { data: fotka } = await nahraj(klient);

  for (const adresa of [`/media/${fotka.id}`, '/media/1', '/media/999999', '/media/']) {
    const odpoved = await fetch(server.url + adresa);
    assert.equal(odpoved.status, 404, `${adresa} nesmí nic vrátit`);
  }

  assert.equal((await fetch(server.url + fotka.url)).status, 200, 'podle kódu se zobrazí');
});

test('každá fotka má svůj vlastní kód', async () => {
  const klient = await prihlas();
  const a = (await nahraj(klient, PNG_1X1)).data;
  const b = (await nahraj(klient, PNG_2X1)).data;

  assert.notEqual(a.url, b.url);

  const [rows] = await pool.query('SELECT kod FROM soubory ORDER BY id');
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((r) => r.kod)).size, 2);
  for (const { kod } of rows) assert.match(kod, /^[0-9a-f]{24}$/);
});

// ------------------------------------------------------ zmenšení pro web

// Fotka z mobilu má klidně 4000 px na delší straně. Ty tady vyrábíme menší,
// ať testy netrvají, ale pořád nad hranicí 1600 px.
async function velkaFotka({ sirka = 2400, vyska = 1200, orientace = null, barva = 40 } = {}) {
  let obraz = sharp({
    create: { width: sirka, height: vyska, channels: 3, background: { r: barva, g: 90, b: 160 } },
  }).jpeg();
  if (orientace) obraz = obraz.withMetadata({ orientation: orientace });
  return (await obraz.toBuffer()).toString('base64');
}

async function nactiVarianty(pool, id) {
  const [rows] = await pool.query('SELECT sirka, vyska, varianty FROM soubory WHERE id = ?', [id]);
  const v = rows[0].varianty;
  return { ...rows[0], varianty: typeof v === 'string' ? JSON.parse(v) : v };
}

test('velká fotka se pro web zmenší na 1600 px a originál zůstane', async () => {
  const klient = await prihlas();
  const obsah = await velkaFotka();

  const odpoved = await klient.post('/api/admin/soubory', {
    obsah: `data:image/jpeg;base64,${obsah}`,
    nazev: 'z-mobilu.jpg',
  });
  assert.equal(odpoved.status, 201);

  // Administrace ukazuje rozměry a velikost toho, co se opravdu posílá na web.
  assert.equal(odpoved.data.sirka, 1600);
  assert.equal(odpoved.data.vyska, 800);
  assert.ok(
    odpoved.data.velikost_b < odpoved.data.puvodni_velikost_b,
    'webová verze musí být menší než originál'
  );

  const ulozene = await nactiVarianty(pool, odpoved.data.id);
  assert.equal(ulozene.sirka, 2400, 'u originálu zůstávají jeho rozměry');
  assert.equal(ulozene.vyska, 1200);
  assert.equal(ulozene.varianty.web.sirka, 1600);

  // Na disku leží obojí.
  const config = (await import('../src/config.js')).default;
  const [rows] = await pool.query('SELECT cesta FROM soubory WHERE id = ?', [odpoved.data.id]);
  const original = await stat(path.join(config.uploadDir, rows[0].cesta));
  const webova = await stat(path.join(config.uploadDir, ulozene.varianty.web.cesta));
  assert.ok(original.size > webova.size, 'originál se nepřepsal');

  // A /media posílá tu zmenšenou.
  const stazene = await fetch(server.url + odpoved.data.url);
  const bajty = Buffer.from(await stazene.arrayBuffer());
  assert.equal(bajty.length, webova.size);
  const popis = await sharp(bajty).metadata();
  assert.equal(popis.width, 1600);
});

test('fotka, která je už dost malá, se znovu nepřepisuje', async () => {
  const klient = await prihlas();
  const { data: fotka } = await nahraj(klient); // 1×1 PNG

  assert.equal(fotka.sirka, 1);
  assert.equal(fotka.velikost_b, fotka.puvodni_velikost_b);

  const ulozene = await nactiVarianty(pool, fotka.id);
  assert.equal(ulozene.varianty.web, null);
  assert.match(ulozene.varianty.proc, /dost malý/);

  // Posílá se originál, bit po bitu.
  const stazene = Buffer.from(await (await fetch(server.url + fotka.url)).arrayBuffer());
  assert.equal(stazene.toString('base64'), PNG_1X1);
});

test('fotka vyfocená na boku je na webu narovnaná', async () => {
  // Mobil fotku uloží naležato a připíše do EXIF, že se má otočit. Zmenšením
  // se EXIF zahodí, takže se otočení musí propsat do pixelů - jinak by
  // na webu ležela na boku.
  const klient = await prihlas();
  const obsah = await velkaFotka({ orientace: 6, barva: 70 });

  const { data: fotka } = await klient.post('/api/admin/soubory', {
    obsah: `data:image/jpeg;base64,${obsah}`,
  });

  // Administrace ukazuje rozměry webové verze - tedy už narovnané, na výšku.
  assert.equal(fotka.sirka, 800);
  assert.equal(fotka.vyska, 1600);

  const ulozene = await nactiVarianty(pool, fotka.id);
  assert.equal(ulozene.sirka, 1200, 'u originálu jsou rozměry prohozené, jak ho člověk uvidí');
  assert.equal(ulozene.vyska, 2400);

  const bajty = Buffer.from(await (await fetch(server.url + fotka.url)).arrayBuffer());
  const popis = await sharp(bajty).metadata();
  assert.equal(popis.width, 800);
  assert.equal(popis.height, 1600);
  assert.ok(!popis.orientation || popis.orientation === 1, 'otočení je v pixelech, ne v EXIF');
});

test('torzo obrázku se odmítne, i když má správnou hlavičku', async () => {
  const klient = await prihlas();
  // Začátek JPEG, zbytek nesmysl - magické bajty projdou, obrázek ne.
  const torzo = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(200, 0x41),
  ]).toString('base64');

  const odpoved = await klient.post('/api/admin/soubory', {
    obsah: `data:image/jpeg;base64,${torzo}`,
  });

  assert.equal(odpoved.status, 400);
  assert.match(odpoved.data.chyba, /nepodařilo přečíst/i);

  const [rows] = await pool.query('SELECT COUNT(*) AS pocet FROM soubory');
  assert.equal(rows[0].pocet, 0, 'po odmítnutí nesmí zůstat ani záznam, ani soubor');
});

test('fotce bez webové verze se dopočítá', async () => {
  // Takhle jsou na tom fotky nahrané dřív, než se zmenšování zavedlo,
  // a tak přijdou i fotky z importu starého webu (fáze 5).
  const klient = await prihlas();
  const { data: fotka } = await klient.post('/api/admin/soubory', {
    obsah: `data:image/jpeg;base64,${await velkaFotka({ barva: 120 })}`,
  });
  await pool.query('UPDATE soubory SET sirka = NULL, vyska = NULL, varianty = NULL WHERE id = ?', [
    fotka.id,
  ]);

  const { dopocitejChybejiciVarianty } = await import('../src/soubory.js');
  assert.equal(await dopocitejChybejiciVarianty(), 1);

  const ulozene = await nactiVarianty(pool, fotka.id);
  assert.equal(ulozene.sirka, 2400);
  assert.equal(ulozene.varianty.web.sirka, 1600);

  // Druhé spuštění už nemá co dělat.
  assert.equal(await dopocitejChybejiciVarianty(), 0);
});

test('fotka, kterou se nepodařilo přečíst, se nezkouší pořád znovu', async () => {
  const klient = await prihlas();
  const { data: fotka } = await nahraj(klient);
  await pool.query(
    "UPDATE soubory SET varianty = NULL, cesta = 'produkty/2026-10/neexistuje.png' WHERE id = ?",
    [fotka.id]
  );

  const { dopocitejChybejiciVarianty } = await import('../src/soubory.js');
  assert.equal(await dopocitejChybejiciVarianty(), 0);

  const ulozene = await nactiVarianty(pool, fotka.id);
  assert.equal(ulozene.varianty.web, null, 'zapíše se pokus, ne NULL');
  assert.equal(await dopocitejChybejiciVarianty(), 0, 'podruhé už se o ni nepokouší');
});

// ------------------------------------------------------------------- úklid

test('smazaná fotka, na které nic nevisí, zmizí den po smazání i z disku', async () => {
  const klient = await prihlas();
  const { data: fotka } = await nahraj(klient);

  const [pred] = await pool.query('SELECT cesta FROM soubory WHERE id = ?', [fotka.id]);
  const config = (await import('../src/config.js')).default;
  const naDisku = path.join(config.uploadDir, pred[0].cesta);
  await stat(naDisku); // existuje

  const { uklidOsireleSoubory } = await import('../src/soubory.js');

  // Čerstvě smazaná se ještě neuklízí - je den na rozmyšlenou.
  await klient.del(`/api/admin/soubory/${fotka.id}`);
  assert.equal(await uklidOsireleSoubory(), 0);
  await stat(naDisku);

  // Po dni ano.
  await pool.query('UPDATE soubory SET smazano_at = DATE_SUB(NOW(), INTERVAL 2 DAY) WHERE id = ?', [
    fotka.id,
  ]);
  assert.equal(await uklidOsireleSoubory(), 1);

  const [po] = await pool.query('SELECT COUNT(*) AS pocet FROM soubory WHERE id = ?', [fotka.id]);
  assert.equal(po[0].pocet, 0);
  await assert.rejects(() => stat(naDisku), 'soubor zmizí i z disku');
});

test('z disku zmizí i webová verze, ne jen originál', async () => {
  const klient = await prihlas();
  const { data: fotka } = await klient.post('/api/admin/soubory', {
    obsah: `data:image/jpeg;base64,${await velkaFotka({ barva: 200 })}`,
  });

  const config = (await import('../src/config.js')).default;
  const ulozene = await nactiVarianty(pool, fotka.id);
  const [rows] = await pool.query('SELECT cesta FROM soubory WHERE id = ?', [fotka.id]);
  const cesty = [rows[0].cesta, ulozene.varianty.web.cesta].map((c) =>
    path.join(config.uploadDir, c)
  );
  for (const cesta of cesty) await stat(cesta);

  await klient.del(`/api/admin/soubory/${fotka.id}`);
  await pool.query('UPDATE soubory SET smazano_at = DATE_SUB(NOW(), INTERVAL 2 DAY) WHERE id = ?', [
    fotka.id,
  ]);
  const { uklidOsireleSoubory } = await import('../src/soubory.js');
  assert.equal(await uklidOsireleSoubory(), 1);

  for (const cesta of cesty) {
    await assert.rejects(() => stat(cesta), `${path.basename(cesta)} má zmizet`);
  }
});

test('úklid i dopočet webových verzí se opravdu spouští, nejen existují', async () => {
  // Napsat úklidovou funkci a zapomenout ji zavolat je snadné a nikdo si
  // toho nevšimne - projeví se to až plným diskem za půl roku.
  const udrzba = await readFile(new URL('../src/udrzba.js', import.meta.url), 'utf8');
  assert.match(udrzba, /uklidOsireleSoubory/, 'src/udrzba.js musí osiřelé soubory uklízet');
  assert.match(
    udrzba,
    /dopocitejChybejiciVarianty/,
    'src/udrzba.js musí dopočítávat chybějící webové verze'
  );
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
