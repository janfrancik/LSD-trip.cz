// src/akceptace/import.js
//
// Zadání akceptačních testů je v repozitáři (docs/akceptace/<faze>.yml), ne
// v databázi. Důvod: úkoly píše programátor ke konkrétní změně kódu, takže
// patří ke commitu - a při nasazení se naimportují samy.
//
// Import je idempotentní. Páruje se podle `kod` (verze) a `kod` úkolu v rámci
// verze, takže opakovaný běh nic nezduplikuje a hlavně nesmaže výsledky
// testerů. Změněné zadání se aktualizuje a orazítkuje `zmeneno_at`, aby
// administrace poznala, že tester odklikl starší podobu úkolu.

import { readdir, readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import pool from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ADRESAR_ZADANI = path.join(__dirname, '..', '..', 'docs', 'akceptace');

const schemaUkol = z.object({
  kod: z
    .string()
    .trim()
    .min(2)
    .max(80)
    // Kód je trvalý identifikátor úkolu. Kdyby se do něj dostala mezera nebo
    // diakritika, snadno by se při přepisu rozešel a výsledky by se odpojily.
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'kod úkolu smí obsahovat jen malá písmena, číslice a pomlčky'),
  nazev: z.string().trim().min(3).max(200),
  oblast: z.string().trim().max(40).optional(),
  odkaz: z.string().trim().max(255).optional(),
  // Komu se úkol ukáže. Bez těchhle polí platí "všem přiřazeným testerům".
  role: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined
        ? undefined
        : (Array.isArray(v) ? v : String(v).split(','))
            .map((r) => r.trim().toLowerCase())
            .filter(Boolean)
            .join(',')
    ),
  jen_admin: z.boolean().optional(),
  postup: z.string().trim().min(3),
  vysledek: z.string().trim().min(3),
});

const schemaSoubor = z.object({
  verze: z.object({
    kod: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'kod verze smí obsahovat jen malá písmena, číslice a pomlčky'),
    nazev: z.string().trim().min(3).max(200),
    popis: z.string().trim().optional(),
    poradi: z.coerce.number().int().min(0).default(0),
  }),
  ukoly: z.array(schemaUkol).min(1),
});

function hashZadani(u) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        u.nazev, u.postup, u.vysledek, u.odkaz ?? '', u.oblast ?? '',
        u.role ?? '', u.jen_admin ? 1 : 0,
      ])
    )
    .digest('hex');
}

// Jak dopadl poslední import. Drží se v paměti procesu, ne v databázi -
// import může selhat právě proto, že databáze ještě nemá schéma. Administrace
// to podle tohoto stavu ukáže jako upozornění s tlačítkem na nový pokus,
// aby modul tiše nezůstal prázdný.
let stav = { cas: null, ok: null, chyba: null, verzi: 0 };

export function stavImportu() {
  return { ...stav };
}

/**
 * Naimportuje všechna zadání ze souborů docs/akceptace/*.yml.
 *
 * @returns {Promise<Array<{id:number, kod:string, nazev:string, nova:boolean,
 *                          pridano:number, zmeneno:number, deaktivovano:number}>>}
 */
export async function naimportujAkceptaci(volby = {}) {
  try {
    const prehled = await provedImport(volby);
    stav = { cas: new Date(), ok: true, chyba: null, verzi: prehled.length };
    return prehled;
  } catch (err) {
    stav = { cas: new Date(), ok: false, chyba: err.message, verzi: 0 };
    throw err;
  }
}

