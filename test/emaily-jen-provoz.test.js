// Režim `jen_provoz`: interní upozornění odejdou provozu, zákazníkům ne.
//
// Je to stav na dobu, kdy Resend ještě nemá ověřenou doménu - tehdy odešle
// jen z onboarding@resend.dev a jen na adresu majitele účtu. Zákaznický
// e-mail by skončil chybou 403, takže se o něj ani nezkouší.
//
// Odesílání se tady podstrkuje přes `_odesilatel` (viz src/email/posli.js).
// Skutečný Resend se nevolá - testy nesmí posílat e-maily ven ani omylem.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pripravDatabazi, vycistiData, spustServer, vytvorKlienta,
  vytvorUzivatele, testovaciHeslo,
} from './pomocnik.js';

let pool;
let config;
let posli;
let server;
let klient;

// Co by odešlo, kdyby na druhém konci byl Resend.
let odeslane = [];
let pouziteKlice = [];
let pristiOdeslaniSelze = null;
let poradiOdeslani = 0;

before(async () => {
  await pripravDatabazi();
  pool = (await import('../src/db.js')).default;
  config = (await import('../src/config.js')).default;
  posli = await import('../src/email/posli.js');

  // Podstrčit odesílatele jde jen pod NODE_ENV=test (nastavuje pomocnik.js).
  posli._podstrcOdesilatel({
    maKlienta: () => true,
    async odesli(zprava, idempotencyKey) {
      pouziteKlice.push(idempotencyKey);
      if (pristiOdeslaniSelze) {
        const chyba = new Error(pristiOdeslaniSelze);
        pristiOdeslaniSelze = null;
        throw chyba;
      }
      odeslane.push(zprava);
      // Pořadové číslo, které se v rámci běhu NIKDY neopakuje. Odvozovat ho od
      // délky `odeslane` nejde: to pole se uvnitř testů nuluje, a protože nad
      // `resend_id` je UNIQUE, druhý e-mail by spadl na duplicitní klíč.
      poradiOdeslani += 1;
      return `podstrceny-${poradiOdeslani}`;
    },
  });

  server = await spustServer();
  klient = vytvorKlienta(server.url);
});

after(async () => {
  posli._podstrcOdesilatel(null);
  await server?.zavri();
  await pool.end();
});

beforeEach(async () => {
  await vycistiData(pool);
  const { vynulujLimity } = await import('../src/auth/limit.js');
  await vynulujLimity();
  const { zapomenCache } = await import('../src/nastaveni.js');
  zapomenCache();
  odeslane = [];
  pouziteKlice = [];
  pristiOdeslaniSelze = null;
});

// Režim se v testech přepíná na objektu config - stejně to dělají i ostatní
// testy. Vrací se vždy, i když test spadne.
async function vRezimu(rezim, telo, provozPrijemce = 'provoz@example.invalid') {
  const puvodniRezim = config.EMAIL_REZIM;
  const puvodniProvoz = config.EMAIL_PROVOZ_PRIJEMCE;
  const puvodniMuze = config.muzeZakaznikovi;

  config.EMAIL_REZIM = rezim;
  config.EMAIL_PROVOZ_PRIJEMCE = provozPrijemce;
  config.muzeZakaznikovi = ['live', 'test'].includes(rezim);
  try {
    return await telo();
  } finally {
    config.EMAIL_REZIM = puvodniRezim;
    config.EMAIL_PROVOZ_PRIJEMCE = puvodniProvoz;
    config.muzeZakaznikovi = puvodniMuze;
  }
}

// ----------------------------------------------------------- směrování

test('jen_provoz odešle interní upozornění a zákaznický e-mail neodešle', async () => {
  await vRezimu('jen_provoz', async () => {
    const zakaznikovi = await posli.posliEmail({
      prijemce: 'zakaznik@seznam.cz',
      predmet: 'Přihláška přijatá',
      telo: '<p>Děkujeme</p>',
      interni: false,
    });

    const provozu = await posli.posliEmail({
      prijemce: 'kontakt-z-nastaveni@example.invalid',
      predmet: 'Nová přihláška',
      telo: '<p>Přišla přihláška</p>',
      interni: true,
    });

    assert.equal(zakaznikovi.odeslano, false, 'zákazníkovi se nesmí nic odeslat');
    assert.equal(zakaznikovi.prijemceSkutecny, null);
    assert.equal(provozu.odeslano, true, 'provozu upozornění odejít musí');

    // Odešel právě jeden e-mail a právě na adresu z .env. Kontaktní adresa
    // z nastavení se nepoužije: bez ověřené domény ji Resend odmítne.
    assert.equal(odeslane.length, 1);
    assert.deepEqual(odeslane[0].to, ['provoz@example.invalid']);
    assert.match(odeslane[0].subject, /Nová přihláška/);

    const [[zakaznickyLog]] = await pool.query('SELECT * FROM emaily WHERE id = ?', [
      zakaznikovi.id,
    ]);
    assert.equal(zakaznickyLog.stav, 'neodeslano');
    assert.equal(zakaznickyLog.rezim, 'jen_provoz');
    assert.match(zakaznickyLog.chyba, /jen_provoz/);
    // Tělo se ukládá i tak - jinak by se po ověření domény nedalo doposlat.
    assert.match(zakaznickyLog.telo_snapshot, /Děkujeme/);
  });
});

