// src/api/admin/dashboard.js
//
// Dashboard. Ve fázi 1 existují jen poptávky, uživatelé a e-maily - karty pro
// termíny, rezervace a platby přijdou ve fázích 2 až 4. Aby administrace
// nevypadala rozbitě, vrací se u nehotových částí `pripravuje_se: true`
// a obrazovka je vykreslí jako prázdné místo s vysvětlením.

import express from 'express';
import pool from '../../db.js';
import config from '../../config.js';
import { asyncHandler } from '../../chyby.js';
import { vyzaduje, maPravo } from '../../auth/opravneni.js';
import { kartaNaPrehled } from '../../akceptace/souhrn.js';

const router = express.Router();

router.get(
  '/',
  vyzaduje('dashboard'),
  asyncHandler(async (req, res) => {
    const [[poptavky]] = await pool.query(
      `SELECT
         SUM(stav = 'nova') AS nove,
         SUM(stav = 'vyrizuje_se') AS vyrizuji_se,
         SUM(stav = 'nova' AND created_at < DATE_SUB(NOW(), INTERVAL 2 DAY)) AS stare
       FROM poptavky WHERE smazano_at IS NULL`
    );

    const [[emaily]] = await pool.query(
      `SELECT
         SUM(stav = 'chyba') AS chyby,
         SUM(stav IN ('bounce','stiznost')) AS problemy,
         SUM(created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)) AS za_tyden
       FROM emaily`
    );

    const [poslednPoptavky] = await pool.query(
      `SELECT id, jmeno, email, stav, created_at,
              LEFT(COALESCE(zprava,''), 140) AS ukazka
         FROM poptavky WHERE smazano_at IS NULL AND stav IN ('nova','vyrizuje_se')
        ORDER BY created_at DESC LIMIT 5`
    );

    const [aktivita] = await pool.query(
      `SELECT a.akce, a.entita, a.popis, a.created_at,
              COALESCE(u.jmeno, a.uzivatel_email, 'systém') AS kdo
         FROM audit_log a LEFT JOIN uzivatele u ON u.id = a.uzivatel_id
        ORDER BY a.created_at DESC, a.id DESC LIMIT 8`
    );

    // Karta akceptace jen na testu (a ve vývoji) a jen tomu, kdo testuje.
    const akceptace =
      config.akceptaceZapnuta && maPravo(req.uzivatel.role, 'akceptace')
        ? await kartaNaPrehled(req.uzivatel)
        : null;

    res.json({
      prostredi: config.PROSTREDI,
      email_rezim: config.EMAIL_REZIM,
      akceptace,
      poptavky: {
        nove: Number(poptavky.nove ?? 0),
        vyrizuji_se: Number(poptavky.vyrizuji_se ?? 0),
        stare: Number(poptavky.stare ?? 0),
      },
      emaily: {
        chyby: Number(emaily.chyby ?? 0),
        problemy: Number(emaily.problemy ?? 0),
        za_tyden: Number(emaily.za_tyden ?? 0),
      },
      posledni_poptavky: poslednPoptavky,
      aktivita,

      // Připravované karty - obrazovka je ukáže jako "bude ve fázi N".
      pripravuje_se: [
        { klic: 'terminy', nazev: 'Dnešní a nejbližší termíny', faze: 2 },
        { klic: 'rezervace', nazev: 'Nové rezervace', faze: 3 },
        { klic: 'platby', nazev: 'Nezaplacené a po splatnosti', faze: 4 },
        { klic: 'prosetreni', nazev: 'K prošetření', faze: 4 },
        { klic: 'poukazy', nazev: 'Poukazy blížící se konci platnosti', faze: 4 },
        { klic: 'trzby', nazev: 'Tržby za období', faze: 6 },
      ],
    });
  })
);

export default router;
