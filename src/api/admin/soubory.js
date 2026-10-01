// src/api/admin/soubory.js
//
// Nahrávání a správa souborů. Samotné zobrazení fotky je veřejné
// (GET /media/:id v src/api/verejne.js) - fotky kurzů jsou obsah webu,
// ne nic chráněného, a administrace si je zobrazuje toutéž cestou.

import express from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import { asyncHandler, chybaNenalezeno } from '../../chyby.js';
import { zvaliduj, schemaSeznam } from '../../validace.js';
import { vyzaduje } from '../../auth/opravneni.js';
import { zapisAudit } from '../../audit.js';
import { ulozSoubor, srovnejFotkyProduktu, MAX_BAJTU } from '../../soubory.js';

const router = express.Router();

const schemaNahrani = z.object({
  obsah: z.string({ error: 'Chybí obsah souboru.' }).min(1, 'Soubor je prázdný.'),
  nazev: z.string().trim().max(255).nullable().optional(),
  alt: z.string().trim().max(255).nullable().optional(),
});

// POST /api/admin/soubory - nahrání obrázku (base64 v JSON)
router.post(
  '/',
  vyzaduje('galerie', 'menit'),
  asyncHandler(async (req, res) => {
    const vstup = zvaliduj(schemaNahrani, req.body ?? {});

    const soubor = await ulozSoubor({
      obsah: vstup.obsah,
      nazev: vstup.nazev ?? null,
      alt: vstup.alt ?? null,
      uzivatelId: req.uzivatel.id,
    });

    // Opakované nahrání téže fotky není nová položka a nemá co psát do auditu.
    if (!soubor.uzJeNahrany) {
      await zapisAudit({
        req, akce: 'vytvoreni', entita: 'soubor', entitaId: soubor.id,
        popis: soubor.puvodni_nazev ?? soubor.cesta,
      });
    }

    res.status(soubor.uzJeNahrany ? 200 : 201).json(prosit(soubor));
  })
);

// GET /api/admin/soubory - knihovna nahraných souborů
router.get(
  '/',
  vyzaduje('galerie'),
  asyncHandler(async (req, res) => {
    const { strana, na_strane, q } = zvaliduj(schemaSeznam, req.query);

    const kde = ['smazano_at IS NULL'];
    const params = [];
    if (q) {
      kde.push('(puvodni_nazev LIKE ? OR alt LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const kdeSql = 'WHERE ' + kde.join(' AND ');

    const [[{ celkem }]] = await pool.query(
      `SELECT COUNT(*) AS celkem FROM soubory ${kdeSql}`,
      params
    );
    const [data] = await pool.query(
      `SELECT * FROM soubory ${kdeSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, na_strane, (strana - 1) * na_strane]
    );

    res.json({ data: data.map(prosit), celkem, strana, na_strane });
  })
);

const schemaUprava = z.object({
  alt: z.string().trim().max(255, 'Popis je příliš dlouhý.').nullable().optional()
    .transform((v) => (v ? v : null)),
});

// PATCH /api/admin/soubory/:id - popis obrázku (alt)
router.patch(
  '/:id(\\d+)',
  vyzaduje('galerie', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const vstup = zvaliduj(schemaUprava, req.body ?? {});

    const [rows] = await pool.query(
      'SELECT * FROM soubory WHERE id = ? AND smazano_at IS NULL',
      [id]
    );
    if (!rows[0]) throw chybaNenalezeno('Soubor nenalezen.');

    if (vstup.alt !== undefined) {
      await pool.query('UPDATE soubory SET alt = ? WHERE id = ?', [vstup.alt, id]);
      await zapisAudit({
        req, akce: 'zmena', entita: 'soubor', entitaId: id,
        popis: 'popis obrázku',
        pred: { alt: rows[0].alt }, po: { alt: vstup.alt },
      });
    }

    const [nove] = await pool.query('SELECT * FROM soubory WHERE id = ?', [id]);
    res.json(prosit(nove[0]));
  })
);

// DELETE /api/admin/soubory/:id - měkké smazání
router.delete(
  '/:id(\\d+)',
  vyzaduje('galerie', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [rows] = await pool.query(
      'SELECT puvodni_nazev, cesta FROM soubory WHERE id = ? AND smazano_at IS NULL',
      [id]
    );
    if (!rows[0]) throw chybaNenalezeno('Soubor nenalezen.');

    // Vazby na produkty padají s ním (ON DELETE CASCADE řeší až tvrdé
    // smazání, tady je odpojíme rovnou, ať fotka zmizí z karty hned).
    //
    // Produkty, u kterých fotka visela, se pak musí srovnat. Kdyby se
    // smazala zrovna titulní, zůstal by kurz bez ní a na kartě by nebyl
    // obrázek, přestože nějaké fotky má.
    const [dotcene] = await pool.query(
      'SELECT DISTINCT produkt_id FROM produkt_fotky WHERE soubor_id = ?',
      [id]
    );

    const spojeni = await pool.getConnection();
    try {
      await spojeni.beginTransaction();
      await spojeni.query('DELETE FROM produkt_fotky WHERE soubor_id = ?', [id]);
      await spojeni.query(
        'UPDATE soubory SET smazano_at = NOW() WHERE id = ? AND smazano_at IS NULL',
        [id]
      );
      for (const { produkt_id: produktId } of dotcene) {
        await srovnejFotkyProduktu(spojeni, produktId);
      }
      await spojeni.commit();
    } catch (chyba) {
      await spojeni.rollback();
      throw chyba;
    } finally {
      spojeni.release();
    }

    await zapisAudit({
      req, akce: 'smazani', entita: 'soubor', entitaId: id,
      popis: rows[0].puvodni_nazev ?? rows[0].cesta,
    });
    res.json({ ok: true, zprava: 'Fotka je smazaná.' });
  })
);

// Cesta na disku ven nepatří - klient potřebuje jen adresu, kde si obrázek
// vyzvedne, a údaje pro zobrazení.
export function prosit(soubor) {
  return {
    id: soubor.id,
    url: `/media/${soubor.id}`,
    nazev: soubor.puvodni_nazev,
    mime: soubor.mime,
    velikost_b: soubor.velikost_b,
    alt: soubor.alt,
    created_at: soubor.created_at,
    ...(soubor.uzJeNahrany !== undefined ? { uz_je_nahrany: soubor.uzJeNahrany } : {}),
  };
}

export { MAX_BAJTU };
export default router;
