// Poptávky: veřejné odeslání a zabezpečená administrace.
// Do fáze 1 byly všechny tyhle endpointy veřejné včetně mazání.

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

async function prihlasenySpravce() {
  await vytvorUzivatele(pool, { email: 'sef@example.invalid', jmeno: 'Šéfka', heslo });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  await klient.post('/api/admin/prihlaseni', { email: 'sef@example.invalid', heslo });
  return klient;
}

test('kdokoli může poslat poptávku z webu', async () => {
  const klient = vytvorKlienta(server.url);
  const odpoved = await klient.post('/api/poptavky', {
    jmeno: 'Jan Novák',
    email: 'JAN.NOVAK@Example.Invalid',
    telefon: '+420 601 000 111',
    zprava: 'Chtěl bych tandem pro dva.',
  });

  assert.equal(odpoved.status, 201);
  assert.equal(odpoved.data.ok, true);
  // Veřejná odpověď nesmí vracet uložený záznam ani jeho id.
  assert.equal(odpoved.data.id, undefined);

  const [rows] = await pool.query('SELECT * FROM poptavky');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'jan.novak@example.invalid', 'e-mail se ukládá malými písmeny');
  assert.equal(rows[0].stav, 'nova');
});

test('poptávka bez jména nebo s neplatným e-mailem se odmítne', async () => {
  const klient = vytvorKlienta(server.url);
  const odpoved = await klient.post('/api/poptavky', { jmeno: 'X', email: 'nesmysl' });

  assert.equal(odpoved.status, 400);
  assert.ok(odpoved.data.detaily.jmeno);
  assert.ok(odpoved.data.detaily.email);
});

test('past na roboty se tváří jako úspěch, ale nic neuloží', async () => {
  const klient = vytvorKlienta(server.url);
  const odpoved = await klient.post('/api/poptavky', {
    jmeno: 'Robot',
    email: 'bot@example.invalid',
    zprava: 'reklama',
    web: 'http://spam.example',
  });

  assert.equal(odpoved.status, 201, 'robot se nesmí dozvědět, že ho známe');
  const [rows] = await pool.query('SELECT COUNT(*) AS pocet FROM poptavky');
  assert.equal(rows[0].pocet, 0);
});

test('poptávky si nikdo nepřečte ani nesmaže bez přihlášení', async () => {
  await pool.query("INSERT INTO poptavky (jmeno, email, zprava) VALUES ('Jan', 'jan@example.invalid', 'ahoj')");
  const [[p]] = await pool.query('SELECT id FROM poptavky LIMIT 1');

  const klient = vytvorKlienta(server.url);
  // Vyzvedneme CSRF cookie, ať test měří chybějící přihlášení, ne chybějící
  // token - jinak by mazání spadlo na CSRF a o autorizaci bychom nic nevěděli.
  await klient.get('/api/admin/ja');

  assert.equal((await klient.get('/api/admin/poptavky')).status, 401);
  assert.equal((await klient.get(`/api/admin/poptavky/${p.id}`)).status, 401);
  assert.equal((await klient.del(`/api/admin/poptavky/${p.id}`)).status, 401);

  // A bez CSRF tokenu se zápis neprovede už vůbec.
  const bezTokenu = vytvorKlienta(server.url);
  assert.equal((await bezTokenu.del(`/api/admin/poptavky/${p.id}`)).status, 403);

  // Stará veřejná cesta pro čtení už neexistuje.
  assert.equal((await klient.get('/api/poptavky')).status, 404);

  const [rows] = await pool.query('SELECT COUNT(*) AS pocet FROM poptavky WHERE smazano_at IS NULL');
  assert.equal(rows[0].pocet, 1, 'poptávka musí pořád být');
});

test('mazání je měkké a jde vzít zpět', async () => {
  const klient = await prihlasenySpravce();
  await vytvorKlienta(server.url).post('/api/poptavky', {
    jmeno: 'Petra', email: 'petra@example.invalid', zprava: 'dotaz',
  });
  const [[p]] = await pool.query('SELECT id FROM poptavky LIMIT 1');

  assert.equal((await klient.del(`/api/admin/poptavky/${p.id}`)).status, 200);

  const [[po]] = await pool.query('SELECT smazano_at FROM poptavky WHERE id = ?', [p.id]);
  assert.ok(po.smazano_at, 'záznam zůstává, jen je označený jako smazaný');

  const seznam = await klient.get('/api/admin/poptavky');
  assert.equal(seznam.data.data.length, 0, 've výchozím seznamu smazané nejsou');

  const smazane = await klient.get('/api/admin/poptavky?smazane=1');
  assert.equal(smazane.data.data.length, 1);

  assert.equal((await klient.post(`/api/admin/poptavky/${p.id}/obnovit`)).status, 200);
  const [[obnoveno]] = await pool.query('SELECT smazano_at FROM poptavky WHERE id = ?', [p.id]);
  assert.equal(obnoveno.smazano_at, null);
});

test('odpověď na poptávku se uloží, zaloguje a poptávka se označí za vyřízenou', async () => {
  const klient = await prihlasenySpravce();
  await vytvorKlienta(server.url).post('/api/poptavky', {
    jmeno: 'Jan Novák', email: 'jan@example.invalid', zprava: 'Kolik stojí tandem?',
  });
  const [[p]] = await pool.query('SELECT id FROM poptavky LIMIT 1');

  const odpoved = await klient.post(`/api/admin/poptavky/${p.id}/odpovedet`, {
    odpoved: 'Dobrý den, tandem stojí 4 700 Kč.',
    oznacit_vyrizene: true,
  });
  assert.equal(odpoved.status, 200);

  const [[ulozena]] = await pool.query('SELECT stav, odpoved, odpovezeno_at FROM poptavky WHERE id = ?', [p.id]);
  assert.equal(ulozena.stav, 'vyrizeno');
  assert.match(ulozena.odpoved, /4 700 Kč/);
  assert.ok(ulozena.odpovezeno_at);

  // E-mail je v logu s původním i skutečným příjemcem.
  const [[email]] = await pool.query('SELECT * FROM emaily WHERE poptavka_id = ?', [p.id]);
  assert.equal(email.prijemce, 'jan@example.invalid');
  assert.notEqual(email.prijemce_skutecny, 'jan@example.invalid');

  // A akce je v auditu.
  const [[audit]] = await pool.query("SELECT * FROM audit_log WHERE akce = 'odpoved'");
  assert.equal(audit.entita, 'poptavka');
  assert.equal(Number(audit.entita_id), p.id);
});

test('hledání a filtr podle stavu fungují', async () => {
  const klient = await prihlasenySpravce();
  const verejny = vytvorKlienta(server.url);
  await verejny.post('/api/poptavky', { jmeno: 'Jan Novák', email: 'jan@example.invalid', zprava: 'tandem' });
  await verejny.post('/api/poptavky', { jmeno: 'Petra Dvořáková', email: 'petra@example.invalid', zprava: 'poukaz' });

  const hledani = await klient.get('/api/admin/poptavky?q=Dvo%C5%99');
  assert.equal(hledani.data.data.length, 1);
  assert.equal(hledani.data.data[0].jmeno, 'Petra Dvořáková');

  const [[p]] = await pool.query("SELECT id FROM poptavky WHERE jmeno = 'Jan Novák'");
  await klient.patch(`/api/admin/poptavky/${p.id}`, { stav: 'spam' });

  const nove = await klient.get('/api/admin/poptavky?stav=nova');
  assert.equal(nove.data.data.length, 1);
  assert.equal(nove.data.pocty.spam, 1);
});
