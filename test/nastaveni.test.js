// Nastavení a audit: co se uloží, co se odmítne a co po sobě zůstane v logu.

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
  (await import('../src/nastaveni.js')).zapomenCache();
  const { vynulujLimity } = await import('../src/auth/limit.js');
  await vynulujLimity();
  heslo = testovaciHeslo();
});

async function prihlasenySpravce() {
  await vytvorUzivatele(pool, { email: 'sef@example.invalid', jmeno: 'Šéfka', heslo });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  await klient.post('/api/admin/prihlaseni', { email: 'sef@example.invalid', heslo });
  return klient;
}

test('nastavení má rozumné výchozí hodnoty i bez záznamu v databázi', async () => {
  const klient = await prihlasenySpravce();
  const odpoved = await klient.get('/api/admin/nastaveni');

  assert.equal(odpoved.status, 200);
  const nazev = odpoved.data.polozky.find((p) => p.klic === 'spolek.nazev');
  assert.equal(nazev.hodnota, 'Letecká společnost dobrodruhů z.s.');

  const drzeni = odpoved.data.polozky.find((p) => p.klic === 'rezervace.drzeni_hodin');
  assert.equal(drzeni.hodnota, 48, 'držení místa je 48 hodin, jak jsme se domluvili');

  // Formulář se skládá podle registru, takže popisky musí chodit s ním.
  assert.ok(nazev.popisek);
  assert.ok(odpoved.data.skupiny.length > 0);
});

test('uložení nastavení se propíše a zapíše do auditu', async () => {
  const klient = await prihlasenySpravce();

  const odpoved = await klient.patch('/api/admin/nastaveni', {
    'spolek.ico': '26529253',
    'rezervace.drzeni_hodin': '72',
  });
  assert.equal(odpoved.status, 200);

  const znovu = await klient.get('/api/admin/nastaveni');
  const drzeni = znovu.data.polozky.find((p) => p.klic === 'rezervace.drzeni_hodin');
  assert.equal(drzeni.hodnota, 72, 'číslo se ukládá jako číslo, ne jako text');

  const [[audit]] = await pool.query(
    "SELECT * FROM audit_log WHERE entita = 'nastaveni' ORDER BY id DESC LIMIT 1"
  );
  assert.equal(audit.akce, 'zmena');
  const po = typeof audit.po === 'string' ? JSON.parse(audit.po) : audit.po;
  assert.equal(po['rezervace.drzeni_hodin'], 72);
});

test('neznámý klíč ani nesmyslná hodnota se neuloží', async () => {
  const klient = await prihlasenySpravce();

  const cizi = await klient.patch('/api/admin/nastaveni', { 'utok.klic': 'cokoli' });
  assert.equal(cizi.status, 400);

  const spatneCislo = await klient.patch('/api/admin/nastaveni', {
    'rezervace.drzeni_hodin': 'čtyřicet osm',
  });
  assert.equal(spatneCislo.status, 400);
  assert.ok(spatneCislo.data.detaily['rezervace.drzeni_hodin']);

  const mimoRozsah = await klient.patch('/api/admin/nastaveni', {
    'rezervace.drzeni_hodin': '99999',
  });
  assert.equal(mimoRozsah.status, 400);

  const [[pocet]] = await pool.query('SELECT COUNT(*) AS pocet FROM nastaveni');
  assert.equal(pocet.pocet, 0, 'nic z toho se nesmělo uložit');
});

test('klíče k službám se z administrace nedají přečíst', async () => {
  const klient = await prihlasenySpravce();
  const odpoved = await klient.get('/api/admin/nastaveni/integrace');

  assert.equal(odpoved.status, 200);
  const text = JSON.stringify(odpoved.data);

  // Smí být vidět, jestli je klíč nastavený - ne jeho hodnota.
  for (const sluzba of odpoved.data.sluzby) {
    assert.equal(typeof sluzba.nastaveno, 'boolean');
    assert.ok(!('klic_hodnota' in sluzba));
  }
  assert.ok(!text.includes('re_'), 'v odpovědi nesmí být Resend klíč');
  assert.ok(!text.toLowerCase().includes('secret'));
});

test('audit zaznamená, kdo co změnil, a hesla do něj neprosáknou', async () => {
  const klient = await prihlasenySpravce();

  await klient.post('/api/admin/uzivatele', {
    jmeno: 'Nový Člověk',
    email: 'novy@example.invalid',
    role: 'provoz',
    poslat_pozvanku: false,
  });

  const audit = await klient.get('/api/admin/audit?entita=uzivatel');
  assert.equal(audit.status, 200);

  const vytvoreni = audit.data.data.find((a) => a.akce === 'vytvoreni');
  assert.ok(vytvoreni, 'vytvoření uživatele musí být v auditu');
  assert.equal(vytvoreni.kdo, 'Šéfka');
  assert.match(vytvoreni.popis, /Nový Člověk/);

  const [rows] = await pool.query('SELECT pred, po FROM audit_log');
  const vse = JSON.stringify(rows);
  assert.ok(!vse.includes(heslo), 'heslo se nikdy nesmí objevit v auditu');
  assert.ok(!vse.includes('heslo_hash'));
});

