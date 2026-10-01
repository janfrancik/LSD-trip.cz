// Místa a termíny kurzů (etapa E3 modulu Kurzy).
//
// Testy jdou po tom, co se nesmí rozbít: datum termínu je den na kalendáři
// a nesmí se posunout ani přes přechod letního času; hromadné zakládání
// nesmí vyrobit dvojité termíny; zrušení se neobejde bez důvodu a přihlášky
// po něm zůstávají; a kdo smí co, drží matice oprávnění.

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

async function prihlas(role = 'admin') {
  const email = `${role}@example.invalid`;
  await vytvorUzivatele(pool, { email, jmeno: 'Testovací člověk', role, heslo });
  const klient = vytvorKlienta(server.url);
  await klient.get('/api/admin/ja');
  await klient.post('/api/admin/prihlaseni', { email, heslo });
  return klient;
}

async function zalozKurz(klient, nazev = 'Základní kurz') {
  const { data } = await klient.post('/api/admin/produkty', {
    typ: 'kurz', nazev, cena_hal: 490000,
  });
  return data;
}

async function zalozMisto(klient, nazev = 'Letiště Jihlava') {
  const { data } = await klient.post('/api/admin/mista', { nazev, adresa: 'Jihlava' });
  return data;
}

// Datum v budoucnu, ať se termín neschová ve výchozím filtru "od dneška".
function zaDni(pocet) {
  const den = new Date(Date.now() + pocet * 24 * 60 * 60 * 1000);
  return den.toISOString().slice(0, 10);
}

// -------------------------------------------------------------------- místa

test('místo se založí, upraví a smaže měkce', async () => {
  const klient = await prihlas();

  const nove = await klient.post('/api/admin/mista', {
    nazev: 'Letiště Jihlava', adresa: 'Jihlava 586 01', gps_lat: 49.4, gps_lon: 15.6,
  });
  assert.equal(nove.status, 201);
  assert.equal(nove.data.nazev, 'Letiště Jihlava');
  assert.equal(nove.data.aktivni, 1);

  const upravene = await klient.patch(`/api/admin/mista/${nove.data.id}`, { adresa: 'Jihlava' });
  assert.equal(upravene.data.adresa, 'Jihlava');

  const smazane = await klient.del(`/api/admin/mista/${nove.data.id}`);
  assert.equal(smazane.status, 200);

  const seznam = await klient.get('/api/admin/mista');
  assert.equal(seznam.data.data.length, 0, 've výchozím seznamu smazané místo není');

  const koseSeznam = await klient.get('/api/admin/mista?smazane=1');
  assert.equal(koseSeznam.data.data.length, 1);
});

test('nesmyslné souřadnice se odmítnou', async () => {
  const klient = await prihlas();
  const odpoved = await klient.post('/api/admin/mista', { nazev: 'Někde', gps_lat: 999 });

  assert.equal(odpoved.status, 400);
  assert.match(odpoved.data.detaily.gps_lat, /šířka/i);
});

test('místo s budoucími termíny nejde smazat', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const misto = await zalozMisto(klient);
  await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(14), misto_id: misto.id, kapacita_mist: 6,
  });

  const odpoved = await klient.del(`/api/admin/mista/${misto.id}`);
  assert.equal(odpoved.status, 409);
  assert.match(odpoved.data.chyba, /termín/i);
});

// ------------------------------------------------------------------ termíny

test('termín se založí i s časem a místem', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const misto = await zalozMisto(klient);

  const odpoved = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id,
    datum: '2026-05-17',
    cas_od: '8:00',
    cas_do: '18:00',
    misto_id: misto.id,
    kapacita_mist: 6,
    popis: 'Sraz u hangáru.',
  });

  assert.equal(odpoved.status, 201);
  assert.equal(odpoved.data.datum, '2026-05-17', 'datum zůstává dnem na kalendáři');
  assert.equal(odpoved.data.cas_od, '08:00:00', 'čas se doplní na celý tvar');
  assert.equal(odpoved.data.stav, 'otevreno');
  assert.equal(odpoved.data.misto_nazev, 'Letiště Jihlava');
  assert.equal(odpoved.data.obsazeno_mist, 0);
});

