// src/api/admin/zakaznici.js
//
// Zákazníci a jejich anonymizace.
//
// Mazání zákazníka na přání (GDPR, „právo být zapomenut") se dělá
// **anonymizací**, ne smazáním řádku: přihlášky, doklady a účetní stopa
// musí zůstat, ale nesmí u nich zbýt, kdo to byl. Po anonymizaci zůstane
// jen to, co potřebuje účetnictví - počet osob, cena, termín.
//
// Je to nevratné a dělá se vědomě, proto vlastní tlačítko a potvrzení,
// ne vedlejší účinek mazání přihlášky.

import express from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import { asyncHandler, chybaNenalezeno, chybaKonflikt } from '../../chyby.js';
import { zvaliduj, schemaSeznam } from '../../validace.js';
import { vyzaduje, jenSpravce } from '../../auth/opravneni.js';
import { zapisAudit } from '../../audit.js';

const router = express.Router();

// GET /api/admin/zakaznici?q=
router.get(
  '/',
  vyzaduje('zakaznici'),
  asyncHandler(async (req, res) => {
    const { strana, na_strane, q } = zvaliduj(schemaSeznam, req.query);

    const kde = ['z.smazano_at IS NULL'];
    const params = [];
    if (q) {
      kde.push('(z.jmeno LIKE ? OR z.email LIKE ? OR z.telefon LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const kdeSql = kde.join(' AND ');

    const [[{ celkem }]] = await pool.query(
      `SELECT COUNT(*) AS celkem FROM zakaznici z WHERE ${kdeSql}`,
      params
    );
    const [data] = await pool.query(
      `SELECT z.id, z.jmeno, z.email, z.telefon, z.mesto, z.anonymizovano_at, z.created_at,
              (SELECT COUNT(*) FROM rezervace r WHERE r.zakaznik_id = z.id AND r.smazano_at IS NULL)
                AS pocet_prihlasek
         FROM zakaznici z
        WHERE ${kdeSql}
        ORDER BY z.created_at DESC, z.id DESC
        LIMIT ? OFFSET ?`,
      [...params, na_strane, (strana - 1) * na_strane]
    );

    res.json({ data, celkem, strana, na_strane });
  })
);

// GET /api/admin/zakaznici/:id
router.get(
  '/:id(\\d+)',
  vyzaduje('zakaznici'),
  asyncHandler(async (req, res) => {
    const zakaznik = await nactiZakaznika(Number(req.params.id));
    if (!zakaznik) throw chybaNenalezeno('Zákazník nenalezen.');

    const [prihlasky] = await pool.query(
      `SELECT r.id, r.kod, r.stav, r.pocet_osob, r.created_at, p.nazev AS produkt_nazev, t.datum
         FROM rezervace r
         JOIN produkty p ON p.id = r.produkt_id
         LEFT JOIN terminy t ON t.id = r.termin_id
        WHERE r.zakaznik_id = ? AND r.smazano_at IS NULL
        ORDER BY r.created_at DESC`,
      [zakaznik.id]
    );

    res.json({ ...zakaznik, prihlasky });
  })
);

// PATCH /api/admin/zakaznici/:id - oprava údajů a poznámka provozu
router.patch(
  '/:id(\\d+)',
  vyzaduje('zakaznici', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const vstup = zvaliduj(
      z.object({
        jmeno: z.string().trim().min(2, 'Jméno je povinné.').max(160).optional(),
        telefon: z.string().trim().max(40).nullable().optional().or(z.literal(''))
          .transform((v) => (v ? v : null)),
        mesto: z.string().trim().max(100).nullable().optional().or(z.literal(''))
          .transform((v) => (v ? v : null)),
        poznamka: z.string().trim().max(5000).nullable().optional(),
      }),
      req.body ?? {}
    );

    const pred = await nactiZakaznika(id);
    if (!pred) throw chybaNenalezeno('Zákazník nenalezen.');
    if (pred.anonymizovano_at) {
      throw chybaKonflikt('Zákazník je anonymizovaný, údaje už se do něj nevracejí.');
    }

    const zmeny = {};
    for (const sloupec of ['jmeno', 'telefon', 'mesto', 'poznamka']) {
      if (vstup[sloupec] !== undefined) zmeny[sloupec] = vstup[sloupec];
    }
    if (!Object.keys(zmeny).length) return res.json(pred);

    const sloupce = Object.keys(zmeny);
    await pool.query(
      `UPDATE zakaznici SET ${sloupce.map((s) => `${s} = ?`).join(', ')} WHERE id = ?`,
      [...sloupce.map((s) => zmeny[s]), id]
    );

    // Do auditu jen co se měnilo, ne nové hodnoty - jsou to osobní údaje.
    await zapisAudit({
      req, akce: 'zmena', entita: 'zakaznik', entitaId: id, popis: pred.jmeno,
      po: { zmeneno: sloupce },
    });
    res.json(await nactiZakaznika(id));
  })
);

// POST /api/admin/zakaznici/:id/anonymizovat
router.post(
  '/:id(\\d+)/anonymizovat',
  // Anonymizace je nevratná a je to zásah do dat, za která se ručí navenek.
  // Proto jen správce - zákazníky sice smí měnit i provoz, ale tohle ne.
  vyzaduje('zakaznici', 'menit'),
  jenSpravce,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const zakaznik = await nactiZakaznika(id);
    if (!zakaznik) throw chybaNenalezeno('Zákazník nenalezen.');
    if (zakaznik.anonymizovano_at) throw chybaKonflikt('Zákazník je už anonymizovaný.');

    const spojeni = await pool.getConnection();
    try {
      await spojeni.beginTransaction();

      // E-mail jde na NULL, ne na vymyšlenou adresu: jinak by se dal spojit
      // s původním člověkem a příští přihláška ze stejné adresy by ho
      // omylem oživila.
      await spojeni.query(
        `UPDATE zakaznici
            SET jmeno = 'Anonymizovaný zákazník', email = NULL, telefon = NULL,
                ulice = NULL, mesto = NULL, psc = NULL, ico = NULL, dic = NULL,
                poznamka = NULL, marketing_souhlas_at = NULL, anonymizovano_at = NOW()
          WHERE id = ?`,
        [id]
      );

      // Osobní údaje jsou i u účastníků a ve zprávě od zákazníka.
      await spojeni.query(
        `UPDATE rezervace_ucastnici u
           JOIN rezervace r ON r.id = u.rezervace_id
            SET u.jmeno = 'Anonymizovaný účastník', u.datum_narozeni = NULL,
                u.telefon = NULL, u.email = NULL, u.poznamka = NULL
          WHERE r.zakaznik_id = ?`,
        [id]
      );
      await spojeni.query(
        'UPDATE rezervace SET zprava = NULL, interni_poznamka = NULL WHERE zakaznik_id = ?',
        [id]
      );

      // Odeslané e-maily nesou adresu i celé tělo zprávy. Zůstane záznam,
      // že e-mail odešel, ale ne komu a s čím.
      await spojeni.query(
        `UPDATE emaily
            SET prijemce = 'anonymizovano', prijemce_skutecny = NULL,
                telo_snapshot = NULL, telo_text = NULL
          WHERE zakaznik_id = ?`,
        [id]
      );

      await spojeni.commit();
    } catch (chyba) {
      await spojeni.rollback();
      throw chyba;
    } finally {
      spojeni.release();
    }

    // Do auditu nejde jméno ani adresa - to je přesně to, co mizí.
    await zapisAudit({
      req, akce: 'anonymizace', entita: 'zakaznik', entitaId: id,
      popis: `zákazník #${id}`,
    });

    res.json({
      ok: true,
      zprava: 'Zákazník je anonymizovaný. Přihlášky zůstaly kvůli účetnictví, osobní údaje zmizely.',
    });
  })
);

async function nactiZakaznika(id) {
  const [rows] = await pool.query(
    'SELECT * FROM zakaznici WHERE id = ? AND smazano_at IS NULL',
    [id]
  );
  return rows[0] ?? null;
}

export default router;
