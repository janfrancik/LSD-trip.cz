// Testovací schránka e-mailů. Na testu nebude Resend, takže e-maily nikam
// neodcházejí - ukládají se celé a v administraci se dají otevřít včetně
// odkazů, na které jde kliknout.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pripravDatabazi, vycistiData, spustServer, vytvorKlienta, vytvorUzivatele, testovaciHeslo,
} from './pomocnik.js';

let server;
let pool;
let config;
let heslo;

before(async () => {
  await pripravDatabazi();
  pool = (await import('../src/db.js')).default;
  config = (await import('../src/config.js')).default;
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
  config.EMAIL_REZIM = 'schranka';
});

after(() => {
  config.EMAIL_REZIM = 'test';
});

async function prihlas(role = 'admin', email = 'sef@example.invalid', jmeno = 'Šéfka') {
  await vytvorUzivatele(pool, { email, jmeno, role, heslo });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  await klient.post('/api/admin/prihlaseni', { email, heslo });
  return klient;
}

test('v režimu schránky se e-mail uloží celý a nikam neodejde', async () => {
  const klient = await prihlas();
  const [poptavka] = await pool.query(
    "INSERT INTO poptavky (jmeno, email, zprava) VALUES ('Martina', 'martina@example.invalid', 'Kdy se skáče?')"
  );

  const odpoved = await klient.post(`/api/admin/poptavky/${poptavka.insertId}/odpovedet`, {
    odpoved: 'V srpnu máme volno 14. a 21.',
  });

  assert.equal(odpoved.status, 200);
  assert.equal(odpoved.data.odeslano, false, 'ven nic neodešlo');
  assert.equal(odpoved.data.email_do_schranky, true);
  assert.ok(odpoved.data.email_id, 'administrace potřebuje odkaz na uložený e-mail');

  const [[email]] = await pool.query('SELECT * FROM emaily WHERE id = ?', [odpoved.data.email_id]);
  assert.equal(email.stav, 've_schrance');
  assert.equal(email.rezim, 'schranka');
  assert.equal(email.prijemce, 'martina@example.invalid', 'komu e-mail patřil');
  assert.equal(email.prijemce_skutecny, null, 'ale nikam se neposlal');
  assert.match(email.telo_snapshot, /V srpnu máme volno/, 'uloží se celé HTML');
  assert.match(email.telo_text, /V srpnu máme volno/, 'i textová verze');
});

test('schránka se dá prohlížet, hledat a e-mail otevřít i s odkazy', async () => {
  const klient = await prihlas();

  // Pozvánka je e-mail s odkazem, kvůli kterému se do schránky chodí.
  const novy = await klient.post('/api/admin/uzivatele', {
    jmeno: 'Nový Tester',
    email: 'novy@example.invalid',
    role: 'tester',
    poslat_pozvanku: true,
  });
  assert.equal(novy.status, 201);
  assert.equal(novy.data.email_do_schranky, true);

  const seznam = await klient.get('/api/admin/emaily?q=novy@example.invalid');
  assert.equal(seznam.status, 200);
  assert.equal(seznam.data.rezim, 'schranka');
  assert.equal(seznam.data.data.length, 1);
  assert.equal(seznam.data.data[0].prijemce, 'novy@example.invalid');

  const detail = await klient.get(`/api/admin/emaily/${novy.data.email_id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.ma_html, true);
  assert.equal(detail.data.telo_snapshot, undefined, 'HTML chodí zvlášť do iframe');
  assert.ok(
    detail.data.odkazy.some((o) => o.includes('/admin/nove-heslo/')),
    'odkaz na nastavení hesla musí být vypsaný, aby na něj šlo kliknout'
  );

  // Odkaz ze schránky opravdu funguje - token je platný.
  const odkaz = detail.data.odkazy.find((o) => o.includes('/admin/nove-heslo/'));
  const token = odkaz.split('/admin/nove-heslo/')[1];
  const overeni = await klient.get(`/api/admin/reset-hesla/${token}`);
  assert.equal(overeni.data.platny, true, 'odkaz z e-mailu ve schránce musí fungovat');
});

test('tělo e-mailu se servíruje pro iframe a nepustí do sebe skripty', async () => {
  const klient = await prihlas();
  const [poptavka] = await pool.query(
    "INSERT INTO poptavky (jmeno, email, zprava) VALUES ('Martina', 'martina@example.invalid', 'Dotaz')"
  );
  const odpoved = await klient.post(`/api/admin/poptavky/${poptavka.insertId}/odpovedet`, {
    odpoved: 'Odpověď do schránky.',
  });

  const cookie = [...klient.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const telo = await fetch(`${server.url}/api/admin/emaily/${odpoved.data.email_id}/telo`, {
    headers: { Cookie: cookie },
  });

  assert.equal(telo.status, 200);
  assert.match(telo.headers.get('content-type'), /text\/html/);

  const csp = telo.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/, 'obsah e-mailu nesmí nic načítat');
  assert.match(csp, /frame-ancestors 'self'/, 'ale administrace ho musí zobrazit v iframe');
  assert.ok(!/script-src/.test(csp) || /script-src 'none'/.test(csp));

  const html = await telo.text();
  assert.match(html, /Odpověď do schránky/);
});

test('do schránky se nedostane nikdo bez oprávnění', async () => {
  const spravce = await prihlas();
  const [poptavka] = await pool.query(
    "INSERT INTO poptavky (jmeno, email, zprava) VALUES ('Martina', 'martina@example.invalid', 'Dotaz')"
  );
  const odpoved = await spravce.post(`/api/admin/poptavky/${poptavka.insertId}/odpovedet`, {
    odpoved: 'Text.',
  });

  const tester = await prihlas('tester', 'tester@example.invalid', 'Tester');
  assert.equal((await tester.get('/api/admin/emaily')).status, 403);
  assert.equal((await tester.get(`/api/admin/emaily/${odpoved.data.email_id}`)).status, 403);

  const bezPrihlaseni = vytvorKlienta(server.url);
  assert.equal((await bezPrihlaseni.get('/api/admin/emaily')).status, 401);
});

test('reset hesla ve schránce nic neprozradí ven, ale je v ní celý', async () => {
  await vytvorUzivatele(pool, { email: 'existuje@example.invalid', heslo });
  const verejny = vytvorKlienta(server.url);
  await verejny.get('/api/admin/ja');

  const odpoved = await verejny.post('/api/admin/reset-hesla', {
    email: 'existuje@example.invalid',
  });
  assert.equal(odpoved.status, 200);
  assert.ok(!/schránk|neodesl/i.test(JSON.stringify(odpoved.data)), 'ven se neřekne nic');

  const [[email]] = await pool.query('SELECT * FROM emaily ORDER BY id DESC LIMIT 1');
  assert.equal(email.stav, 've_schrance');
  assert.equal(email.prijemce, 'existuje@example.invalid');
  assert.match(email.telo_snapshot, /nove-heslo/, 'odkaz je uložený a dá se použít');
});
