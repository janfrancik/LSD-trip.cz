// Pojistka, která musí platit vždycky: na testovacím prostředí nesmí odejít
// e-mail skutečnému zákazníkovi.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pripravDatabazi, vycistiData } from './pomocnik.js';

let pool;

before(async () => {
  await pripravDatabazi();
  pool = (await import('../src/db.js')).default;
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await vycistiData(pool);
});

test('v testovacím režimu se příjemce vždy přepíše na testovací adresu', async () => {
  const { _skutecnyPrijemce } = await import('../src/email/posli.js');
  const config = (await import('../src/config.js')).default;

  assert.equal(config.EMAIL_REZIM, 'test', 'testy musí běžet v testovacím režimu');

  for (const adresa of [
    'zakaznik@seznam.cz',
    'jan.novak@gmail.com',
    'info@lsd-trip.cz',
    'kdokoli@example.com',
  ]) {
    assert.equal(
      _skutecnyPrijemce(adresa),
      config.EMAIL_TEST_PRIJEMCE,
      `adresa ${adresa} se musí přepsat na testovací schránku`
    );
  }
});

test('log e-mailu si pamatuje, komu patřil a kam doopravdy šel', async () => {
  const { posliEmail } = await import('../src/email/posli.js');
  const config = (await import('../src/config.js')).default;

  const vysledek = await posliEmail({
    prijemce: 'zakaznik@seznam.cz',
    predmet: 'Potvrzení rezervace',
    telo: '<p>Ahoj</p>',
    sablona: 'rezervace_prijata',
  });

  const [[zaznam]] = await pool.query('SELECT * FROM emaily WHERE id = ?', [vysledek.id]);

  assert.equal(zaznam.prijemce, 'zakaznik@seznam.cz', 'komu e-mail patří');
  assert.equal(zaznam.prijemce_skutecny, config.EMAIL_TEST_PRIJEMCE, 'kam doopravdy šel');
  assert.equal(zaznam.rezim, 'test');
  assert.match(zaznam.predmet, /^\[TEST\]/, 'předmět musí být v testu označený');

  // Bez klíče se e-mail neodešle - a to je v logu vidět.
  assert.equal(vysledek.odeslano, false);
  assert.equal(zaznam.stav, 'chyba');
  assert.match(zaznam.chyba, /RESEND_API_KEY/);
});

test('ve vypnutém režimu se e-mail nikam nepošle', async () => {
  const { _skutecnyPrijemce } = await import('../src/email/posli.js');
  const config = (await import('../src/config.js')).default;

  const puvodni = config.EMAIL_REZIM;
  config.EMAIL_REZIM = 'vypnuto';
  try {
    assert.equal(_skutecnyPrijemce('zakaznik@seznam.cz'), null);
  } finally {
    config.EMAIL_REZIM = puvodni;
  }
});

test('šablona escapuje proměnné, takže se do e-mailu nedá propašovat HTML', async () => {
  const { vyrenderuj } = await import('../src/email/sablona.js');

  const vysledek = vyrenderuj('Dobrý den, {{jmeno}}.', {
    jmeno: '<script>alert(1)</script>',
  });

  assert.ok(!vysledek.includes('<script>'), 'HTML z proměnné se nesmí vykreslit');
  assert.ok(vysledek.includes('&lt;script&gt;'));
});

test('podmíněný blok v šabloně funguje', async () => {
  const { vyrenderuj } = await import('../src/email/sablona.js');

  const sablona = 'Ahoj{{#if jmeno}} {{jmeno}}{{/if}}.';
  assert.equal(vyrenderuj(sablona, { jmeno: 'Petro' }), 'Ahoj Petro.');
  assert.equal(vyrenderuj(sablona, {}), 'Ahoj.');
});
