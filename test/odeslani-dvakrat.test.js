// Ochrana proti dvojímu odeslání a podoba upozornění pro provoz.
//
// Vzniklo po prvním ostrém testu na produkci: formulář po odeslání nedal
// najevo, že se něco stalo, takže člověk klikl znovu - a provoz měl dvě
// stejné poptávky. Obrana je na serveru, protože na tlačítko se spolehnout
// nedá (dvojklik, zpátky v prohlížeči, mobilní síť, která požadavek zopakuje).

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
let odeslane = [];

before(async () => {
  await pripravDatabazi();
  pool = (await import('../src/db.js')).default;
  config = (await import('../src/config.js')).default;
  posli = await import('../src/email/posli.js');

  posli._podstrcOdesilatel({
    maKlienta: () => true,
    async odesli(zprava) {
      odeslane.push(zprava);
      return `podstrceny-${odeslane.length}-${Date.now()}`;
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
  const { ulozNastaveni, zapomenCache } = await import('../src/nastaveni.js');
  await ulozNastaveni({ 'provoz.email': 'provoz@example.invalid' });
  zapomenCache();
  odeslane = [];
});

// --------------------------------------------------------- dvojí odeslání

test('dvě stejné poptávky za sebou se uloží jednou', async () => {
  const telo = {
    jmeno: 'Jan Francik',
    email: 'jan@example.invalid',
    zprava: 'Kdy se dá skákat?',
  };

  const prvni = await klient.post('/api/poptavky', telo);
  const druha = await klient.post('/api/poptavky', telo);

  // Zákazník nemá poznat, že se jeho druhé kliknutí zahodilo.
  assert.equal(prvni.status, 201);
  assert.equal(druha.status, 201);
  assert.deepEqual(druha.data, prvni.data, 'odpověď musí být stejná jako poprvé');

  const [poptavky] = await pool.query('SELECT id FROM poptavky WHERE email = ?', [telo.email]);
  assert.equal(poptavky.length, 1, 'v databázi smí být jen jedna');

  // A provoz dostane jedno upozornění, ne dvě.
  const [upozorneni] = await pool.query(
    `SELECT id FROM emaily WHERE sablona_klic = 'poptavka_provoz'`
  );
  assert.equal(upozorneni.length, 1);
});

test('jiný text od téhož člověka je nová poptávka', async () => {
  await klient.post('/api/poptavky', {
    jmeno: 'Jan Francik', email: 'jan@example.invalid', zprava: 'První dotaz.',
  });
  await klient.post('/api/poptavky', {
    jmeno: 'Jan Francik', email: 'jan@example.invalid', zprava: 'Ještě něco jiného.',
  });

  const [poptavky] = await pool.query('SELECT id FROM poptavky WHERE email = ?', [
    'jan@example.invalid',
  ]);
  assert.equal(poptavky.length, 2, 'dvě různé zprávy nejsou duplicita');
});

test('stejná zpráva po deseti minutách projde znovu', async () => {
  const telo = { jmeno: 'Jan Francik', email: 'jan@example.invalid', zprava: 'Dotaz.' };
  await klient.post('/api/poptavky', telo);

  // Posuneme tu první do minulosti, ať se nemusí čekat.
  await pool.query(
    'UPDATE poptavky SET created_at = DATE_SUB(NOW(), INTERVAL 11 MINUTE) WHERE email = ?',
    [telo.email]
  );

  await klient.post('/api/poptavky', telo);

  const [poptavky] = await pool.query('SELECT id FROM poptavky WHERE email = ?', [telo.email]);
  assert.equal(poptavky.length, 2, 'po deseti minutách už to není dvojklik');
});

test('dvě stejné přihlášky za sebou zaberou jedno místo', async () => {
  const { terminId } = await pripravKurzSTerminem();
  const telo = prihlaskaTelo(terminId);

  const prvni = await klient.post('/api/prihlasky', telo);
  const druha = await klient.post('/api/prihlasky', telo);

  assert.equal(prvni.status, 201);
  assert.equal(druha.status, 201);
  assert.equal(druha.data.kod, prvni.data.kod, 'musí se vrátit táž přihláška');
  assert.equal(druha.data.odkaz, prvni.data.odkaz);

  const [rezervace] = await pool.query('SELECT id FROM rezervace');
  assert.equal(rezervace.length, 1, 'druhá přihláška nesmí vzniknout');

  // A hlavně: nesmí zabrat druhé místo na termínu.
  const [[termin]] = await pool.query('SELECT obsazeno_mist FROM terminy WHERE id = ?', [terminId]);
  assert.equal(termin.obsazeno_mist, 1, 'dvojklik nesmí ukrojit dvě místa');
});

test('tentýž člověk se může přihlásit na jiný termín', async () => {
  const { terminId, druhyTerminId } = await pripravKurzSTerminem();

  await klient.post('/api/prihlasky', prihlaskaTelo(terminId));
  const druha = await klient.post('/api/prihlasky', prihlaskaTelo(druhyTerminId));

  assert.equal(druha.status, 201);
  const [rezervace] = await pool.query('SELECT id FROM rezervace');
  assert.equal(rezervace.length, 2, 'jiný termín není duplicita');
});

// ------------------------------------------------ podoba upozornění provozu

test('upozornění má Reply-To na zákazníka', async () => {
  const { terminId } = await pripravKurzSTerminem();

  await vRezimu('live', async () => {
    await klient.post('/api/prihlasky', prihlaskaTelo(terminId));
  });

  const provozni = odeslane.find((z) => z.subject.includes('přihláška'));
  assert.ok(provozni, 'upozornění provozu musí odejít');
  assert.equal(
    provozni.replyTo,
    'martina@example.invalid',
    'Odpovědět v poště musí jít rovnou zákazníkovi'
  );

  // Zákaznický e-mail naopak Reply-To na sebe sama nemá.
  const zakaznicky = odeslane.find((z) => z.to[0] === 'martina@example.invalid');
  assert.ok(zakaznicky);
  assert.equal(zakaznicky.replyTo, undefined);
});

test('upozornění na poptávku má Reply-To a prefix v předmětu', async () => {
  await vRezimu('live', async () => {
    await klient.post('/api/poptavky', {
      jmeno: 'Jan Francik', email: 'jan@example.invalid', zprava: 'Dotaz.',
    });
  });

  assert.equal(odeslane.length, 1);
  assert.equal(odeslane[0].replyTo, 'jan@example.invalid');
  assert.match(odeslane[0].subject, /^\[LSD\] Nová poptávka: Jan Francik$/);
});

test('upozornění chodí pod jménem LSD web, ale z adresy z nastavení', async () => {
  const { odesilatelProvozu } = await import('../src/email/posli.js');

  const puvodni = config.EMAIL_ODESILATEL;
  try {
    config.EMAIL_ODESILATEL = 'LSD <rezervace@example.invalid>';
    assert.equal(odesilatelProvozu(), 'LSD web <rezervace@example.invalid>');

    // I když je v .env jen holá adresa.
    config.EMAIL_ODESILATEL = 'rezervace@example.invalid';
    assert.equal(odesilatelProvozu(), 'LSD web <rezervace@example.invalid>');
  } finally {
    config.EMAIL_ODESILATEL = puvodni;
  }
});

test('prázdné údaje se do upozornění nepíšou', async () => {
  // Telefon nevyplněný - v e-mailu nesmí zůstat holé "Telefon:".
  await vRezimu('live', async () => {
    await klient.post('/api/poptavky', {
      jmeno: 'Jan Francik', email: 'jan@example.invalid', zprava: 'Dotaz bez telefonu.',
    });
  });

  const [[log]] = await pool.query(
    `SELECT telo_text FROM emaily WHERE sablona_klic = 'poptavka_provoz'`
  );
  assert.doesNotMatch(log.telo_text, /Telefon:\s*$/m, 'prázdný řádek s telefonem musí zmizet');
  assert.doesNotMatch(log.telo_text, /Telefon:\s*\n/, 'ani s koncem řádku');
  // Co hodnotu má, zůstává.
  assert.match(log.telo_text, /jan@example\.invalid/);
});

test('vyplněný telefon v upozornění zůstane', async () => {
  await vRezimu('live', async () => {
    await klient.post('/api/poptavky', {
      jmeno: 'Jan Francik', email: 'jan@example.invalid',
      telefon: '+420777123456', zprava: 'Dotaz s telefonem.',
    });
  });

  const [[log]] = await pool.query(
    `SELECT telo_text FROM emaily WHERE sablona_klic = 'poptavka_provoz'`
  );
  assert.match(log.telo_text, /Telefon: \+420777123456/);
});

// --------------------------------------------- odpověď na poptávku v administraci

test('v jen_provoz se odpověď uloží a server řekne, že to bylo záměrně', async () => {
  const [vlozeno] = await pool.query(
    `INSERT INTO poptavky (jmeno, email, zprava) VALUES ('Jan', 'jan@example.invalid', 'Dotaz?')`
  );
  const spravce = await prihlasSpravce();

  const odpoved = await vRezimu('jen_provoz', () =>
    spravce.post(`/api/admin/poptavky/${vlozeno.insertId}/odpovedet`, {
      odpoved: 'V srpnu máme volno 14. a 21.',
    })
  );

  assert.equal(odpoved.status, 200);
  assert.equal(odpoved.data.odeslano, false);
  assert.equal(odpoved.data.zamerne, true, 'není to chyba, je to nastavení');
  assert.doesNotMatch(odpoved.data.zprava, /zkontroluj/i, 'nemá se posílat hledat chybu');

  // Odpověď se uložila do historie, jako kdyby odešla.
  const [[poptavka]] = await pool.query('SELECT odpoved, stav FROM poptavky WHERE id = ?', [
    vlozeno.insertId,
  ]);
  assert.match(poptavka.odpoved, /V srpnu máme volno/);
});

test('skutečná chyba odeslání se jako záměr netváří', async () => {
  const [vlozeno] = await pool.query(
    `INSERT INTO poptavky (jmeno, email, zprava) VALUES ('Jan', 'jan@example.invalid', 'Dotaz?')`
  );
  const spravce = await prihlasSpravce();

  const odpoved = await vRezimu('live', async () => {
    posli._podstrcOdesilatel({
      maKlienta: () => true,
      odesli: async () => { throw new Error('Internal server error (500)'); },
    });
    return spravce.post(`/api/admin/poptavky/${vlozeno.insertId}/odpovedet`, {
      odpoved: 'Text odpovědi.',
    });
  });

  assert.equal(odpoved.data.odeslano, false);
  assert.equal(odpoved.data.zamerne, false, 'chyba není záměr - okno se ukázat má');

  // Vrátit podstrčeného odesílatele pro další testy.
  posli._podstrcOdesilatel({
    maKlienta: () => true,
    async odesli(zprava) {
      odeslane.push(zprava);
      return `podstrceny-${odeslane.length}-${Date.now()}`;
    },
  });
});

// ------------------------------------------------------------- pomocné

async function vRezimu(rezim, telo) {
  const a = config.EMAIL_REZIM;
  const b = config.muzeZakaznikovi;
  const c = config.EMAIL_PROVOZ_PRIJEMCE;
  config.EMAIL_REZIM = rezim;
  config.muzeZakaznikovi = ['live', 'test'].includes(rezim);
  if (rezim === 'jen_provoz') config.EMAIL_PROVOZ_PRIJEMCE = 'provoz@example.invalid';
  try {
    return await telo();
  } finally {
    config.EMAIL_REZIM = a;
    config.muzeZakaznikovi = b;
    config.EMAIL_PROVOZ_PRIJEMCE = c;
  }
}

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

async function pripravKurzSTerminem() {
  const email = 'admin@example.invalid';
  const heslo = testovaciHeslo();
  await vytvorUzivatele(pool, { email, jmeno: 'Admin', role: 'admin', heslo });
  const spravce = vytvorKlienta(server.url);
  await spravce.get('/api/admin/ja');
  await spravce.post('/api/admin/prihlaseni', { email, heslo });

  const { data: kurz } = await spravce.post('/api/admin/produkty', {
    typ: 'kurz', nazev: 'Parašutistický výcvik', cena_hal: 490000,
    min_vek: 15, max_vaha_kg: 95, souhlas_zastupce_do_let: 18,
    vyzaduje_lekarskou_prohlidku: true, aktivni: true,
  });
  const { data: misto } = await spravce.post('/api/admin/mista', { nazev: 'Letiště Jihlava' });

  const den = (za) => new Date(Date.now() + za * 86400000).toISOString().slice(0, 10);
  const { data: termin } = await spravce.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: den(21), cas_od: '8:00', misto_id: misto.id, kapacita_mist: 6,
  });
  const { data: druhy } = await spravce.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: den(28), cas_od: '8:00', misto_id: misto.id, kapacita_mist: 6,
  });

  return { terminId: termin.id, druhyTerminId: druhy.id };
}