async function provedImport({ adresar = ADRESAR_ZADANI } = {}) {
  let soubory;
  try {
    soubory = (await readdir(adresar)).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).sort();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const prehled = [];
  for (const soubor of soubory) {
    const surovy = await readFile(path.join(adresar, soubor), 'utf8');

    let data;
    try {
      data = schemaSoubor.parse(parseYaml(surovy));
    } catch (err) {
      // Špatné zadání nesmí zablokovat start aplikace ani ostatní soubory -
      // jen se ohlásí a soubor se přeskočí.
      throw new Error(`Zadání ${soubor} je chybné: ${err.message}`);
    }

    // Duplicitní kód úkolu by tiše přepsal jiný úkol včetně jeho výsledků.
    const kody = data.ukoly.map((u) => u.kod);
    const duplikat = kody.find((k, i) => kody.indexOf(k) !== i);
    if (duplikat) throw new Error(`Zadání ${soubor} má dvakrát úkol s kódem "${duplikat}".`);

    prehled.push(await ulozVerzi(data));
  }
  return prehled;
}

async function ulozVerzi({ verze, ukoly }) {
  await pool.query(
    `INSERT INTO akceptace_verze (kod, nazev, popis, poradi)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE nazev = VALUES(nazev), popis = VALUES(popis), poradi = VALUES(poradi)`,
    [verze.kod, verze.nazev, verze.popis ?? null, verze.poradi]
  );
  const [[radek]] = await pool.query('SELECT id FROM akceptace_verze WHERE kod = ?', [verze.kod]);
  const verzeId = radek.id;

  const [stare] = await pool.query(
    'SELECT id, kod, definice_hash, aktivni FROM akceptace_ukoly WHERE verze_id = ?',
    [verzeId]
  );
  const podleKodu = new Map(stare.map((u) => [u.kod, u]));

  let pridano = 0;
  let zmeneno = 0;

  for (const [index, ukol] of ukoly.entries()) {
    const hash = hashZadani(ukol);
    const stary = podleKodu.get(ukol.kod);

    if (!stary) {
      await pool.query(
        `INSERT INTO akceptace_ukoly
           (verze_id, kod, nazev, postup, ocekavany_vysledek, odkaz, oblast,
            role_filtr, jen_admin, poradi, definice_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          verzeId, ukol.kod, ukol.nazev, ukol.postup, ukol.vysledek,
          ukol.odkaz ?? null, ukol.oblast ?? null,
          ukol.role ?? null, ukol.jen_admin ? 1 : 0, index, hash,
        ]
      );
      pridano += 1;
      continue;
    }

    if (stary.definice_hash === hash && stary.aktivni === 1) {
      // Zadání je stejné - jen srovnáme pořadí, ať se úkoly nemíchají.
      await pool.query('UPDATE akceptace_ukoly SET poradi = ? WHERE id = ?', [index, stary.id]);
      continue;
    }

    await pool.query(
      `UPDATE akceptace_ukoly
          SET nazev = ?, postup = ?, ocekavany_vysledek = ?, odkaz = ?, oblast = ?,
              role_filtr = ?, jen_admin = ?, poradi = ?, aktivni = 1,
              definice_hash = ?, zmeneno_at = NOW()
        WHERE id = ?`,
      [
        ukol.nazev, ukol.postup, ukol.vysledek, ukol.odkaz ?? null, ukol.oblast ?? null,
        ukol.role ?? null, ukol.jen_admin ? 1 : 0, index, hash, stary.id,
      ]
    );
    // Změna zadání se počítá jen tehdy, když se opravdu změnil text. Oživení
    // dřív odstraněného úkolu není změna zadání.
    if (stary.definice_hash !== hash) zmeneno += 1;
  }

  // Úkoly, které v souboru už nejsou, jen zhasneme. Smazáním by zmizely
  // i výsledky testerů, a to je historie, kterou chceme mít.
  const zivoty = new Set(ukoly.map((u) => u.kod));
  const kDeaktivaci = stare.filter((u) => u.aktivni === 1 && !zivoty.has(u.kod)).map((u) => u.id);
  if (kDeaktivaci.length) {
    await pool.query('UPDATE akceptace_ukoly SET aktivni = 0 WHERE id IN (?)', [kDeaktivaci]);
  }

  return {
    id: verzeId,
    kod: verze.kod,
    nazev: verze.nazev,
    nova: stare.length === 0,
    pridano,
    zmeneno,
    deaktivovano: kDeaktivaci.length,
  };
}
