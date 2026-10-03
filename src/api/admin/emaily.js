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
import { z } from 'zod';
import pool from '../../db.js';
import config from '../../config.js';
import { asyncHandler, chybaNenalezeno, chybaKonflikt } from '../../chyby.js';
import { zvaliduj, schemaSeznam } from '../../validace.js';
import { vyzaduje } from '../../auth/opravneni.js';
import { prilohyEmailu, cestaKPrilozeEmailu } from '../../email/prilohy.js';
import { odesliZnovu } from '../../email/posli.js';
import { SABLONY_INTERNI } from '../../email/sablony.js';
import { zapisAudit } from '../../audit.js';
import { sklon } from '../../cas.js';

const router = express.Router();

const STAVY = [
  've_fronte', 've_schrance', 'neodeslano', 'odeslano', 'doruceno', 'otevreno',
  'kliknuto', 'bounce', 'stiznost', 'chyba',
];

// Nejvíc e-mailů, které pustíme v jedné hromadné akci. Resend má na free
// tarifu 100 e-mailů denně, takže větší dávka by zbytek jen utopila v chybách;
// a požadavek by běžel tak dlouho, že by ho prohlížeč vzdal.
const HROMADNE_MAX = 50;

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
      // Jestli má smysl nabízet "Odeslat znovu". V jen_provoz a vypnuto ne.
      muze_zakaznikovi: config.muzeZakaznikovi,
      pocty: Object.fromEntries(pocty.map((r) => [r.stav, r.pocet])),
    });
  })
);

// GET /api/admin/emaily/neodeslane - náhled pro hromadné rozeslání
//
// Musí být nad '/:id', jinak by "neodeslane" skončilo jako id.
router.get(
  '/neodeslane',
  vyzaduje('emaily_log'),
  asyncHandler(async (req, res) => {
    const { od, do: doData } = zvaliduj(schemaObdobi, req.query);
    const { kdeSql, params } = kdeNeodeslane(od, doData);

    const [[souhrn]] = await pool.query(
      `SELECT COUNT(*) AS celkem, MIN(e.created_at) AS nejstarsi, MAX(e.created_at) AS nejnovejsi
         FROM emaily e ${kdeSql}`,
      params
    );

    const [ukazka] = await pool.query(
      `SELECT e.id, e.prijemce, e.predmet, e.sablona_klic, e.created_at
         FROM emaily e ${kdeSql}
        ORDER BY e.created_at LIMIT 10`,
      params
    );

    res.json({
      celkem: Number(souhrn.celkem ?? 0),
      nejstarsi: souhrn.nejstarsi,
      nejnovejsi: souhrn.nejnovejsi,
      // Víc než HROMADNE_MAX se v jedné akci neodešle - obrazovka to řekne
      // dopředu, ať nikdo nečeká, že jedno kliknutí vyřídí všechno.
      davka: Math.min(Number(souhrn.celkem ?? 0), HROMADNE_MAX),
      max_v_davce: HROMADNE_MAX,
      muze_zakaznikovi: config.muzeZakaznikovi,
      rezim: config.EMAIL_REZIM,
      ukazka,
    });
  })
);

// POST /api/admin/emaily/neodeslane/odeslat - hromadné rozeslání
router.post(
  '/neodeslane/odeslat',
  vyzaduje('emaily_odeslat'),
  asyncHandler(async (req, res) => {
    if (!config.muzeZakaznikovi) throw chybaRezimu();

    const { od, do: doData } = zvaliduj(schemaObdobi, req.body ?? {});
    const { kdeSql, params } = kdeNeodeslane(od, doData);

    // Seznam se načte dopředu a posílá se po jednom. Každý e-mail si v
    // odesliZnovu() zabere svůj řádek, takže souběžné kliknutí ani druhá
    // dávka tentýž e-mail neodešlou dvakrát.
    const [kOdeslani] = await pool.query(
      `SELECT e.id FROM emaily e ${kdeSql} ORDER BY e.created_at LIMIT ?`,
      [...params, HROMADNE_MAX]
    );

    let odeslano = 0;
    let preskoceno = 0;
    let chyby = 0;
    for (const { id } of kOdeslani) {
      const vysledek = await odesliZnovu(id);
      if (vysledek.odeslano) odeslano += 1;
      else if (vysledek.duvod === 'jiz_vyrizeno') preskoceno += 1;
      else chyby += 1;
    }

    await zapisAudit({
      req, akce: 'hromadne_odeslani', entita: 'email', entitaId: null,
      popis: `hromadné rozeslání neodeslaných: ${odeslano} odesláno, ${chyby} chyba, ${preskoceno} přeskočeno`,
      po: { od, do: doData, odeslano, chyby, preskoceno },
    });

    res.json({
      odeslano,
      chyby,
      preskoceno,
      zbyva: Math.max(0, kOdeslani.length - odeslano - preskoceno - chyby),
      zprava: odeslano
        ? `Odesláno ${odeslano} ${sklon(odeslano, 'e-mail', 'e-maily', 'e-mailů')}.`
        : 'Neodešlo nic — podrobnosti jsou u jednotlivých e-mailů.',
    });
  })
);

