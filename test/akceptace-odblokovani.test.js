// Odblokování schválení verze a stav „V produkci".
//
// Fáze 1 se nedala schválit: blokovala ji testerka, která k ní nikdy nesedla,
// a jedno hlášení, které se jí vlastně netýkalo. Odebrat testerku z výchozího
// seznamu („testují všichni, kdo na to mají právo") nešlo - nebylo co smazat -
// a hlášení se nedalo přestěhovat jinam, takže se muselo buď zamítnout něco,
// co platí, nebo kvůli němu vydání viselo.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
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

async function prihlas(role = 'admin', email = 'sef@example.invalid', jmeno = 'Šéfka') {
  await vytvorUzivatele(pool, { email, jmeno, role, heslo });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  await klient.post('/api/admin/prihlaseni', { email, heslo });
  return klient;
}

async function zadani(ukoly, { kod = 'zkouska', nazev = 'Zkušební verze' } = {}) {
  const adresar = await mkdtemp(path.join(os.tmpdir(), 'lsd-odblok-'));
  const radky = ['verze:', `  kod: ${kod}`, `  nazev: ${nazev}`, '  poradi: 1', 'ukoly:'];
  for (const u of ukoly) {
    radky.push(
      `  - kod: ${u.kod}`,
      `    nazev: ${u.nazev}`,
      '    postup: "Udělej krok jeden, potom krok dva."',
      '    vysledek: "Objeví se zelená hláška."'
    );
  }
  await writeFile(path.join(adresar, `${kod}.yml`), radky.join('\n') + '\n');
  return adresar;
}

async function naimportuj(adresar) {
  const { naimportujAkceptaci } = await import('../src/akceptace/import.js');
  return naimportujAkceptaci({ adresar });
}

// ------------------------------------------------------- odebrání testera

test('odebraný tester přestane blokovat schválení, výsledky mu zůstanou', async () => {
  await naimportuj(await zadani([{ kod: 'ukol-a', nazev: 'Úkol A' }, { kod: 'ukol-b', nazev: 'Úkol B' }]));
  const sef = await prihlas('admin');
  const katrina = await prihlas('provoz', 'katrina@example.invalid', 'Katřina Fojtová');

  const [[ukol]] = await pool.query("SELECT id FROM akceptace_ukoly WHERE kod = 'ukol-a'");
  await katrina.put(`/api/admin/akceptace/ukoly/${ukol.id}/vysledek`, { stav: 'funguje' });

  const pred = await sef.get('/api/admin/akceptace/verze/zkouska');
  assert.ok(
    pred.data.duvody_proti_schvaleni.some((d) => d.includes('Katřina')),
    'dokud verzi testuje, musí být mezi překážkami'
  );

  const [[uzivatel]] = await pool.query('SELECT id FROM uzivatele WHERE email = ?', [
    'katrina@example.invalid',
  ]);
  const odebrani = await sef.del(`/api/admin/akceptace/verze/zkouska/testeri/${uzivatel.id}`);
  assert.equal(odebrani.status, 200);

  const po = await sef.get('/api/admin/akceptace/verze/zkouska');
  assert.ok(
    !po.data.duvody_proti_schvaleni.some((d) => d.includes('Katřina')),
    'po odebrání už blokovat nesmí'
  );
  assert.ok(
    !(po.data.testeri ?? []).some((t) => t.jmeno.includes('Katřina')),
    'a nesmí zůstat v seznamu testerů'
  );

  const [vysledky] = await pool.query('SELECT id FROM akceptace_vysledky WHERE uzivatel_id = ?', [
    uzivatel.id,
  ]);
  assert.equal(vysledky.length, 1, 'zapsané výsledky se nesmí ztratit');
});

test('odebrání se zapíše do auditu', async () => {
  await naimportuj(await zadani([{ kod: 'ukol-a', nazev: 'Úkol A' }]));
  const sef = await prihlas('admin');
  await prihlas('provoz', 'katrina@example.invalid', 'Katřina Fojtová');

  const [[uzivatel]] = await pool.query('SELECT id FROM uzivatele WHERE email = ?', [
    'katrina@example.invalid',
  ]);
  await sef.del(`/api/admin/akceptace/verze/zkouska/testeri/${uzivatel.id}`);

  const [[zaznam]] = await pool.query(
    "SELECT popis FROM audit_log WHERE akce = 'akceptace_tester_odebran' ORDER BY id DESC LIMIT 1"
  );
  assert.ok(zaznam, 'odebrání testera patří do auditu');
  assert.match(zaznam.popis, /Katřina/);
});

// --------------------------------------------------------- přesun hlášení

