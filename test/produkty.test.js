// Produkty a ceník (etapa E1 modulu Kurzy).
//
// Kurz je produkt s typ='kurz'. Testy jdou po tom, co se nesmí rozbít:
// oprávnění podle rolí, cena v haléřích a její historie, měkké mazání
// a kontroly, které zabrání uložit nesmysl.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
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
  await obnovDphSazby();
  const { vynulujLimity } = await import('../src/auth/limit.js');
  await vynulujLimity();
  heslo = testovaciHeslo();
});

// `dph_sazby` je číselník z migrace, vycistiData ho schválně nemaže. Testy ale
// výchozí sazbu přepínají, takže se před každým vrací do stavu po migraci -
// jinak by si následující test sáhl pro výchozí sazbu a dostal osvobozeno.
async function obnovDphSazby() {
  await pool.query(
    `UPDATE dph_sazby
        SET vychozi = (kod = 'zakladni21'),
            aktivni = 1,
            procento = CASE kod
              WHEN 'zakladni21' THEN 21.00
              WHEN 'snizena12' THEN 12.00
              ELSE 0.00
            END`
  );
}

async function prihlas(role = 'admin') {
  const email = `${role}@example.invalid`;
  await vytvorUzivatele(pool, { email, jmeno: 'Testovací člověk', role, heslo });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  await klient.post('/api/admin/prihlaseni', { email, heslo });
  return klient;
}

const KURZ = {
  typ: 'kurz',
  nazev: 'Parašutistický výcvik se 2 seskoky',
  stitek: 'Základní kurz',
  perex: '48 hodin výuky podle osnov V-PARA 1 a V-PARA 2.',
  cena_hal: 460000,
  min_vek: 15,
  max_vaha_kg: 95,
  souhlas_zastupce_do_let: 18,
  vyzaduje_lekarskou_prohlidku: true,
  delka_text: '48 hodin',
  uroven_text: 'Začátečník',
};

// ------------------------------------------------------------------ založení

test('kurz se založí jako produkt typu kurz a dostane výchozí sazbu DPH', async () => {
  const klient = await prihlas();
  const odpoved = await klient.post('/api/admin/produkty', KURZ);

  assert.equal(odpoved.status, 201);
  assert.equal(odpoved.data.typ, 'kurz');
  assert.equal(odpoved.data.cena_hal, 460000, 'cena se drží v haléřích');
  assert.equal(odpoved.data.dph_kod, 'zakladni21', 'bez výběru se použije výchozí sazba');
  assert.equal(odpoved.data.aktivni, 0, 'nový kurz je skrytý, dokud ho majitelka nezveřejní');
  assert.equal(odpoved.data.max_vaha_kg, 95);
  assert.equal(odpoved.data.vyzaduje_lekarskou_prohlidku, 1);
});

test('slug vznikne z názvu bez diakritiky a neopakuje se', async () => {
  const klient = await prihlas();

  const prvni = await klient.post('/api/admin/produkty', KURZ);
  assert.equal(
    prvni.data.slug,
    'parasutisticky-vycvik-se-2-seskoky',
    'adresa kurzu musí jít přečíst i z papíru'
  );

  // Druhý kurz se stejným názvem nesmí spadnout na duplicitním slugu.
  const druhy = await klient.post('/api/admin/produkty', KURZ);
  assert.equal(druhy.status, 201);
  assert.equal(druhy.data.slug, 'parasutisticky-vycvik-se-2-seskoky-2');
});

test('kurz bez ceny a bez „cena na dotaz“ se neuloží', async () => {
  const klient = await prihlas();
  const odpoved = await klient.post('/api/admin/produkty', {
    typ: 'kurz',
    nazev: 'Kurz bez ceny',
  });

  assert.equal(odpoved.status, 409);
  assert.match(odpoved.data.detaily.cena_hal, /Zadej cenu/);
});

test('cena na dotaz se uloží bez částky', async () => {
  const klient = await prihlas();
  const odpoved = await klient.post('/api/admin/produkty', {
    typ: 'kurz',
    nazev: 'Kurz IAFF s větrným tunelem',
    cena_na_dotaz: true,
  });

  assert.equal(odpoved.status, 201);
  assert.equal(odpoved.data.cena_na_dotaz, 1);
  assert.equal(odpoved.data.cena_hal, null);
});

