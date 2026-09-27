// src/api/admin/uzivatele.js
//
// Správa uživatelů administrace. Heslo nikdy nenastavuje správce - nový člověk
// dostane e-mailem odkaz na pozvánku a heslo si zvolí sám. Nikde se tedy
// neposílá ani nezapisuje heslo v čitelné podobě.

import express from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import { asyncHandler, chybaNenalezeno, chybaSpatnyVstup, chybaKonflikt } from '../../chyby.js';
import { zvaliduj, schemaEmail, schemaJmeno, schemaTelefon, schemaRole, schemaSeznam } from '../../validace.js';
import { vyzaduje } from '../../auth/opravneni.js';
import { zapisAudit, rozdil } from '../../audit.js';
import { zrusVsechnySession } from '../../auth/session.js';
import { posliOdkazNaHeslo } from './auth.js';

const router = express.Router();

const SLOUPCE = `id, email, jmeno, telefon, role, aktivni,
                 totp_potvrzeno_at IS NOT NULL AS ma_totp,
                 heslo_hash IS NOT NULL AS ma_heslo,
                 posledni_prihlaseni_at, zamceno_do, smazano_at, created_at`;

// GET /api/admin/uzivatele
router.get(
  '/',
  vyzaduje('uzivatele'),
  asyncHandler(async (req, res) => {
    const { strana, na_strane, q } = zvaliduj(schemaSeznam, req.query);
    const smazane = req.query.smazane === '1';

    const kde = [smazane ? 'smazano_at IS NOT NULL' : 'smazano_at IS NULL'];
    const params = [];
    if (q) {
      kde.push('(jmeno LIKE ? OR email LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const kdeSql = 'WHERE ' + kde.join(' AND ');

    const [[{ celkem }]] = await pool.query(
      `SELECT COUNT(*) AS celkem FROM uzivatele ${kdeSql}`,
      params
    );
    const [data] = await pool.query(
      `SELECT ${SLOUPCE} FROM uzivatele ${kdeSql}
        ORDER BY aktivni DESC, jmeno ASC
        LIMIT ? OFFSET ?`,
      [...params, na_strane, (strana - 1) * na_strane]
    );

    res.json({ data, celkem, strana, na_strane });
  })
);

const schemaNovy = z.object({
  email: schemaEmail,
  jmeno: schemaJmeno,
  telefon: schemaTelefon,
  role: schemaRole,
  poslat_pozvanku: z.boolean().default(true),
});

// POST /api/admin/uzivatele
router.post(
  '/',
  vyzaduje('uzivatele', 'menit'),
  asyncHandler(async (req, res) => {
    const vstup = zvaliduj(schemaNovy, req.body ?? {});

    const [existuje] = await pool.query('SELECT id, smazano_at FROM uzivatele WHERE email = ?', [
      vstup.email,
    ]);
    if (existuje[0]) {
      throw chybaKonflikt(
        existuje[0].smazano_at
          ? 'Uživatel s tímhle e-mailem už existoval a je smazaný. Obnov ho místo zakládání nového.'
          : 'Uživatel s tímhle e-mailem už existuje.',
        { email: 'E-mail je už použitý.' }
      );
    }

    const [vysledek] = await pool.query(
      `INSERT INTO uzivatele (email, jmeno, telefon, role, vytvoril_id)
       VALUES (?, ?, ?, ?, ?)`,
      [vstup.email, vstup.jmeno, vstup.telefon, vstup.role, req.uzivatel.id]
    );
    const id = vysledek.insertId;

    await zapisAudit({
      req,
      akce: 'vytvoreni',
      entita: 'uzivatel',
      entitaId: id,
      popis: `${vstup.jmeno} (${vstup.role})`,
      po: { email: vstup.email, jmeno: vstup.jmeno, role: vstup.role },
    });

    let pozvanka = null;
    if (vstup.poslat_pozvanku) {
      pozvanka = await posliOdkazNaHeslo(
        { id, jmeno: vstup.jmeno, email: vstup.email },
        'pozvanka',
        req
      );
    }

    const [rows] = await pool.query(`SELECT ${SLOUPCE} FROM uzivatele WHERE id = ?`, [id]);
    res.status(201).json({
      ...rows[0],
      pozvanka_odeslana: pozvanka?.odeslano ?? false,
      // Když e-mail neodešel (vypnuté odesílání, chybějící klíč), vrátíme odkaz,
      // ať ho správce může předat sám. Správce stejně může komukoli heslo
      // resetovat, takže tím nic navíc neotevíráme - jen ušetříme běh na server.
      ...(pozvanka && !pozvanka.odeslano ? { odkaz_na_heslo: pozvanka.url } : {}),
    });
  })
);

// GET /api/admin/uzivatele/:id
router.get(
  '/:id',
  vyzaduje('uzivatele'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT ${SLOUPCE} FROM uzivatele WHERE id = ?`, [
      req.params.id,
    ]);
    if (!rows[0]) throw chybaNenalezeno('Uživatel nenalezen.');
    res.json(rows[0]);
  })
);

const schemaUprava = z.object({
  jmeno: schemaJmeno.optional(),
  telefon: schemaTelefon,
  role: schemaRole.optional(),
  aktivni: z.boolean().optional(),
});

// PATCH /api/admin/uzivatele/:id
router.patch(
  '/:id',
  vyzaduje('uzivatele', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const vstup = zvaliduj(schemaUprava, req.body ?? {});

    const [rows] = await pool.query(
      'SELECT id, email, jmeno, telefon, role, aktivni FROM uzivatele WHERE id = ? AND smazano_at IS NULL',
      [id]
    );
    const pred = rows[0];
    if (!pred) throw chybaNenalezeno('Uživatel nenalezen.');

    // Pojistka proti tomu, aby administrace zůstala bez správce.
    if ((vstup.role && vstup.role !== 'admin') || vstup.aktivni === false) {
      await overPosledniAdmin(pred, id);
    }
    if (id === req.uzivatel.id && vstup.aktivni === false) {
      throw chybaSpatnyVstup('Sám sebe deaktivovat nemůžeš.');
    }

    const po = {
      jmeno: vstup.jmeno ?? pred.jmeno,
      telefon: vstup.telefon ?? pred.telefon,
      role: vstup.role ?? pred.role,
      aktivni: vstup.aktivni === undefined ? pred.aktivni : vstup.aktivni ? 1 : 0,
    };

    await pool.query(
      'UPDATE uzivatele SET jmeno = ?, telefon = ?, role = ?, aktivni = ?, upravil_id = ? WHERE id = ?',
      [po.jmeno, po.telefon, po.role, po.aktivni, req.uzivatel.id, id]
    );

    // Odebrání práv nebo deaktivace musí platit hned, ne až vyprší session.
    if (po.role !== pred.role || !po.aktivni) await zrusVsechnySession(id);

    const zmena = rozdil(pred, po);
    if (zmena) {
      await zapisAudit({
        req,
        akce: 'zmena',
        entita: 'uzivatel',
        entitaId: id,
        popis: pred.jmeno,
        pred: zmena.pred,
        po: zmena.po,
      });
    }

    const [nove] = await pool.query(`SELECT ${SLOUPCE} FROM uzivatele WHERE id = ?`, [id]);
    res.json(nove[0]);
  })
);

// DELETE /api/admin/uzivatele/:id - soft delete
router.delete(
  '/:id',
  vyzaduje('uzivatele', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.uzivatel.id) throw chybaSpatnyVstup('Sám sebe smazat nemůžeš.');

    const [rows] = await pool.query(
      'SELECT id, jmeno, email, role FROM uzivatele WHERE id = ? AND smazano_at IS NULL',
      [id]
    );
    if (!rows[0]) throw chybaNenalezeno('Uživatel nenalezen.');
    await overPosledniAdmin(rows[0], id);

    await pool.query(
      'UPDATE uzivatele SET smazano_at = NOW(), aktivni = 0, upravil_id = ? WHERE id = ?',
      [req.uzivatel.id, id]
    );
    await zrusVsechnySession(id);
    await zapisAudit({
      req,
      akce: 'smazani',
      entita: 'uzivatel',
      entitaId: id,
      popis: rows[0].jmeno,
      pred: rows[0],
    });

    res.json({ ok: true, zprava: `${rows[0].jmeno} už do administrace nemá přístup.` });
  })
);

// POST /api/admin/uzivatele/:id/obnovit
router.post(
  '/:id/obnovit',
  vyzaduje('uzivatele', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [rows] = await pool.query(
      'SELECT id, jmeno FROM uzivatele WHERE id = ? AND smazano_at IS NOT NULL',
      [id]
    );
    if (!rows[0]) throw chybaNenalezeno('Smazaný uživatel nenalezen.');

    await pool.query(
      'UPDATE uzivatele SET smazano_at = NULL, aktivni = 1, upravil_id = ? WHERE id = ?',
      [req.uzivatel.id, id]
    );
    await zapisAudit({ req, akce: 'obnoveni', entita: 'uzivatel', entitaId: id, popis: rows[0].jmeno });
    res.json({ ok: true, zprava: `${rows[0].jmeno} je obnovený.` });
  })
);

// POST /api/admin/uzivatele/:id/reset-hesla - správce pošle odkaz
router.post(
  '/:id/reset-hesla',
  vyzaduje('uzivatele', 'menit'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT id, jmeno, email, heslo_hash FROM uzivatele WHERE id = ? AND smazano_at IS NULL AND aktivni = 1',
      [req.params.id]
    );
    if (!rows[0]) throw chybaNenalezeno('Uživatel nenalezen.');

    const ucel = rows[0].heslo_hash ? 'reset' : 'pozvanka';
    const vysledek = await posliOdkazNaHeslo(rows[0], ucel, req);

    res.json({
      ok: true,
      odeslano: vysledek.odeslano,
      zprava: vysledek.odeslano
        ? `Odkaz pro nastavení hesla jsme poslali na ${vysledek.prijemceSkutecny}.`
        : 'E-mail se neodeslal — odesílání e-mailů není nastavené. Předej odkaz níž osobně.',
      ...(vysledek.odeslano ? {} : { odkaz_na_heslo: vysledek.url }),
    });
  })
);

// Nikdy nesmí zmizet poslední aktivní správce, jinak by se do administrace
// nikdo nedostal a muselo by se zasahovat do databáze.
async function overPosledniAdmin(uzivatel, id) {
  if (uzivatel.role !== 'admin') return;
  const [[{ pocet }]] = await pool.query(
    `SELECT COUNT(*) AS pocet FROM uzivatele
      WHERE role = 'admin' AND aktivni = 1 AND smazano_at IS NULL AND id <> ?`,
    [id]
  );
  if (pocet === 0) {
    throw chybaSpatnyVstup(
      'Tohle je poslední správce administrace. Nejdřív přidej jiného, pak teprve tohohle uprav.'
    );
  }
}

export default router;
