// src/api/admin/sablony.js
//
// E-mailové šablony: texty, které chodí zákazníkům. Do E5 byly v kódu,
// od téhle verze je upravuje majitelka (tabulka `email_sablony`).
//
// Šablona je prostý text s proměnnými {{takhle}}. Žádné HTML - obálku,
// barvy a odstavce doplní aplikace, takže se vzhled e-mailu nedá rozbít
// ani omylem vložit kód.
//
// Náhled renderuje tutéž cestou jako skutečné odeslání, jen s ukázkovými
// daty. Kdyby měl vlastní vykreslování, ukazoval by něco jiného, než co
// zákazníkovi doopravdy dojde.

import express from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import { asyncHandler, chybaNenalezeno } from '../../chyby.js';
import { zvaliduj } from '../../validace.js';
import { vyzaduje } from '../../auth/opravneni.js';
import { zapisAudit } from '../../audit.js';
import { seznamSablon, nactiSablonu, vyrenderujSablonu } from '../../email/sablony.js';
import config from '../../config.js';

const router = express.Router();

// Ukázková data do náhledu. Vymyšlená, ale ve tvaru, jaký přijde doopravdy -
// ať je v náhledu vidět, jak dlouhé texty se do e-mailu vejdou.
const UKAZKA = {
  jmeno: 'Jana Nováková',
  email: 'jana.novakova@example.com',
  telefon: '777 123 456',
  kurz: 'Parašutistický výcvik se 2 seskoky',
  termin: '17. 5. 2026 od 8:00',
  misto: 'Letiště Jihlava — Henčov',
  kod: 'LSD-2026-0042',
  pocet_osob: '2',
  cena: '9 800 Kč',
  duvod: 'Nepřeje počasí — vítr nad limitem.',
  ucastnici: '- Jana Nováková, 28 let, 62 kg\n- Petr Novák, 31 let, 88 kg',
};

// GET /api/admin/sablony
router.get(
  '/',
  vyzaduje('emaily_sablony'),
  asyncHandler(async (req, res) => {
    const data = await seznamSablon();
    res.json({ data, celkem: data.length });
  })
);

// PATCH /api/admin/sablony/:id
router.patch(
  '/:id(\\d+)',
  vyzaduje('emaily_sablony', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const vstup = zvaliduj(
      z.object({
        predmet: z.string().trim().min(3, 'Předmět je povinný.').max(255).optional(),
        telo: z.string().trim().min(10, 'Text e-mailu je povinný.').max(60000).optional(),
        aktivni: z.coerce.boolean().optional(),
      }),
      req.body ?? {}
    );

    const [rows] = await pool.query('SELECT * FROM email_sablony WHERE id = ?', [id]);
    const pred = rows[0];
    if (!pred) throw chybaNenalezeno('Šablona nenalezena.');

    const zmeny = {};
    for (const sloupec of ['predmet', 'telo']) {
      if (vstup[sloupec] !== undefined) zmeny[sloupec] = vstup[sloupec];
    }
    if (vstup.aktivni !== undefined) zmeny.aktivni = vstup.aktivni ? 1 : 0;
    if (!Object.keys(zmeny).length) return res.json(pred);

    zmeny.upravil_id = req.uzivatel.id;
    const sloupce = Object.keys(zmeny);
    await pool.query(
      `UPDATE email_sablony SET ${sloupce.map((s) => `${s} = ?`).join(', ')} WHERE id = ?`,
      [...sloupce.map((s) => zmeny[s]), id]
    );

    await zapisAudit({
      req, akce: 'zmena', entita: 'email_sablona', entitaId: id, popis: pred.nazev,
      // Celé texty do auditu nepatří, byl by nečitelný. Stačí, co se měnilo.
      po: { zmeneno: sloupce.filter((s) => s !== 'upravil_id') },
    });

    const [nove] = await pool.query('SELECT * FROM email_sablony WHERE id = ?', [id]);
    res.json(nove[0]);
  })
);

// POST /api/admin/sablony/:id/nahled
//
// Vrátí vyrenderovaný předmět, text a HTML. Posílá se i rozepsaný text
// z editoru, aby šlo nahlédnout ještě před uložením.
router.post(
  '/:id(\\d+)/nahled',
  vyzaduje('emaily_sablony'),
  asyncHandler(async (req, res) => {
    const sablona = await nactiSablonuPodleId(Number(req.params.id));
    if (!sablona) throw chybaNenalezeno('Šablona nenalezena.');

    const vstup = zvaliduj(
      z.object({
        predmet: z.string().trim().max(255).optional(),
        telo: z.string().trim().max(60000).optional(),
      }),
      req.body ?? {}
    );

    const kNahledu = {
      ...sablona,
      predmet: vstup.predmet ?? sablona.predmet,
      telo: vstup.telo ?? sablona.telo,
    };
    const { predmet, text, html } = await vyrenderujSablonu(kNahledu, UKAZKA);

    res.json({
      predmet,
      text,
      html,
      // Ať je v administraci vidět, že z testu e-mail zákazníkovi nedojde.
      rezim: config.EMAIL_REZIM,
      ukazka: UKAZKA,
    });
  })
);

async function nactiSablonuPodleId(id) {
  const [rows] = await pool.query('SELECT * FROM email_sablony WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export { nactiSablonu };
export default router;
