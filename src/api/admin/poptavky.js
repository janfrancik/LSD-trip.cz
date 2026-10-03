// src/api/admin/poptavky.js
//
// Poptávky z kontaktního formuláře. Do fáze 1 byly tyhle endpointy veřejné -
// kdokoli si mohl přečíst i smazat všechny poptávky včetně e-mailů. Teď jsou
// za přihlášením a mazání je jen měkké.

import express from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import config from '../../config.js';
import { asyncHandler, chybaNenalezeno } from '../../chyby.js';
import { zvaliduj, schemaSeznam } from '../../validace.js';
import { vyzaduje } from '../../auth/opravneni.js';
import { zapisAudit } from '../../audit.js';
import { posliEmail } from '../../email/posli.js';
import { obalka } from '../../email/sablona.js';
import { hodnota } from '../../nastaveni.js';

const router = express.Router();

const STAVY = ['nova', 'vyrizuje_se', 'vyrizeno', 'spam'];

// GET /api/admin/poptavky
router.get(
  '/',
  vyzaduje('poptavky'),
  asyncHandler(async (req, res) => {
    const { strana, na_strane, q } = zvaliduj(schemaSeznam, req.query);
    const stav = STAVY.includes(req.query.stav) ? req.query.stav : null;
    const smazane = req.query.smazane === '1';

    const kde = [smazane ? 'p.smazano_at IS NOT NULL' : 'p.smazano_at IS NULL'];
    const params = [];
    if (stav) {
      kde.push('p.stav = ?');
      params.push(stav);
    }
    if (q) {
      kde.push('(p.jmeno LIKE ? OR p.email LIKE ? OR p.zprava LIKE ? OR p.telefon LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const kdeSql = 'WHERE ' + kde.join(' AND ');

    const [[{ celkem }]] = await pool.query(
      `SELECT COUNT(*) AS celkem FROM poptavky p ${kdeSql}`,
      params
    );
    const [data] = await pool.query(
      `SELECT p.id, p.jmeno, p.email, p.telefon, p.zprava, p.stav,
              p.odpovezeno_at, p.created_at, p.updated_at,
              u.jmeno AS prirazeno_jmeno
         FROM poptavky p
         LEFT JOIN uzivatele u ON u.id = p.prirazeno_id
         ${kdeSql}
        ORDER BY FIELD(p.stav,'nova','vyrizuje_se','vyrizeno','spam'), p.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, na_strane, (strana - 1) * na_strane]
    );

    // Počty po stavech pro záložky v administraci.
    const [pocty] = await pool.query(
      `SELECT stav, COUNT(*) AS pocet FROM poptavky WHERE smazano_at IS NULL GROUP BY stav`
    );

    res.json({
      data,
      celkem,
      strana,
      na_strane,
      pocty: Object.fromEntries(pocty.map((r) => [r.stav, r.pocet])),
    });
  })
);

// GET /api/admin/poptavky/:id
router.get(
  '/:id',
  vyzaduje('poptavky'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT p.*, u.jmeno AS prirazeno_jmeno, o.jmeno AS odpovedel_jmeno
         FROM poptavky p
         LEFT JOIN uzivatele u ON u.id = p.prirazeno_id
         LEFT JOIN uzivatele o ON o.id = p.odpovedel_id
        WHERE p.id = ?`,
      [req.params.id]
    );
    if (!rows[0]) throw chybaNenalezeno('Poptávka nenalezena.');

    const [emaily] = await pool.query(
      `SELECT id, predmet, prijemce, prijemce_skutecny, stav, rezim, chyba,
              odeslano_at, created_at
         FROM emaily WHERE poptavka_id = ? ORDER BY created_at DESC`,
      [req.params.id]
    );

    res.json({ ...rows[0], emaily });
  })
);

const schemaUprava = z.object({
  stav: z.enum(STAVY).optional(),
  interni_poznamka: z.string().max(5000).optional(),
  prirazeno_id: z.coerce.number().int().positive().nullable().optional(),
});

// PATCH /api/admin/poptavky/:id
router.patch(
  '/:id',
  vyzaduje('poptavky', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const vstup = zvaliduj(schemaUprava, req.body ?? {});

    const [rows] = await pool.query(
      'SELECT id, jmeno, stav, interni_poznamka, prirazeno_id FROM poptavky WHERE id = ? AND smazano_at IS NULL',
      [id]
    );
    const pred = rows[0];
    if (!pred) throw chybaNenalezeno('Poptávka nenalezena.');

    const po = {
      stav: vstup.stav ?? pred.stav,
      interni_poznamka: vstup.interni_poznamka ?? pred.interni_poznamka,
      prirazeno_id:
        vstup.prirazeno_id === undefined ? pred.prirazeno_id : vstup.prirazeno_id,
    };

    await pool.query(
      'UPDATE poptavky SET stav = ?, interni_poznamka = ?, prirazeno_id = ? WHERE id = ?',
      [po.stav, po.interni_poznamka, po.prirazeno_id, id]
    );
    await zapisAudit({
      req,
      akce: 'zmena',
      entita: 'poptavka',
      entitaId: id,
      popis: pred.jmeno,
      pred: { stav: pred.stav },
      po: { stav: po.stav },
    });

    const [nove] = await pool.query('SELECT * FROM poptavky WHERE id = ?', [id]);
    res.json(nove[0]);
  })
);

const schemaOdpoved = z.object({
  odpoved: z.string().trim().min(2, 'Napiš odpověď.').max(10000),
  oznacit_vyrizene: z.boolean().default(true),
});

// POST /api/admin/poptavky/:id/odpovedet - odpoví e-mailem přímo z administrace
router.post(
  '/:id/odpovedet',
  vyzaduje('poptavky', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { odpoved, oznacit_vyrizene } = zvaliduj(schemaOdpoved, req.body ?? {});

    const [rows] = await pool.query(
      'SELECT id, jmeno, email, zprava FROM poptavky WHERE id = ? AND smazano_at IS NULL',
      [id]
    );
    const poptavka = rows[0];
    if (!poptavka) throw chybaNenalezeno('Poptávka nenalezena.');

    const podpis = await hodnota('emaily.podpis');
    const vysledek = await posliEmail({
      prijemce: poptavka.email,
      predmet: 'Odpověď na vaši zprávu — LSD',
      sablona: 'odpoved_na_poptavku',
      vazby: { poptavkaId: id },
      telo: obalka({
        titulek: `Dobrý den, ${poptavka.jmeno}`,
        obsahHtml:
          odpovedNaHtml(odpoved) +
          `<div style="margin-top:26px;padding-top:18px;border-top:1px solid rgba(255,255,255,.08);
                       font-size:13px;color:#8B8987">
             <div style="margin-bottom:6px">Vaše původní zpráva:</div>
             <div style="white-space:pre-wrap">${escapujProCitaci(poptavka.zprava ?? '')}</div>
           </div>`,
        podpis,
      }),
      textovaVerze: odpoved,
    });

    await pool.query(
      `UPDATE poptavky
          SET odpoved = ?, odpovezeno_at = NOW(), odpovedel_id = ?, stav = ?
        WHERE id = ?`,
      [odpoved, req.uzivatel.id, oznacit_vyrizene ? 'vyrizeno' : 'vyrizuje_se', id]
    );
    await zapisAudit({
      req,
      akce: 'odpoved',
      entita: 'poptavka',
      entitaId: id,
      popis: `Odpověď na ${poptavka.email}`,
    });

    // Neodeslalo se, ale režim to tak má: není to chyba a administrace kvůli
    // tomu nemá otevírat okno „zkontroluj nastavení“. Nastavení je v pořádku,
    // tohle je jeho důsledek.
    const zamerne = !vysledek.odeslano && !vysledek.doSchranky && !config.muzeZakaznikovi;

    res.json({
      ok: true,
      odeslano: vysledek.odeslano,
      email_do_schranky: Boolean(vysledek.doSchranky),
      zamerne,
      email_id: vysledek.id,
      zprava: vysledek.odeslano
        ? `Odpověď odešla na ${vysledek.prijemceSkutecny}.`
        : vysledek.doSchranky
          ? 'Odpověď je uložená v testovací schránce — zákazníkovi nic neodešlo.'
          : zamerne
            ? 'Odpověď je uložená. E-mail se neposílá — pošlete ji zákazníkovi ze své pošty.'
            : 'Odpověď je uložená, ale e-mail se neodeslal — zkontroluj nastavení odesílání.',
    });
  })
);

