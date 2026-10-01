// scripts/prepocitej-fotky.js
//
// Dopočítá webové verze fotkám, které je ještě nemají - tedy těm, co se
// nahrály dřív, než se zmenšování na 1600 px zavedlo.
//
// Pustit ručně není nutné: totéž dělá hodinová údržba (src/udrzba.js), takže
// se fotky dopočítají samy. Skript je tu pro případ, kdy je potřeba mít to
// hotové hned a vidět výpis - například po importu fotek ze starého webu.
//
//   docker compose run --rm app node scripts/prepocitej-fotky.js
//
// Opakované spuštění nic nezkazí: co už webovou verzi má, se přeskočí.
// Originály zůstávají nedotčené, vzniká jen soubor vedle nich.

import pool from '../src/db.js';
import { dopocitejChybejiciVarianty } from '../src/soubory.js';

const DAVKA = 25;

async function kolik() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS pocet FROM soubory
      WHERE varianty IS NULL AND smazano_at IS NULL AND mime LIKE 'image/%'`
  );
  return rows[0].pocet;
}

const celkem = await kolik();
if (celkem === 0) {
  console.log('Všechny fotky už webovou verzi mají, není co počítat.');
} else {
  console.log(`Fotek ke zpracování: ${celkem}`);

  let zmensenych = 0;
  let zbyva = celkem;
  while (zbyva > 0) {
    zmensenych += await dopocitejChybejiciVarianty(DAVKA);
    const pred = zbyva;
    zbyva = await kolik();
    console.log(`  hotovo ${celkem - zbyva} z ${celkem}`);
    // Kdyby se jedna fotka nedala přečíst, dostane zápis do `varianty`
    // a z výběru vypadne. Když se ale počet nezmění vůbec, něco je špatně
    // a nemá smysl kroužit dál.
    if (zbyva === pred) {
      console.error('Počet se nezmenšuje, končím. Zkontroluj log aplikace.');
      break;
    }
  }

  console.log(
    `Hotovo. Zmenšeno pro web: ${zmensenych}` +
      (zmensenych < celkem ? `, zbytek byl už dost malý nebo se nedal přečíst.` : '.')
  );
}

await pool.end();
