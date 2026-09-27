// Přihlášení, role a CSRF - jádro zabezpečení administrace.

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
  const { vynulujLimity } = await import('../src/auth/limit.js');
  await vynulujLimity();
  heslo = testovaciHeslo();
});

test('nepřihlášený člověk se k administraci nedostane', async () => {
  const klient = vytvorKlienta(server.url);

  for (const cesta of ['/api/admin/poptavky', '/api/admin/uzivatele', '/api/admin/audit',
                       '/api/admin/nastaveni', '/api/admin/dashboard']) {
    const odpoved = await klient.get(cesta);
    assert.equal(odpoved.status, 401, `${cesta} musí vrátit 401`);
  }
});

test('přihlášení správným heslem funguje a vrátí oprávnění', async () => {
  await vytvorUzivatele(pool, { email: 'sef@example.invalid', jmeno: 'Šéfka', heslo });
  const klient = vytvorKlienta(server.url);

  await klient.get('/api/admin/ja'); // vyzvedne CSRF cookie
  const odpoved = await klient.post('/api/admin/prihlaseni', {
    email: 'sef@example.invalid',
    heslo,
  });

  assert.equal(odpoved.status, 200);
  assert.equal(odpoved.data.uzivatel.jmeno, 'Šéfka');
  assert.equal(odpoved.data.prava.nastaveni, 'menit');
  assert.ok(klient.cookies.has('lsd_admin'), 'musí se nastavit session cookie');

  const ja = await klient.get('/api/admin/ja');
  assert.equal(ja.status, 200);
  assert.equal(ja.data.uzivatel.email, 'sef@example.invalid');
});

test('špatné heslo neprozradí, jestli účet existuje', async () => {
  await vytvorUzivatele(pool, { email: 'sef@example.invalid', heslo });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');

  const spatneHeslo = await klient.post('/api/admin/prihlaseni', {
    email: 'sef@example.invalid',
    heslo: 'uplne-jine-heslo-123',
  });
  const neznamyUcet = await klient.post('/api/admin/prihlaseni', {
    email: 'nikdo@example.invalid',
    heslo: 'uplne-jine-heslo-123',
  });

  assert.equal(spatneHeslo.status, 400);
  assert.equal(neznamyUcet.status, 400);
  assert.equal(spatneHeslo.data.chyba, neznamyUcet.data.chyba);
});

test('po deseti neúspěšných pokusech se účet zamkne', async () => {
  await vytvorUzivatele(pool, { email: 'sef@example.invalid', heslo });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');

  for (let i = 0; i < 10; i++) {
    await klient.post('/api/admin/prihlaseni', {
      email: 'sef@example.invalid',
      heslo: 'spatne-heslo-' + i,
    });
  }

  // Zámek účtu je v databázi - na rozdíl od rate limitu v paměti přežije
  // i restart kontejneru a platí pro útočníka z jakékoli adresy.
  const [[u]] = await pool.query('SELECT zamceno_do FROM uzivatele WHERE email = ?', [
    'sef@example.invalid',
  ]);
  assert.ok(u.zamceno_do, 'v databázi musí být zámek účtu');
  assert.ok(new Date(u.zamceno_do) > new Date(), 'zámek musí platit do budoucna');

  // I se správným heslem se teď dovnitř nedostane. Který z obou mechanismů
  // zabere dřív, nerozhoduje - obojí je správná odpověď:
  //   429 = rate limit na IP, 403 = zámek účtu.
  const odpoved = await klient.post('/api/admin/prihlaseni', {
    email: 'sef@example.invalid',
    heslo,
  });
  assert.ok(
    [403, 429].includes(odpoved.status),
    `přihlášení mělo být zablokované, přišlo ${odpoved.status}`
  );
});

test('zámek účtu platí i pro jinou IP adresu', async () => {
  await vytvorUzivatele(pool, { email: 'sef@example.invalid', heslo });
  // Zámek nasimulujeme přímo, ať test nezávisí na rate limitu.
  await pool.query(
    "UPDATE uzivatele SET zamceno_do = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE email = ?",
    ['sef@example.invalid']
  );

  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  const odpoved = await klient.post('/api/admin/prihlaseni', {
    email: 'sef@example.invalid',
    heslo,
  });

  assert.equal(odpoved.status, 403);
  assert.match(odpoved.data.chyba, /zamčený/i);
});

test('zápis bez CSRF tokenu se odmítne', async () => {
  await vytvorUzivatele(pool, { email: 'sef@example.invalid', heslo });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  await klient.post('/api/admin/prihlaseni', { email: 'sef@example.invalid', heslo });

  // Platná session, ale chybějící hlavička X-CSRF-Token.
  const odpoved = await klient.bezCsrf('PATCH', '/api/admin/nastaveni', {
    'spolek.nazev': 'Podvrh',
  });
  assert.equal(odpoved.status, 403);

  const [[zaznam]] = await pool.query(
    "SELECT COUNT(*) AS pocet FROM nastaveni WHERE klic = 'spolek.nazev'"
  );
  assert.equal(zaznam.pocet, 0, 'nastavení se nesmělo změnit');
});

