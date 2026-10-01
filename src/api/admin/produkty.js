// src/api/admin/produkty.js
//
// Produkty a jejich ceník. Kurz je produkt s `typ = 'kurz'` - vlastní tabulka
// pro kurzy nevzniká, aby se stejné obrazovky daly později použít i pro tandem
// a expedice (docs/plan-kurzy.md §1).
//
// Ceny jsou v haléřích (INT). Každá změna ceny se zapisuje do `cenik_historie`
// z aplikace, ne triggerem - jinak by se nedalo uložit, kdo ji změnil a proč.

import express from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import { asyncHandler, chybaNenalezeno, chybaKonflikt } from '../../chyby.js';
import { zvaliduj, schemaSeznam } from '../../validace.js';
import { vyzaduje } from '../../auth/opravneni.js';
import { zapisAudit } from '../../audit.js';
import { prosit as prositSoubor } from './soubory.js';

const router = express.Router();

export const TYPY = ['tandem', 'kurz', 'expedice', 'helitour', 'poukaz', 'jine'];

// Sloupce, které se dají měnit přes PATCH. Výčet je schválně ruční - kdyby se
// bralo cokoli z těla, dal by se přes API přepsat i `vytvoril_id` nebo `poradi`.
const UPRAVITELNE = [
  'typ', 'nazev', 'podtitul', 'stitek', 'perex', 'popis', 'co_je_v_cene',
  'cena_hal', 'cena_na_dotaz', 'dph_sazba_id', 'min_vek', 'max_vek', 'max_vaha_kg',
  'souhlas_zastupce_do_let', 'vyzaduje_lekarskou_prohlidku',
  'vyzaduje_zdravotni_prohlaseni', 'delka_text', 'uroven_text',
  'seo_title', 'seo_description', 'aktivni',
];

const prazdnyText = (max) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

const volitelneCislo = (max, zprava) =>
  z.coerce.number().int().min(0, zprava).max(max, zprava).nullable().optional();

const schemaProdukt = z.object({
  typ: z.enum(TYPY).default('kurz'),
  nazev: z.string({ error: 'Název je povinný.' }).trim()
    .min(2, 'Název je povinný.').max(200, 'Název je příliš dlouhý.'),
  slug: z.string().trim().max(160).optional(),
  podtitul: prazdnyText(255),
  stitek: prazdnyText(60),
  perex: prazdnyText(500),
  popis: prazdnyText(65535),
  co_je_v_cene: prazdnyText(65535),
  cena_hal: z.coerce.number().int()
    .min(0, 'Cena nemůže být záporná.')
    .max(100_000_000, 'Cena je nepravděpodobně vysoká — je opravdu v korunách?')
    .nullable().optional(),
  cena_na_dotaz: z.coerce.boolean().default(false),
  dph_sazba_id: z.coerce.number().int().positive().nullable().optional(),
  min_vek: volitelneCislo(120, 'Věk zadej mezi 0 a 120 lety.'),
  max_vek: volitelneCislo(120, 'Věk zadej mezi 0 a 120 lety.'),
  max_vaha_kg: volitelneCislo(400, 'Hmotnost zadej mezi 0 a 400 kg.'),
  souhlas_zastupce_do_let: volitelneCislo(26, 'Zadej věk do 26 let.'),
  vyzaduje_lekarskou_prohlidku: z.coerce.boolean().default(false),
  vyzaduje_zdravotni_prohlaseni: z.coerce.boolean().default(false),
  delka_text: prazdnyText(60),
  uroven_text: prazdnyText(60),
  seo_title: prazdnyText(200),
  seo_description: prazdnyText(400),
  aktivni: z.coerce.boolean().default(false),
  // Proč se cena mění. Do historie, ne do produktu.
  duvod_zmeny_ceny: z.string().trim().max(255).optional(),
});

// PATCH posílá jen to, co se změnilo.
const schemaUprava = schemaProdukt.partial();

