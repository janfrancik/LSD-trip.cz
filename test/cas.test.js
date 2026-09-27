// Formátování času. Všechno v aplikaci - administrace, e-maily, exporty -
// musí ukazovat Europe/Prague, ať běží kdekoli.
//
// Vzniklo z chyby v exportu akceptace: čas vygenerování byl v UTC, časy testů
// v pražském čase, takže souhrn tvrdil, že vznikl hodinu před testy,
// které popisuje.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  datum, datumCas, cas, datumSlovy, isoDatum, okamzik, pred, slozky,
} from '../src/cas.js';

test('DATETIME z databáze se bere jako pražský čas, nepřepočítává se', () => {
  assert.equal(datumCas('2026-09-27 22:49:00'), '27. 9. 2026 22:49');
  assert.equal(datum('2026-09-27 22:49:00'), '27. 9. 2026');
  assert.equal(cas('2026-09-27 22:49:00'), '22:49');
  assert.equal(datumSlovy('2026-09-27'), '27. září 2026');
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

test('pražský čas z databáze se převede zpět na správný okamžik', () => {
  // Letní čas: 22:49 v Praze = 20:49 UTC.
  assert.equal(okamzik('2026-09-27 22:49:00').toISOString(), '2026-09-27T20:49:00.000Z');
  // Zimní čas: 11:00 v Praze = 10:00 UTC.
  assert.equal(okamzik('2026-01-15 11:00:00').toISOString(), '2026-01-15T10:00:00.000Z');
  // Těsně po přechodu na letní čas.
  assert.equal(okamzik('2026-03-29 03:30:00').toISOString(), '2026-03-29T01:30:00.000Z');
});

test('den v názvu souboru je pražský, ne UTC', () => {
  // 23:30 UTC je v Praze už další den.
  assert.equal(isoDatum(new Date('2026-09-27T23:30:00Z')), '2026-09-28');
  assert.equal(isoDatum('2026-09-27 22:49:00'), '2026-09-27');
});

test('„před chvílí" počítá od skutečného okamžiku', () => {
  const ted = new Date('2026-09-27T20:49:00Z'); // 22:49 v Praze
  assert.equal(pred('2026-09-27 22:48:30', ted), 'právě teď');
  assert.equal(pred('2026-09-27 22:44:00', ted), 'před 5 minutami');
  assert.equal(pred('2026-09-27 19:49:00', ted), 'před 3 hodinami');
  assert.equal(pred('2026-09-26 22:49:00', ted), 'včera');
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
      zDb: datumCas('2026-09-27 22:49:00'),
      zUtc: datumCas('2026-09-27T20:49:00Z'),
      den: isoDatum(new Date('2026-09-27T23:30:00Z')),
      okamzik: okamzik('2026-09-27 22:49:00').toISOString(),
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