test('nový uživatel nemá heslo, dokud si ho sám nenastaví z pozvánky', async () => {
  const klient = await prihlasenySpravce();

  const vytvoreni = await klient.post('/api/admin/uzivatele', {
    jmeno: 'Provozní Člověk',
    email: 'provoz@example.invalid',
    role: 'provoz',
    poslat_pozvanku: true,
  });
  assert.equal(vytvoreni.status, 201);
  assert.equal(vytvoreni.data.ma_heslo, 0);

  // Bez nastaveného Resendu e-mail neodejde - a administrace to musí přiznat,
  // ne tvrdit "pozvánka odeslána". Místo toho vrátí odkaz k ručnímu předání.
  assert.equal(vytvoreni.data.pozvanka_odeslana, false);
  assert.match(vytvoreni.data.odkaz_na_heslo, /\/admin\/nove-heslo\//);

  // Pozvánkový e-mail je v logu a míří na testovací schránku.
  const [[email]] = await pool.query("SELECT * FROM emaily WHERE sablona_klic = 'pozvanka'");
  assert.equal(email.prijemce, 'provoz@example.invalid');
  assert.notEqual(email.prijemce_skutecny, 'provoz@example.invalid');

  // V databázi je jen hash tokenu, ne token samotný.
  const [[token]] = await pool.query('SELECT token_hash, ucel FROM reset_hesla');
  assert.equal(token.ucel, 'pozvanka');
  assert.equal(token.token_hash.length, 64);

  // A dokud heslo nemá, nepřihlásí se.
  const pokus = vytvorKlienta(server.url);
  await pokus.get('/api/admin/ja');
  const odpoved = await pokus.post('/api/admin/prihlaseni', {
    email: 'provoz@example.invalid',
    heslo: 'cokoli-co-zkusi-123',
  });
  assert.equal(odpoved.status, 400);
});

test('odkaz na nastavení hesla jde použít jen jednou', async () => {
  const klient = await prihlasenySpravce();
  const { posliOdkazNaHeslo } = await import('../src/api/admin/auth.js');

  const id = await vytvorUzivatele(pool, {
    email: 'novy@example.invalid', jmeno: 'Nový', role: 'provoz',
  });
  const { token } = await posliOdkazNaHeslo(
    { id, jmeno: 'Nový', email: 'novy@example.invalid' },
    'pozvanka'
  );

  const verejny = vytvorKlienta(server.url);
  await verejny.get('/api/admin/ja');

  const kontrola = await verejny.get(`/api/admin/reset-hesla/${token}`);
  assert.equal(kontrola.data.platny, true);

  const noveHeslo = testovaciHeslo();
  const prvni = await verejny.post(`/api/admin/reset-hesla/${token}`, { heslo: noveHeslo });
  assert.equal(prvni.status, 200);

  const druhy = await verejny.post(`/api/admin/reset-hesla/${token}`, { heslo: 'jine-heslo-1234' });
  assert.equal(druhy.status, 400, 'tentýž odkaz už podruhé nesmí projít');

  // A s nastaveným heslem se člověk přihlásí.
  const prihlaseni = await verejny.post('/api/admin/prihlaseni', {
    email: 'novy@example.invalid',
    heslo: noveHeslo,
  });
  assert.equal(prihlaseni.status, 200);
});

test('reset hesla neprozradí, jestli e-mail patří k účtu', async () => {
  await vytvorUzivatele(pool, { email: 'existuje@example.invalid', heslo });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');

  const existujici = await klient.post('/api/admin/reset-hesla', { email: 'existuje@example.invalid' });
  const neexistujici = await klient.post('/api/admin/reset-hesla', { email: 'nikdo@example.invalid' });

  assert.equal(existujici.status, 200);
  assert.equal(neexistujici.status, 200);
  assert.equal(existujici.data.zprava, neexistujici.data.zprava);

  // Odkaz vznikl jen pro existující účet.
  const [[pocet]] = await pool.query('SELECT COUNT(*) AS pocet FROM reset_hesla');
  assert.equal(pocet.pocet, 1);
});

test('s vypnutým odesíláním se reset hesla pozná jen z logu e-mailů', async () => {
  // Zákazníkovi se nesmí prozradit nic - ani to, že e-mail neodešel. Obsluha
  // to ale musí mít kde zjistit, jinak čeká na odkaz, který nikdy nedorazil.
  const config = (await import('../src/config.js')).default;
  await vytvorUzivatele(pool, { email: 'existuje@example.invalid', heslo });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');

  const puvodni = config.EMAIL_REZIM;
  config.EMAIL_REZIM = 'vypnuto';
  let odpoved;
  try {
    odpoved = await klient.post('/api/admin/reset-hesla', { email: 'existuje@example.invalid' });
  } finally {
    config.EMAIL_REZIM = puvodni;
  }

  assert.equal(odpoved.status, 200);
  assert.ok(!/neodesl|vypnut|chyb/i.test(JSON.stringify(odpoved.data)),
    'odpověď ven nesmí prozradit, že e-mail neodešel');

  const [emaily] = await pool.query(
    'SELECT prijemce, stav, chyba, rezim FROM emaily ORDER BY id DESC LIMIT 1'
  );
  assert.equal(emaily.length, 1, 'e-mail musí být v logu, i když se neodeslal');
  assert.equal(emaily[0].prijemce, 'existuje@example.invalid');
  assert.equal(emaily[0].stav, 'chyba');
  assert.equal(emaily[0].rezim, 'vypnuto');
  assert.match(emaily[0].chyba, /vypnut/i);
});