test('datum se nerozjede ani přes přechod letního času', async () => {
  // Poslední říjnovou neděli má Praha hodinu 2:00-3:00 dvakrát. Termín na
  // ten den musí zůstat na tom dni, ne spadnout na sousední.
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);

  for (const datum of ['2026-03-29', '2026-10-25']) {
    const { data } = await klient.post('/api/admin/terminy', {
      produkt_id: kurz.id, datum, cas_od: '2:30', kapacita_mist: 4,
    });
    assert.equal(data.datum, datum);
    assert.equal(data.cas_od, '02:30:00');

    const [rows] = await pool.query('SELECT datum, cas_od FROM terminy WHERE id = ?', [data.id]);
    assert.equal(rows[0].datum, datum, 'v databázi je přesně ten den');
    assert.equal(rows[0].cas_od, '02:30:00');
  }
});

test('konec dřív než začátek se odmítne', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);

  const odpoved = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(5), cas_od: '14:00', cas_do: '9:00',
  });
  assert.equal(odpoved.status, 409);
  assert.match(odpoved.data.detaily.cas_do, /po začátku/i);
});

test('termín u neexistujícího kurzu nevznikne', async () => {
  const klient = await prihlas();
  const odpoved = await klient.post('/api/admin/terminy', { produkt_id: 9999, datum: zaDni(3) });

  assert.equal(odpoved.status, 409);
  assert.match(odpoved.data.detaily.produkt_id, /neexistuje/i);
});

test('seznam ukazuje od dneška dál, minulé až na vyžádání', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);

  await klient.post('/api/admin/terminy', { produkt_id: kurz.id, datum: zaDni(-30) });
  await klient.post('/api/admin/terminy', { produkt_id: kurz.id, datum: zaDni(10) });

  const budouci = await klient.get('/api/admin/terminy');
  assert.equal(budouci.data.celkem, 1, 'minulý termín výpis neplní');

  const minule = await klient.get('/api/admin/terminy?minule=1');
  assert.equal(minule.data.celkem, 2);

  const kurzu = await klient.get(`/api/admin/terminy?produkt=${kurz.id}`);
  assert.equal(kurzu.data.celkem, 1);
});

// --------------------------------------------------------------- hromadně

test('hromadné zakládání vytvoří jen vybrané dny v týdnu', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);

  // 1.–31. 5. 2026, jen pátky a soboty.
  const odpoved = await klient.post('/api/admin/terminy/hromadne', {
    produkt_id: kurz.id, od: '2026-05-01', do: '2026-05-31', dny: [5, 6],
    cas_od: '8:00', kapacita_mist: 6, nazev_serie: 'AFF květen',
  });

  assert.equal(odpoved.status, 201);
  assert.equal(odpoved.data.vytvoreno, 10, 'v květnu 2026 je 5 pátků a 5 sobot');

  const [rows] = await pool.query('SELECT datum FROM terminy ORDER BY datum');
  assert.equal(rows[0].datum, '2026-05-01', 'první pátek');
  for (const { datum } of rows) {
    const den = new Date(`${datum}T00:00:00Z`).getUTCDay();
    assert.ok(den === 5 || den === 6, `${datum} není pátek ani sobota`);
  }

  const [[serie]] = await pool.query('SELECT nazev, pravidlo FROM termin_serie');
  assert.equal(serie.nazev, 'AFF květen');
  const pravidlo = typeof serie.pravidlo === 'string' ? JSON.parse(serie.pravidlo) : serie.pravidlo;
  assert.deepEqual(pravidlo.dny, [5, 6], 'z čeho série vznikla, zůstane zapsané');
});

test('hromadné zakládání nepřidá druhý termín na den, kde už je', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  await klient.post('/api/admin/terminy', { produkt_id: kurz.id, datum: '2026-05-02' });

  const odpoved = await klient.post('/api/admin/terminy/hromadne', {
    produkt_id: kurz.id, od: '2026-05-01', do: '2026-05-03',
  });

  assert.equal(odpoved.data.vytvoreno, 2);
  assert.equal(odpoved.data.preskoceno, 1);
  assert.match(odpoved.data.zprava, /vynecháno/i);

  const [[{ pocet }]] = await pool.query(
    "SELECT COUNT(*) AS pocet FROM terminy WHERE datum = '2026-05-02'"
  );
  assert.equal(pocet, 1);
});