test('v režimu test se přesměruje i interní upozornění', async () => {
  await vRezimu('test', async () => {
    await posli.posliEmail({
      prijemce: 'kontakt-z-nastaveni@example.invalid',
      predmet: 'Nová přihláška',
      telo: '<p>x</p>',
      interni: true,
    });

    assert.equal(odeslane.length, 1);
    assert.deepEqual(
      odeslane[0].to,
      [config.EMAIL_TEST_PRIJEMCE],
      'z testu nesmí odejít nic na skutečnou adresu, ani interní upozornění'
    );
    assert.match(odeslane[0].subject, /^\[TEST\]/);
  });
});

test('vypnuto neodešle ani interní upozornění', async () => {
  await vRezimu('vypnuto', async () => {
    const vysledek = await posli.posliEmail({
      prijemce: 'provoz@example.invalid',
      predmet: 'Nová přihláška',
      telo: '<p>x</p>',
      interni: true,
    });

    assert.equal(vysledek.odeslano, false);
    assert.equal(odeslane.length, 0);

    const [[log]] = await pool.query('SELECT stav FROM emaily WHERE id = ?', [vysledek.id]);
    assert.equal(log.stav, 'neodeslano');
  });
});

// -------------------------------------------------------- odeslat znovu

test('odeslat znovu pošle uložené tělo a nepošle ho dvakrát', async () => {
  // E-mail vznikne jako neodeslaný (jen_provoz), pak se režim přepne na live
  // a dodatečné rozeslání má projít - právě jednou.
  const { id } = await vRezimu('jen_provoz', () =>
    posli.posliEmail({
      prijemce: 'zakaznik@seznam.cz',
      predmet: 'Přihláška přijatá',
      telo: '<p>Potvrzení přihlášky</p>',
      textovaVerze: 'Potvrzení přihlášky',
      interni: false,
    })
  );

  await vRezimu('live', async () => {
    const prvni = await posli.odesliZnovu(id);
    assert.equal(prvni.odeslano, true);
    assert.equal(prvni.prijemceSkutecny, 'zakaznik@seznam.cz');
    assert.equal(odeslane.length, 1);
    assert.match(odeslane[0].html, /Potvrzení přihlášky/, 'posílá se uložené tělo');

    // Druhé kliknutí nesmí odeslat nic - stav už není 'neodeslano'.
    const druhe = await posli.odesliZnovu(id);
    assert.equal(druhe.odeslano, false);
    assert.equal(druhe.duvod, 'jiz_vyrizeno');
    assert.equal(odeslane.length, 1, 'e-mail nesmí odejít dvakrát');

    const [[log]] = await pool.query('SELECT stav, chyba FROM emaily WHERE id = ?', [id]);
    assert.equal(log.stav, 'odeslano');
    assert.equal(log.chyba, null, 'po úspěšném odeslání nemá zůstat starý důvod');
  });
});

test('souběžné odeslání znovu projde jen jednou', async () => {
  const { id } = await vRezimu('jen_provoz', () =>
    posli.posliEmail({
      prijemce: 'zakaznik@seznam.cz',
      predmet: 'Přihláška přijatá',
      telo: '<p>x</p>',
      interni: false,
    })
  );

  await vRezimu('live', async () => {
    // Pět kliknutí ve stejnou chvíli. Zabrání řádku je podmíněný UPDATE,
    // takže projít smí právě jedno.
    const vysledky = await Promise.all([1, 2, 3, 4, 5].map(() => posli.odesliZnovu(id)));

    assert.equal(vysledky.filter((v) => v.odeslano).length, 1);
    assert.equal(odeslane.length, 1, 'zákazník nesmí dostat pět stejných e-mailů');
  });
});

