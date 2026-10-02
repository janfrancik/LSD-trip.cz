// Přihlášky na kurz (etapa E5 modulu Kurzy).
//
// Testy jdou po tom, co se nesmí rozbít ani omylem:
//   - na pět míst se nesmí dostat šest lidí, ani když kliknou naráz,
//   - z testovacího prostředí nesmí odejít e-mail zákazníkovi,
//   - souhlas musí být doložitelný i za rok, včetně znění,
//   - v auditu nesmí být osobní údaje,
//   - změna ceníku nesmí přepsat už odeslanou přihlášku.

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

function zaDni(pocet) {
  return new Date(Date.now() + pocet * 86400000).toISOString().slice(0, 10);
}

// Kurz s termínem tak, jak by ho založila majitelka v administraci.
async function pripravKurz(klient, { kapacita = 6, cena_hal = 490000, zmenyKurzu = {} } = {}) {
  const { data: kurz } = await klient.post('/api/admin/produkty', {
    typ: 'kurz', nazev: 'Parašutistický výcvik', cena_hal,
    min_vek: 15, max_vaha_kg: 95, souhlas_zastupce_do_let: 18,
    vyzaduje_lekarskou_prohlidku: true, aktivni: true,
    ...zmenyKurzu,
  });
  const { data: misto } = await klient.post('/api/admin/mista', { nazev: 'Letiště Jihlava' });
  const { data: termin } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(21), cas_od: '8:00', misto_id: misto.id,
    kapacita_mist: kapacita,
  });
  return { kurz, termin, misto };
}

function telo(terminId, zmeny = {}) {
  return {
    termin_id: terminId,
    jmeno: 'Jana Nováková',
    email: 'jana@example.invalid',
    telefon: '777111222',
    ucastnici: [{ jmeno: 'Jana Nováková', datum_narozeni: '1998-05-17', vaha_kg: 62 }],
    souhlas_vop: true,
    souhlas_gdpr: true,
    souhlas_zdravi: true,
    ...zmeny,
  };
}

function posliPrihlasku(zmeny = {}, terminId) {
  return fetch(`${server.url}/api/prihlasky`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(telo(terminId, zmeny)),
  });
}

// ------------------------------------------------------------- kapacita

test('dvacet souběžných přihlášek na pět míst pustí přesně pět', async () => {
  // Tohle je důvod, proč je kolem přihlášky transakce se zámkem. Bez ní
  // by všech dvacet přečetlo "volno 5" a zapsalo se.
  const klient = await prihlas();
  const { kurz, termin } = await pripravKurz(klient, { kapacita: 5 });

  const { zapisPrihlasku } = await import('../src/prihlasky.js');
  const pokusy = Array.from({ length: 20 }, (_, i) =>
    zapisPrihlasku({
      terminId: termin.id,
      kontakt: { jmeno: `Zájemce ${i}`, email: `zajemce${i}@example.invalid` },
      ucastnici: [{ jmeno: `Zájemce ${i}` }],
      souhlasy: { vop: true, gdpr: true, zdravi: true },
    }).then(
      () => 'prošla',
      (chyba) => chyba.status ?? 'chyba'
    )
  );

  const vysledky = await Promise.all(pokusy);
  const proslo = vysledky.filter((v) => v === 'prošla').length;

  assert.equal(proslo, 5, `mělo projít 5 přihlášek, prošlo ${proslo}`);
  assert.equal(vysledky.filter((v) => v === 409).length, 15, 'zbytek dostal „je plno"');

  const [[{ obsazeno }]] = await pool.query(
    `SELECT COALESCE(SUM(pocet_osob), 0) AS obsazeno FROM rezervace
      WHERE termin_id = ? AND stav IN ('nova','potvrzena','zaplacena','probehla')`,
    [termin.id]
  );
  assert.equal(Number(obsazeno), 5, 'v databázi je přesně pět lidí');

  const [[t]] = await pool.query('SELECT obsazeno_mist, stav FROM terminy WHERE id = ?', [termin.id]);
  assert.equal(t.obsazeno_mist, 5, 'cache obsazenosti sedí se skutečností');
  assert.equal(t.stav, 'plno', 'plný termín se přepne sám');
  assert.ok(kurz.id);
});

