// Formátování času. Všechno v aplikaci - administrace, e-maily, exporty -
// musí ukazovat Europe/Prague, ať běží kdekoli.
//
// Vzniklo z chyby v exportu akceptace: čas vygenerování byl v UTC, časy testů
// v pražském čase, takže souhrn tvrdil, že vznikl hodinu před testy,
// které popisuje.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pripravDatabazi, vycistiData } from './pomocnik.js';
import {
  datum, datumCas, cas, datumSlovy, isoDatum, okamzik, pred, slozky,
} from '../src/cas.js';

let pool;

before(async () => {
  await pripravDatabazi();
  pool = (await import('../src/db.js')).default;
});

after(async () => {
  await pool.end();
});

test('DATETIME z databáze je UTC a zobrazuje se v pražském čase', () => {
  // Letní čas: v databázi 20:49 UTC, na hodinách v Praze 22:49.
  assert.equal(datumCas('2026-09-27 20:49:00'), '27. 9. 2026 22:49');
  assert.equal(datum('2026-09-27 20:49:00'), '27. 9. 2026');
  assert.equal(cas('2026-09-27 20:49:00'), '22:49');
  // Zimní čas: +1 hodina.
  assert.equal(datumCas('2026-01-15 10:00:00'), '15. 1. 2026 11:00');
  assert.equal(datumSlovy('2026-09-27'), '27. září 2026');
});

test('nejednoznačná hodina při přechodu na zimní čas je v UTC jednoznačná', () => {
  // Tohle je důvod, proč se v databázi drží UTC: "2026-10-25 02:30" pražského
  // času jsou dva různé okamžiky hodinu od sebe. V UTC se nepletou.
  const prvni = '2026-10-25 00:30:00'; // ještě letní čas
  const druhy = '2026-10-25 01:30:00'; // už zimní
  assert.equal(datumCas(prvni), '25. 10. 2026 2:30');
  assert.equal(datumCas(druhy), '25. 10. 2026 2:30');
  assert.equal(
    okamzik(druhy).getTime() - okamzik(prvni).getTime(),
    60 * 60 * 1000,
    'stejný čas na hodinách, ale okamžiky jsou hodinu od sebe'
  );
});

test('okamžik v UTC se převede do pražského času', () => {
  // Letní čas: +2 hodiny.
  assert.equal(datumCas('2026-09-27T20:49:00.000Z'), '27. 9. 2026 22:49');
  assert.equal(datumCas(new Date('2026-09-27T20:49:00Z')), '27. 9. 2026 22:49');
  // Zimní čas: +1 hodina.
  assert.equal(datumCas(new Date('2026-01-15T10:00:00Z')), '15. 1. 2026 11:00');
});

test('přechod na letní čas (poslední březnová neděle)', () => {
  // V 2:00 SEČ se přeskočí na 3:00 SELČ.
  assert.equal(datumCas('2026-03-29T00:30:00Z'), '29. 3. 2026 1:30', 'ještě zimní čas');
  assert.equal(datumCas('2026-03-29T01:30:00Z'), '29. 3. 2026 3:30', 'už letní čas');
});

test('přechod na zimní čas (poslední říjnová neděle)', () => {
  // Hodina 2:00-3:00 proběhne dvakrát; obojí se ukáže jako 2:30 - to je správně,
  // víc rozlišit nejde a pro provoz to nevadí.
  assert.equal(datumCas('2026-10-25T00:30:00Z'), '25. 10. 2026 2:30', 'letní čas');
  assert.equal(datumCas('2026-10-25T01:30:00Z'), '25. 10. 2026 2:30', 'zimní čas');
});

test('čas z databáze se čte jako UTC, ne jako místní čas stroje', () => {
  assert.equal(okamzik('2026-09-27 20:49:00').toISOString(), '2026-09-27T20:49:00.000Z');
  assert.equal(okamzik('2026-01-15 10:00:00').toISOString(), '2026-01-15T10:00:00.000Z');
});

test('proDb vrací tvar pro databázi v UTC', async () => {
  const { proDb } = await import('../src/cas.js');
  assert.equal(proDb(new Date('2026-09-27T20:49:00Z')), '2026-09-27 20:49:00');
  assert.equal(proDb('2026-09-27 20:49:00'), '2026-09-27 20:49:00');
  assert.equal(proDb(null), null);
});

test('den v názvu souboru je pražský, ne UTC', () => {
  // 23:30 UTC je v Praze už další den.
  assert.equal(isoDatum(new Date('2026-09-27T23:30:00Z')), '2026-09-28');
  assert.equal(isoDatum('2026-09-27 23:30:00'), '2026-09-28');
  assert.equal(isoDatum('2026-09-27 20:49:00'), '2026-09-27');
});

test('„před chvílí" počítá od skutečného okamžiku', () => {
  const ted = new Date('2026-09-27T20:49:00Z'); // 22:49 v Praze
  assert.equal(pred('2026-09-27 20:48:30', ted), 'právě teď');
  assert.equal(pred('2026-09-27 20:44:00', ted), 'před 5 minutami');
  assert.equal(pred('2026-09-27 17:49:00', ted), 'před 3 hodinami');
  assert.equal(pred('2026-09-26 20:49:00', ted), 'včera');
});

test('nesmysl nebo prázdno nevrací „Invalid Date"', () => {
  for (const nic of [null, undefined, '', 'tohle není datum']) {
    assert.equal(datumCas(nic), '—');
    assert.equal(slozky(nic), null);
  }
});

