// src/api/admin/audit.js - prohlížení auditu. Jen čtení, zápis dělá src/audit.js.

import express from 'express';
import pool from '../../db.js';
import { asyncHandler } from '../../chyby.js';
import { zvaliduj, schemaSeznam } from '../../validace.js';
import { vyzaduje } from '../../auth/opravneni.js';

const router = express.Router();

router.get(
  '/',
  vyzaduje('audit'),
  asyncHandler(async (req, res) => {
    const { strana, na_strane, q } = zvaliduj(schemaSeznam, req.query);

    const kde = [];
    const params = [];
    if (req.query.entita) {
      kde.push('a.entita = ?');
      params.push(String(req.query.entita).slice(0, 64));
    }
    if (req.query.entita_id) {
      kde.push('a.entita_id = ?');
      params.push(String(req.query.entita_id).slice(0, 64));
    }
    if (req.query.uzivatel_id) {
      kde.push('a.uzivatel_id = ?');
      params.push(Number(req.query.uzivatel_id));
    }
    if (req.query.od) {
      kde.push('a.created_at >= ?');
      params.push(String(req.query.od).slice(0, 10));
    }
    if (req.query.do) {
      kde.push('a.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
      params.push(String(req.query.do).slice(0, 10));
    }
    if (q) {
      kde.push('(a.popis LIKE ? OR a.akce LIKE ? OR a.uzivatel_email LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const kdeSql = kde.length ? 'WHERE ' + kde.join(' AND ') : '';

    const [[{ celkem }]] = await pool.query(
      `SELECT COUNT(*) AS celkem FROM audit_log a ${kdeSql}`,
      params
    );
    const [data] = await pool.query(
      `SELECT a.id, a.akce, a.entita, a.entita_id, a.popis, a.pred, a.po,
              a.ip, a.created_at,
              COALESCE(u.jmeno, a.uzivatel_email, 'systém') AS kdo
         FROM audit_log a
         LEFT JOIN uzivatele u ON u.id = a.uzivatel_id
         ${kdeSql}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ? OFFSET ?`,
      [...params, na_strane, (strana - 1) * na_strane]
    );

    res.json({ data, celkem, strana, na_strane });
  })
);

export default router;