test('plný termín přihlášku odmítne a nabídne další termíny', async () => {
  // Čekací listinu nevedeme (rozhodnutí v zadání E5), ale člověk nemá
  // skončit u slepé uličky.
  const klient = await prihlas();
  const { kurz, termin } = await pripravKurz(klient, { kapacita: 1 });
  const { data: dalsi } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(28), kapacita_mist: 6,
  });

  assert.equal((await posliPrihlasku({}, termin.id)).status, 201);

  const odpoved = await posliPrihlasku({ email: 'druhy@example.invalid' }, termin.id);
  const data = await odpoved.json();

  assert.equal(odpoved.status, 409);
  assert.match(data.chyba, /plný/i);
  assert.deepEqual(data.detaily.dalsi_terminy.map((t) => t.id), [dalsi.id]);
  assert.equal(data.detaily.dalsi_terminy[0].volno, 6);
});

test('na zrušený ani proběhlý termín se přihlásit nedá', async () => {
  const klient = await prihlas();
  const { kurz, termin } = await pripravKurz(klient);
  await klient.post(`/api/admin/terminy/${termin.id}/zrusit`, { duvod: 'Nepřeje počasí.' });

  const zruseny = await posliPrihlasku({}, termin.id);
  assert.equal(zruseny.status, 409);
  assert.match((await zruseny.json()).chyba, /zrušený/i);

  const { data: minuly } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(-2), kapacita_mist: 6,
  });
  const proslyTermin = await posliPrihlasku({}, minuly.id);
  assert.equal(proslyTermin.status, 409);
  assert.match((await proslyTermin.json()).chyba, /proběhl/i);
});

test('storno uvolní místo na termínu', async () => {
  const klient = await prihlas();
  const { termin } = await pripravKurz(klient, { kapacita: 1 });
  const prvni = await (await posliPrihlasku({}, termin.id)).json();

  const [[prihlaska]] = await pool.query('SELECT id FROM rezervace WHERE kod = ?', [prvni.kod]);
  await klient.post(`/api/admin/rezervace/${prihlaska.id}/storno`, {
    duvod: 'Zákazník onemocněl.', poslat_email: false,
  });

  const [[t]] = await pool.query('SELECT obsazeno_mist, stav FROM terminy WHERE id = ?', [termin.id]);
  assert.equal(t.obsazeno_mist, 0);
  assert.equal(t.stav, 'otevreno', 'z plna se termín vrátí mezi otevřené');

  assert.equal((await posliPrihlasku({ email: 'dalsi@example.invalid' }, termin.id)).status, 201);
});

// --------------------------------------------------------------- e-maily

test('z testovacího prostředí nedojde e-mail zákazníkovi', async () => {
  // Nejdůležitější pojistka celého modulu. Příjemce se přepisuje
  // v src/email/posli.js ještě před odesláním.
  assert.equal(config.EMAIL_REZIM, 'test', 'testy musí běžet v testovacím režimu');

  const klient = await prihlas();
  const { termin } = await pripravKurz(klient);
  await posliPrihlasku({ email: 'zakaznik@example.invalid' }, termin.id);

  const [emaily] = await pool.query(
    'SELECT sablona_klic, prijemce, prijemce_skutecny FROM emaily ORDER BY id'
  );
  assert.ok(emaily.length >= 1, 'potvrzení přihlášky odešlo');

  for (const e of emaily) {
    assert.equal(
      e.prijemce_skutecny,
      config.EMAIL_TEST_PRIJEMCE,
      `e-mail ${e.sablona_klic} šel jinam než na testovací adresu`
    );
    assert.notEqual(e.prijemce_skutecny, 'zakaznik@example.invalid');
  }

  // V logu zůstane, komu e-mail patřil - jinak by se nedalo dohledat,
  // co se mělo stát v produkci.
  assert.equal(emaily[0].prijemce, 'zakaznik@example.invalid');
});