test('výsledek nezávisí na časové zóně stroje', () => {
  // Kontejner má TZ=Europe/Prague, ale testy můžou běžet kdekoli a někdo si
  // někdy pustí skript ručně. Formátování se proto nesmí opírat o zónu procesu.
  const skript = `
    const { datumCas, isoDatum, okamzik } = await import('./src/cas.js');
    console.log(JSON.stringify({
      zDb: datumCas('2026-09-27 20:49:00'),
      zUtc: datumCas('2026-09-27T20:49:00Z'),
      den: isoDatum(new Date('2026-09-27T23:30:00Z')),
      okamzik: okamzik('2026-09-27 20:49:00').toISOString(),
    }));
  `;

  for (const zona of ['America/New_York', 'Asia/Tokyo', 'UTC']) {
    const vystup = execFileSync(process.execPath, ['--input-type=module', '-e', skript], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, TZ: zona },
    });

    assert.deepEqual(
      JSON.parse(vystup.trim().split('\n').pop()),
      {
        zDb: '27. 9. 2026 22:49',
        zUtc: '27. 9. 2026 22:49',
        den: '2026-09-28',
        okamzik: '2026-09-27T20:49:00.000Z',
      },
      `v zóně ${zona} musí vyjít to samé`
    );
  }
});

// ------------------------------------------------------------- proti databázi

test('spojení do databáze běží v UTC', async () => {
  const [[r]] = await pool.query(
    'SELECT @@session.time_zone AS zona, NOW() AS ted, UTC_TIMESTAMP() AS utc'
  );
  assert.equal(r.zona, '+00:00', 'bez toho by NOW() psalo čas podle zóny serveru');
  assert.equal(r.ted, r.utc, 'NOW() musí být totéž co UTC_TIMESTAMP()');
});

test('okamžik uložený do databáze se přečte jako tentýž okamžik', async () => {
  await vycistiData(pool);

  // Okamžik v létě (Praha +2) i v zimě (+1) - kdyby se někde ztratila zóna,
  // rozdíl se pozná právě tady.
  for (const iso of ['2026-07-15T10:00:00.000Z', '2026-01-15T10:00:00.000Z']) {
    const puvodni = new Date(iso);
    const [vysledek] = await pool.query(
      'INSERT INTO poptavky (jmeno, email, zprava, created_at) VALUES (?, ?, ?, ?)',
      ['Zkouška času', 'cas@example.invalid', 'test', puvodni]
    );

    const [[radek]] = await pool.query('SELECT created_at FROM poptavky WHERE id = ?', [
      vysledek.insertId,
    ]);

    assert.equal(
      okamzik(radek.created_at).getTime(),
      puvodni.getTime(),
      `okamžik ${iso} se má uložit i přečíst beze změny`
    );
  }

  // A ten samý údaj se člověku ukáže v pražském čase.
  const [[letni]] = await pool.query(
    "SELECT created_at FROM poptavky WHERE created_at = '2026-07-15 10:00:00'"
  );
  assert.equal(datumCas(letni.created_at), '15. 7. 2026 12:00');
});

test('NOW() v databázi a Date.now() v aplikaci jdou stejně', async () => {
  const [[r]] = await pool.query('SELECT NOW() AS ted');
  const rozdil = Math.abs(okamzik(r.ted).getTime() - Date.now());
  assert.ok(rozdil < 5000, `čas databáze a aplikace se liší o ${rozdil} ms`);
});

// -------------------------------------------- kalendářní dny (den na papíře)

test('dny v rozsahu nepřeskočí ani nezopakují den na přechodu letního času', async () => {
  const { datumyVRozsahu, oDniDal, pocetDni } = await import('../src/cas.js');

  // V Praze se 29. 3. 2026 přechází na letní čas a 25. 10. zpátky. Den na
  // kalendáři to nesmí posunout - "17. 5." je 17. 5. bez ohledu na zónu.
  const jaro = datumyVRozsahu('2026-03-28', '2026-03-30');
  assert.deepEqual(jaro, ['2026-03-28', '2026-03-29', '2026-03-30']);

  const podzim = datumyVRozsahu('2026-10-24', '2026-10-26');
  assert.deepEqual(podzim, ['2026-10-24', '2026-10-25', '2026-10-26']);

  assert.equal(oDniDal('2026-03-28', 1), '2026-03-29');
  assert.equal(oDniDal('2026-10-24', 7), '2026-10-31');
  assert.equal(pocetDni('2026-03-28', '2026-03-30'), 3);
});

test('dny v týdnu se vybírají podle ISO, pondělí je jednička', async () => {
  const { datumyVRozsahu, denVTydnu } = await import('../src/cas.js');

  assert.equal(denVTydnu('2026-05-01'), 5, '1. 5. 2026 je pátek');
  assert.equal(denVTydnu('2026-05-03'), 7, 'neděle je sedmička, ne nula');

  const patkyASoboty = datumyVRozsahu('2026-05-01', '2026-05-31', [5, 6]);
  assert.equal(patkyASoboty.length, 10);
  assert.equal(patkyASoboty[0], '2026-05-01');
  assert.equal(patkyASoboty.at(-1), '2026-05-30');

  // Prázdný výběr = všechny dny.
  assert.equal(datumyVRozsahu('2026-05-01', '2026-05-31').length, 31);
  // Obrácený rozsah nevrátí nic, místo aby se zacyklil.
  assert.deepEqual(datumyVRozsahu('2026-05-31', '2026-05-01'), []);
});
