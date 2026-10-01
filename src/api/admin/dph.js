// src/api/admin/dph.js
//
// Číselník sazeb DPH. Sazby se nezakládají ani nemažou z administrace - jsou
// dané zákonem a migrace 008 je naplnila. Měnit jde procento, název, právní
// text a to, která je výchozí; vypnout se dá nepoužívaná sazba.
//
// Proč to vůbec jde měnit: sazby se čas od času mění zákonem a majitelka
// nemá čekat na nasazení. Už vystavené doklady se tím nemění - ty si sazbu
// uloží k položce (docs/plan-administrace.md §11).

import express from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import { asyncHandler, chybaNenalezeno, chybaKonflikt } from '../../chyby.js';
import { zvaliduj } from '../../validace.js';
import { vyzaduje } from '../../auth/opravneni.js';
import { zapisAudit } from '../../audit.js';

const router = express.Router();

// GET /api/admin/dph-sazby
router.get(
  '/',
  vyzaduje('produkty'),
  asyncHandler(async (req, res) => {
    const [data] = await pool.query(
      `SELECT id, kod, nazev, procento, rezim, pravni_text, vychozi, aktivni, poradi
         FROM dph_sazby ORDER BY poradi, id`
    );
    res.json({ data });
  })
);

const schemaUprava = z.object({
  nazev: z.string().trim().min(2, 'Název sazby je povinný.').max(100).optional(),
  procento: z.coerce.number()
    .min(0, 'Sazba nemůže být záporná.')
    .max(100, 'Sazba nemůže být přes 100 %.')
    .optional(),
  pravni_text: z.string().trim().max(255).nullable().optional()
    .transform((v) => (v ? v : null)),
  vychozi: z.coerce.boolean().optional(),
  aktivni: z.coerce.boolean().optional(),
});

// PATCH /api/admin/dph-sazby/:id
router.patch(
  '/:id(\\d+)',
  vyzaduje('produkty', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const vstup = zvaliduj(schemaUprava, req.body ?? {});

    const [rows] = await pool.query('SELECT * FROM dph_sazby WHERE id = ?', [id]);
    const pred = rows[0];
    if (!pred) throw chybaNenalezeno('Sazba DPH nenalezena.');

    // Osvobozená sazba s nenulovým procentem by tiše rozbila doklady.
    const procento = vstup.procento ?? Number(pred.procento);
    if (pred.rezim === 'osvobozeno' && procento !== 0) {
      throw chybaKonflikt('U osvobozené sazby musí být 0 %.', {
        procento: 'Osvobozeno znamená nulovou sazbu.',
      });
    }

    // Vypnout poslední použitelnou sazbu nejde - nový produkt by neměl co dostat.
    if (vstup.aktivni === false && pred.aktivni) {
      const [[{ zbyva }]] = await pool.query(
        'SELECT COUNT(*) AS zbyva FROM dph_sazby WHERE aktivni = 1 AND id <> ?',
        [id]
      );
      if (zbyva === 0) {
        throw chybaKonflikt('Tohle je poslední zapnutá sazba, vypnout ji nejde.', {
          aktivni: 'Nejdřív zapni jinou sazbu.',
        });
      }
    }

    const spojeni = await pool.getConnection();
    try {
      await spojeni.beginTransaction();

      // Výchozí sazba je právě jedna. Nastavení nové zruší tu starou v téže
      // transakci, aby neexistoval okamžik se dvěma ani se žádnou.
      if (vstup.vychozi === true) {
        await spojeni.query('UPDATE dph_sazby SET vychozi = 0 WHERE id <> ?', [id]);
      }

      const zmeny = {};
      if (vstup.nazev !== undefined) zmeny.nazev = vstup.nazev;
      if (vstup.procento !== undefined) zmeny.procento = vstup.procento;
      if (vstup.pravni_text !== undefined) zmeny.pravni_text = vstup.pravni_text;
      if (vstup.vychozi !== undefined) zmeny.vychozi = vstup.vychozi ? 1 : 0;
      if (vstup.aktivni !== undefined) zmeny.aktivni = vstup.aktivni ? 1 : 0;

      if (Object.keys(zmeny).length) {
        const sloupce = Object.keys(zmeny);
        await spojeni.query(
          `UPDATE dph_sazby SET ${sloupce.map((s) => `${s} = ?`).join(', ')} WHERE id = ?`,
          [...sloupce.map((s) => zmeny[s]), id]
        );
      }

      await spojeni.commit();
    } catch (chyba) {
      await spojeni.rollback();
      throw chyba;
    } finally {
      spojeni.release();
    }

    await zapisAudit({
      req, akce: 'zmena', entita: 'dph_sazba', entitaId: id, popis: pred.kod,
      pred: { procento: pred.procento, vychozi: pred.vychozi, aktivni: pred.aktivni },
      po: { procento, vychozi: vstup.vychozi, aktivni: vstup.aktivni },
    });

    const [nove] = await pool.query('SELECT * FROM dph_sazby WHERE id = ?', [id]);
    res.json(nove[0]);
  })
);

export default router;
