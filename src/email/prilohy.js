// src/email/prilohy.js
//
// Přílohy e-mailů (od fáze 4 faktury a QR platby v PDF). Soubor jde do volume
// uploads, v databázi zůstane jen cesta - jinak by dump databáze narostl
// o každou odeslanou fakturu.
//
// Ukládají se ve všech režimech: v testovací schránce si je má obsluha stáhnout
// a podívat se, co by zákazník dostal; v produkci jsou dokladem o tom, co
// zákazník dostal doopravdy.

import { mkdir, writeFile, unlink } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import config from '../config.js';
import pool from '../db.js';
import { isoDatum } from '../cas.js';

const PODADRESAR = 'emaily';

// Přípona podle typu obsahu; víc než tohle zatím neposíláme.
const PRIPONY = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

function obsahJakoBuffer(obsah) {
  if (Buffer.isBuffer(obsah)) return obsah;
  if (obsah instanceof Uint8Array) return Buffer.from(obsah);
  // Resend bere přílohy i jako base64 řetězec.
  return Buffer.from(String(obsah ?? '').replace(/^data:[^;]+;base64,/, ''), 'base64');
}

/**
 * @param {number} emailId
 * @param {{filename?:string, content:any, contentType?:string}} priloha
 */
export async function ulozPrilohuEmailu(emailId, priloha) {
  const bajty = obsahJakoBuffer(priloha.content);
  if (bajty.length === 0) return null;

  const nazev = String(priloha.filename ?? 'priloha').slice(0, 255);
  const mime = priloha.contentType ?? 'application/octet-stream';
  const pripona = PRIPONY[mime] ?? path.extname(nazev).replace('.', '') ?? 'bin';

  const relativni = path.join(
    PODADRESAR,
    isoDatum(new Date()).slice(0, 7),
    `${crypto.randomBytes(16).toString('hex')}.${pripona || 'bin'}`
  );
  const cil = path.join(config.uploadDir, relativni);
  await mkdir(path.dirname(cil), { recursive: true });
  await writeFile(cil, bajty);

  const [vysledek] = await pool.query(
    `INSERT INTO email_prilohy (email_id, nazev, mime, velikost, soubor)
     VALUES (?, ?, ?, ?, ?)`,
    [emailId, nazev, mime, bajty.length, relativni]
  );
  return { id: vysledek.insertId, nazev, mime, velikost: bajty.length };
}

export async function prilohyEmailu(emailId) {
  const [rows] = await pool.query(
    'SELECT id, nazev, mime, velikost FROM email_prilohy WHERE email_id = ? ORDER BY id',
    [emailId]
  );
  return rows;
}

// Stejná pojistka jako u příloh akceptace: cestu skládáme sami, ale kdyby se
// do databáze někdy dostalo "..", nesmí vést mimo adresář s nahranými soubory.
export function cestaKPrilozeEmailu(soubor) {
  const cil = path.resolve(config.uploadDir, soubor);
  const koren = path.resolve(config.uploadDir) + path.sep;
  return cil.startsWith(koren) ? cil : null;
}

export async function smazPrilohyEmailu(emailId) {
  const prilohy = await prilohyEmailu(emailId);
  for (const p of prilohy) {
    const [[radek]] = await pool.query('SELECT soubor FROM email_prilohy WHERE id = ?', [p.id]);
    const cesta = radek && cestaKPrilozeEmailu(radek.soubor);
    if (cesta) await unlink(cesta).catch(() => {});
  }
  await pool.query('DELETE FROM email_prilohy WHERE email_id = ?', [emailId]);
}