test('odeslat znovu v režimu jen_provoz neprojde', async () => {
  const { id } = await vRezimu('jen_provoz', () =>
    posli.posliEmail({
      prijemce: 'zakaznik@seznam.cz',
      predmet: 'Přihláška přijatá',
      telo: '<p>x</p>',
      interni: false,
    })
  );

  await vRezimu('jen_provoz', async () => {
    const vysledek = await posli.odesliZnovu(id);
    assert.equal(vysledek.odeslano, false);
    assert.equal(vysledek.duvod, 'rezim_nedovoluje');
    assert.equal(odeslane.length, 0);

    // Stav zůstane 'neodeslano', aby to šlo po přepnutí režimu zkusit znovu.
    const [[log]] = await pool.query('SELECT stav FROM emaily WHERE id = ?', [id]);
    assert.equal(log.stav, 'neodeslano');
  });
});

test('když odeslání znovu selže, je to chyba — ne "neodesláno" — a dá se zkusit zas', async () => {
  const { id } = await vRezimu('jen_provoz', () =>
    posli.posliEmail({
      prijemce: 'zakaznik@seznam.cz',
      predmet: 'Přihláška přijatá',
      telo: '<p>x</p>',
      interni: false,
    })
  );

  await vRezimu('live', async () => {
    pristiOdeslaniSelze = 'The lsd-trip.cz domain is not verified (403)';
    const nepovedlo = await posli.odesliZnovu(id);

    assert.equal(nepovedlo.odeslano, false);
    assert.equal(nepovedlo.duvod, 'chyba_odeslani');

    const [[log]] = await pool.query('SELECT stav, chyba FROM emaily WHERE id = ?', [id]);
    // Skutečná chyba odesílací služby je 'chyba', ne 'neodeslano'. To druhé
    // znamená "režim to zakázal" a na dashboardu se nemá hlásit jako problém.
    assert.equal(log.stav, 'chyba', 'selhání u Resendu je chyba, ne "neodesláno"');
    assert.match(log.chyba, /not verified/, 'text chyby musí být v logu');

    // A po opravě to z toho stavu jde zkusit znovu.
    const povedlo = await posli.odesliZnovu(id);
    assert.equal(povedlo.odeslano, true);

    const [[poOprave]] = await pool.query('SELECT stav, chyba FROM emaily WHERE id = ?', [id]);
    assert.equal(poOprave.stav, 'odeslano');
    assert.equal(poOprave.chyba, null, 'po úspěchu nemá zůstat starý text chyby');
  });
});

test('chyba v režimu live zůstane chybou, ne neodeslaným', async () => {
  const { terminId } = await pripravKurzSTerminem();
  await nastavProvozEmail('kontakt@example.invalid');

  await vRezimu('live', async () => {
    pristiOdeslaniSelze = 'Internal server error (500)';
    await klient.post('/api/prihlasky', prihlaskaTelo(terminId));
  });

  const [[zakaznicky]] = await pool.query(
    `SELECT stav, chyba FROM emaily WHERE sablona_klic = 'prihlaska_prijata'`
  );
  assert.equal(zakaznicky.stav, 'chyba');
  assert.match(zakaznicky.chyba, /500/);

  // A hromadné rozeslání se jí nechytne - to je na to, co zakázal režim.
  const spravce = await prihlasSpravce();
  const nahled = await vRezimu('live', () => spravce.get('/api/admin/emaily/neodeslane'));
  assert.equal(nahled.data.celkem, 0, 'chyby se hromadně nerozesílají naslepo');
});

// ------------------------------------------------- chyba nesmí nic shodit

test('chyba odesílací služby neshodí přihlášku z webu', async () => {
  const { terminId } = await pripravKurzSTerminem();

  const odpoved = await vRezimu('live', async () => {
    pristiOdeslaniSelze = 'You can only send testing emails to your own address (403)';
    return klient.post('/api/prihlasky', {
      termin_id: terminId,
      jmeno: 'Martina Dvořáková',
      email: 'martina@example.invalid',
      telefon: '+420777123456',
      ucastnici: [{ jmeno: 'Martina Dvořáková', datum_narozeni: '1990-05-05', vaha_kg: 65 }],
      souhlas_vop: true,
      souhlas_gdpr: true,
      souhlas_zdravi: true,
    });
  });

  assert.equal(odpoved.status, 201, 'přihláška se musí uložit i při chybě e-mailu');
  assert.ok(odpoved.data.kod, 'musí vzniknout číslo přihlášky');

  // A je v databázi, ne jen v odpovědi.
  const [[prihlaska]] = await pool.query('SELECT kod FROM rezervace WHERE kod = ?', [
    odpoved.data.kod,
  ]);
  assert.ok(prihlaska, 'přihláška musí být v databázi');

  // Chyba se zapsala do logu, aby ji bylo vidět na dashboardu.
  const [chyby] = await pool.query(
    `SELECT stav, chyba FROM emaily WHERE stav = 'chyba' AND chyba LIKE '%403%'`
  );
  assert.equal(chyby.length >= 1, true, 'chyba odeslání musí být v logu');
});