test('přepnutí na cenu na dotaz zahodí starou částku', async () => {
  const klient = await prihlas();
  const { data: kurz } = await klient.post('/api/admin/produkty', KURZ);

  const po = await klient.patch(`/api/admin/produkty/${kurz.id}`, { cena_na_dotaz: true });

  assert.equal(po.status, 200);
  assert.equal(po.data.cena_na_dotaz, 1);
  assert.equal(po.data.cena_hal, null, 'jinak by web ukazoval cenu u kurzu „na dotaz“');
});

test('horní hranice věku nemůže být pod dolní', async () => {
  const klient = await prihlas();
  const odpoved = await klient.post('/api/admin/produkty', {
    ...KURZ, min_vek: 30, max_vek: 18,
  });

  assert.equal(odpoved.status, 409);
  assert.match(odpoved.data.detaily.max_vek, /nemůže být nižší/);
});

// -------------------------------------------------------------- historie cen

test('každá změna ceny se zapíše do historie i s tím, kdo ji udělal', async () => {
  const klient = await prihlas();
  const { data: kurz } = await klient.post('/api/admin/produkty', KURZ);

  await klient.patch(`/api/admin/produkty/${kurz.id}`, {
    cena_hal: 490000,
    duvod_zmeny_ceny: 'Zdražení od nové sezóny',
  });

  const historie = await klient.get(`/api/admin/produkty/${kurz.id}/cenik-historie`);
  assert.equal(historie.status, 200);
  assert.equal(historie.data.data.length, 2, 'založení i změna');

  const [zmena, zalozeni] = historie.data.data;
  assert.equal(zmena.cena_hal_pred, 460000);
  assert.equal(zmena.cena_hal_po, 490000);
  assert.equal(zmena.duvod, 'Zdražení od nové sezóny');
  assert.equal(zmena.uzivatel_jmeno, 'Testovací člověk');
  assert.equal(zalozeni.cena_hal_pred, null);
  assert.equal(zalozeni.cena_hal_po, 460000);
});

test('úprava, která se ceny netýká, do historie nic nepřidá', async () => {
  const klient = await prihlas();
  const { data: kurz } = await klient.post('/api/admin/produkty', KURZ);

  await klient.patch(`/api/admin/produkty/${kurz.id}`, { perex: 'Jiný perex.' });
  // Stejná cena znovu taky ne - jinak by historii zaplavily prázdné řádky.
  await klient.patch(`/api/admin/produkty/${kurz.id}`, { cena_hal: 460000 });

  const historie = await klient.get(`/api/admin/produkty/${kurz.id}/cenik-historie`);
  assert.equal(historie.data.data.length, 1, 'jen řádek ze založení');
});

// -------------------------------------------------- požadavky a průběh kurzu

test('požadavky a průběh se ukládají celé najednou a drží pořadí', async () => {
  const klient = await prihlas();
  const { data: kurz } = await klient.post('/api/admin/produkty', KURZ);

  const sPozadavky = await klient.put(`/api/admin/produkty/${kurz.id}/pozadavky`, {
    polozky: [
      { text: 'Lékařské potvrzení o způsobilosti.' },
      { text: 'Sportovní obuv nad kotník.' },
    ],
  });
  assert.equal(sPozadavky.status, 200);
  assert.deepEqual(
    sPozadavky.data.pozadavky.map((p) => p.text),
    ['Lékařské potvrzení o způsobilosti.', 'Sportovní obuv nad kotník.']
  );

  const sKroky = await klient.put(`/api/admin/produkty/${kurz.id}/kroky`, {
    polozky: [
      { cislo: '01', nadpis: 'Teorie', text: 'Pátek od 10:00.' },
      { cislo: '02', nadpis: 'První seskok', text: 'Sobota ráno.' },
    ],
  });
  assert.deepEqual(sKroky.data.kroky.map((k) => k.nadpis), ['Teorie', 'První seskok']);
  assert.deepEqual(sKroky.data.kroky.map((k) => k.poradi), [1, 2]);

  // Uložení kratšího seznamu musí ten původní nahradit, ne doplnit.
  const kratsi = await klient.put(`/api/admin/produkty/${kurz.id}/pozadavky`, {
    polozky: [{ text: 'Jen jeden požadavek.' }],
  });
  assert.equal(kratsi.data.pozadavky.length, 1);
});

