// Text, kterým administrace popisuje režim odesílání.
//
// Na produkci se u odpovědi na poptávku ukazovalo „Testovací režim: odpověď
// odejde na testovací adresu", přestože běžel jen_provoz a žádný přepis
// se nedělal. Příčina: poslední větev if/else předpokládala, že zbývá
// už jen `test`. Tenhle test hlídá, že každý režim z REZIMY_EMAILU má
// vlastní popis a že se žádný nepopisuje slovy jiného.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REZIMY_EMAILU, REZIMY_ZAKAZNIKOVI } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Administrace je prostý ES modul, dá se naimportovat i v Node.
const modul = await import(
  'file://' + path.join(rootDir, 'public/admin/assets/js/rezim-emailu.js')
);

test('každý režim má vlastní popis i text varování', () => {
  for (const rezim of REZIMY_EMAILU) {
    const popis = modul.rezimEmailu(rezim);

    assert.ok(popis.nazev, `režim ${rezim} musí mít název`);
    assert.doesNotMatch(
      popis.nazev,
      /neznámý/i,
      `režim ${rezim} spadl do větve pro neznámé - chybí mu vlastní popis`
    );
    assert.ok(popis.tlacitko, `režim ${rezim} musí mít popisek tlačítka`);
  }
});

test('odesilaSe odpovídá tomu, co umí server', () => {
  // Jediná pravda je v config.js. Kdyby administrace tvrdila něco jiného,
  // nabízela by „Odeslat" tam, kde se neodesílá (nebo naopak).
  for (const rezim of REZIMY_EMAILU) {
    assert.equal(
      modul.odesilaSe(rezim),
      REZIMY_ZAKAZNIKOVI.includes(rezim),
      `u režimu ${rezim} se administrace a server rozcházejí v tom, jestli e-mail dojde zákazníkovi`
    );
  }
});

test('jen_provoz se nepopisuje jako testovací přesměrování', () => {
  const popis = modul.rezimEmailu('jen_provoz');

  assert.doesNotMatch(
    popis.varovani,
    /testovac/i,
    'v jen_provoz žádný přepis příjemce neběží - nesmí se to tak jmenovat'
  );
  assert.match(popis.varovani, /neposílaj|neodejde/i, 'musí říct, že zákazníkovi nic nepřijde');
});

test('režim, kde e-mail dojde zákazníkovi, nemá varování', () => {
  for (const rezim of REZIMY_ZAKAZNIKOVI) {
    if (rezim === 'test') continue; // test přesměrovává, takže varování mít má
    assert.equal(
      modul.rezimEmailu(rezim).varovani,
      null,
      `v režimu ${rezim} e-mail dojde, takže není před čím varovat`
    );
  }
});

test('neznámý režim nedostane text jiného režimu', () => {
  const popis = modul.rezimEmailu('neco_co_neexistuje');

  assert.match(popis.nazev, /neznámý/i);
  assert.equal(popis.odesilaSe, false, 'u neznámého režimu se nesmí tvrdit, že se odešle');
});

test('obrazovky nepopisují režim vlastními slovy', () => {
  // Pojistka proti návratu původní chyby: kdyby si obrazovka zase psala
  // vlastní if/else, chyběl by v něm příští přidaný režim.
  const poptavky = readFileSync(
    path.join(rootDir, 'public/admin/assets/js/obrazovky/poptavky.js'),
    'utf8'
  );

  assert.doesNotMatch(
    poptavky,
    /Testovací režim: odpověď odejde/,
    'text režimu patří do rezim-emailu.js, ne do obrazovky'
  );
  assert.match(poptavky, /from '\.\.\/rezim-emailu\.js'/, 'obrazovka má texty brát odtamtud');
});
