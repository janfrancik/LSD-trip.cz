// Tajemství nesmí uniknout do logu, do databáze ani do administrace.
//
// Vzniklo po incidentu: odesílací služba vrátila chybu z `Headers.append`
// a ta v sobě měla celou hodnotu hlavičky Authorization, tedy API klíč.
// Text se zapsal do logu i do `emaily.chyba` a klíč se musel zneplatnit.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ocisti, ocistiChybu, zkontrolujTvarKlice } from '../src/tajemstvi.js';
import { pripravDatabazi, vycistiData } from './pomocnik.js';

let pool;
let config;
let posli;

before(async () => {
  await pripravDatabazi();
  pool = (await import('../src/db.js')).default;
  config = (await import('../src/config.js')).default;
  posli = await import('../src/email/posli.js');
});

after(async () => {
  posli._podstrcOdesilatel(null);
  await pool.end();
});

beforeEach(async () => {
  await vycistiData(pool);
});

// ------------------------------------------------------------- čištění

test('klíč z chyby Headers.append se nedostane ven', () => {
  const skutecna =
    'Headers.append: "Bearer re_8vK2mQp7_AbCdEfGhIjKlMnOpQrSt" is an invalid header value.';
  const cisty = ocisti(skutecna);

  assert.doesNotMatch(cisty, /re_8vK2mQp7/, 'klíč nesmí v textu zůstat');
  assert.doesNotMatch(cisty, /AbCdEfGhIjKlMnOpQrSt/);
  assert.match(cisty, /Headers\.append/, 'zbytek hlášky má zůstat čitelný');
  assert.match(cisty, /\*\*\*/);
});

test('očistí se i holý klíč a Authorization v JSON', () => {
  for (const vzorek of [
    're_abcdefghij_KLMNOPQRSTUV',
    '{"Authorization":"Bearer re_abcdefghij_KLMNOPQRSTUV"}',
    'api_key: re_abcdefghij_KLMNOPQRSTUV',
    'Nepovedlo se to, klíč re_abcdefghij_KLMNOPQRSTUV je neplatný.',
  ]) {
    assert.doesNotMatch(ocisti(vzorek), /re_abcdefghij/, `uniklo z: ${vzorek}`);
  }
});

test('obyčejná chyba zůstane čitelná', () => {
  const text = 'The lsd-trip.cz domain is not verified (403)';
  assert.equal(ocisti(text), text, 'co není tajemství, se nemá mrzačit');
});

