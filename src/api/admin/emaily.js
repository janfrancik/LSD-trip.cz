// src/api/admin/emaily.js
//
// Odeslané e-maily. Na testu to je schránka: e-maily se nikam neposílají,
// ukládají se celé a tady se dají otevřít jako v poštovním klientovi -
// včetně odkazů, na které jde kliknout (reset hesla, pozvánka).
// V produkci je to log odeslaných e-mailů se stavem doručení z Resendu.
//
// Tělo e-mailu se servíruje zvlášť do sandboxovaného iframe. HTML z e-mailu
// se nikdy nevkládá do stránky administrace - je to cizí obsah a v iframe
// nemůže sáhnout na session ani na nic jiného.

import express from 'express';
import pool from '../../db.js';
import config from '../../config.js';
import { asyncHandler, chybaNenalezeno } from '../../chyby.js';
import { zvaliduj, schemaSeznam } from '../../validace.js';
import { vyzaduje } from '../../auth/opravneni.js';
import { prilohyEmailu, cestaKPrilozeEmailu } from '../../email/prilohy.js';

const router = express.Router();

const STAVY = [
  've_fronte', 've_schrance', 'odeslano', 'doruceno', 'otevreno',
  'kliknuto', 'bounce', 'stiznost', 'chyba',
];

// GET /api/admin/emaily
router.get(
  '/',
  vyzaduje('emaily_log'),
  asyncHandler(async (req, res) => {
    const { strana, na_strane, q } = zvaliduj(schemaSeznam, req.query);
    const stav = STAVY.includes(req.query.stav) ? req.query.stav : null;

    const kde = [];
    const params = [];
    if (stav) {
      kde.push('e.stav = ?');
      params.push(stav);
    }
    if (q) {
      kde.push('(e.prijemce LIKE ? OR e.predmet LIKE ? OR e.sablona_klic LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const kdeSql = kde.length ? 'WHERE ' + kde.join(' AND ') : '';

    const [[{ celkem }]] = await pool.query(
      `SELECT COUNT(*) AS celkem FROM emaily e ${kdeSql}`,
      params
    );
    const [data] = await pool.query(
      `SELECT e.id, e.prijemce, e.prijemce_skutecny, e.predmet, e.sablona_klic,
              e.stav, e.rezim, e.chyba, e.odeslano_at, e.created_at,
              e.poptavka_id, e.uzivatel_id,
              (SELECT COUNT(*) FROM email_prilohy p WHERE p.email_id = e.id) AS prilohy
         FROM emaily e
         ${kdeSql}
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT ? OFFSET ?`,
      [...params, na_strane, (strana - 1) * na_strane]
    );

    const [pocty] = await pool.query('SELECT stav, COUNT(*) AS pocet FROM emaily GROUP BY stav');

    res.json({
      data,
      celkem,
      strana,
      na_strane,
      // Podle režimu se obrazovka pojmenuje: na testu schránka, v produkci log.
      rezim: config.EMAIL_REZIM,
      pocty: Object.fromEntries(pocty.map((r) => [r.stav, r.pocet])),
    });
  })
);

// GET /api/admin/emaily/:id
router.get(
  '/:id',
  vyzaduje('emaily_log'),
  asyncHandler(async (req, res) => {
    const email = await nactiEmail(req.params.id);

    res.json({
      ...email,
      // HTML jde do náhledu přes srcdoc, ne přes adresu: iframe se zdrojem
      // z /api/ blokují některá rozšíření prohlížeče (ERR_BLOCKED_BY_CLIENT)
      // a náhled by zůstal prázdný. Se srcdoc žádný požadavek nevzniká.
      // Obsah je i tak v sandboxovaném iframe, takže do stránky administrace
      // nemůže sáhnout.
      telo_snapshot: undefined,
      telo_html: email.telo_snapshot ?? null,
      ma_html: Boolean(email.telo_snapshot),
      odkazy: odkazyZHtml(email.telo_snapshot),
      prilohy: await prilohyEmailu(email.id),
      udalosti: await udalostiEmailu(email.id),
    });
  })
);

// GET /api/admin/emaily/:id/telo - obsah pro iframe
router.get(
  '/:id/telo',
  vyzaduje('emaily_log'),
  asyncHandler(async (req, res) => {
    const email = await nactiEmail(req.params.id);
    const html = email.telo_snapshot ?? `<pre>${escapuj(email.telo_text ?? '')}</pre>`;

    // Vlastní CSP místo globální: žádné skripty, žádné cizí zdroje, ale
    // frame-ancestors 'self', aby si to administrace mohla vložit do iframe
    // (globální politika má 'none' a zobrazení by zakázala).
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; " +
        "font-src 'self'; frame-ancestors 'self'; form-action 'none'"
    );
    res.type('text/html; charset=utf-8');
    res.send(html);
  })
);

// GET /api/admin/emaily/:id/priloha/:prilohaId
router.get(
  '/:id/priloha/:prilohaId',
  vyzaduje('emaily_log'),
  asyncHandler(async (req, res) => {
    const [[priloha]] = await pool.query(
      'SELECT * FROM email_prilohy WHERE id = ? AND email_id = ?',
      [req.params.prilohaId, req.params.id]
    );
    if (!priloha) throw chybaNenalezeno('Příloha nenalezena.');

    const cesta = cestaKPrilozeEmailu(priloha.soubor);
    if (!cesta) throw chybaNenalezeno('Příloha nenalezena.');

    res.type(priloha.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${priloha.nazev.replace(/"/g, '')}"`);
    res.sendFile(cesta, (err) => {
      if (err && !res.headersSent) res.status(404).json({ chyba: 'Soubor přílohy chybí.' });
    });
  })
);

async function nactiEmail(id) {
  const [rows] = await pool.query('SELECT * FROM emaily WHERE id = ?', [id]);
  if (!rows[0]) throw chybaNenalezeno('E-mail nenalezen.');
  return rows[0];
}

async function udalostiEmailu(id) {
  const [rows] = await pool.query(
    'SELECT typ, created_at FROM email_udalosti WHERE email_id = ? ORDER BY created_at',
    [id]
  );
  return rows;
}

// Odkazy z e-mailu vypisujeme vedle náhledu. V sandboxovaném iframe sice jde
// kliknout taky, ale tohle funguje spolehlivě všude a je vidět, kam odkaz vede
// (u pozvánky nebo resetu hesla je to ta hlavní věc, kvůli které se sem chodí).
function odkazyZHtml(html) {
  if (!html) return [];
  const nalezene = new Set();
  for (const shoda of String(html).matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
    nalezene.add(dekodujEntity(shoda[1]));
  }
  return [...nalezene].slice(0, 20);
}

function dekodujEntity(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapuj(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default router;
