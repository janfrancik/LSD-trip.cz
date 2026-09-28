// Pořadí kroků při nasazení. Testuje se zdrojový text workflow, ne běh -
// spustit GitHub Actions tady nejde, ale zrovna tohle pořadí se jednou
// rozešlo (nová verze nastartovala nad starým schématem) a je levné ho hlídat.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

test('deploy počká, až aplikace opravdu běží', () => {
  // "up -d" se vrátí hned po spuštění kontejneru. Bez čekání na healthcheck
  // by deploy hlásil úspěch i u aplikace, která se točí v restartu kvůli
  // chybě v .env - přesně to se stalo při přepnutí na EMAIL_REZIM=schranka.
  assert.match(
    prikazy,
    /docker inspect[^\n]*State\.Health\.Status/,
    'po up -d se musí čekat na stav healthy'
  );
  assert.match(prikazy, /docker compose logs --tail 50 app/, 'při nezdaru vypsat log');

  const cekani = prikazy.indexOf('State.Health.Status');
  const start = prikazy.indexOf('docker compose up -d');
  assert.ok(cekani > start, 'čeká se až po startu, ne před ním');

  const padne = prikazy.slice(cekani).match(/exit 1/);
  assert.ok(padne, 'když kontejner nenaběhne, deploy musí selhat');
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

// --------------------------------------------------- zpětná kompatibilita migrací
//
// Migrace běží před startem nové verze, takže mezi migrací a záměnou kontejneru
// chvíli běží STARÁ aplikace nad NOVÝM schématem. Odebrání sloupce nebo tabulky
// ji v tu chvíli shodí. Patří proto až do dalšího nasazení (expand/contract,
// viz CLAUDE.md).
//
// Test není chytrý - hlídá jen to, že se takový příkaz nedostane do migrace
// omylem. Když je odebrání opravdu na řadě (contract krok, předchozí verze už
// sloupec nepoužívá), připíše se soubor sem i s důvodem.
const ODEBRANI_SCHVALENA = {
  // Sloupec `vyrizeno` nahradil `stav`. Prošlo to jen proto, že produkční
  // databáze byla prázdná a testovací prostředí ještě neexistovalo.
  '003_emaily_poptavky.sql': ['DROP COLUMN'],
};

const migraceDir = path.join(__dirname, '..', 'migrations');

test('migrace nemažou a nepřejmenovávají sloupce ani tabulky', () => {
  const nebezpecne = [/DROP\s+COLUMN/i, /DROP\s+TABLE/i, /RENAME\s+COLUMN/i, /RENAME\s+TABLE/i, /CHANGE\s+COLUMN/i];

  for (const soubor of readdirSync(migraceDir).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(path.join(migraceDir, soubor), 'utf8')
      .split('\n')
      .filter((radek) => !/^\s*--/.test(radek))
      .join('\n');

    for (const vzor of nebezpecne) {
      const nalez = sql.match(vzor);
      if (!nalez) continue;

      const schvaleno = (ODEBRANI_SCHVALENA[soubor] ?? []).some((povolene) =>
        new RegExp(povolene.replace(/\s+/, '\\s+'), 'i').test(nalez[0])
      );
      assert.ok(
        schvaleno,
        `${soubor} obsahuje "${nalez[0]}". Migrace musí být zpětně kompatibilní: ` +
          'nejdřív přidej nové a převeď data, staré odeber až v dalším nasazení. ' +
          'Pokud tohle JE ten pozdější krok, doplň soubor do ODEBRANI_SCHVALENA i s důvodem.'
      );
    }
  }
});