// DELETE /api/admin/poptavky/:id - měkké smazání
router.delete(
  '/:id',
  vyzaduje('poptavky', 'menit'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT id, jmeno FROM poptavky WHERE id = ? AND smazano_at IS NULL',
      [req.params.id]
    );
    if (!rows[0]) throw chybaNenalezeno('Poptávka nenalezena.');

    await pool.query('UPDATE poptavky SET smazano_at = NOW() WHERE id = ?', [req.params.id]);
    await zapisAudit({
      req,
      akce: 'smazani',
      entita: 'poptavka',
      entitaId: req.params.id,
      popis: rows[0].jmeno,
    });
    res.json({ ok: true, zprava: 'Poptávka je ve smazaných. Dá se obnovit.' });
  })
);

// POST /api/admin/poptavky/:id/obnovit
router.post(
  '/:id/obnovit',
  vyzaduje('poptavky', 'menit'),
  asyncHandler(async (req, res) => {
    const [vysledek] = await pool.query(
      'UPDATE poptavky SET smazano_at = NULL WHERE id = ? AND smazano_at IS NOT NULL',
      [req.params.id]
    );
    if (vysledek.affectedRows === 0) throw chybaNenalezeno('Smazaná poptávka nenalezena.');
    await zapisAudit({ req, akce: 'obnoveni', entita: 'poptavka', entitaId: req.params.id });
    res.json({ ok: true });
  })
);

// Odpověď píše člověk do textového pole; zachováme odstavce, ale nepustíme HTML.
function odpovedNaHtml(text) {
  return String(text)
    .split(/\n{2,}/)
    .map((odstavec) => `<p>${escapujProCitaci(odstavec).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function escapujProCitaci(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default router;