// POST /api/admin/emaily/:id/odeslat-znovu
router.post(
  '/:id/odeslat-znovu',
  vyzaduje('emaily_odeslat'),
  asyncHandler(async (req, res) => {
    if (!config.muzeZakaznikovi) throw chybaRezimu();

    const vysledek = await odesliZnovu(Number(req.params.id));

    if (vysledek.duvod === 'nenalezeno') throw chybaNenalezeno('E-mail nenalezen.');
    if (vysledek.duvod === 'jiz_vyrizeno') {
      throw chybaKonflikt('Tenhle e-mail už někdo odeslal — podívejte se na jeho stav.');
    }
    if (!vysledek.odeslano) {
      throw chybaKonflikt(
        'E-mail se nepodařilo odeslat. Důvod je u e-mailu v poli chyba — ' +
          'nejčastěji to je neověřená doména u odesílací služby.'
      );
    }

    await zapisAudit({
      req, akce: 'opakovane_odeslani', entita: 'email', entitaId: req.params.id,
      popis: 'opakované odeslání e-mailu',
    });

    res.json({ ok: true, zprava: 'E-mail odešel.' });
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
      // Tlačítko "Odeslat znovu" se ukáže u zákaznického e-mailu, který buď
      // režim zakázal ('neodeslano'), nebo u kterého odeslání selhalo
      // ('chyba' - typicky 403, než se ověřila doména). Jen v režimu, který
      // umí odeslat. Interní upozornění se nedoposílá - za týden už nikoho
      // nezajímá, že přišla přihláška.
      lze_odeslat_znovu:
        ['neodeslano', 'chyba'].includes(email.stav) &&
        config.muzeZakaznikovi &&
        !SABLONY_INTERNI.has(email.sablona_klic),
      interni: SABLONY_INTERNI.has(email.sablona_klic),
      rezim_umi_zakaznikovi: config.muzeZakaznikovi,
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

// Období pro hromadnou akci. Oboje nepovinné: bez hranic se vezme všechno
// neodeslané, což je po zapnutí odesílání ta nejčastější situace.
const schemaObdobi = z.object({
  od: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum ve formátu RRRR-MM-DD.').optional(),
  do: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum ve formátu RRRR-MM-DD.').optional(),
});

// Hromadné rozeslání se týká jen e-mailů zákazníkům. Interní upozornění se
// nedoposílají: "přišla nová přihláška" má cenu ve chvíli, kdy přijde, a za
// týden je to jen šum v poštovní schránce provozu.
function kdeNeodeslane(od, doData) {
  const kde = [`e.stav = 'neodeslano'`, `(e.sablona_klic IS NULL OR e.sablona_klic NOT IN (?))`];
  const params = [[...SABLONY_INTERNI]];

  if (od) {
    kde.push('e.created_at >= ?');
    params.push(`${od} 00:00:00`);
  }
  if (doData) {
    kde.push('e.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(`${doData} 00:00:00`);
  }
  return { kdeSql: 'WHERE ' + kde.join(' AND '), params };
}

function chybaRezimu() {
  return chybaKonflikt(
    `V režimu ${config.EMAIL_REZIM} se zákazníkům neodesílá. ` +
      'Nejdřív přepněte EMAIL_REZIM na live (až bude ověřená doména u odesílací služby).'
  );
}

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