test('překlep v roce neudělá tisíce termínů', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);

  const odpoved = await klient.post('/api/admin/terminy/hromadne', {
    produkt_id: kurz.id, od: '2026-05-01', do: '3026-05-01',
  });

  assert.equal(odpoved.status, 409);
  assert.match(odpoved.data.chyba, /dva roky/i);
  const [[{ pocet }]] = await pool.query('SELECT COUNT(*) AS pocet FROM terminy');
  assert.equal(pocet, 0);
});

test('kopie dne vezme i instruktory, ale ne obsazenost', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const misto = await zalozMisto(klient);
  const { data: instruktor } = await klient.post('/api/admin/uzivatele', {
    email: 'petr@example.invalid', jmeno: 'Petr Instruktor', role: 'instruktor',
  });

  const { data: vzor } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: '2026-06-06', cas_od: '8:00', misto_id: misto.id,
    kapacita_mist: 6,
  });
  await klient.put(`/api/admin/terminy/${vzor.id}/instruktori`, {
    instruktori: [{ uzivatel_id: instruktor.id, role: 'aff' }],
  });
  // Jako by na termín někdo byl přihlášený (cache obsazenosti plní E5).
  await pool.query('UPDATE terminy SET obsazeno_mist = 3 WHERE id = ?', [vzor.id]);

  const odpoved = await klient.post(`/api/admin/terminy/${vzor.id}/kopie`, {
    datumy: ['2026-06-13', '2026-06-20'],
  });
  assert.equal(odpoved.status, 201);
  assert.equal(odpoved.data.vytvoreno, 2);

  const [kopie] = await pool.query(
    "SELECT * FROM terminy WHERE datum = '2026-06-13'"
  );
  assert.equal(kopie[0].cas_od, '08:00:00');
  assert.equal(kopie[0].kapacita_mist, 6);
  assert.equal(kopie[0].obsazeno_mist, 0, 'kopíruje se zadání dne, ne jeho průběh');
  assert.equal(kopie[0].stav, 'otevreno');

  const [instruktori] = await pool.query(
    'SELECT uzivatel_id, role FROM termin_instruktori WHERE termin_id = ?',
    [kopie[0].id]
  );
  assert.deepEqual(instruktori, [{ uzivatel_id: instruktor.id, role: 'aff' }]);
});

test('když kopie nemá kam, řekne to rovnou', async () => {
  // "Zkopírováno na 0 termínů" by vypadalo jako chyba, i když je všechno
  // v pořádku - ty dny prostě termín už mají.
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const { data: vzor } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: '2026-06-06',
  });
  await klient.post('/api/admin/terminy', { produkt_id: kurz.id, datum: '2026-06-13' });

  const odpoved = await klient.post(`/api/admin/terminy/${vzor.id}/kopie`, {
    datumy: ['2026-06-13'],
  });

  assert.equal(odpoved.data.vytvoreno, 0);
  assert.match(odpoved.data.zprava, /Nevzniklo nic nového/);
});

// ----------------------------------------------------------------- zrušení

test('zrušení potřebuje důvod a přihlášky nechá být', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const { data: termin } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(20), kapacita_mist: 6,
  });
  await pool.query('UPDATE terminy SET obsazeno_mist = 2 WHERE id = ?', [termin.id]);

  const bezDuvodu = await klient.post(`/api/admin/terminy/${termin.id}/zrusit`, {});
  assert.equal(bezDuvodu.status, 400);

  const zruseni = await klient.post(`/api/admin/terminy/${termin.id}/zrusit`, {
    duvod: 'Nepřeje počasí.',
  });
  assert.equal(zruseni.status, 200);
  assert.equal(zruseni.data.stav, 'zruseno');
  assert.equal(zruseni.data.zruseno_duvod, 'Nepřeje počasí.');
  assert.ok(zruseni.data.zruseno_at, 'kdy se zrušilo, se zapíše');

  const [[po]] = await pool.query('SELECT obsazeno_mist FROM terminy WHERE id = ?', [termin.id]);
  assert.equal(po.obsazeno_mist, 2, 'přihlášky zrušením termínu nemizí');
});