test('e-mail při změně stavu odejde jen když o to provoz stojí', async () => {
  const klient = await prihlas();
  const { termin } = await pripravKurz(klient);
  const { kod } = await (await posliPrihlasku({}, termin.id)).json();
  const [[p]] = await pool.query('SELECT id FROM rezervace WHERE kod = ?', [kod]);

  const [pred] = await pool.query('SELECT COUNT(*) AS pocet FROM emaily');

  const bez = await klient.post(`/api/admin/rezervace/${p.id}/stav`, {
    stav: 'potvrzena', poslat_email: false,
  });
  assert.equal(bez.status, 200);
  assert.equal(bez.data.stav, 'potvrzena');
  assert.equal(bez.data.email_odeslan, false);

  const [bezEmailu] = await pool.query('SELECT COUNT(*) AS pocet FROM emaily');
  assert.equal(bezEmailu[0].pocet, pred[0].pocet, 'bez zaškrtnutí nic neodešlo');

  const s = await klient.post(`/api/admin/rezervace/${p.id}/stav`, {
    stav: 'zaplacena', poslat_email: true,
  });
  assert.equal(s.data.email_odeslan, true);

  const [posledni] = await pool.query(
    'SELECT sablona_klic, prijemce_skutecny FROM emaily ORDER BY id DESC LIMIT 1'
  );
  assert.equal(posledni[0].sablona_klic, 'prihlaska_zaplacena');
  assert.equal(posledni[0].prijemce_skutecny, config.EMAIL_TEST_PRIJEMCE);
});

test('zrušení termínu dá vědět přihlášeným a přihlášky nechá být', async () => {
  const klient = await prihlas();
  const { termin } = await pripravKurz(klient);
  await posliPrihlasku({}, termin.id);

  const odpoved = await klient.post(`/api/admin/terminy/${termin.id}/zrusit`, {
    duvod: 'Nepřeje počasí.', poslat_email: true,
  });

  assert.equal(odpoved.data.prihlasek, 1);
  assert.equal(odpoved.data.emailu_odeslano, 1);

  const [[p]] = await pool.query('SELECT stav FROM rezervace LIMIT 1');
  assert.equal(p.stav, 'nova', 'přihláška zrušením termínu nemizí (rozhodnutí 7)');

  const [posledni] = await pool.query(
    'SELECT sablona_klic, prijemce_skutecny FROM emaily ORDER BY id DESC LIMIT 1'
  );
  assert.equal(posledni[0].sablona_klic, 'termin_zruseny');
  assert.equal(posledni[0].prijemce_skutecny, config.EMAIL_TEST_PRIJEMCE);
});

test('text šablony se dá upravit a projeví se v odeslaném e-mailu', async () => {
  const klient = await prihlas();
  const { data } = await klient.get('/api/admin/sablony');
  const sablona = data.data.find((s) => s.klic === 'prihlaska_prijata');

  const upravena = await klient.patch(`/api/admin/sablony/${sablona.id}`, {
    predmet: 'Máme tvou přihlášku na {{kurz}}',
    telo: 'Ahoj {{jmeno}}, přihlášku {{kod}} na {{termin}} máme.',
  });
  assert.equal(upravena.status, 200);

  const { termin } = await pripravKurz(klient);
  await posliPrihlasku({ jmeno: 'Petr Novák', email: 'petr@example.invalid' }, termin.id);

  const [emaily] = await pool.query(
    "SELECT predmet, telo_text FROM emaily WHERE sablona_klic = 'prihlaska_prijata' ORDER BY id DESC LIMIT 1"
  );
  assert.match(emaily[0].predmet, /Máme tvou přihlášku na Parašutistický výcvik/);
  assert.match(emaily[0].telo_text, /^Ahoj Petr Novák, přihlášku LSD-/);
});