test('hlášení jde přesunout do jiné otevřené verze', async () => {
  await naimportuj(await zadani([{ kod: 'ukol-a', nazev: 'Úkol A' }], { kod: 'prvni', nazev: 'První' }));
  await naimportuj(await zadani([{ kod: 'ukol-b', nazev: 'Úkol B' }], { kod: 'druha', nazev: 'Druhá' }));
  const sef = await prihlas('admin');

  const [[prvni]] = await pool.query("SELECT id FROM akceptace_verze WHERE kod = 'prvni'");
  const [[druha]] = await pool.query("SELECT id FROM akceptace_verze WHERE kod = 'druha'");

  const nahlaseni = await sef.post('/api/admin/akceptace/hlaseni', {
    text: 'Tohle patří spíš do další dávky.',
    verze_id: prvni.id,
  });
  assert.equal(nahlaseni.status, 201);

  const [[hlaseni]] = await pool.query('SELECT id FROM akceptace_hlaseni ORDER BY id DESC LIMIT 1');

  const presun = await sef.patch(`/api/admin/akceptace/hlaseni/${hlaseni.id}`, {
    verze_id: druha.id,
    odpoved: 'Netýká se téhle verze.',
  });
  assert.equal(presun.status, 200);
  assert.match(presun.data.zprava, /Druhá/);

  const [[po]] = await pool.query('SELECT verze_id, stav FROM akceptace_hlaseni WHERE id = ?', [
    hlaseni.id,
  ]);
  assert.equal(po.verze_id, druha.id, 'hlášení se musí počítat nové verzi');
  assert.equal(po.stav, 'nove', 'přesun sám o sobě hlášení neuzavírá');

  const detail = await sef.get('/api/admin/akceptace/verze/prvni');
  assert.ok(
    !detail.data.duvody_proti_schvaleni.some((d) => /hlášení/i.test(d)),
    'po přesunu nesmí brzdit původní verzi'
  );
});

test('hlášení nejde přesunout do uzavřené verze', async () => {
  await naimportuj(await zadani([{ kod: 'ukol-a', nazev: 'Úkol A' }], { kod: 'prvni', nazev: 'První' }));
  await naimportuj(await zadani([{ kod: 'ukol-b', nazev: 'Úkol B' }], { kod: 'druha', nazev: 'Druhá' }));
  const sef = await prihlas('admin');

  const [[prvni]] = await pool.query("SELECT id FROM akceptace_verze WHERE kod = 'prvni'");
  const [[druha]] = await pool.query("SELECT id FROM akceptace_verze WHERE kod = 'druha'");
  await pool.query("UPDATE akceptace_verze SET stav = 'schvalena' WHERE id = ?", [druha.id]);

  await sef.post('/api/admin/akceptace/hlaseni', { text: 'Zkouška.', verze_id: prvni.id });
  const [[hlaseni]] = await pool.query('SELECT id FROM akceptace_hlaseni ORDER BY id DESC LIMIT 1');

  const presun = await sef.patch(`/api/admin/akceptace/hlaseni/${hlaseni.id}`, {
    verze_id: druha.id,
  });
  assert.equal(presun.status, 409, 'do uzavřené verze by hlášení spadlo a nikdo ho neotevře');
});

test('uzavření hlášení s poznámkou ho přestane počítat mezi otevřená', async () => {
  await naimportuj(await zadani([{ kod: 'ukol-a', nazev: 'Úkol A' }]));
  const sef = await prihlas('admin');
  const [[verze]] = await pool.query("SELECT id FROM akceptace_verze WHERE kod = 'zkouska'");

  await sef.post('/api/admin/akceptace/hlaseni', { text: 'Něco nesedí.', verze_id: verze.id });
  const [[hlaseni]] = await pool.query('SELECT id FROM akceptace_hlaseni ORDER BY id DESC LIMIT 1');

  await sef.patch(`/api/admin/akceptace/hlaseni/${hlaseni.id}`, {
    stav: 'vyreseno',
    odpoved: 'Opraveno v dávce 2.',
  });

  const [[po]] = await pool.query(
    'SELECT stav, odpoved, vyresil_id FROM akceptace_hlaseni WHERE id = ?',
    [hlaseni.id]
  );
  assert.equal(po.stav, 'vyreseno');
  assert.match(po.odpoved, /dávce 2/);
  assert.ok(po.vyresil_id, 'musí být vidět, kdo to uzavřel');

  const detail = await sef.get('/api/admin/akceptace/verze/zkouska');
  assert.ok(
    !detail.data.duvody_proti_schvaleni.some((d) => /hlášení/i.test(d)),
    'vyřešené hlášení nesmí blokovat'
  );
});

// --------------------------------------------------------- schválit přesto