test('zrušený termín jde zase otevřít a důvod zmizí', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const { data: termin } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(20),
  });
  await klient.post(`/api/admin/terminy/${termin.id}/zrusit`, { duvod: 'Nepřeje počasí.' });

  const znovu = await klient.patch(`/api/admin/terminy/${termin.id}`, { stav: 'otevreno' });
  assert.equal(znovu.data.stav, 'otevreno');
  assert.equal(znovu.data.zruseno_duvod, null, 'u živého termínu nesmí svítit důvod zrušení');
  assert.equal(znovu.data.zruseno_at, null);
});

test('zrušit se přes běžnou úpravu nedá', async () => {
  // Jinak by šlo termín zrušit bez důvodu a nikdo by se nedozvěděl proč.
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const { data: termin } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(20),
  });

  const odpoved = await klient.patch(`/api/admin/terminy/${termin.id}`, { stav: 'zruseno' });
  assert.equal(odpoved.status, 400);
  assert.match(odpoved.data.chyba, /důvod/i);
});

test('kapacitu nejde snížit pod počet přihlášených', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const { data: termin } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(20), kapacita_mist: 6,
  });
  await pool.query('UPDATE terminy SET obsazeno_mist = 4 WHERE id = ?', [termin.id]);

  const odpoved = await klient.patch(`/api/admin/terminy/${termin.id}`, { kapacita_mist: 2 });
  assert.equal(odpoved.status, 409);
  assert.match(odpoved.data.detaily.kapacita_mist, /přihlášeno 4/);
});

test('termín s přihlášenými se nemaže, jen ruší', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const { data: termin } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(20), kapacita_mist: 6,
  });
  await pool.query('UPDATE terminy SET obsazeno_mist = 1 WHERE id = ?', [termin.id]);

  const odpoved = await klient.del(`/api/admin/terminy/${termin.id}`);
  assert.equal(odpoved.status, 409);
  assert.match(odpoved.data.chyba, /Zrušit termín/i);
});

// ------------------------------------------------------------- instruktoři

test('instruktoři se uloží celým seznamem a dvojí zápis se spojí', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);
  const { data: termin } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(9),
  });
  const { data: clovek } = await klient.post('/api/admin/uzivatele', {
    email: 'tomas@example.invalid', jmeno: 'Tomáš Balič', role: 'instruktor',
  });

  const po = await klient.put(`/api/admin/terminy/${termin.id}/instruktori`, {
    instruktori: [
      { uzivatel_id: clovek.id, role: 'aff' },
      { uzivatel_id: clovek.id, role: 'aff' },
      { uzivatel_id: clovek.id, role: 'balic' },
    ],
  });

  assert.equal(po.status, 200);
  assert.equal(po.data.instruktori.length, 2, 'tentýž člověk v téže roli jen jednou');
  assert.deepEqual(po.data.instruktori.map((i) => i.role).sort(), ['aff', 'balic']);
  assert.equal(po.data.instruktori[0].jmeno, 'Tomáš Balič');

  const prazdny = await klient.put(`/api/admin/terminy/${termin.id}/instruktori`, {
    instruktori: [],
  });
  assert.equal(prazdny.data.instruktori.length, 0);
});

test('seznam lidí k přiřazení vidí i provoz a nejsou v něm hesla', async () => {
  const sefka = await prihlas('admin');
  await sefka.post('/api/admin/uzivatele', {
    email: 'jan@example.invalid', jmeno: 'Jan Instruktor', role: 'instruktor',
  });

  const provoz = await prihlas('provoz');
  const odpoved = await provoz.get('/api/admin/terminy/instruktori');

  assert.equal(odpoved.status, 200, 'provoz musí mít koho přiřadit, i když na uživatele nevidí');
  const jmena = odpoved.data.data.map((u) => u.jmeno);
  assert.ok(jmena.includes('Jan Instruktor'));
  for (const u of odpoved.data.data) {
    assert.deepEqual(Object.keys(u).sort(), ['id', 'jmeno', 'role']);
  }

  // Na plný seznam uživatelů provoz nemá právo a to se nemění.
  assert.equal((await provoz.get('/api/admin/uzivatele')).status, 403);
});

