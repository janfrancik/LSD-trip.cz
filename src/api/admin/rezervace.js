// src/api/admin/rezervace.js
//
// Přihlášky na termín (etapa E5 modulu Kurzy).
//
// Stavy přepíná provoz ručně: nová → potvrzená → zaplacená, kdykoli storno
// s důvodem. Platební brána v tomhle modulu není (rozhodnutí 8), takže
// "zaplacená" znamená "provoz viděl peníze na účtu".
//
// Ke každé změně stavu se **může** poslat e-mail - rozhoduje se v dialogu,
// ne automatikou. Provoz často nejdřív zavolá a e-mail by byl navíc.
//
// Osobní údaje do auditu nepatří. Zapisuje se číslo přihlášky a jméno,
// ne e-mail, telefon ani datum narození (proAudit níž).

import express from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import config from '../../config.js';
import { SABLONY_INTERNI } from '../../email/sablony.js';
import { asyncHandler, chybaNenalezeno, chybaKonflikt } from '../../chyby.js';
import { zvaliduj, schemaSeznam, schemaEmail, schemaJmeno, schemaTelefon } from '../../validace.js';
import { vyzaduje } from '../../auth/opravneni.js';
import { zapisAudit } from '../../audit.js';
import { posliCsv, anoNe } from '../../csv.js';
import { datum as formatujDatum } from '../../cas.js';
import {
  STAVY, STAVY_DRZICI_MISTO, zapisPrihlasku, nactiPrihlasku, prepocitejObsazenost,
  posliOznameni, popisTerminu,
} from '../../prihlasky.js';

const router = express.Router();

// Ke kterému stavu patří která šablona. Co tu není, se neoznamuje.
const SABLONA_KE_STAVU = {
  potvrzena: 'prihlaska_potvrzena',
  zaplacena: 'prihlaska_zaplacena',
  storno: 'prihlaska_zrusena',
};

const POPIS_STAVU = {
  nova: 'nová',
  potvrzena: 'potvrzená',
  zaplacena: 'zaplacená',
  probehla: 'proběhla',
  storno: 'storno',
  presunuta: 'přesunutá',
  no_show: 'nedorazil',
};

// Do auditu jen to, co není osobní údaj.
function proAudit(prihlaska) {
  return {
    kod: prihlaska.kod,
    stav: prihlaska.stav,
    zakaznik_id: prihlaska.zakaznik_id,
    termin_id: prihlaska.termin_id,
    pocet_osob: prihlaska.pocet_osob,
  };
}

function popisProAudit(prihlaska) {
  return `${prihlaska.kod} — ${prihlaska.zakaznik_jmeno}`;
}

// ------------------------------------------------------------------ seznam

// GET /api/admin/rezervace?stav=&termin=&produkt=&q=
router.get(
  '/',
  vyzaduje('rezervace'),
  asyncHandler(async (req, res) => {
    const { strana, na_strane, q } = zvaliduj(schemaSeznam, req.query);
    const { kde, params } = filtrSeznamu(req, q);

    const spojeni = `
      FROM rezervace r
      JOIN zakaznici z ON z.id = r.zakaznik_id
      JOIN produkty p ON p.id = r.produkt_id
      LEFT JOIN terminy t ON t.id = r.termin_id`;

    const [[{ celkem }]] = await pool.query(
      `SELECT COUNT(*) AS celkem ${spojeni} WHERE ${kde}`,
      params
    );
    const [data] = await pool.query(
      `SELECT r.id, r.kod, r.stav, r.pocet_osob, r.cena_hal, r.uhrazeno_hal, r.created_at,
              r.termin_id, r.zdroj,
              z.jmeno AS zakaznik_jmeno, z.email AS zakaznik_email, z.telefon AS zakaznik_telefon,
              p.nazev AS produkt_nazev,
              t.datum, t.cas_od, t.popis_casu
         ${spojeni}
        WHERE ${kde}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ? OFFSET ?`,
      [...params, na_strane, (strana - 1) * na_strane]
    );

    res.json({ data, celkem, strana, na_strane });
  })
);