test('čistí se i podle skutečné hodnoty klíče z prostředí', () => {
  // Pojistka pro tvary, které vzory nechytnou - třeba klíč bez prefixu.
  const puvodni = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'naprosto-nestandardni-hodnota-klice';
  try {
    const cisty = ocisti('Chyba: naprosto-nestandardni-hodnota-klice selhala');
    assert.doesNotMatch(cisty, /nestandardni-hodnota/);
  } finally {
    if (puvodni === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = puvodni;
  }
});

test('ocistiChybu zvládne výjimku i řetězec a nikdy nespadne', () => {
  assert.match(ocistiChybu(new Error('Bearer re_tajny_klic_1234567890')), /\*\*\*/);
  assert.match(ocistiChybu('re_tajny_klic_1234567890'), /\*\*\*/);
  assert.equal(typeof ocistiChybu(null), 'string');
  assert.equal(typeof ocistiChybu(undefined), 'string');
  assert.equal(typeof ocistiChybu({ bez: 'message' }), 'string');
});

// --------------------------------------------------------- tvar klíče

test('pokažený tvar klíče se pozná', () => {
  assert.equal(zkontrolujTvarKlice('re_abcdefghij1234567890'), null, 'správný klíč projde');
  assert.equal(zkontrolujTvarKlice(''), null, 'prázdný klíč řeší jiná kontrola');

  assert.match(zkontrolujTvarKlice('re_abc\nre_def1234567890'), /mezeru|zalomení/);
  assert.match(zkontrolujTvarKlice('re_abc def1234567890'), /mezeru|zalomení/);
  assert.match(zkontrolujTvarKlice('bezprefixu1234567890'), /re_/);
  assert.match(zkontrolujTvarKlice('re_kratky'), /délku/);
  assert.match(zkontrolujTvarKlice('re_abcdefghij1234567890re_x'), /víckrát/);
});

test('hláška o špatném klíči nevypisuje jeho hodnotu', () => {
  const klic = 're_tajemstvi_ktere_nikdo_nema_videt re_podruhe';
  const problem = zkontrolujTvarKlice(klic);

  assert.ok(problem, 'špatný tvar se musí poznat');
  assert.doesNotMatch(problem, /tajemstvi/, 'popis problému nesmí obsahovat klíč');
});

// ----------------------------------------------- co se uloží do databáze

test('chyba odeslání se ukládá očištěná a e-mail skončí ve stavu chyba', async () => {
  posli._podstrcOdesilatel({
    maKlienta: () => true,
    odesli: async () => {
      throw new Error('Headers.append: "Bearer re_uniklyklic_1234567890" is invalid');
    },
  });

  const puvodni = config.EMAIL_REZIM;
  config.EMAIL_REZIM = 'live';
  let vysledek;
  try {
    vysledek = await posli.posliEmail({
      prijemce: 'zakaznik@example.invalid',
      predmet: 'Zkouška',
      telo: '<p>x</p>',
    });
  } finally {
    config.EMAIL_REZIM = puvodni;
  }

  assert.equal(vysledek.odeslano, false);

  const [[log]] = await pool.query('SELECT stav, chyba FROM emaily WHERE id = ?', [vysledek.id]);
  assert.equal(log.stav, 'chyba', 'selhání nesmí nechat e-mail viset ve frontě');
  assert.doesNotMatch(log.chyba, /re_uniklyklic/, 'klíč se nesmí uložit do databáze');
  assert.match(log.chyba, /\*\*\*/);
});

test('když se odesílací služba vůbec nespustí, e-mail skončí v chybě, ne ve frontě', async () => {
  // Přesně to se dělo s pokaženým klíčem: výjimka utekla z posliEmail ven
  // a záznam zůstal ve stavu 've_fronte', odkud ho nikdo nevyhrabal.
  posli._podstrcOdesilatel({
    maKlienta: () => {
      throw new Error('Headers.append: "Bearer re_uniklyklic_1234567890" is invalid');
    },
    odesli: async () => 'nikdy',
  });

  const puvodni = config.EMAIL_REZIM;
  config.EMAIL_REZIM = 'live';
  let vysledek;
  try {
    vysledek = await posli.posliEmail({
      prijemce: 'zakaznik@example.invalid',
      predmet: 'Zkouška',
      telo: '<p>x</p>',
    });
  } finally {
    config.EMAIL_REZIM = puvodni;
  }

  assert.equal(vysledek.odeslano, false, 'nesmí to shodit volajícího');

  const [[log]] = await pool.query('SELECT stav, chyba FROM emaily WHERE id = ?', [vysledek.id]);
  assert.equal(log.stav, 'chyba', 'nikdy nesmí zůstat ve stavu ve_fronte');
  assert.doesNotMatch(log.chyba, /re_uniklyklic/);
});

test('žádný e-mail nezůstane ve stavu ve_fronte, ani když selže cokoli', async () => {
  posli._podstrcOdesilatel({
    maKlienta: () => true,
    odesli: async () => { throw new Error('timeout'); },
  });

  const puvodni = config.EMAIL_REZIM;
  config.EMAIL_REZIM = 'live';
  try {
    await posli.posliEmail({ prijemce: 'a@example.invalid', predmet: 'A', telo: '<p>a</p>' });
    await posli.posliEmail({ prijemce: 'b@example.invalid', predmet: 'B', telo: '<p>b</p>' });
  } finally {
    config.EMAIL_REZIM = puvodni;
  }

  const [[zbyle]] = await pool.query(
    `SELECT COUNT(*) AS pocet FROM emaily WHERE stav = 've_fronte'`
  );
  assert.equal(zbyle.pocet, 0, 've frontě nesmí zůstat viset nic');
});