test('role rozhodují, kam kdo smí', async () => {
  await vytvorUzivatele(pool, {
    email: 'provoz@example.invalid', jmeno: 'Provoz', role: 'provoz', heslo,
  });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  await klient.post('/api/admin/prihlaseni', { email: 'provoz@example.invalid', heslo });

  // Provoz smí na poptávky…
  assert.equal((await klient.get('/api/admin/poptavky')).status, 200);
  // …ale ne na uživatele, nastavení ani audit.
  assert.equal((await klient.get('/api/admin/uzivatele')).status, 403);
  assert.equal((await klient.get('/api/admin/nastaveni')).status, 403);
  assert.equal((await klient.get('/api/admin/audit')).status, 403);
});

test('instruktor nevidí poptávky ani zákazníky', async () => {
  await vytvorUzivatele(pool, {
    email: 'instruktor@example.invalid', role: 'instruktor', heslo,
  });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  await klient.post('/api/admin/prihlaseni', { email: 'instruktor@example.invalid', heslo });

  assert.equal((await klient.get('/api/admin/poptavky')).status, 403);
  assert.equal((await klient.get('/api/admin/dashboard')).status, 200);
});

test('odhlášení zruší session na serveru, ne jen v prohlížeči', async () => {
  await vytvorUzivatele(pool, { email: 'sef@example.invalid', heslo });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  await klient.post('/api/admin/prihlaseni', { email: 'sef@example.invalid', heslo });

  const sessionCookie = klient.cookies.get('lsd_admin');
  await klient.post('/api/admin/odhlaseni');

  const [rows] = await pool.query('SELECT COUNT(*) AS pocet FROM sessions');
  assert.equal(rows[0].pocet, 0, 'session musí zmizet z databáze');

  // I kdyby si někdo cookie uložil, už neplatí.
  klient.cookies.set('lsd_admin', sessionCookie);
  assert.equal((await klient.get('/api/admin/uzivatele')).status, 401);
});

test('deaktivovaný uživatel je odhlášený okamžitě', async () => {
  const idSpravce = await vytvorUzivatele(pool, { email: 'sef@example.invalid', heslo });
  await vytvorUzivatele(pool, {
    email: 'druhy@example.invalid', jmeno: 'Druhý správce', role: 'admin', heslo,
  });

  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  await klient.post('/api/admin/prihlaseni', { email: 'sef@example.invalid', heslo });
  assert.equal((await klient.get('/api/admin/uzivatele')).status, 200);

  await pool.query('UPDATE uzivatele SET aktivni = 0 WHERE id = ?', [idSpravce]);
  assert.equal((await klient.get('/api/admin/uzivatele')).status, 401);
});

test('poslední správce nesmí zmizet', async () => {
  const id = await vytvorUzivatele(pool, { email: 'sef@example.invalid', heslo });
  await vytvorUzivatele(pool, { email: 'provoz@example.invalid', role: 'provoz', heslo });

  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  await klient.post('/api/admin/prihlaseni', { email: 'sef@example.invalid', heslo });

  // Sám sebe smazat nemůže…
  const sebe = await klient.del(`/api/admin/uzivatele/${id}`);
  assert.equal(sebe.status, 400);

  // …a ani mu nejde odebrat roli admina, když je poslední.
  const degradace = await klient.patch(`/api/admin/uzivatele/${id}`, { role: 'provoz' });
  assert.equal(degradace.status, 400);
  assert.match(degradace.data.chyba, /poslední správce/i);
});

test('změna hesla odhlásí ostatní zařízení', async () => {
  await vytvorUzivatele(pool, { email: 'sef@example.invalid', heslo });

  const telefon = vytvorKlienta(server.url);
  await telefon.get('/api/admin/ja');
  await telefon.post('/api/admin/prihlaseni', { email: 'sef@example.invalid', heslo });

  const pocitac = vytvorKlienta(server.url);
  await pocitac.get('/api/admin/ja');
  await pocitac.post('/api/admin/prihlaseni', { email: 'sef@example.invalid', heslo });

  const noveHeslo = testovaciHeslo();
  const zmena = await pocitac.post('/api/admin/zmena-hesla', { stare: heslo, nove: noveHeslo });
  assert.equal(zmena.status, 200);

  // Počítač, na kterém se heslo měnilo, zůstává přihlášený.
  assert.equal((await pocitac.get('/api/admin/uzivatele')).status, 200);
  // Telefon je odhlášený.
  assert.equal((await telefon.get('/api/admin/uzivatele')).status, 401);
});