test('chyba odesílací služby neshodí poptávku z kontaktního formuláře', async () => {
  // Kontaktní e-mail provozu musí být nastavený, jinak se upozornění neposílá.
  await nastavProvozEmail('provoz@example.invalid');

  const odpoved = await vRezimu('live', async () => {
    pristiOdeslaniSelze = 'Domain is not verified (403)';
    return klient.post('/api/poptavky', {
      jmeno: 'Petr Novák',
      email: 'petr@example.invalid',
      zprava: 'Kdy se dá skákat?',
    });
  });

  assert.equal(odpoved.status, 201, 'poptávka se musí uložit i při chybě e-mailu');

  const [[poptavka]] = await pool.query(
    'SELECT jmeno FROM poptavky WHERE email = ?',
    ['petr@example.invalid']
  );
  assert.ok(poptavka, 'poptávka musí být v databázi');
});

// ------------------------------------------------ interní upozornění

test('upozornění na novou poptávku odejde provozu s odkazem do administrace', async () => {
  await nastavProvozEmail('kontakt@example.invalid');

  await vRezimu('jen_provoz', async () => {
    const odpoved = await klient.post('/api/poptavky', {
      jmeno: 'Petr Novák',
      email: 'petr@example.invalid',
      telefon: '+420777000111',
      zprava: 'Kdy se dá skákat?',
    });
    assert.equal(odpoved.status, 201);

    assert.equal(odeslane.length, 1, 'provoz se o poptávce musí dozvědět');
    assert.deepEqual(odeslane[0].to, ['provoz@example.invalid']);

    const [[log]] = await pool.query(
      `SELECT prijemce, poptavka_id, telo_text FROM emaily WHERE sablona_klic = 'poptavka_provoz'`
    );
    assert.ok(log, 'upozornění musí být v logu');
    assert.ok(log.poptavka_id, 'log se musí vázat na poptávku');
    // Odkaz vede do administrace, ne na veřejný web.
    assert.match(log.telo_text, /\/admin\/poptavky\/\d+/);
  });
});

test('upozornění na novou přihlášku nevozí po e-mailu váhu ani varování', async () => {
  await nastavProvozEmail('kontakt@example.invalid');
  const { terminId } = await pripravKurzSTerminem();

  await vRezimu('jen_provoz', async () => {
    const odpoved = await klient.post('/api/prihlasky', {
      termin_id: terminId,
      jmeno: 'Martina Dvořáková',
      email: 'martina@example.invalid',
      telefon: '+420777123456',
      ucastnici: [{ jmeno: 'Martina Dvořáková', datum_narozeni: '1990-05-05', vaha_kg: 65 }],
      souhlas_vop: true,
      souhlas_gdpr: true,
      souhlas_zdravi: true,
    });
    assert.equal(odpoved.status, 201);

    const [[provozni]] = await pool.query(
      `SELECT telo_text FROM emaily WHERE sablona_klic = 'prihlaska_provoz'`
    );
    assert.ok(provozni, 'upozornění provozu musí vzniknout');

    assert.doesNotMatch(provozni.telo_text, /65 kg/, 'váha do upozornění nepatří');
    assert.doesNotMatch(provozni.telo_text, /POZOR/, 'varování z limitů do upozornění nepatří');

    // Co tam naopak patří: kontakt a odkaz na detail.
    assert.match(provozni.telo_text, /martina@example\.invalid/);
    assert.match(provozni.telo_text, /\/admin\/prihlasky\/\d+/);
  });
});

// ------------------------------------------- pojistky kolem odesílání