test('krok bez nadpisu se neuloží', async () => {
  const klient = await prihlas();
  const { data: kurz } = await klient.post('/api/admin/produkty', KURZ);

  const odpoved = await klient.put(`/api/admin/produkty/${kurz.id}/kroky`, {
    polozky: [{ cislo: '01', nadpis: '', text: 'Bez nadpisu.' }],
  });

  assert.equal(odpoved.status, 400);
});

// ---------------------------------------------------------------- pořadí

test('pořadí se dá přeskládat a nový kurz jde na konec', async () => {
  const klient = await prihlas();
  const a = (await klient.post('/api/admin/produkty', { ...KURZ, nazev: 'Kurz A' })).data;
  const b = (await klient.post('/api/admin/produkty', { ...KURZ, nazev: 'Kurz B' })).data;
  const c = (await klient.post('/api/admin/produkty', { ...KURZ, nazev: 'Kurz C' })).data;

  assert.deepEqual([a.poradi, b.poradi, c.poradi], [1, 2, 3]);

  await klient.post('/api/admin/produkty/poradi', { poradi: [c.id, a.id, b.id] });

  const seznam = await klient.get('/api/admin/produkty?typ=kurz');
  assert.deepEqual(seznam.data.data.map((p) => p.nazev), ['Kurz C', 'Kurz A', 'Kurz B']);
});

// ---------------------------------------------------------------- mazání

test('smazaný kurz zmizí ze seznamu, zůstane v datech a dá se obnovit', async () => {
  const klient = await prihlas();
  const { data: kurz } = await klient.post('/api/admin/produkty', { ...KURZ, aktivni: true });

  const smazani = await klient.del(`/api/admin/produkty/${kurz.id}`);
  assert.equal(smazani.status, 200);

  const seznam = await klient.get('/api/admin/produkty?typ=kurz');
  assert.equal(seznam.data.data.length, 0);

  const [rows] = await pool.query('SELECT smazano_at, aktivni FROM produkty WHERE id = ?', [kurz.id]);
  assert.ok(rows[0].smazano_at, 'maže se měkce');
  assert.equal(rows[0].aktivni, 0, 'smazaný kurz se nesmí ukázat na webu, i kdyby byl aktivní');

  const smazane = await klient.get('/api/admin/produkty?typ=kurz&smazane=1');
  assert.equal(smazane.data.data.length, 1);

  const obnoveni = await klient.post(`/api/admin/produkty/${kurz.id}/obnovit`, {});
  assert.equal(obnoveni.status, 200);

  const [po] = await pool.query('SELECT smazano_at, aktivni FROM produkty WHERE id = ?', [kurz.id]);
  assert.equal(po[0].smazano_at, null);
  assert.equal(po[0].aktivni, 0, 'obnovený kurz zůstává skrytý, zveřejní se vědomě');
});

test('smazaný kurz nejde upravovat', async () => {
  const klient = await prihlas();
  const { data: kurz } = await klient.post('/api/admin/produkty', KURZ);
  await klient.del(`/api/admin/produkty/${kurz.id}`);

  const odpoved = await klient.patch(`/api/admin/produkty/${kurz.id}`, { nazev: 'Jiný název' });
  assert.equal(odpoved.status, 404);
});

// ------------------------------------------------------------- oprávnění

test('bez přihlášení se k produktům nikdo nedostane', async () => {
  const host = vytvorKlienta(server.url);
  assert.equal((await host.get('/api/admin/produkty')).status, 401);

  // Zápis bez CSRF tokenu neprojde přes ochranu formulářů, tedy 403 dřív než 401.
  assert.equal((await host.post('/api/admin/produkty', KURZ)).status, 403);

  // S platným CSRF tokenem, ale bez session, je to 401.
  await host.get('/api/admin/ja');
  assert.equal((await host.post('/api/admin/produkty', KURZ)).status, 401);
});

