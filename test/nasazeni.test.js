// Pořadí kroků při nasazení. Testuje se zdrojový text workflow, ne běh -
// spustit GitHub Actions tady nejde, ale zrovna tohle pořadí se jednou
// rozešlo (nová verze nastartovala nad starým schématem) a je levné ho hlídat.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'),
  'utf8'
);

// Komentáře popisují i to, co se dělat NEMÁ ("obyčejný docker image prune by
// smazal i cizí image"), takže se do kontrol nesmí počítat.
const prikazy = workflow
  .split('\n')
  .filter((radek) => !/^\s*#/.test(radek))
  .join('\n');

test('migrace běží před startem nové verze aplikace', () => {
  const migrace = prikazy.indexOf('docker compose run --rm -T app npm run migrate');
  const start = prikazy.indexOf('docker compose up -d');

  assert.ok(migrace > 0, 'migrace se musí spouštět jednorázovým kontejnerem (run --rm)');
  assert.ok(start > 0, 'někde se musí spustit aplikace');
  assert.ok(
    migrace < start,
    'migrace musí proběhnout PŘED "docker compose up -d", jinak nový kód chvíli běží nad starým schématem'
  );
});

test('migrace se nespouští až v běžící nové aplikaci', () => {
  assert.ok(
    !/docker compose exec[^\n]*npm run migrate/.test(prikazy),
    '"exec ... npm run migrate" znamená, že nová verze už běží - schéma musí být hotové dřív'
  );
});

test('neúspěšná migrace zastaví nasazení', () => {
  assert.match(
    prikazy,
    /if ! docker compose run --rm -T app npm run migrate; then[\s\S]*?exit 1/,
    'při chybě migrace se musí deploy zastavit, aby dál běžela stará verze'
  );
});

test('workflow se nedotýká .env a uklízí jen vlastní image', () => {
  // Pozor na příliš široký vzor: "steps.env.outputs.dir" obsahuje ".env" taky.
  // Kontrolujeme jen to, co se na server nahrává.
  const nahravane = [...prikazy.matchAll(/^\s*source:\s*(.+)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(
    nahravane.filter((z) => z.includes('.env')),
    [],
    '.env na serveru se nikdy nepřepisuje - vytváří ho člověk'
  );
  assert.ok(
    !/docker (system|image) prune/.test(prikazy),
    'prune by smazal i image cizích aplikací, které na VPS běží vedle'
  );
});
