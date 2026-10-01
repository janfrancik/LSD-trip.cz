// src/soubory.js
//
// Nahrané soubory. Obecné zázemí pro fotky kurzů, později i pro fotogalerii
// a obrázky v obsahu webu (docs/plan-administrace.md §3.9).
//
// Soubory leží ve volume uploads (v Dockeru /app/uploads), v databázi je jen
// cesta - obrázky tak nenadýmají zálohu databáze a přežijí přestavbu image.
// Je to stejný postup jako u příloh akceptace (src/akceptace/prilohy.js);
// tabulka je ale jiná, protože tyhle soubory jsou obsah webu, ne interní
// snímky z testování, a mají navíc alt text, otisk a měkké mazání.
//
// Obrázek přichází jako base64 v JSON. Na multipart tady není důvod:
// prohlížeč soubor přečte sám a nepřidává to závislost navíc.
//
// Zmenšování, převod na WebP a náhledy přijdou s fotogalerií (fáze 5).
// Do té doby se obrázek ukládá tak, jak přišel - proto je limit velikosti
// nižší, než co umí dnešní mobily, a administrace o tom říká dopředu.

import { mkdir, writeFile, unlink } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import config from './config.js';
import pool from './db.js';
import { isoDatum } from './cas.js';
import { chybaSpatnyVstup } from './chyby.js';

export const MAX_BAJTU = 10 * 1024 * 1024;