function filtrSeznamu(req, q) {
  const kde = [req.query.smazane === '1' ? 'r.smazano_at IS NOT NULL' : 'r.smazano_at IS NULL'];
  const params = [];

  if (STAVY.includes(req.query.stav)) {
    kde.push('r.stav = ?');
    params.push(req.query.stav);
  }
  if (req.query.termin) {
    kde.push('r.termin_id = ?');
    params.push(Number(req.query.termin));
  }
  if (req.query.produkt) {
    kde.push('r.produkt_id = ?');
    params.push(Number(req.query.produkt));
  }
  if (q) {
    kde.push('(r.kod LIKE ? OR z.jmeno LIKE ? OR z.email LIKE ? OR z.telefon LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  return { kde: kde.join(' AND '), params };
}

// GET /api/admin/rezervace/export.csv
//
// Přehled přihlášek pro účetní a pro majitelku. Soupiska na letiště je
// jinde (u termínu) a má jiné sloupce - tahle tabulka je o penězích.
router.get(
  '/export.csv',
  vyzaduje('rezervace'),
  asyncHandler(async (req, res) => {
    const { q } = zvaliduj(schemaSeznam, req.query);
    const { kde, params } = filtrSeznamu(req, q);

    const [data] = await pool.query(
      `SELECT r.kod, r.stav, r.pocet_osob, r.cena_hal, r.uhrazeno_hal, r.created_at, r.zdroj,
              z.jmeno AS zakaznik_jmeno, z.email AS zakaznik_email, z.telefon AS zakaznik_telefon,
              p.nazev AS produkt_nazev, t.datum
         FROM rezervace r
         JOIN zakaznici z ON z.id = r.zakaznik_id
         JOIN produkty p ON p.id = r.produkt_id
         LEFT JOIN terminy t ON t.id = r.termin_id
        WHERE ${kde}
        ORDER BY r.created_at DESC
        LIMIT 5000`,
      params
    );

    posliCsv(
      res,
      'prihlasky.csv',
      ['Číslo', 'Přijato', 'Kurz', 'Termín', 'Zákazník', 'E-mail', 'Telefon',
        'Osob', 'Stav', 'Cena Kč', 'Zaplaceno Kč', 'Zdroj'],
      data.map((r) => [
        r.kod,
        formatujDatum(r.created_at),
        r.produkt_nazev,
        r.datum ? formatujDatum(r.datum) : '',
        r.zakaznik_jmeno,
        r.zakaznik_email ?? '',
        r.zakaznik_telefon ?? '',
        r.pocet_osob,
        POPIS_STAVU[r.stav] ?? r.stav,
        Math.round(r.cena_hal / 100),
        Math.round(r.uhrazeno_hal / 100),
        r.zdroj,
      ])
    );
  })
);

// ------------------------------------------------------------------ detail

// GET /api/admin/rezervace/:id
router.get(
  '/:id(\\d+)',
  vyzaduje('rezervace'),
  asyncHandler(async (req, res) => {
    const prihlaska = await nactiPrihlasku(Number(req.params.id));
    if (!prihlaska) throw chybaNenalezeno('Přihláška nenalezena.');

    const [emaily] = await pool.query(
      `SELECT id, sablona_klic, predmet, prijemce, stav, chyba, created_at
         FROM emaily WHERE rezervace_id = ? ORDER BY id DESC LIMIT 20`,
      [prihlaska.id]
    );

    // Dostal zákazník vůbec něco? V režimu bez odesílání zákazníkům se
    // přihláška uloží a vypadá hotově, ale člověk na druhé straně neví nic.
    // Provoz to musí vidět na detailu, ne až v logu e-mailů.
    const neodeslaneZakaznikovi = emaily.filter(
      (e) => e.stav === 'neodeslano' && !SABLONY_INTERNI.has(e.sablona_klic)
    ).length;

    res.json({
      ...prihlaska,
      emaily,
      neodeslane_zakaznikovi: neodeslaneZakaznikovi,
      email_rezim: config.EMAIL_REZIM,
      muze_zakaznikovi: config.muzeZakaznikovi,
    });
  })
);

// ------------------------------------------------------------------- zápis

// POST /api/admin/rezervace - přihláška po telefonu
//
// Souhlasy se tudy **nezaznamenávají**: po telefonu je nikdo neodklikne
// a tvrdit, že je zákazník potvrdil, by bylo doložitelné jen těžko.
// Papír se podepisuje na místě a soupiska na to u takové přihlášky
// upozorní (viz src/prihlasky-soupiska.js).
router.post(
  '/',
  vyzaduje('rezervace', 'menit'),
  asyncHandler(async (req, res) => {
    const vstup = zvaliduj(
      z.object({
        termin_id: z.coerce.number({ error: 'Vyber termín.' }).int().positive('Vyber termín.'),
        jmeno: schemaJmeno,
        email: schemaEmail,
        telefon: schemaTelefon,
        ucastnici: z.array(
          z.object({
            jmeno: z.string().trim().min(2, 'Jméno účastníka je povinné.').max(160),
            datum_narozeni: z.string().trim()
              .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum narození zadej jako 1990-05-17.')
              .nullable().optional().or(z.literal('')).transform((v) => (v ? v : null)),
            vaha_kg: z.coerce.number().int().min(20).max(300).nullable().optional(),
            telefon: z.string().trim().max(40).nullable().optional().or(z.literal(''))
              .transform((v) => (v ? v : null)),
            poznamka: z.string().trim().max(500).nullable().optional().or(z.literal(''))
              .transform((v) => (v ? v : null)),
          })
        ).min(1, 'Přidej aspoň jednoho účastníka.').max(10),
        zprava: z.string().trim().max(2000).nullable().optional(),
        poslat_email: z.coerce.boolean().default(false),
      }),
      req.body ?? {}
    );

    const vysledek = await zapisPrihlasku({
      terminId: vstup.termin_id,
      kontakt: { jmeno: vstup.jmeno, email: vstup.email, telefon: vstup.telefon },
      ucastnici: vstup.ucastnici,
      souhlasy: { vop: false, gdpr: false, zdravi: false },
      zprava: vstup.zprava ?? null,
      zdroj: 'telefon',
      uzivatelId: req.uzivatel.id,
    });

    const prihlaska = await nactiPrihlasku(vysledek.id);
    if (vstup.poslat_email) {
      await posliOznameni('prihlaska_prijata', prihlaska).catch((chyba) =>
        console.error('[rezervace] e-mail neodešel:', chyba.message)
      );
    }

    await zapisAudit({
      req, akce: 'vytvoreni', entita: 'rezervace', entitaId: prihlaska.id,
      popis: popisProAudit(prihlaska), po: proAudit(prihlaska),
    });
    // Odpověď na akci je schválně úzká, ne celá přihláška: `zprava` je
    // u přihlášky vzkaz od zákazníka a zároveň zvyklost pro hlášku v
    // administraci. Smíchané do jednoho objektu by jedno přepsalo druhé.
    res.status(201).json({
      ok: true,
      id: prihlaska.id,
      kod: prihlaska.kod,
      zdroj: prihlaska.zdroj,
      pocet_osob: prihlaska.pocet_osob,
      varovani: vysledek.varovani,
      zprava:
        'Přihláška je zapsaná. Souhlasy chybí — papír se podepisuje na místě, ' +
        'soupiska na to upozorní.',
    });
  })
);

// PATCH /api/admin/rezervace/:id - poznámka provozu a zaplacená částka
router.patch(
  '/:id(\\d+)',
  vyzaduje('rezervace', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const vstup = zvaliduj(
      z.object({
        interni_poznamka: z.string().trim().max(5000).nullable().optional(),
        uhrazeno_kc: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
        splatnost: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
          .or(z.literal('')).transform((v) => (v ? v : null)),
      }),
      req.body ?? {}
    );

    const pred = await nactiPrihlasku(id);
    if (!pred || pred.smazano_at) throw chybaNenalezeno('Přihláška nenalezena.');

    const zmeny = {};
    if (vstup.interni_poznamka !== undefined) zmeny.interni_poznamka = vstup.interni_poznamka;
    if (vstup.uhrazeno_kc !== undefined && vstup.uhrazeno_kc !== null) {
      zmeny.uhrazeno_hal = vstup.uhrazeno_kc * 100;
    }
    if (vstup.splatnost !== undefined) zmeny.splatnost = vstup.splatnost;
    if (!Object.keys(zmeny).length) return res.json(pred);

    zmeny.upravil_id = req.uzivatel.id;
    const sloupce = Object.keys(zmeny);
    await pool.query(
      `UPDATE rezervace SET ${sloupce.map((s) => `${s} = ?`).join(', ')} WHERE id = ?`,
      [...sloupce.map((s) => zmeny[s]), id]
    );

    await zapisAudit({
      req, akce: 'zmena', entita: 'rezervace', entitaId: id,
      popis: popisProAudit(pred),
      // Text poznámky se do auditu nepíše - může v ní být cokoli osobního.
      po: { zmeneno: sloupce.filter((s) => s !== 'upravil_id') },
    });
    res.json(await nactiPrihlasku(id));
  })
);

// PUT /api/admin/rezervace/:id/ucastnici - doplnění jmen a údajů
router.put(
  '/:id(\\d+)/ucastnici',
  vyzaduje('rezervace', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { ucastnici } = zvaliduj(
      z.object({
        ucastnici: z.array(
          z.object({
            jmeno: z.string().trim().min(2, 'Jméno účastníka je povinné.').max(160),
            datum_narozeni: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum zadej jako 1990-05-17.')
              .nullable().optional().or(z.literal('')).transform((v) => (v ? v : null)),
            vaha_kg: z.coerce.number().int().min(20).max(300).nullable().optional(),
            telefon: z.string().trim().max(40).nullable().optional().or(z.literal(''))
              .transform((v) => (v ? v : null)),
            email: z.string().trim().max(255).nullable().optional().or(z.literal(''))
              .transform((v) => (v ? v : null)),
            doklada_prohlidku: z.coerce.boolean().default(false),
            zajisti_souhlas_zastupce: z.coerce.boolean().default(false),
            dorazil: z.coerce.boolean().default(false),
            poznamka: z.string().trim().max(500).nullable().optional().or(z.literal(''))
              .transform((v) => (v ? v : null)),
          })
        ).min(1, 'Přihláška musí mít aspoň jednoho účastníka.').max(10),
      }),
      req.body ?? {}
    );

    const pred = await nactiPrihlasku(id);
    if (!pred || pred.smazano_at) throw chybaNenalezeno('Přihláška nenalezena.');

    const spojeni = await pool.getConnection();
    try {
      await spojeni.beginTransaction();
      await spojeni.query('DELETE FROM rezervace_ucastnici WHERE rezervace_id = ?', [id]);
      for (const u of ucastnici) {
        await spojeni.query(
          `INSERT INTO rezervace_ucastnici
             (rezervace_id, jmeno, datum_narozeni, vaha_kg, telefon, email,
              doklada_prohlidku, zajisti_souhlas_zastupce, dorazil, poznamka)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, u.jmeno, u.datum_narozeni ?? null, u.vaha_kg ?? null,
            u.telefon ?? null, u.email ?? null,
            u.doklada_prohlidku ? 1 : 0, u.zajisti_souhlas_zastupce ? 1 : 0,
            u.dorazil ? 1 : 0, u.poznamka ?? null,
          ]
        );
      }
      // Počet osob drží kapacitu, takže se musí hýbat spolu s účastníky.
      await spojeni.query('UPDATE rezervace SET pocet_osob = ?, upravil_id = ? WHERE id = ?', [
        ucastnici.length, req.uzivatel.id, id,
      ]);
      if (pred.termin_id) await prepocitejObsazenost(spojeni, pred.termin_id);
      await spojeni.commit();
    } catch (chyba) {
      await spojeni.rollback();
      throw chyba;
    } finally {
      spojeni.release();
    }

    await zapisAudit({
      req, akce: 'zmena', entita: 'rezervace', entitaId: id,
      popis: `${pred.kod} — účastníci`,
      po: { pocet_osob: ucastnici.length },
    });
    res.json(await nactiPrihlasku(id));
  })
);

// ------------------------------------------------------------------- stavy

// POST /api/admin/rezervace/:id/stav
router.post(
  '/:id(\\d+)/stav',
  vyzaduje('rezervace', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const vstup = zvaliduj(
      z.object({
        // Storno má vlastní cestu - potřebuje důvod.
        stav: z.enum(['nova', 'potvrzena', 'zaplacena', 'probehla', 'no_show'], {
          error: 'Storno má vlastní tlačítko — je k němu potřeba důvod.',
        }),
        poslat_email: z.coerce.boolean().default(false),
      }),
      req.body ?? {}
    );

    const pred = await nactiPrihlasku(id);
    if (!pred || pred.smazano_at) throw chybaNenalezeno('Přihláška nenalezena.');
    if (pred.stav === vstup.stav) return res.json(pred);

    const spojeni = await pool.getConnection();
    try {
      await spojeni.beginTransaction();
      await spojeni.query(
        `UPDATE rezervace
            SET stav = ?, storno_duvod = NULL, storno_at = NULL, upravil_id = ?
          WHERE id = ?`,
        [vstup.stav, req.uzivatel.id, id]
      );
      // Návrat ze storna zpátky mezi živé přihlášky zabere místo - a může
      // kapacitu přetáhnout, proto se přepočítá hned.
      if (pred.termin_id) await prepocitejObsazenost(spojeni, pred.termin_id);
      await spojeni.commit();
    } catch (chyba) {
      await spojeni.rollback();
      throw chyba;
    } finally {
      spojeni.release();
    }

    const po = await nactiPrihlasku(id);
    const email = vstup.poslat_email ? await posliKeStavu(po, vstup.stav) : null;

    await zapisAudit({
      req, akce: 'zmena', entita: 'rezervace', entitaId: id,
      popis: `${pred.kod} — stav ${POPIS_STAVU[vstup.stav] ?? vstup.stav}`,
      pred: { stav: pred.stav }, po: { stav: vstup.stav, email: Boolean(email) },
    });

    res.json({
      ok: true,
      id: po.id,
      kod: po.kod,
      stav: po.stav,
      email_odeslan: Boolean(email),
      email_do_schranky: email?.doSchranky ?? false,
    });
  })
);

// POST /api/admin/rezervace/:id/storno
router.post(
  '/:id(\\d+)/storno',
  vyzaduje('rezervace', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const vstup = zvaliduj(
      z.object({
        duvod: z.string({ error: 'Napiš důvod storna.' }).trim()
          .min(3, 'Napiš důvod storna — přečte si ho i přihlášený.')
          .max(500, 'Důvod je příliš dlouhý.'),
        poslat_email: z.coerce.boolean().default(true),
      }),
      req.body ?? {}
    );

    const pred = await nactiPrihlasku(id);
    if (!pred || pred.smazano_at) throw chybaNenalezeno('Přihláška nenalezena.');
    if (pred.stav === 'storno') throw chybaKonflikt('Přihláška je už stornovaná.');

    const spojeni = await pool.getConnection();
    try {
      await spojeni.beginTransaction();
      await spojeni.query(
        `UPDATE rezervace
            SET stav = 'storno', storno_duvod = ?, storno_at = NOW(), upravil_id = ?
          WHERE id = ?`,
        [vstup.duvod, req.uzivatel.id, id]
      );
      // Místo se uvolní hned - jiný zájemce na něj čeká.
      if (pred.termin_id) await prepocitejObsazenost(spojeni, pred.termin_id);
      await spojeni.commit();
    } catch (chyba) {
      await spojeni.rollback();
      throw chyba;
    } finally {
      spojeni.release();
    }

    const po = await nactiPrihlasku(id);
    const email = vstup.poslat_email
      ? await posliOznameni('prihlaska_zrusena', po, { duvod: vstup.duvod }).catch((chyba) => {
          console.error('[rezervace] e-mail neodešel:', chyba.message);
          return null;
        })
      : null;

    await zapisAudit({
      req, akce: 'zmena', entita: 'rezervace', entitaId: id,
      popis: `${pred.kod} — storno`,
      pred: { stav: pred.stav }, po: { stav: 'storno', email: Boolean(email) },
    });

    res.json({
      ok: true,
      id: po.id,
      kod: po.kod,
      stav: po.stav,
      email_odeslan: Boolean(email),
      email_do_schranky: email?.doSchranky ?? false,
      zprava: 'Přihláška je stornovaná, místo na termínu se uvolnilo.',
    });
  })
);

async function posliKeStavu(prihlaska, stav) {
  const klic = SABLONA_KE_STAVU[stav];
  if (!klic) return null;
  return posliOznameni(klic, prihlaska).catch((chyba) => {
    console.error('[rezervace] e-mail neodešel:', chyba.message);
    return null;
  });
}

// ------------------------------------------------------------------ mazání

// DELETE /api/admin/rezervace/:id - měkké smazání
//
// Pro omyly a zkoušky. Pro skutečné zrušení je storno s důvodem, které
// zákazníkovi dá vědět.
router.delete(
  '/:id(\\d+)',
  vyzaduje('rezervace', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const prihlaska = await nactiPrihlasku(id);
    if (!prihlaska || prihlaska.smazano_at) throw chybaNenalezeno('Přihláška nenalezena.');

    const spojeni = await pool.getConnection();
    try {
      await spojeni.beginTransaction();
      await spojeni.query(
        'UPDATE rezervace SET smazano_at = NOW(), upravil_id = ? WHERE id = ?',
        [req.uzivatel.id, id]
      );
      if (prihlaska.termin_id) await prepocitejObsazenost(spojeni, prihlaska.termin_id);
      await spojeni.commit();
    } catch (chyba) {
      await spojeni.rollback();
      throw chyba;
    } finally {
      spojeni.release();
    }

    await zapisAudit({
      req, akce: 'smazani', entita: 'rezervace', entitaId: id, popis: popisProAudit(prihlaska),
    });
    res.json({ ok: true, zprava: 'Přihláška je ve smazaných. Dá se obnovit.' });
  })
);

// POST /api/admin/rezervace/:id/obnovit
router.post(
  '/:id(\\d+)/obnovit',
  vyzaduje('rezervace', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [vysledek] = await pool.query(
      'UPDATE rezervace SET smazano_at = NULL, upravil_id = ? WHERE id = ? AND smazano_at IS NOT NULL',
      [req.uzivatel.id, id]
    );
    if (vysledek.affectedRows === 0) throw chybaNenalezeno('Smazaná přihláška nenalezena.');

    const prihlaska = await nactiPrihlasku(id);
    if (prihlaska.termin_id) {
      const spojeni = await pool.getConnection();
      try {
        await prepocitejObsazenost(spojeni, prihlaska.termin_id);
      } finally {
        spojeni.release();
      }
    }

    await zapisAudit({ req, akce: 'obnoveni', entita: 'rezervace', entitaId: id });
    res.json({ ok: true, zprava: 'Přihláška je zpátky.' });
  })
);

export { POPIS_STAVU, STAVY_DRZICI_MISTO, popisTerminu, anoNe };
export default router;