test('náhled šablony vykreslí ukázková data, ne proměnné', async () => {
  const klient = await prihlas();
  const { data } = await klient.get('/api/admin/sablony');
  const sablona = data.data.find((s) => s.klic === 'prihlaska_potvrzena');

  const nahled = await klient.post(`/api/admin/sablony/${sablona.id}/nahled`, {
    telo: 'Dobrý den, {{jmeno}}, kurz {{kurz}} začíná {{termin}}.',
  });

  assert.equal(nahled.status, 200);
  assert.doesNotMatch(nahled.data.text, /\{\{/, 'v náhledu nesmí zůstat proměnná');
  assert.match(nahled.data.text, /Jana Nováková/);
  assert.match(nahled.data.html, /<p style=/, 'odstavce doplní aplikace');
});

// --------------------------------------------------------------- souhlasy

test('souhlas se uloží i s textem, jaký měl člověk před očima', async () => {
  const klient = await prihlas();
  const { termin } = await pripravKurz(klient);

  await klient.post('/api/admin/nastaveni', {
    'souhlasy.vop_text': 'Souhlasím s podmínkami ze dne 1. 1. 2026.',
  }).catch(() => {});
  const { ulozNastaveni, zapomenCache } = await import('../src/nastaveni.js');
  await ulozNastaveni({ 'souhlasy.vop_text': 'Souhlasím s podmínkami ze dne 1. 1. 2026.' });
  zapomenCache();

  const { kod } = await (await posliPrihlasku({}, termin.id)).json();
  const [[p]] = await pool.query('SELECT * FROM rezervace WHERE kod = ?', [kod]);

  assert.ok(p.souhlas_vop_at, 'kdy souhlasil');
  assert.equal(p.souhlas_vop_text, 'Souhlasím s podmínkami ze dne 1. 1. 2026.');
  assert.ok(p.souhlas_gdpr_at && p.souhlas_gdpr_text);
  assert.ok(p.souhlas_zdravi_at && p.souhlas_zdravi_text);

  // Pozdější změna podmínek se do staré přihlášky nepromítne.
  await ulozNastaveni({ 'souhlasy.vop_text': 'Úplně jiné podmínky.' });
  zapomenCache();
  const [[pozdeji]] = await pool.query('SELECT souhlas_vop_text FROM rezervace WHERE kod = ?', [kod]);
  assert.equal(pozdeji.souhlas_vop_text, 'Souhlasím s podmínkami ze dne 1. 1. 2026.');
});

test('bez souhlasu přihláška neprojde', async () => {
  const klient = await prihlas();
  const { termin } = await pripravKurz(klient);

  for (const chybejici of ['souhlas_vop', 'souhlas_gdpr', 'souhlas_zdravi']) {
    const odpoved = await posliPrihlasku({ [chybejici]: false }, termin.id);
    assert.equal(odpoved.status, 400, `bez ${chybejici} to nesmí projít`);
    const data = await odpoved.json();
    assert.ok(data.detaily[chybejici], 'chyba má sedět u svého zaškrtnutí');
  }

  const [[{ pocet }]] = await pool.query('SELECT COUNT(*) AS pocet FROM rezervace');
  assert.equal(pocet, 0);
});

// ------------------------------------------------- osobní údaje a audit

test('v auditu nejsou osobní údaje, jen číslo přihlášky a jméno', async () => {
  const klient = await prihlas();
  const { termin } = await pripravKurz(klient);
  const { kod } = await (await posliPrihlasku(
    { email: 'tajny@example.invalid', telefon: '777999888' }, termin.id
  )).json();
  const [[p]] = await pool.query('SELECT id FROM rezervace WHERE kod = ?', [kod]);

  await klient.post(`/api/admin/rezervace/${p.id}/stav`, { stav: 'potvrzena', poslat_email: false });
  await klient.patch(`/api/admin/rezervace/${p.id}`, { interni_poznamka: 'Volal, domluveno.' });

  const [zaznamy] = await pool.query(
    "SELECT popis, pred, po FROM audit_log WHERE entita = 'rezervace'"
  );
  assert.ok(zaznamy.length >= 2);

  for (const z of zaznamy) {
    const cely = `${z.popis ?? ''} ${z.pred ?? ''} ${z.po ?? ''}`;
    assert.doesNotMatch(cely, /tajny@example.invalid/, 'e-mail do auditu nepatří');
    assert.doesNotMatch(cely, /777999888/, 'telefon do auditu nepatří');
    assert.doesNotMatch(cely, /Volal, domluveno/, 'text poznámky do auditu nepatří');
  }
  assert.ok(zaznamy.some((z) => z.popis.includes(kod)), 'číslo přihlášky tam naopak být má');
});

test('anonymizace smaže osobní údaje, přihlášku nechá', async () => {
  const klient = await prihlas();
  const { termin } = await pripravKurz(klient);
  const { kod } = await (await posliPrihlasku({}, termin.id)).json();
  const [[p]] = await pool.query('SELECT id, zakaznik_id FROM rezervace WHERE kod = ?', [kod]);

  const odpoved = await klient.post(`/api/admin/zakaznici/${p.zakaznik_id}/anonymizovat`);
  assert.equal(odpoved.status, 200);

  const [[z]] = await pool.query('SELECT * FROM zakaznici WHERE id = ?', [p.zakaznik_id]);
  assert.equal(z.email, null);
  assert.equal(z.telefon, null);
  assert.equal(z.jmeno, 'Anonymizovaný zákazník');
  assert.ok(z.anonymizovano_at);

  const [[u]] = await pool.query(
    'SELECT * FROM rezervace_ucastnici WHERE rezervace_id = ?', [p.id]
  );
  assert.equal(u.jmeno, 'Anonymizovaný účastník');
  assert.equal(u.datum_narozeni, null);

  // Přihláška zůstává kvůli účetnictví.
  const [[r]] = await pool.query('SELECT kod, cena_hal, pocet_osob FROM rezervace WHERE id = ?', [p.id]);
  assert.equal(r.kod, kod);
  assert.equal(r.cena_hal, 490000);

  // Odeslané e-maily nesmí nést adresu ani text.
  const [emaily] = await pool.query('SELECT prijemce, telo_text FROM emaily WHERE zakaznik_id = ?', [
    p.zakaznik_id,
  ]);
  for (const e of emaily) {
    assert.equal(e.prijemce, 'anonymizovano');
    assert.equal(e.telo_text, null);
  }

  // Podruhé už není co anonymizovat.
  assert.equal((await klient.post(`/api/admin/zakaznici/${p.zakaznik_id}/anonymizovat`)).status, 409);
});

test('přihláška ukládá jen to, co potřebuje', async () => {
  // Kdyby do tabulky někdo přidal sloupec na rodné číslo nebo diagnózu,
  // tenhle test na to upozorní dřív, než se to dostane do produkce.
  const [sloupce] = await pool.query('SHOW COLUMNS FROM rezervace_ucastnici');
  const jmena = sloupce.map((s) => s.Field);

  assert.deepEqual(jmena.sort(), [
    'created_at', 'datum_narozeni', 'doklada_prohlidku', 'dorazil', 'email', 'id',
    'jmeno', 'poznamka', 'rezervace_id', 'telefon', 'vaha_kg', 'zajisti_souhlas_zastupce',
  ]);
});

// ----------------------------------------------------- věk, váha, ceník

test('účastník mimo limit se přihlásí, ale je označený', async () => {
  // Rozhodnutí 3: rozhodnutí je na provozu, ne na formuláři.
  const klient = await prihlas();
  const { termin } = await pripravKurz(klient);

  const odpoved = await posliPrihlasku({
    ucastnici: [{ jmeno: 'Mladý Zájemce', datum_narozeni: zaDni(-14 * 365), vaha_kg: 120 }],
  }, termin.id);
  const data = await odpoved.json();

  assert.equal(odpoved.status, 201, 'přihláška projde');
  assert.ok(data.varovani.length >= 2, 'ale s varováním');
  assert.ok(data.varovani.some((v) => /věk/.test(v)));
  assert.ok(data.varovani.some((v) => /hmotnost/.test(v)));
});

test('změna ceny kurzu nepřepíše už odeslanou přihlášku', async () => {
  const klient = await prihlas();
  const { kurz, termin } = await pripravKurz(klient, { cena_hal: 490000 });
  const { kod } = await (await posliPrihlasku({}, termin.id)).json();

  await klient.patch(`/api/admin/produkty/${kurz.id}`, {
    cena_hal: 590000, duvod_zmeny_ceny: 'Zdražení od nové sezóny',
  });

  const [[p]] = await pool.query('SELECT cena_hal FROM rezervace WHERE kod = ?', [kod]);
  assert.equal(p.cena_hal, 490000, 'stará přihláška si drží svou cenu');

  const [[polozka]] = await pool.query(
    'SELECT nazev_snapshot, cena_jed_hal FROM rezervace_polozky LIMIT 1'
  );
  assert.equal(polozka.cena_jed_hal, 490000);
  assert.match(polozka.nazev_snapshot, /Parašutistický výcvik/);
});

// -------------------------------------------------------------- soupiska

test('soupiska má sloupce pro letiště a označí účastníky mimo limit', async () => {
  const klient = await prihlas();
  const { termin } = await pripravKurz(klient);

  await posliPrihlasku({
    jmeno: 'Eva Nováková', email: 'eva@example.invalid',
    ucastnici: [
      { jmeno: 'Eva Nováková', datum_narozeni: '1990-03-03', vaha_kg: 70, doklada_prohlidku: true },
      { jmeno: 'Malá Nováková', datum_narozeni: zaDni(-13 * 365), vaha_kg: 45 },
    ],
  }, termin.id);

  const { data } = await klient.get(`/api/admin/terminy/${termin.id}/soupiska`);

  assert.equal(data.pocty.prihlaseno, 2);
  assert.equal(data.pocty.mimo_limit, 1);
  assert.equal(data.ucastnici[0].doklada_prohlidku, true);
  assert.ok(data.ucastnici[1].varovani.length, 'nezletilá je označená');
  assert.equal(data.ucastnici[0].telefon, '777111222', 'bez vlastního telefonu platí kontakt z přihlášky');

  // CSV má stejné sloupce jako tištěná soupiska - jinak by provoz držel
  // v ruce dva různé papíře k témuž dni.
  const csv = await klient.get(`/api/admin/terminy/${termin.id}/soupiska.csv`);
  assert.equal(csv.status, 200);

  const radky = csv.data.split('\r\n');
  assert.equal(
    radky[0].replace('﻿', ''),
    'Jméno;Věk;Váha kg;Telefon;E-mail;Stav;Zaplaceno;Prohlídka doložena;Souhlas zástupce;Mimo limit;Poznámka'
  );
  assert.match(radky[1], /^Eva Nováková;/);
  assert.match(radky[1], /;ano;/, 'doložená prohlídka je v tabulce');
  assert.match(radky[2], /věk/, 'u nezletilé je důvod, proč je mimo limit');
});

test('soupiska nepočítá stornované přihlášky', async () => {
  const klient = await prihlas();
  const { termin } = await pripravKurz(klient);
  const { kod } = await (await posliPrihlasku({}, termin.id)).json();
  const [[p]] = await pool.query('SELECT id FROM rezervace WHERE kod = ?', [kod]);

  await klient.post(`/api/admin/rezervace/${p.id}/storno`, {
    duvod: 'Omluvil se.', poslat_email: false,
  });

  const { data } = await klient.get(`/api/admin/terminy/${termin.id}/soupiska`);
  assert.equal(data.pocty.prihlaseno, 0, 'kdo se omluvil, na letiště nepřijede');
});

// ------------------------------------------------- veřejné zobrazení

test('účastník vidí svou přihlášku jen se správným odkazem', async () => {
  const klient = await prihlas();
  const { termin } = await pripravKurz(klient);
  const { kod, odkaz } = await (await posliPrihlasku({}, termin.id)).json();

  const spravne = await fetch(server.url + '/api' + odkaz.replace('/prihlaska/', '/prihlasky/'));
  assert.equal(spravne.status, 200);
  const data = await spravne.json();
  assert.equal(data.kod, kod);
  assert.equal(data.verejny_token, undefined, 'token se sám sebou nevrací');
  assert.equal(data.interni_poznamka, undefined, 'poznámka provozu na web nepatří');

  // Bez tokenu nebo s cizím 404, ne 403 - ať nejde uhodnout, co existuje.
  assert.equal((await fetch(`${server.url}/api/prihlasky/${kod}`)).status, 404);
  assert.equal((await fetch(`${server.url}/api/prihlasky/${kod}?t=spatny`)).status, 404);
});

test('stránka kurzu nabídne přihlášku, dokud je kam se přihlásit', async () => {
  // Požadavek 5: přihláška nahradí formulář „Mám zájem" u kurzů s termínem,
  // u kurzů bez termínu zůstane poptávka.
  const klient = await prihlas();
  const { kurz, termin } = await pripravKurz(klient, { kapacita: 1 });

  const sTerminem = await (await fetch(`${server.url}/kurz/${kurz.slug}`)).text();
  assert.match(sTerminem, /data-prihlaska/, 'je kam se přihlásit');
  assert.match(sTerminem, /souhlas_vop/, 'souhlasy jsou na stránce');

  // Když se termín zaplní, zůstane poptávka.
  await posliPrihlasku({}, termin.id);
  const plny = await (await fetch(`${server.url}/kurz/${kurz.slug}`)).text();
  assert.doesNotMatch(plny, /data-prihlaska/);
  assert.match(plny, /data-poptavka/, 'u plného kurzu zbyde poptávka');
});

// ------------------------------------------------------------ oprávnění

test('přihlášky nikdo nepřečte bez přihlášení', async () => {
  const host = vytvorKlienta(server.url);
  await host.get('/api/admin/ja');

  assert.equal((await host.get('/api/admin/rezervace')).status, 401);
  assert.equal((await host.post('/api/admin/rezervace/1/stav', { stav: 'potvrzena' })).status, 401);
  assert.equal((await host.post('/api/admin/zakaznici/1/anonymizovat')).status, 401);
});

test('instruktor vidí soupisku, ale přihlášky nemění', async () => {
  const sefka = await prihlas('admin');
  const { termin } = await pripravKurz(sefka);
  const { kod } = await (await posliPrihlasku({}, termin.id)).json();
  const [[p]] = await pool.query('SELECT id FROM rezervace WHERE kod = ?', [kod]);

  const instruktor = await prihlas('instruktor');
  assert.equal(
    (await instruktor.get(`/api/admin/terminy/${termin.id}/soupiska`)).status,
    200,
    'na letišti ji potřebuje ten, kdo tam je'
  );
  assert.equal((await instruktor.get('/api/admin/rezervace')).status, 403);
  assert.equal(
    (await instruktor.post(`/api/admin/rezervace/${p.id}/stav`, { stav: 'zaplacena' })).status,
    403
  );
});