// ------------------------------------------------------------------ ostatní

test('proběhlé termíny se označí samy', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);

  const { data: vcera } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(-1),
  });
  const { data: zitra } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(1),
  });
  const { data: zruseny } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(-2),
  });
  await klient.post(`/api/admin/terminy/${zruseny.id}/zrusit`, { duvod: 'Nepřeje počasí.' });

  const { oznacProbehleTerminy } = await import('../src/terminy.js');
  assert.equal(await oznacProbehleTerminy(), 1);

  const [rows] = await pool.query('SELECT id, stav FROM terminy ORDER BY id');
  const stavy = Object.fromEntries(rows.map((r) => [r.id, r.stav]));
  assert.equal(stavy[vcera.id], 'probehlo');
  assert.equal(stavy[zitra.id], 'otevreno');
  assert.equal(stavy[zruseny.id], 'zruseno', 'zrušený termín zůstane zrušený');
});

test('soupiska je zatím prázdná, ale hlavičku termínu už má', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient, 'Kurz AFF');
  const misto = await zalozMisto(klient);
  const { data: termin } = await klient.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(7), cas_od: '8:00', misto_id: misto.id, kapacita_mist: 6,
  });

  const odpoved = await klient.get(`/api/admin/terminy/${termin.id}/soupiska`);
  assert.equal(odpoved.status, 200);
  assert.equal(odpoved.data.termin.produkt_nazev, 'Kurz AFF');
  assert.deepEqual(odpoved.data.ucastnici, []);
  assert.equal(odpoved.data.pocty.volno, 6);
});

test('údržba termíny opravdu přepíná, nejen to umí', async () => {
  const { readFile } = await import('node:fs/promises');
  const udrzba = await readFile(new URL('../src/udrzba.js', import.meta.url), 'utf8');
  assert.match(udrzba, /oznacProbehleTerminy/, 'src/udrzba.js musí proběhlé termíny označovat');
});

// --------------------------------------------------------------- oprávnění

test('bez přihlášení termíny nikdo nevidí ani nemění', async () => {
  const host = vytvorKlienta(server.url);
  await host.get('/api/admin/ja'); // CSRF token

  assert.equal((await host.get('/api/admin/terminy')).status, 401);
  assert.equal((await host.post('/api/admin/terminy', { produkt_id: 1, datum: '2026-05-01' })).status, 401);
  assert.equal((await host.post('/api/admin/mista', { nazev: 'Kdeco' })).status, 401);
});

test('bez CSRF tokenu zápis neprojde', async () => {
  const klient = await prihlas();
  const kurz = await zalozKurz(klient);

  const odpoved = await fetch(`${server.url}/api/admin/terminy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ produkt_id: kurz.id, datum: '2026-05-01' }),
  });
  assert.equal(odpoved.status, 403);
});

test('provoz termíny spravuje, instruktor je jen čte', async () => {
  const sefka = await prihlas('admin');
  const kurz = await zalozKurz(sefka);

  const provoz = await prihlas('provoz');
  const zalozeni = await provoz.post('/api/admin/terminy', {
    produkt_id: kurz.id, datum: zaDni(15), kapacita_mist: 6,
  });
  assert.equal(zalozeni.status, 201, 'provoz termíny zakládá');
  assert.equal((await provoz.post('/api/admin/mista', { nazev: 'Nové letiště' })).status, 201);

  const instruktor = await prihlas('instruktor');
  assert.equal((await instruktor.get('/api/admin/terminy')).status, 200);
  assert.equal(
    (await instruktor.post('/api/admin/terminy', { produkt_id: kurz.id, datum: zaDni(16) })).status,
    403,
    'instruktor termíny nezakládá'
  );
  assert.equal(
    (await instruktor.post(`/api/admin/terminy/${zalozeni.data.id}/zrusit`, { duvod: 'Jen tak' })).status,
    403
  );
});