// Dvojí kontrola, kterou zod sám neumí: jedno pole závisí na druhém.
function zkontrolujSouvislosti(data) {
  const detaily = {};

  if (data.cena_na_dotaz === false && (data.cena_hal === null || data.cena_hal === undefined)) {
    detaily.cena_hal = 'Zadej cenu, nebo zaškrtni „cena na dotaz“.';
  }
  if (data.min_vek != null && data.max_vek != null && data.min_vek > data.max_vek) {
    detaily.max_vek = 'Horní hranice věku nemůže být nižší než dolní.';
  }

  if (Object.keys(detaily).length) {
    throw chybaKonflikt('Zkontroluj prosím vyplněná pole.', detaily);
  }
}

// Slug se odvozuje z názvu, ale dá se přepsat. Diakritika pryč, mezery na
// pomlčky - adresa kurzu na webu musí jít přečíst i z papíru.
export function naSlug(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

// Kdyby slug už existoval, přidá se pořadové číslo. Padat kvůli tomu, že
// majitelka založí druhý "zakladni-kurz", by bylo zbytečné.
async function volnySlug(zaklad, krometoho = null) {
  const cisty = naSlug(zaklad) || 'produkt';
  for (let pokus = 0; pokus < 50; pokus++) {
    const kandidat = pokus === 0 ? cisty : `${cisty}-${pokus + 1}`;
    const [rows] = await pool.query(
      'SELECT id FROM produkty WHERE slug = ? AND (? IS NULL OR id <> ?)',
      [kandidat, krometoho, krometoho]
    );
    if (!rows.length) return kandidat;
  }
  return `${cisty}-${Date.now()}`;
}

// ------------------------------------------------------------------ seznam

// GET /api/admin/produkty?typ=kurz
router.get(
  '/',
  vyzaduje('produkty'),
  asyncHandler(async (req, res) => {
    const { strana, na_strane, q } = zvaliduj(schemaSeznam, req.query);
    const typ = TYPY.includes(req.query.typ) ? req.query.typ : null;
    const smazane = req.query.smazane === '1';

    const kde = [smazane ? 'p.smazano_at IS NOT NULL' : 'p.smazano_at IS NULL'];
    const params = [];
    if (typ) {
      kde.push('p.typ = ?');
      params.push(typ);
    }
    if (q) {
      kde.push('(p.nazev LIKE ? OR p.perex LIKE ? OR p.slug LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const kdeSql = 'WHERE ' + kde.join(' AND ');

    const [[{ celkem }]] = await pool.query(
      `SELECT COUNT(*) AS celkem FROM produkty p ${kdeSql}`,
      params
    );
    const [data] = await pool.query(
      `SELECT p.id, p.typ, p.slug, p.nazev, p.podtitul, p.stitek, p.perex,
              p.cena_hal, p.cena_na_dotaz, p.aktivni, p.poradi,
              p.delka_text, p.uroven_text, p.updated_at,
              s.kod AS dph_kod, s.nazev AS dph_nazev, s.procento AS dph_procento
         FROM produkty p
         LEFT JOIN dph_sazby s ON s.id = p.dph_sazba_id
         ${kdeSql}
        ORDER BY p.poradi, p.nazev
        LIMIT ? OFFSET ?`,
      [...params, na_strane, (strana - 1) * na_strane]
    );

    res.json({ data, celkem, strana, na_strane });
  })
);

// ------------------------------------------------------------------ detail

async function nactiDetail(id) {
  const [rows] = await pool.query(
    `SELECT p.*, s.kod AS dph_kod, s.nazev AS dph_nazev, s.procento AS dph_procento,
            s.rezim AS dph_rezim
       FROM produkty p
       LEFT JOIN dph_sazby s ON s.id = p.dph_sazba_id
      WHERE p.id = ?`,
    [id]
  );
  if (!rows[0]) return null;

  const [pozadavky] = await pool.query(
    'SELECT id, text, poradi FROM produkt_pozadavky WHERE produkt_id = ? ORDER BY poradi, id',
    [id]
  );
  const [kroky] = await pool.query(
    'SELECT id, cislo, nadpis, text, poradi FROM produkt_kroky WHERE produkt_id = ? ORDER BY poradi, id',
    [id]
  );

  // Titulní fotka je vždycky první - karta kurzu i výpis na webu berou tu,
  // na kterou narazí dřív, a nemají se o pořadí starat.
  const [fotky] = await pool.query(
    `SELECT s.id, s.kod, s.puvodni_nazev, s.mime, s.velikost_b, s.alt, s.created_at,
            f.poradi, f.titulni
       FROM produkt_fotky f
       JOIN soubory s ON s.id = f.soubor_id
      WHERE f.produkt_id = ? AND s.smazano_at IS NULL
      ORDER BY f.titulni DESC, f.poradi, s.id`,
    [id]
  );

  return {
    ...rows[0],
    pozadavky,
    kroky,
    fotky: fotky.map((f) => ({ ...prositSoubor(f), poradi: f.poradi, titulni: f.titulni })),
  };
}

// GET /api/admin/produkty/:id
router.get(
  '/:id(\\d+)',
  vyzaduje('produkty'),
  asyncHandler(async (req, res) => {
    const detail = await nactiDetail(Number(req.params.id));
    if (!detail) throw chybaNenalezeno('Produkt nenalezen.');
    res.json(detail);
  })
);

// GET /api/admin/produkty/:id/cenik-historie
router.get(
  '/:id(\\d+)/cenik-historie',
  vyzaduje('produkty'),
  asyncHandler(async (req, res) => {
    const [data] = await pool.query(
      `SELECT h.id, h.cena_hal_pred, h.cena_hal_po, h.duvod, h.created_at,
              u.jmeno AS uzivatel_jmeno
         FROM cenik_historie h
         LEFT JOIN uzivatele u ON u.id = h.uzivatel_id
        WHERE h.entita = 'produkt' AND h.entita_id = ?
        ORDER BY h.created_at DESC, h.id DESC
        LIMIT 200`,
      [Number(req.params.id)]
    );
    res.json({ data });
  })
);

// ------------------------------------------------------------------ zápis

// POST /api/admin/produkty
router.post(
  '/',
  vyzaduje('produkty', 'menit'),
  asyncHandler(async (req, res) => {
    const vstup = zvaliduj(schemaProdukt, req.body ?? {});
    zkontrolujSouvislosti(vstup);

    const slug = await volnySlug(vstup.slug || vstup.nazev);
    const cena = vstup.cena_na_dotaz ? null : (vstup.cena_hal ?? null);

    // Nový produkt jde na konec svého typu, ne na začátek.
    const [[{ dalsi }]] = await pool.query(
      'SELECT COALESCE(MAX(poradi), 0) + 1 AS dalsi FROM produkty WHERE typ = ?',
      [vstup.typ]
    );

    const [vysledek] = await pool.query(
      `INSERT INTO produkty
         (typ, slug, nazev, podtitul, stitek, perex, popis, co_je_v_cene,
          cena_hal, cena_na_dotaz, dph_sazba_id, min_vek, max_vek, max_vaha_kg,
          souhlas_zastupce_do_let, vyzaduje_lekarskou_prohlidku,
          vyzaduje_zdravotni_prohlaseni, delka_text, uroven_text,
          seo_title, seo_description, aktivni, poradi, vytvoril_id, upravil_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vstup.typ, slug, vstup.nazev, vstup.podtitul ?? null, vstup.stitek ?? null,
        vstup.perex ?? null, vstup.popis ?? null, vstup.co_je_v_cene ?? null,
        cena, vstup.cena_na_dotaz ? 1 : 0, vstup.dph_sazba_id ?? (await vychoziDph()),
        vstup.min_vek ?? null, vstup.max_vek ?? null, vstup.max_vaha_kg ?? null,
        vstup.souhlas_zastupce_do_let ?? null,
        vstup.vyzaduje_lekarskou_prohlidku ? 1 : 0,
        vstup.vyzaduje_zdravotni_prohlaseni ? 1 : 0,
        vstup.delka_text ?? null, vstup.uroven_text ?? null,
        vstup.seo_title ?? null, vstup.seo_description ?? null,
        vstup.aktivni ? 1 : 0, dalsi, req.uzivatel.id, req.uzivatel.id,
      ]
    );
    const id = vysledek.insertId;

    if (cena !== null) {
      await zapisCenu({ id, pred: null, po: cena, duvod: 'Založení produktu', req });
    }
    await zapisAudit({
      req, akce: 'vytvoreni', entita: 'produkt', entitaId: id, popis: vstup.nazev,
      po: { nazev: vstup.nazev, typ: vstup.typ, aktivni: vstup.aktivni },
    });

    res.status(201).json(await nactiDetail(id));
  })
);

// PATCH /api/admin/produkty/:id
router.patch(
  '/:id(\\d+)',
  vyzaduje('produkty', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const vstup = zvaliduj(schemaUprava, req.body ?? {});

    const pred = await nactiDetail(id);
    if (!pred || pred.smazano_at) throw chybaNenalezeno('Produkt nenalezen.');

    // Sloučíme se stávajícím stavem, ať kontrola souvislostí vidí celý produkt
    // a ne jen to, co přišlo v těle.
    zkontrolujSouvislosti({
      cena_na_dotaz: vstup.cena_na_dotaz ?? Boolean(pred.cena_na_dotaz),
      cena_hal: vstup.cena_hal !== undefined ? vstup.cena_hal : pred.cena_hal,
      min_vek: vstup.min_vek !== undefined ? vstup.min_vek : pred.min_vek,
      max_vek: vstup.max_vek !== undefined ? vstup.max_vek : pred.max_vek,
    });

    const zmeny = {};
    for (const sloupec of UPRAVITELNE) {
      if (vstup[sloupec] === undefined) continue;
      zmeny[sloupec] = typeof vstup[sloupec] === 'boolean'
        ? (vstup[sloupec] ? 1 : 0)
        : vstup[sloupec];
    }

    // Cena na dotaz a konkrétní cena se vylučují.
    if (zmeny.cena_na_dotaz === 1) zmeny.cena_hal = null;

    if (vstup.slug !== undefined && vstup.slug !== pred.slug) {
      zmeny.slug = await volnySlug(vstup.slug || vstup.nazev || pred.nazev, id);
    }

    if (!Object.keys(zmeny).length) return res.json(pred);

    zmeny.upravil_id = req.uzivatel.id;
    const sloupce = Object.keys(zmeny);
    await pool.query(
      `UPDATE produkty SET ${sloupce.map((s) => `${s} = ?`).join(', ')} WHERE id = ?`,
      [...sloupce.map((s) => zmeny[s]), id]
    );

    if ('cena_hal' in zmeny && Number(zmeny.cena_hal) !== Number(pred.cena_hal)) {
      await zapisCenu({
        id, pred: pred.cena_hal, po: zmeny.cena_hal,
        duvod: vstup.duvod_zmeny_ceny || null, req,
      });
    }

    await zapisAudit({
      req, akce: 'zmena', entita: 'produkt', entitaId: id, popis: pred.nazev,
      pred: vyberProAudit(pred, sloupce),
      po: vyberProAudit(zmeny, sloupce),
    });

    res.json(await nactiDetail(id));
  })
);

// POST /api/admin/produkty/poradi - přetažení v seznamu
router.post(
  '/poradi',
  vyzaduje('produkty', 'menit'),
  asyncHandler(async (req, res) => {
    const { poradi } = zvaliduj(
      z.object({
        poradi: z.array(z.coerce.number().int().positive())
          .min(1, 'Pořadí je prázdné.').max(500),
      }),
      req.body ?? {}
    );

    const spojeni = await pool.getConnection();
    try {
      await spojeni.beginTransaction();
      for (let i = 0; i < poradi.length; i++) {
        await spojeni.query('UPDATE produkty SET poradi = ? WHERE id = ?', [i + 1, poradi[i]]);
      }
      await spojeni.commit();
    } catch (chyba) {
      await spojeni.rollback();
      throw chyba;
    } finally {
      spojeni.release();
    }

    await zapisAudit({ req, akce: 'zmena', entita: 'produkt', popis: 'pořadí produktů' });
    res.json({ ok: true });
  })
);

// ------------------------------------------- požadavky a průběh (celý seznam)

// Oba seznamy se ukládají celé najednou. Majitelka je v administraci edituje
// jako blok a klikne na uložit - posílat na každou odrážku vlastní požadavek
// by znamenalo víc míst, kde se to může rozejít.
function routerSeznamu({ tabulka, entita, schema, sloupce }) {
  return asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { polozky } = zvaliduj(z.object({ polozky: z.array(schema).max(100) }), req.body ?? {});

    const [[produkt]] = await pool.query(
      'SELECT id, nazev FROM produkty WHERE id = ? AND smazano_at IS NULL',
      [id]
    );
    if (!produkt) throw chybaNenalezeno('Produkt nenalezen.');

    const spojeni = await pool.getConnection();
    try {
      await spojeni.beginTransaction();
      await spojeni.query(`DELETE FROM ${tabulka} WHERE produkt_id = ?`, [id]);
      for (let i = 0; i < polozky.length; i++) {
        const p = polozky[i];
        await spojeni.query(
          `INSERT INTO ${tabulka} (produkt_id, ${sloupce.join(', ')}, poradi)
           VALUES (?, ${sloupce.map(() => '?').join(', ')}, ?)`,
          [id, ...sloupce.map((s) => p[s] ?? null), i + 1]
        );
      }
      await spojeni.commit();
    } catch (chyba) {
      await spojeni.rollback();
      throw chyba;
    } finally {
      spojeni.release();
    }

    await zapisAudit({
      req, akce: 'zmena', entita: 'produkt', entitaId: id,
      popis: `${produkt.nazev} — ${entita}`,
    });
    res.json(await nactiDetail(id));
  });
}

// PUT /api/admin/produkty/:id/pozadavky
router.put(
  '/:id(\\d+)/pozadavky',
  vyzaduje('produkty', 'menit'),
  routerSeznamu({
    tabulka: 'produkt_pozadavky',
    entita: 'požadavky',
    sloupce: ['text'],
    schema: z.object({
      text: z.string().trim().min(1, 'Prázdný řádek smaž.').max(500),
    }),
  })
);

// PUT /api/admin/produkty/:id/kroky
router.put(
  '/:id(\\d+)/kroky',
  vyzaduje('produkty', 'menit'),
  routerSeznamu({
    tabulka: 'produkt_kroky',
    entita: 'průběh',
    sloupce: ['cislo', 'nadpis', 'text'],
    schema: z.object({
      cislo: z.string().trim().max(4).nullable().optional(),
      nadpis: z.string().trim().min(1, 'Krok musí mít nadpis.').max(160),
      text: z.string().trim().max(65535).nullable().optional(),
    }),
  })
);

// ------------------------------------------------------------------- fotky

// PUT /api/admin/produkty/:id/fotky
//
// Posílá se celý seznam id fotek v pořadí, v jakém mají být. První je
// titulní. Stejně jako u odrážek: majitelka s fotkami hýbe v administraci
// a uloží je najednou, ne po jedné.
router.put(
  '/:id(\\d+)/fotky',
  vyzaduje('produkty', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { fotky } = zvaliduj(
      z.object({
        fotky: z.array(z.coerce.number().int().positive()).max(50, 'Víc než 50 fotek na kurz nedává smysl.'),
      }),
      req.body ?? {}
    );

    const [[produkt]] = await pool.query(
      'SELECT id, nazev FROM produkty WHERE id = ? AND smazano_at IS NULL',
      [id]
    );
    if (!produkt) throw chybaNenalezeno('Produkt nenalezen.');

    // Táž fotka dvakrát v jednom kurzu nedává smysl a rozbila by primární klíč.
    const unikatni = [...new Set(fotky)];

    if (unikatni.length) {
      const [existujici] = await pool.query(
        'SELECT id FROM soubory WHERE id IN (?) AND smazano_at IS NULL',
        [unikatni]
      );
      if (existujici.length !== unikatni.length) {
        throw chybaNenalezeno('Některá z fotek už neexistuje. Načti stránku znovu.');
      }
    }

    const spojeni = await pool.getConnection();
    try {
      await spojeni.beginTransaction();
      await spojeni.query('DELETE FROM produkt_fotky WHERE produkt_id = ?', [id]);
      for (let i = 0; i < unikatni.length; i++) {
        await spojeni.query(
          'INSERT INTO produkt_fotky (produkt_id, soubor_id, poradi, titulni) VALUES (?, ?, ?, ?)',
          [id, unikatni[i], i + 1, i === 0 ? 1 : 0]
        );
      }
      await spojeni.commit();
    } catch (chyba) {
      await spojeni.rollback();
      throw chyba;
    } finally {
      spojeni.release();
    }

    await zapisAudit({
      req, akce: 'zmena', entita: 'produkt', entitaId: id,
      popis: `${produkt.nazev} — fotky`,
      po: { pocet_fotek: unikatni.length },
    });

    res.json(await nactiDetail(id));
  })
);

// ------------------------------------------------------------------ mazání

// DELETE /api/admin/produkty/:id - měkké smazání
router.delete(
  '/:id(\\d+)',
  vyzaduje('produkty', 'menit'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT id, nazev FROM produkty WHERE id = ? AND smazano_at IS NULL',
      [req.params.id]
    );
    if (!rows[0]) throw chybaNenalezeno('Produkt nenalezen.');

    // Skrytý produkt se nesmí ukázat na webu, i kdyby zůstal `aktivni`.
    await pool.query(
      'UPDATE produkty SET smazano_at = NOW(), aktivni = 0, upravil_id = ? WHERE id = ?',
      [req.uzivatel.id, req.params.id]
    );
    await zapisAudit({
      req, akce: 'smazani', entita: 'produkt',
      entitaId: Number(req.params.id), popis: rows[0].nazev,
    });
    res.json({ ok: true, zprava: 'Produkt je ve smazaných. Dá se obnovit.' });
  })
);

// POST /api/admin/produkty/:id/obnovit
router.post(
  '/:id(\\d+)/obnovit',
  vyzaduje('produkty', 'menit'),
  asyncHandler(async (req, res) => {
    // Obnovený produkt zůstává skrytý - zveřejní se až vědomě.
    const [vysledek] = await pool.query(
      'UPDATE produkty SET smazano_at = NULL, upravil_id = ? WHERE id = ? AND smazano_at IS NOT NULL',
      [req.uzivatel.id, req.params.id]
    );
    if (vysledek.affectedRows === 0) throw chybaNenalezeno('Smazaný produkt nenalezen.');

    await zapisAudit({
      req, akce: 'obnoveni', entita: 'produkt', entitaId: Number(req.params.id),
    });
    res.json({ ok: true, zprava: 'Produkt je zpátky, zatím skrytý.' });
  })
);

// ------------------------------------------------------------------ pomocné

async function vychoziDph() {
  const [rows] = await pool.query(
    'SELECT id FROM dph_sazby WHERE vychozi = 1 AND aktivni = 1 ORDER BY poradi LIMIT 1'
  );
  return rows[0]?.id ?? null;
}

async function zapisCenu({ id, pred, po, duvod, req }) {
  await pool.query(
    `INSERT INTO cenik_historie
       (entita, entita_id, cena_hal_pred, cena_hal_po, duvod, uzivatel_id)
     VALUES ('produkt', ?, ?, ?, ?, ?)`,
    [id, pred ?? null, po ?? null, duvod ?? null, req.uzivatel?.id ?? null]
  );
}

// Do auditu jde jen to, co se opravdu měnilo - celý produkt s popisem na
// deset tisíc znaků by se v logu nedal přečíst.
function vyberProAudit(zdroj, sloupce) {
  const vybrano = {};
  for (const sloupec of sloupce) {
    if (sloupec === 'popis' || sloupec === 'co_je_v_cene') {
      vybrano[sloupec] = zdroj[sloupec] ? '(text)' : null;
      continue;
    }
    vybrano[sloupec] = zdroj[sloupec] ?? null;
  }
  return vybrano;
}

export default router;