test('schválit přesto obejde překážky, ale zapíše je i s důvodem', async () => {
  await naimportuj(await zadani([{ kod: 'ukol-a', nazev: 'Úkol A' }]));
  const sef = await prihlas('admin');

  const bezDuvodu = await sef.post('/api/admin/akceptace/verze/zkouska/schvalit', {});
  assert.equal(bezDuvodu.status, 409, 'běžné schválení musí odmítnout');
  assert.equal(
    bezDuvodu.data.detaily.lze_presto,
    true,
    'administrace musí poznat, že jde schválit přesto'
  );

  const bezTextu = await sef.post('/api/admin/akceptace/verze/zkouska/schvalit', { presto: true });
  assert.equal(bezTextu.status, 400, 'bez důvodu to projít nesmí');

  const presto = await sef.post('/api/admin/akceptace/verze/zkouska/schvalit', {
    presto: true,
    duvod: 'Testováno mimo modul, zbytek řeší další dávka.',
  });
  assert.equal(presto.status, 200);

  const [[verze]] = await pool.query(
    "SELECT stav, schvaleni_poznamka FROM akceptace_verze WHERE kod = 'zkouska'"
  );
  assert.equal(verze.stav, 'schvalena');
  assert.match(verze.schvaleni_poznamka, /Testováno mimo modul/, 'důvod patří k vydání');
  assert.match(verze.schvaleni_poznamka, /Obejité překážky/, 'a s ním i co se obešlo');

  const [[audit]] = await pool.query(
    "SELECT po FROM audit_log WHERE akce = 'akceptace_schvaleni' ORDER BY id DESC LIMIT 1"
  );
  // Podle typu sloupce vrací ovladač JSON buď jako text, nebo už rozparsovaný.
  const po = typeof audit.po === 'string' ? JSON.parse(audit.po) : audit.po;
  assert.equal(po.presto, true);
  assert.ok(Array.isArray(po.obejite_prekazky) && po.obejite_prekazky.length);
});

test('bez překážek se důvod nevyžaduje a poznámka zůstane čistá', async () => {
  await naimportuj(await zadani([{ kod: 'ukol-a', nazev: 'Úkol A' }]));
  const sef = await prihlas('admin');

  const [[ukol]] = await pool.query("SELECT id FROM akceptace_ukoly WHERE kod = 'ukol-a'");
  await sef.put(`/api/admin/akceptace/ukoly/${ukol.id}/vysledek`, { stav: 'funguje' });

  const vysledek = await sef.post('/api/admin/akceptace/verze/zkouska/schvalit', {
    poznamka: 'Všechno v pořádku.',
  });
  assert.equal(vysledek.status, 200);

  const [[verze]] = await pool.query(
    "SELECT schvaleni_poznamka FROM akceptace_verze WHERE kod = 'zkouska'"
  );
  assert.equal(verze.schvaleni_poznamka, 'Všechno v pořádku.');
  assert.doesNotMatch(verze.schvaleni_poznamka, /Obejité/, 'nic se neobcházelo');
});

// ------------------------------------------------------------ v produkci

test('schválenou verzi jde označit jako nasazenou, otevřenou ne', async () => {
  await naimportuj(await zadani([{ kod: 'ukol-a', nazev: 'Úkol A' }]));
  const sef = await prihlas('admin');

  const brzy = await sef.post('/api/admin/akceptace/verze/zkouska/do-produkce', {});
  assert.equal(brzy.status, 409, 'co není schválené, nemůže být v produkci');

  await sef.post('/api/admin/akceptace/verze/zkouska/schvalit', {
    presto: true,
    duvod: 'Zkouška.',
  });

  const nasazeni = await sef.post('/api/admin/akceptace/verze/zkouska/do-produkce', {
    nasazeno: '2026-10-03',
    odkaz: 'https://github.com/janfrancik/LSD-trip.cz/commit/a786747',
    poznamka: 'Schválil Honza bez testu Katřiny.',
  });
  assert.equal(nasazeni.status, 200);

  const [[verze]] = await pool.query(
    `SELECT stav, nasazeno_at, nasazeni_odkaz, schvaleni_poznamka
       FROM akceptace_verze WHERE kod = 'zkouska'`
  );
  assert.equal(verze.stav, 'v_produkci');
  assert.ok(verze.nasazeno_at, 'datum nasazení se musí zapsat');
  assert.match(verze.nasazeni_odkaz, /commit\/a786747/);
  assert.match(verze.schvaleni_poznamka, /bez testu Katřiny/);

  const znovu = await sef.post('/api/admin/akceptace/verze/zkouska/do-produkce', {});
  assert.equal(znovu.status, 409, 'podruhé už ne');
});
