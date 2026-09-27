// src/audit.js
//
// Audit log: kdo, kdy, co, před a po. Zapisuje se u všeho, co mění data.
// Zápis auditu nesmí shodit samotnou akci - když se nepovede, jen se zaloguje.

import pool from './db.js';

// Co se do auditu nikdy nesmí dostat, ani omylem.
const TAJNE_KLICE = [
  'heslo',
  'heslo_hash',
  'heslo_znovu',
  'token',
  'token_hash',
  'totp_secret',
  'client_secret',
  'api_key',
  'secret',
];

function ocisti(data) {
  if (data == null || typeof data !== 'object') return data ?? null;
  const vysledek = Array.isArray(data) ? [] : {};
  for (const [klic, hodnota] of Object.entries(data)) {
    if (TAJNE_KLICE.includes(klic.toLowerCase())) {
      vysledek[klic] = '***';
    } else if (hodnota && typeof hodnota === 'object') {
      vysledek[klic] = ocisti(hodnota);
    } else {
      vysledek[klic] = hodnota;
    }
  }
  return vysledek;
}

/**
 * @param {object} volby
 * @param {object|null} volby.req      požadavek (kvůli uživateli a IP)
 * @param {string} volby.akce          'prihlaseni', 'vytvoreni', 'zmena', 'smazani', …
 * @param {string} volby.entita        'uzivatel', 'poptavka', 'nastaveni', …
 * @param {string|number|null} volby.entitaId
 * @param {string|null} volby.popis    krátký text pro člověka
 * @param {object|null} volby.pred
 * @param {object|null} volby.po
 */
export async function zapisAudit({
  req = null,
  akce,
  entita,
  entitaId = null,
  popis = null,
  pred = null,
  po = null,
}) {
  try {
    const uzivatel = req?.uzivatel ?? null;
    await pool.query(
      `INSERT INTO audit_log
         (uzivatel_id, uzivatel_email, akce, entita, entita_id, popis, pred, po, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uzivatel?.id ?? null,
        uzivatel?.email ?? null,
        akce,
        entita,
        entitaId == null ? null : String(entitaId),
        popis,
        pred ? JSON.stringify(ocisti(pred)) : null,
        po ? JSON.stringify(ocisti(po)) : null,
        req?.ip ?? null,
      ]
    );
  } catch (err) {
    console.error('Audit se nepodařilo zapsat:', err.message);
  }
}

// Rozdíl dvou verzí záznamu - do auditu ukládáme jen změněná pole, ne celý
// objekt. Detail změny je pak čitelný i po roce.
export function rozdil(pred, po) {
  const zmeneno = { pred: {}, po: {} };
  for (const klic of Object.keys(po ?? {})) {
    const a = pred?.[klic] ?? null;
    const b = po[klic] ?? null;
    if (String(a) !== String(b)) {
      zmeneno.pred[klic] = a;
      zmeneno.po[klic] = b;
    }
  }
  const prazdne = Object.keys(zmeneno.po).length === 0;
  return prazdne ? null : zmeneno;
}