test('odesílatele nejde podstrčit mimo testy', async () => {
  // Pojistka proti tomu, aby se simulace dala zapnout na testovacím webu nebo
  // v produkci. V kontejneru je NODE_ENV=production i na testu, takže tahle
  // podmínka tam platí vždycky.
  const puvodni = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(
      () => posli._podstrcOdesilatel({ maKlienta: () => true, odesli: async () => 'x' }),
      /jen v testech/,
      'mimo testy musí podstrčení skončit výjimkou'
    );
  } finally {
    process.env.NODE_ENV = puvodni;
  }

  // A po neúspěšném pokusu pořád platí ten podstrčený z before() - nic se
  // nerozbilo a skutečný Resend se nevolá.
  await vRezimu('live', async () => {
    const vysledek = await posli.posliEmail({
      prijemce: 'zakaznik@seznam.cz', predmet: 'P', telo: '<p>x</p>',
    });
    assert.equal(vysledek.odeslano, true);
  });
});

test('opakované odeslání má pokaždé jiný Idempotency-Key', async () => {
  const { id } = await vRezimu('jen_provoz', () =>
    posli.posliEmail({
      prijemce: 'zakaznik@seznam.cz',
      predmet: 'Přihláška přijatá',
      telo: '<p>x</p>',
    })
  );

  await vRezimu('live', async () => {
    pouziteKlice = [];

    // První pokus selže, druhý projde. Oba musí mít vlastní klíč - jinak by
    // Resend ten druhý zahodil jako duplicitní a zákazník by nedostal nic.
    pristiOdeslaniSelze = 'Internal server error (500)';
    await posli.odesliZnovu(id);
    await posli.odesliZnovu(id);

    assert.equal(pouziteKlice.length, 2);
    assert.notEqual(pouziteKlice[0], pouziteKlice[1], 'každý pokus má svůj klíč');
    for (const klic of pouziteKlice) {
      assert.match(klic, new RegExp(`^email-${id}-pokus-\\d+$`));
    }
  });

  // Pořadí pokusu se drží v databázi, takže klíč přežije i restart aplikace.
  // Dva pokusy, ne tři: první odeslání v režimu jen_provoz se o nic
  // nepokusilo, jen se uložilo - a co neodešlo, není pokus.
  const [[log]] = await pool.query('SELECT pokusu FROM emaily WHERE id = ?', [id]);
  assert.equal(log.pokusu, 2, 'počítají se jen skutečné pokusy o odeslání');
});

test('první odeslání posílá Idempotency-Key taky', async () => {
  await vRezimu('live', async () => {
    pouziteKlice = [];
    const { id } = await posli.posliEmail({
      prijemce: 'zakaznik@seznam.cz', predmet: 'P', telo: '<p>x</p>',
    });
    assert.deepEqual(pouziteKlice, [`email-${id}-pokus-1`]);
  });
});

// ------------------------------------------------- API hromadné akce
//
// Tyhle testy jdou přes HTTP schválně. Chyba v SQL (chybějící alias tabulky)
// prošla testy, které volaly rovnou funkce - projevila se až v prohlížeči
// jako 500.

test('náhled hromadného rozeslání spočítá jen zákaznické e-maily', async () => {
  await nastavProvozEmail('kontakt@example.invalid');
  const { terminId } = await pripravKurzSTerminem();
  const spravce = await prihlasSpravce();

  await vRezimu('jen_provoz', async () => {
    await klient.post('/api/prihlasky', prihlaskaTelo(terminId));
  });

  const nahled = await vRezimu('live', () => spravce.get('/api/admin/emaily/neodeslane'));

  assert.equal(nahled.status, 200);
  // Vznikly dva záznamy: potvrzení zákazníkovi (neodeslané) a upozornění
  // provozu (odeslané). Do hromadné akce patří jen to první.
  assert.equal(nahled.data.celkem, 1);
  assert.equal(nahled.data.muze_zakaznikovi, true);
  assert.equal(nahled.data.ukazka.length, 1);
  assert.equal(nahled.data.ukazka[0].sablona_klic, 'prihlaska_prijata');
});

test('hromadné rozeslání projde a podruhé už nemá co poslat', async () => {
  await nastavProvozEmail('kontakt@example.invalid');
  const { terminId } = await pripravKurzSTerminem();
  const spravce = await prihlasSpravce();

  await vRezimu('jen_provoz', async () => {
    await klient.post('/api/prihlasky', prihlaskaTelo(terminId));
  });

  await vRezimu('live', async () => {
    odeslane = [];
    const prvni = await spravce.post('/api/admin/emaily/neodeslane/odeslat', {});
    assert.equal(prvni.status, 200);
    assert.equal(prvni.data.odeslano, 1);
    assert.equal(prvni.data.chyby, 0);
    assert.equal(odeslane.length, 1, 'zákazníkovi odejde právě jeden e-mail');

    // Druhé spuštění už nemá co poslat - nic se nezdvojí.
    const druhe = await spravce.post('/api/admin/emaily/neodeslane/odeslat', {});
    assert.equal(druhe.data.odeslano, 0);
    assert.equal(odeslane.length, 1);
  });
});