// Typ souboru se určuje z jeho obsahu, ne z toho, co tvrdí prohlížeč.
const PODPISY = [
  {
    mime: 'image/png',
    pripona: 'png',
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/jpeg',
    pripona: 'jpg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/webp',
    pripona: 'webp',
    test: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

function rozpoznej(bajty) {
  return PODPISY.find((p) => bajty.length > 12 && p.test(bajty)) ?? null;
}

/**
 * Uloží nahraný obrázek a vrátí záznam z databáze.
 *
 * Stejná fotka nahraná podruhé se neukládá znovu - vrátí se ta původní.
 * Pozná se podle otisku obsahu, ne podle názvu, takže to funguje i když ji
 * majitelka přetáhne z telefonu pod jiným jménem.
 *
 * @param {object} p
 * @param {string} p.obsah       data URL nebo čistý base64
 * @param {string|null} p.nazev  původní jméno souboru (jen pro člověka)
 * @param {string|null} p.alt    popis obrázku
 * @param {number} p.uzivatelId
 * @param {string} [p.podadresar]
 */
export async function ulozSoubor({ obsah, nazev = null, alt = null, uzivatelId, podadresar = 'produkty' }) {
  const base64 = String(obsah ?? '').replace(/^data:[^;]+;base64,/, '');
  if (!base64) throw chybaSpatnyVstup('Soubor je prázdný.');

  let bajty;
  try {
    bajty = Buffer.from(base64, 'base64');
  } catch {
    throw chybaSpatnyVstup('Soubor se nepodařilo přečíst.');
  }
  if (bajty.length === 0) throw chybaSpatnyVstup('Soubor je prázdný.');
  if (bajty.length > MAX_BAJTU) {
    throw chybaSpatnyVstup(
      `Fotka je moc velká (${(bajty.length / 1024 / 1024).toFixed(1)} MB). ` +
        `Maximum je ${MAX_BAJTU / 1024 / 1024} MB — zkus ji v telefonu zmenšit.`
    );
  }

  const typ = rozpoznej(bajty);
  if (!typ) throw chybaSpatnyVstup('Nahrát se dá jen obrázek JPEG, PNG nebo WebP.');

  const otisk = crypto.createHash('sha256').update(bajty).digest('hex');

  // Tatáž fotka už nahraná být může - znovu se neukládá. Smazané se
  // přeskakují, jinak by se "smazaná" fotka vrátila bez souboru na disku.
  const [shodne] = await pool.query(
    'SELECT * FROM soubory WHERE hash_sha256 = ? AND smazano_at IS NULL LIMIT 1',
    [otisk]
  );
  if (shodne[0]) return { ...shodne[0], uzJeNahrany: true };

  const mesic = isoDatum(new Date()).slice(0, 7); // 2026-10, podle pražského dne
  const jmeno = `${crypto.randomBytes(16).toString('hex')}.${typ.pripona}`;
  const relativni = path.posix.join(podadresar, mesic, jmeno);

  const cil = path.join(config.uploadDir, relativni);
  await mkdir(path.dirname(cil), { recursive: true });
  await writeFile(cil, bajty);

  const [vysledek] = await pool.query(
    `INSERT INTO soubory
       (cesta, puvodni_nazev, mime, velikost_b, alt, zdroj, hash_sha256, nahral_id)
     VALUES (?, ?, ?, ?, ?, 'upload', ?, ?)`,
    [
      relativni,
      nazev ? String(nazev).slice(0, 255) : null,
      typ.mime,
      bajty.length,
      alt ? String(alt).slice(0, 255) : null,
      otisk,
      uzivatelId ?? null,
    ]
  );

  const [novy] = await pool.query('SELECT * FROM soubory WHERE id = ?', [vysledek.insertId]);
  return { ...novy[0], uzJeNahrany: false };
}

// Absolutní cesta k souboru. Jméno souboru vyrábíme sami, ale kontrola je tu
// i tak - kdyby se do databáze někdy dostala cesta s "..", nesmí vést mimo
// adresář s nahranými soubory.
export function cestaKSouboru(cesta) {
  const cil = path.resolve(config.uploadDir, cesta);
  const koren = path.resolve(config.uploadDir) + path.sep;
  if (!cil.startsWith(koren)) return null;
  return cil;
}

export async function nactiSoubor(id) {
  const [rows] = await pool.query(
    'SELECT * FROM soubory WHERE id = ? AND smazano_at IS NULL',
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Srovná fotky produktu: pořadí od jedničky a titulní na první.
 *
 * Potřeba je to po odebrání fotky. Kdyby se odebrala zrovna titulní,
 * zůstal by produkt bez ní a na kartě by nebyl obrázek, i když fotky má.
 *
 * @param {object} spojeni  spojení z poolu (běží uvnitř transakce volajícího)
 */
export async function srovnejFotkyProduktu(spojeni, produktId) {
  const [fotky] = await spojeni.query(
    `SELECT f.soubor_id
       FROM produkt_fotky f
       JOIN soubory s ON s.id = f.soubor_id
      WHERE f.produkt_id = ? AND s.smazano_at IS NULL
      ORDER BY f.titulni DESC, f.poradi, f.soubor_id`,
    [produktId]
  );

  for (let i = 0; i < fotky.length; i++) {
    await spojeni.query(
      'UPDATE produkt_fotky SET poradi = ?, titulni = ? WHERE produkt_id = ? AND soubor_id = ?',
      [i + 1, i === 0 ? 1 : 0, produktId, fotky[i].soubor_id]
    );
  }
  return fotky.length;
}

/**
 * Měkké smazání. Soubor na disku zůstává - kdyby se smazalo omylem, jde to
 * vrátit, a tvrdě se uklidí až dávkou, až bude jisté, že na něj nic nevisí.
 */
export async function smazSoubor(id) {
  const [vysledek] = await pool.query(
    'UPDATE soubory SET smazano_at = NOW() WHERE id = ? AND smazano_at IS NULL',
    [id]
  );
  return vysledek.affectedRows > 0;
}

/**
 * Úklid souborů, na kterých nic nevisí. Smazané déle než den a bez vazby
 * na produkt se odstraní i z disku.
 *
 * Bez úklidu by ve volume zůstávaly navždy fotky, které někdo nahrál
 * a pak si to rozmyslel.
 */
export async function uklidOsireleSoubory() {
  const [rows] = await pool.query(
    `SELECT s.id, s.cesta
       FROM soubory s
       LEFT JOIN produkt_fotky f ON f.soubor_id = s.id
      WHERE f.soubor_id IS NULL
        AND s.smazano_at IS NOT NULL
        AND s.smazano_at < DATE_SUB(NOW(), INTERVAL 1 DAY)
      LIMIT 500`
  );

  for (const radek of rows) {
    const cesta = cestaKSouboru(radek.cesta);
    if (cesta) await unlink(cesta).catch(() => {});
    await pool.query('DELETE FROM soubory WHERE id = ?', [radek.id]);
  }
  return rows.length;
}