test('provoz kurzy vidí, ale nemění; instruktor je nevidí vůbec', async () => {
  const spravce = await prihlas('admin');
  const { data: kurz } = await spravce.post('/api/admin/produkty', KURZ);

  const provoz = await prihlas('provoz');
  assert.equal((await provoz.get('/api/admin/produkty?typ=kurz')).status, 200);
  assert.equal((await provoz.patch(`/api/admin/produkty/${kurz.id}`, { nazev: 'Jiný' })).status, 403);
  assert.equal((await provoz.del(`/api/admin/produkty/${kurz.id}`)).status, 403);

  const instruktor = await prihlas('instruktor');
  assert.equal((await instruktor.get('/api/admin/produkty?typ=kurz')).status, 403);
});

// ------------------------------------------------------------------ DPH

test('osvobozená sazba nesmí dostat nenulové procento', async () => {
  const klient = await prihlas();
  const [[sazba]] = await pool.query("SELECT id FROM dph_sazby WHERE kod = 'osvobozeno61d'");

  const odpoved = await klient.patch(`/api/admin/dph-sazby/${sazba.id}`, { procento: 21 });

  assert.equal(odpoved.status, 409);
  assert.match(odpoved.data.detaily.procento, /nulovou sazbu/);
});

test('výchozí sazba je vždy právě jedna', async () => {
  const klient = await prihlas();
  const [[sazba]] = await pool.query("SELECT id FROM dph_sazby WHERE kod = 'osvobozeno61d'");

  await klient.patch(`/api/admin/dph-sazby/${sazba.id}`, { vychozi: true });

  const [vychozi] = await pool.query('SELECT kod FROM dph_sazby WHERE vychozi = 1');
  assert.equal(vychozi.length, 1);
  assert.equal(vychozi[0].kod, 'osvobozeno61d');
});

test('kurz se dá přepnout na osvobozeno bez zásahu do kódu', async () => {
  const klient = await prihlas();
  const { data: kurz } = await klient.post('/api/admin/produkty', KURZ);
  const [[osvobozeno]] = await pool.query("SELECT id FROM dph_sazby WHERE kod = 'osvobozeno61d'");

  const po = await klient.patch(`/api/admin/produkty/${kurz.id}`, { dph_sazba_id: osvobozeno.id });

  assert.equal(po.status, 200);
  assert.equal(po.data.dph_kod, 'osvobozeno61d');
  assert.equal(po.data.dph_rezim, 'osvobozeno');
});

// ------------------------------------------------------------------ audit

test('založení i změna kurzu se zapíšou do auditu', async () => {
  const klient = await prihlas();
  const { data: kurz } = await klient.post('/api/admin/produkty', KURZ);
  await klient.patch(`/api/admin/produkty/${kurz.id}`, { nazev: 'Nový název' });

  const [zaznamy] = await pool.query(
    "SELECT akce, popis FROM audit_log WHERE entita = 'produkt' ORDER BY id"
  );
  assert.deepEqual(zaznamy.map((z) => z.akce), ['vytvoreni', 'zmena']);
  assert.equal(zaznamy[0].popis, KURZ.nazev);
});

test('dlouhé texty se do auditu nepropisují celé', async () => {
  const klient = await prihlas();
  const { data: kurz } = await klient.post('/api/admin/produkty', KURZ);

  await klient.patch(`/api/admin/produkty/${kurz.id}`, { popis: 'x'.repeat(5000) });

  const [[zaznam]] = await pool.query(
    "SELECT po FROM audit_log WHERE entita = 'produkt' AND akce = 'zmena' ORDER BY id DESC LIMIT 1"
  );
  const po = typeof zaznam.po === 'string' ? JSON.parse(zaznam.po) : zaznam.po;
  assert.equal(po.popis, '(text)', 'v logu je značka, ne pět tisíc znaků');
});