test('hromadné rozeslání v režimu jen_provoz API odmítne', async () => {
  const spravce = await prihlasSpravce();

  const odpoved = await vRezimu('jen_provoz', () =>
    spravce.post('/api/admin/emaily/neodeslane/odeslat', {})
  );

  assert.equal(odpoved.status, 409);
  assert.match(JSON.stringify(odpoved.data), /jen_provoz|neodes/i);
  assert.equal(odeslane.length, 0);
});

test('období omezí, co se rozešle', async () => {
  const spravce = await prihlasSpravce();

  // Neodeslaný e-mail z loňska, ať je co vyfiltrovat.
  await pool.query(
    `INSERT INTO emaily (sablona_klic, prijemce, predmet, telo_snapshot, stav, rezim, created_at)
     VALUES ('prihlaska_prijata', 'stary@example.invalid', 'Stará přihláška',
             '<p>x</p>', 'neodeslano', 'vypnuto', '2025-01-15 10:00:00')`
  );

  const vsechno = await vRezimu('live', () => spravce.get('/api/admin/emaily/neodeslane'));
  assert.equal(vsechno.data.celkem, 1);

  const letos = await vRezimu('live', () =>
    spravce.get('/api/admin/emaily/neodeslane?od=2026-01-01')
  );
  assert.equal(letos.data.celkem, 0, 'starší e-mail nesmí spadnout do období od letoška');
});

// ------------------------------------------------------------- pomocné

async function prihlasSpravce() {
  const email = 'spravce@example.invalid';
  const heslo = testovaciHeslo();
  await vytvorUzivatele(pool, { email, jmeno: 'Správce', role: 'admin', heslo });
  const spravce = vytvorKlienta(server.url);
  await spravce.get('/api/admin/ja');
  await spravce.post('/api/admin/prihlaseni', { email, heslo });
  return spravce;
}

function prihlaskaTelo(terminId) {
  return {
    termin_id: terminId,
    jmeno: 'Martina Dvořáková',
    email: 'martina@example.invalid',
    telefon: '+420777123456',
    ucastnici: [{ jmeno: 'Martina Dvořáková', datum_narozeni: '1990-05-05', vaha_kg: 65 }],
    souhlas_vop: true,
    souhlas_gdpr: true,
    souhlas_zdravi: true,
  };
}


// Kontaktní e-mail provozu. Bez něj se interní upozornění vůbec neposílá,
// takže ho většina testů níž potřebuje nastavit. Cache nastavení se musí
// zapomenout, jinak si aplikace pamatuje prázdnou hodnotu z předchozího testu.
async function nastavProvozEmail(adresa) {
  const { ulozNastaveni, zapomenCache } = await import('../src/nastaveni.js');
  await ulozNastaveni({ 'provoz.email': adresa });
  zapomenCache();
}

// Kurz s termínem se zakládá přes administraci, ne přímo do databáze -
// stejně jako v ostatních testech. Jde tím i cesta, kterou to opravdu chodí.
async function pripravKurzSTerminem() {
  const email = 'admin@example.invalid';
  const heslo = testovaciHeslo();
  await vytvorUzivatele(pool, { email, jmeno: 'Testovací člověk', role: 'admin', heslo });
  const spravce = vytvorKlienta(server.url);
  await spravce.get('/api/admin/ja');
  await spravce.post('/api/admin/prihlaseni', { email, heslo });

  const { data: kurz } = await spravce.post('/api/admin/produkty', {
    typ: 'kurz', nazev: 'Parašutistický výcvik', cena_hal: 490000,
    min_vek: 15, max_vaha_kg: 95, souhlas_zastupce_do_let: 18,
    vyzaduje_lekarskou_prohlidku: true, aktivni: true,
  });
  const { data: misto } = await spravce.post('/api/admin/mista', { nazev: 'Letiště Jihlava' });
  const { data: termin } = await spravce.post('/api/admin/terminy', {
    produkt_id: kurz.id,
    datum: new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10),
    cas_od: '8:00',
    misto_id: misto.id,
    kapacita_mist: 6,
  });

  return { produktId: kurz.id, terminId: termin.id };
}
