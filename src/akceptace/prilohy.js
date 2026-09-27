// src/akceptace/prilohy.js
//
// Přílohy k testům a hlášením: snímky obrazovky, typicky rovnou z mobilu.
// Soubory leží ve volume uploads (v Dockeru /app/uploads), v databázi je jen
// cesta - obrázky tak nenadýmají zálohu databáze a přežijí přestavbu image.
//
// Obrázek přichází jako base64 v JSON. Na multipart tady není důvod: je to
// jeden soubor, prohlížeč ho umí přečíst sám a nepřidává to závislost.
// Zpracování obrázků (sharp, WebP, EXIF) přijde ve fázi 5 s fotogalerií;
// tady jde o interní snímek na testovacím prostředí, který nikdo nezveřejní,
// takže se ukládá tak, jak přišel.

import { mkdir, writeFile, unlink } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import config from '../config.js';
import pool from '../db.js';
import { chybaSpatnyVstup } from '../chyby.js';

const PODADRESAR = 'akceptace';
export const MAX_BAJTU = 6 * 1024 * 1024;

// Typ souboru se určuje z jeho obsahu, ne z toho, co tvrdí prohlížeč.
const PODPISY = [
  { mime: 'image/png', pripona: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', pripona: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/webp',
    pripona: 'webp',
    test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

function rozpoznej(bajty) {
  return PODPISY.find((p) => bajty.length > 12 && p.test(bajty)) ?? null;
}

/**
 * Uloží nahraný obrázek a vrátí záznam z databáze. Příloha je zatím "volná" -
 * připojí se k výsledku nebo hlášení až při uložení formuláře.
 *
 * @param {object} p
 * @param {string} p.obsah      data URL nebo čistý base64
 * @param {string|null} p.nazev původní jméno souboru (jen pro člověka)
 * @param {number} p.uzivatelId
 */
export async function ulozPrilohu({ obsah, nazev = null, uzivatelId }) {
  const base64 = String(obsah ?? '').replace(/^data:[^;]+;base64,/, '');
  if (!base64) throw chybaSpatnyVstup('Příloha je prázdná.');

  let bajty;
  try {
    bajty = Buffer.from(base64, 'base64');
  } catch {
    throw chybaSpatnyVstup('Přílohu se nepodařilo přečíst.');
  }
  if (bajty.length === 0) throw chybaSpatnyVstup('Příloha je prázdná.');
  if (bajty.length > MAX_BAJTU) {
    throw chybaSpatnyVstup(`Obrázek je moc velký (${(bajty.length / 1024 / 1024).toFixed(1)} MB). Maximum je 6 MB.`);
  }

  const typ = rozpoznej(bajty);
  if (!typ) throw chybaSpatnyVstup('Přiložit se dá jen obrázek PNG, JPEG nebo WebP.');

  const mesic = new Date().toISOString().slice(0, 7); // 2026-09
  const jmeno = `${crypto.randomBytes(16).toString('hex')}.${typ.pripona}`;
  const relativni = path.join(PODADRESAR, mesic, jmeno);

  const cil = path.join(config.uploadDir, relativni);
  await mkdir(path.dirname(cil), { recursive: true });
  await writeFile(cil, bajty);

  const [vysledek] = await pool.query(
    `INSERT INTO akceptace_prilohy (uzivatel_id, soubor, nazev, mime, velikost)
     VALUES (?, ?, ?, ?, ?)`,
    [uzivatelId, relativni, nazev ? String(nazev).slice(0, 255) : null, typ.mime, bajty.length]
  );

  return { id: vysledek.insertId, mime: typ.mime, velikost: bajty.length, soubor: relativni };
}

// Absolutní cesta k souboru přílohy. Jméno souboru vyrábíme sami, ale kontrola
// je tu i tak - kdyby se do databáze někdy dostala cesta s "..", nesmí vést
// mimo adresář s nahranými soubory.
export function cestaKPriloze(soubor) {
  const cil = path.resolve(config.uploadDir, soubor);
  const koren = path.resolve(config.uploadDir) + path.sep;
  if (!cil.startsWith(koren)) return null;
  return cil;
}

/**
 * Připojí volné přílohy k výsledku nebo hlášení. Připojit se dají jen přílohy,
 * které nahrál tentýž člověk a které ještě nikde nevisí - jinak by stačilo
 * hádat id a přivlastnit si cizí snímek.
 */
export async function pripojPrilohy(ids, { vysledekId = null, hlaseniId = null, uzivatelId }) {
  const cisla = (ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (cisla.length === 0) return 0;

  const [vysledek] = await pool.query(
    `UPDATE akceptace_prilohy
        SET vysledek_id = ?, hlaseni_id = ?
      WHERE id IN (?) AND uzivatel_id = ? AND vysledek_id IS NULL AND hlaseni_id IS NULL`,
    [vysledekId, hlaseniId, cisla, uzivatelId]
  );
  return vysledek.affectedRows;
}

export async function prilohyPro({ vysledekId = null, hlaseniId = null }) {
  const [rows] = await pool.query(
    `SELECT id, nazev, mime, velikost, created_at FROM akceptace_prilohy
      WHERE ${vysledekId ? 'vysledek_id = ?' : 'hlaseni_id = ?'} ORDER BY id`,
    [vysledekId ?? hlaseniId]
  );
  return rows;
}

// Přílohy, které někdo nahrál a formulář pak neodeslal. Bez úklidu by ve volume
// zůstávaly navždy.
export async function uklidNepouzitePrilohy() {
  const [rows] = await pool.query(
    `SELECT id, soubor FROM akceptace_prilohy
      WHERE vysledek_id IS NULL AND hlaseni_id IS NULL
        AND created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)
      LIMIT 500`
  );
  for (const radek of rows) {
    const cesta = cestaKPriloze(radek.soubor);
    if (cesta) await unlink(cesta).catch(() => {});
    await pool.query('DELETE FROM akceptace_prilohy WHERE id = ?', [radek.id]);
  }
  return rows.length;
}
