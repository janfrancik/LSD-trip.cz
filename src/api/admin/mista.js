// src/api/admin/mista.js
//
// Místa, kde se létá. Číselník k termínům - proto patří pod oprávnění
// `terminy`, ne pod `nastaveni`: termíny spravuje provoz a nové letiště
// si musí umět založit sám, bez toho, aby na to volal admina.
//
// Mazání je měkké. Termín, který na místě visí, si drží vazbu i potom -
// kdyby se místo vymazalo natvrdo, zmizela by i informace, kde se loni
// létalo.

import express from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import { asyncHandler, chybaNenalezeno, chybaKonflikt } from '../../chyby.js';
import { zvaliduj } from '../../validace.js';
import { vyzaduje } from '../../auth/opravneni.js';
import { zapisAudit } from '../../audit.js';

const router = express.Router();

const prazdnyText = (max) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

// Souřadnice jsou dobrovolné, ale když se zadají, musí dávat smysl - překlep
// v zeměpisné šířce pošle návštěvníka do Grónska.
const souradnice = (max, zprava) =>
  z.coerce.number().min(-max, zprava).max(max, zprava).nullable().optional();

const schemaMisto = z.object({
  nazev: z.string({ error: 'Název je povinný.' }).trim()
    .min(2, 'Název je povinný.').max(160, 'Název je příliš dlouhý.'),
  adresa: prazdnyText(255),
  gps_lat: souradnice(90, 'Zeměpisná šířka je mezi -90 a 90.'),
  gps_lon: souradnice(180, 'Zeměpisná délka je mezi -180 a 180.'),
  poznamka: prazdnyText(500),
  aktivni: z.coerce.boolean().default(true),
});

const schemaUprava = schemaMisto.partial();

const UPRAVITELNE = ['nazev', 'adresa', 'gps_lat', 'gps_lon', 'poznamka', 'aktivni'];

// GET /api/admin/mista
router.get(
  '/',
  vyzaduje('terminy'),
  asyncHandler(async (req, res) => {
    const smazane = req.query.smazane === '1';
    const [data] = await pool.query(
      `SELECT m.*, (
         SELECT COUNT(*) FROM terminy t
          WHERE t.misto_id = m.id AND t.smazano_at IS NULL
       ) AS pocet_terminu
         FROM mista m
        WHERE m.smazano_at IS ${smazane ? 'NOT NULL' : 'NULL'}
        ORDER BY m.aktivni DESC, m.poradi, m.nazev`
    );
    res.json({ data, celkem: data.length });
  })
);

// POST /api/admin/mista
router.post(
  '/',
  vyzaduje('terminy', 'menit'),
  asyncHandler(async (req, res) => {
    const vstup = zvaliduj(schemaMisto, req.body ?? {});

    const [[{ dalsi }]] = await pool.query(
      'SELECT COALESCE(MAX(poradi), 0) + 1 AS dalsi FROM mista'
    );
    const [vysledek] = await pool.query(
      `INSERT INTO mista
         (nazev, adresa, gps_lat, gps_lon, poznamka, aktivni, poradi, vytvoril_id, upravil_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vstup.nazev, vstup.adresa ?? null, vstup.gps_lat ?? null, vstup.gps_lon ?? null,
        vstup.poznamka ?? null, vstup.aktivni ? 1 : 0, dalsi, req.uzivatel.id, req.uzivatel.id,
      ]
    );

    await zapisAudit({
      req, akce: 'vytvoreni', entita: 'misto', entitaId: vysledek.insertId, popis: vstup.nazev,
    });
    res.status(201).json(await nactiMisto(vysledek.insertId));
  })
);

// PATCH /api/admin/mista/:id
router.patch(
  '/:id(\\d+)',
  vyzaduje('terminy', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const vstup = zvaliduj(schemaUprava, req.body ?? {});

    const pred = await nactiMisto(id);
    if (!pred || pred.smazano_at) throw chybaNenalezeno('Místo nenalezeno.');

    const zmeny = {};
    for (const sloupec of UPRAVITELNE) {
      if (vstup[sloupec] === undefined) continue;
      zmeny[sloupec] = typeof vstup[sloupec] === 'boolean' ? (vstup[sloupec] ? 1 : 0) : vstup[sloupec];
    }
    if (!Object.keys(zmeny).length) return res.json(pred);

    zmeny.upravil_id = req.uzivatel.id;
    const sloupce = Object.keys(zmeny);
    await pool.query(
      `UPDATE mista SET ${sloupce.map((s) => `${s} = ?`).join(', ')} WHERE id = ?`,
      [...sloupce.map((s) => zmeny[s]), id]
    );

    await zapisAudit({
      req, akce: 'zmena', entita: 'misto', entitaId: id, popis: pred.nazev,
      pred: vyber(pred, sloupce), po: vyber(zmeny, sloupce),
    });
    res.json(await nactiMisto(id));
  })
);

// DELETE /api/admin/mista/:id - měkké smazání
router.delete(
  '/:id(\\d+)',
  vyzaduje('terminy', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const misto = await nactiMisto(id);
    if (!misto || misto.smazano_at) throw chybaNenalezeno('Místo nenalezeno.');

    // Místo, na kterém visí budoucí termíny, se nemaže. Jinak by u termínu
    // zmizelo, kam se má přijet, a nikdo by si toho nevšiml.
    const [[{ pocet }]] = await pool.query(
      `SELECT COUNT(*) AS pocet FROM terminy
        WHERE misto_id = ? AND smazano_at IS NULL AND stav IN ('otevreno','plno')`,
      [id]
    );
    if (pocet > 0) {
      const kolik =
        pocet === 1 ? 'je ještě 1 termín'
          : pocet <= 4 ? `jsou ještě ${pocet} termíny`
            : `je ještě ${pocet} termínů`;
      throw chybaKonflikt(
        `Na tomhle místě ${kolik}. Přesuň je jinam, nebo místo jen vypni — ` +
          'zůstane u starých termínů, ale u nových se nenabídne.'
      );
    }

    await pool.query(
      'UPDATE mista SET smazano_at = NOW(), aktivni = 0, upravil_id = ? WHERE id = ?',
      [req.uzivatel.id, id]
    );
    await zapisAudit({ req, akce: 'smazani', entita: 'misto', entitaId: id, popis: misto.nazev });
    res.json({ ok: true, zprava: 'Místo je ve smazaných. Dá se obnovit.' });
  })
);

// POST /api/admin/mista/:id/obnovit
router.post(
  '/:id(\\d+)/obnovit',
  vyzaduje('terminy', 'menit'),
  asyncHandler(async (req, res) => {
    const [vysledek] = await pool.query(
      'UPDATE mista SET smazano_at = NULL, upravil_id = ? WHERE id = ? AND smazano_at IS NOT NULL',
      [req.uzivatel.id, req.params.id]
    );
    if (vysledek.affectedRows === 0) throw chybaNenalezeno('Smazané místo nenalezeno.');

    await zapisAudit({ req, akce: 'obnoveni', entita: 'misto', entitaId: Number(req.params.id) });
    res.json({ ok: true, zprava: 'Místo je zpátky, zatím vypnuté.' });
  })
);

async function nactiMisto(id) {
  const [rows] = await pool.query('SELECT * FROM mista WHERE id = ?', [id]);
  return rows[0] ?? null;
}

function vyber(zdroj, sloupce) {
  const vybrano = {};
  for (const sloupec of sloupce) vybrano[sloupec] = zdroj[sloupec] ?? null;
  return vybrano;
}

export default router;
