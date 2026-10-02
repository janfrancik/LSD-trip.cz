// src/api/admin/terminy.js
//
// Termíny kurzů: kdy a kde se letí, kolik je míst a kdo na tom dělá.
//
// Cesty jsou generické podle produktu, ne kurzové - tentýž kód obslouží
// později i tandemové dny a expedice (docs/plan-kurzy.md §3).
//
// Čas má tady dvojí povahu a nesmí se to smíchat (viz migraci 011):
// `datum`, `cas_od` a `cas_do` jsou hodiny na letišti (DATE a TIME, bez zóny,
// nikdy se nepřevádějí), kdežto `zruseno_at` a `created_at` jsou okamžiky
// v UTC jako všude jinde. Proto se tady nikde nevolá převod na pražský čas.
//
// Hromadné zakládání vytváří **řádky**, ne pravidlo počítané za běhu. Provoz
// každý den ručně přiohne a pravidlo by mu to přepisovalo; `serie_id` slouží
// jen k tomu, aby šlo "všech 12 pátků" najednou najít.

import express from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import { asyncHandler, chybaNenalezeno, chybaKonflikt } from '../../chyby.js';
import { zvaliduj, schemaSeznam } from '../../validace.js';
import { vyzaduje } from '../../auth/opravneni.js';
import { zapisAudit } from '../../audit.js';
import { isoDatum, datumyVRozsahu, pocetDni } from '../../cas.js';
import { nactiSoupisku } from '../../prihlasky-soupiska.js';
import { posliCsv, anoNe } from '../../csv.js';
import { nactiPrihlasku, posliOznameni } from '../../prihlasky.js';

const router = express.Router();

export const STAVY = ['otevreno', 'plno', 'zruseno', 'probehlo'];
export const ROLE_INSTRUKTORU = ['tandem', 'aff', 'kamera', 'balic'];

// Kolik termínů smí vzniknout jedním hromadným zadáním. Pojistka proti
// překlepu v datu ("do roku 2036"), ne obchodní pravidlo.
const MAX_HROMADNE = 200;

// ---------------------------------------------------------------- validace

const prazdnyText = (max) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

// Datum na hodinách, ne okamžik - proto prostý řetězec, žádné new Date().
const schemaDatum = z
  .string({ error: 'Datum je povinné.' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum zadej ve tvaru 2026-05-17.');

// Prohlížeč posílá "09:00", databáze chce "09:00:00".
const schemaCas = z
  .string()
  .trim()
  .regex(/^\d{1,2}:\d{2}(:\d{2})?$/, 'Čas zadej ve tvaru 9:00.')
  .nullable()
  .optional()
  .or(z.literal(''))
  .transform((v) => {
    if (!v) return null;
    const [h, m, s] = String(v).split(':');
    return `${h.padStart(2, '0')}:${m}:${s ?? '00'}`;
  });

const spolecnaPole = {
  nazev_prepis: prazdnyText(200),
  cas_od: schemaCas,
  cas_do: schemaCas,
  popis_casu: prazdnyText(100),
  misto_id: z.coerce.number().int().positive().nullable().optional(),
  kapacita_mist: z.coerce.number().int()
    .min(0, 'Kapacita nemůže být záporná.')
    .max(10_000, 'Tolik míst je nepravděpodobných.')
    .default(0),
  cena_hal_prepis: z.coerce.number().int()
    .min(0, 'Cena nemůže být záporná.')
    .max(100_000_000, 'Cena je nepravděpodobně vysoká — je opravdu v korunách?')
    .nullable().optional(),
  popis: prazdnyText(65535),
  viditelny: z.coerce.boolean().default(true),
};

const schemaTermin = z.object({
  produkt_id: z.coerce.number({ error: 'Vyber kurz.' }).int().positive('Vyber kurz.'),
  datum: schemaDatum,
  ...spolecnaPole,
});

// PATCH posílá jen to, co se změnilo. `stav` se dá přepnout, ale zrušení ne -
// to má vlastní cestu, protože bez důvodu se rušit nemá.
const schemaUprava = schemaTermin.partial().extend({
  stav: z.enum(['otevreno', 'plno', 'probehlo'], {
    error: 'Zrušení termínu má vlastní tlačítko — je k němu potřeba důvod.',
  }).optional(),
});

const schemaHromadne = z.object({
  produkt_id: z.coerce.number({ error: 'Vyber kurz.' }).int().positive('Vyber kurz.'),
  od: schemaDatum,
  do: schemaDatum,
  // 1 = pondělí … 7 = neděle. Prázdné = každý den v rozsahu.
  dny: z.array(z.coerce.number().int().min(1).max(7)).max(7).optional().default([]),
  nazev_serie: prazdnyText(160),
  ...spolecnaPole,
});

const UPRAVITELNE = [
  'produkt_id', 'nazev_prepis', 'datum', 'cas_od', 'cas_do', 'popis_casu',
  'misto_id', 'kapacita_mist', 'cena_hal_prepis', 'popis', 'viditelny', 'stav',
];

// Kontroly, na které zod nestačí, protože jedno pole závisí na druhém.
async function zkontroluj(data, puvodni = null) {
  const detaily = {};
  const hodnota = (klic) => (data[klic] !== undefined ? data[klic] : puvodni?.[klic]);

  const od = hodnota('cas_od');
  const doKdy = hodnota('cas_do');
  if (od && doKdy && doKdy <= od) {
    detaily.cas_do = 'Konec musí být po začátku.';
  }

  const kapacita = hodnota('kapacita_mist');
  const obsazeno = puvodni?.obsazeno_mist ?? 0;
  if (kapacita > 0 && obsazeno > kapacita) {
    detaily.kapacita_mist = `Na termínu už je přihlášeno ${obsazeno} lidí, méně míst nastavit nejde.`;
  }

  const produktId = hodnota('produkt_id');
  if (produktId) {
    const [[produkt]] = await pool.query(
      'SELECT id FROM produkty WHERE id = ? AND smazano_at IS NULL',
      [produktId]
    );
    if (!produkt) detaily.produkt_id = 'Takový kurz neexistuje.';
  }

  const mistoId = hodnota('misto_id');
  if (mistoId) {
    const [[misto]] = await pool.query(
      'SELECT id FROM mista WHERE id = ? AND smazano_at IS NULL',
      [mistoId]
    );
    if (!misto) detaily.misto_id = 'Takové místo neexistuje.';
  }

  if (Object.keys(detaily).length) {
    throw chybaKonflikt('Zkontroluj prosím vyplněná pole.', detaily);
  }
}

// ------------------------------------------------------------------ seznam

const VYBER_SEZNAMU = `
  t.id, t.produkt_id, t.serie_id, t.nazev_prepis, t.datum, t.cas_od, t.cas_do,
  t.popis_casu, t.misto_id, t.kapacita_mist, t.obsazeno_mist, t.cena_hal_prepis,
  t.stav, t.zruseno_duvod, t.zruseno_at, t.viditelny, t.smazano_at, t.updated_at,
  p.nazev AS produkt_nazev, p.typ AS produkt_typ, p.slug AS produkt_slug,
  p.cena_hal AS produkt_cena_hal, p.cena_na_dotaz AS produkt_cena_na_dotaz,
  m.nazev AS misto_nazev`;

// GET /api/admin/terminy?typ=kurz&produkt=&od=&do=&stav=&minule=1
router.get(
  '/',
  vyzaduje('terminy'),
  asyncHandler(async (req, res) => {
    const { strana, na_strane, q } = zvaliduj(schemaSeznam, req.query);

    const kde = [req.query.smazane === '1' ? 't.smazano_at IS NOT NULL' : 't.smazano_at IS NULL'];
    const params = [];

    if (req.query.typ) {
      kde.push('p.typ = ?');
      params.push(String(req.query.typ));
    }
    if (req.query.produkt) {
      kde.push('t.produkt_id = ?');
      params.push(Number(req.query.produkt));
    }
    if (STAVY.includes(req.query.stav)) {
      kde.push('t.stav = ?');
      params.push(req.query.stav);
    }
    if (req.query.misto) {
      kde.push('t.misto_id = ?');
      params.push(Number(req.query.misto));
    }

    // Bez zadaného rozsahu se ukazují termíny od dneška dál. Provoz řeší, co
    // teprve bude; minulost je na přepnutí ("minule=1").
    const od = /^\d{4}-\d{2}-\d{2}$/.test(req.query.od ?? '') ? req.query.od : null;
    const doKdy = /^\d{4}-\d{2}-\d{2}$/.test(req.query.do ?? '') ? req.query.do : null;
    const minule = req.query.minule === '1';
    if (od) {
      kde.push('t.datum >= ?');
      params.push(od);
    } else if (!minule && !doKdy) {
      kde.push('t.datum >= ?');
      params.push(isoDatum(new Date()));
    }
    if (doKdy) {
      kde.push('t.datum <= ?');
      params.push(doKdy);
    }
    if (q) {
      kde.push('(p.nazev LIKE ? OR t.nazev_prepis LIKE ? OR m.nazev LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const kdeSql = 'WHERE ' + kde.join(' AND ');
    const spojeni = `FROM terminy t
       JOIN produkty p ON p.id = t.produkt_id
       LEFT JOIN mista m ON m.id = t.misto_id`;

    const [[{ celkem }]] = await pool.query(
      `SELECT COUNT(*) AS celkem ${spojeni} ${kdeSql}`,
      params
    );
    // Minulé termíny mají smysl od nejnovějšího, budoucí od nejbližšího.
    const [data] = await pool.query(
      `SELECT ${VYBER_SEZNAMU} ${spojeni} ${kdeSql}
        ORDER BY t.datum ${minule && !od ? 'DESC' : 'ASC'}, t.cas_od, t.id
        LIMIT ? OFFSET ?`,
      [...params, na_strane, (strana - 1) * na_strane]
    );

    res.json({ data, celkem, strana, na_strane });
  })
);

// GET /api/admin/terminy/instruktori
//
// Koho jde přiřadit na termín. Vlastní cesta schválně: seznam uživatelů je
// pod oprávněním `uzivatele`, které provoz nemá - a bez tohohle by si provoz
// nemohl k termínu nikoho přiřadit. Ven jdou jen jméno a role, nic dalšího.
router.get(
  '/instruktori',
  vyzaduje('terminy'),
  asyncHandler(async (req, res) => {
    const [data] = await pool.query(
      `SELECT id, jmeno, role FROM uzivatele
        WHERE smazano_at IS NULL AND aktivni = 1
          AND role IN ('instruktor','provoz','admin')
        ORDER BY jmeno`
    );
    res.json({ data });
  })
);

// ------------------------------------------------------------------ detail

async function nactiDetail(id) {
  const [rows] = await pool.query(
    `SELECT t.*, p.nazev AS produkt_nazev, p.typ AS produkt_typ, p.slug AS produkt_slug,
            p.cena_hal AS produkt_cena_hal, p.cena_na_dotaz AS produkt_cena_na_dotaz,
            m.nazev AS misto_nazev, m.adresa AS misto_adresa,
            s.nazev AS serie_nazev
       FROM terminy t
       JOIN produkty p ON p.id = t.produkt_id
       LEFT JOIN mista m ON m.id = t.misto_id
       LEFT JOIN termin_serie s ON s.id = t.serie_id
      WHERE t.id = ?`,
    [id]
  );
  if (!rows[0]) return null;

  const [instruktori] = await pool.query(
    `SELECT i.uzivatel_id, i.role, u.jmeno
       FROM termin_instruktori i
       JOIN uzivatele u ON u.id = i.uzivatel_id
      WHERE i.termin_id = ?
      ORDER BY u.jmeno, i.role`,
    [id]
  );

  return { ...rows[0], instruktori };
}

// GET /api/admin/terminy/:id
router.get(
  '/:id(\\d+)',
  vyzaduje('terminy'),
  asyncHandler(async (req, res) => {
    const detail = await nactiDetail(Number(req.params.id));
    if (!detail) throw chybaNenalezeno('Termín nenalezen.');
    res.json(detail);
  })
);

// GET /api/admin/terminy/:id/soupiska
//
// Papír, se kterým se jde na letiště: kdo přijede, kolik váží, kolik mu je
// a co má s sebou doložit. Účastníci mimo limit věku nebo váhy jsou označení -
// provoz to musí vidět na první pohled, ne to dopočítávat (rozhodnutí 3).
//
// Vidí ji i instruktor: na letišti ji potřebuje ten, kdo tam zrovna je.
router.get(
  '/:id(\\d+)/soupiska',
  vyzaduje('terminy'),
  asyncHandler(async (req, res) => {
    const soupiska = await nactiSoupisku(Number(req.params.id));
    if (!soupiska) throw chybaNenalezeno('Termín nenalezen.');
    res.json(soupiska);
  })
);

// GET /api/admin/terminy/:id/soupiska.csv
//
// Stejné sloupce jako tištěná soupiska - ať se dvě verze téhož papíru
// nerozejdou.
router.get(
  '/:id(\\d+)/soupiska.csv',
  vyzaduje('terminy'),
  asyncHandler(async (req, res) => {
    const soupiska = await nactiSoupisku(Number(req.params.id));
    if (!soupiska) throw chybaNenalezeno('Termín nenalezen.');

    posliCsv(
      res,
      `soupiska-${soupiska.termin.datum}.csv`,
      ['Jméno', 'Věk', 'Váha kg', 'Telefon', 'E-mail', 'Stav', 'Zaplaceno',
        'Prohlídka doložena', 'Souhlas zástupce', 'Souhlasy', 'Mimo limit', 'Poznámka'],
      soupiska.ucastnici.map((u) => [
        u.jmeno,
        u.vek ?? '',
        u.vaha_kg ?? '',
        u.telefon ?? '',
        u.email ?? '',
        u.stav_popis,
        anoNe(u.zaplaceno),
        anoNe(u.doklada_prohlidku),
        anoNe(u.zajisti_souhlas_zastupce),
        u.souhlasy_online ? 'online' : 'podepíše na místě',
        u.varovani.join('; '),
        u.poznamka ?? '',
      ])
    );
  })
);

// ------------------------------------------------------------------- zápis

async function vloz(spojeni, data, uzivatelId, serieId = null) {
  const [vysledek] = await spojeni.query(
    `INSERT INTO terminy
       (produkt_id, serie_id, nazev_prepis, datum, cas_od, cas_do, popis_casu,
        misto_id, kapacita_mist, cena_hal_prepis, popis, viditelny,
        vytvoril_id, upravil_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.produkt_id, serieId, data.nazev_prepis ?? null, data.datum,
      data.cas_od ?? null, data.cas_do ?? null, data.popis_casu ?? null,
      data.misto_id ?? null, data.kapacita_mist ?? 0, data.cena_hal_prepis ?? null,
      data.popis ?? null, data.viditelny ? 1 : 0, uzivatelId, uzivatelId,
    ]
  );
  return vysledek.insertId;
}

// POST /api/admin/terminy
router.post(
  '/',
  vyzaduje('terminy', 'menit'),
  asyncHandler(async (req, res) => {
    const vstup = zvaliduj(schemaTermin, req.body ?? {});
    await zkontroluj(vstup);

    const id = await vloz(pool, vstup, req.uzivatel.id);
    const detail = await nactiDetail(id);

    await zapisAudit({
      req, akce: 'vytvoreni', entita: 'termin', entitaId: id,
      popis: `${detail.produkt_nazev} — ${detail.datum}`,
    });
    res.status(201).json(detail);
  })
);

// POST /api/admin/terminy/hromadne
//
// "Každý pátek a sobotu od května do června." Termíny se založí jako řádky,
// aby šlo každý zvlášť přiohnout; série je drží pohromadě jen pro hledání.
router.post(
  '/hromadne',
  vyzaduje('terminy', 'menit'),
  asyncHandler(async (req, res) => {
    const vstup = zvaliduj(schemaHromadne, req.body ?? {});
    await zkontroluj(vstup);

    if (vstup.do < vstup.od) {
      throw chybaKonflikt('Zkontroluj prosím vyplněná pole.', {
        do: 'Konec rozsahu musí být po začátku.',
      });
    }
    // Překlep v roce ("do 3026") by jinak znamenal milion otáček cyklu.
    if (pocetDni(vstup.od, vstup.do) > 2 * 366) {
      throw chybaKonflikt('Rozsah je delší než dva roky — zkontroluj datum.', {
        do: 'Příliš dlouhý rozsah.',
      });
    }

    const datumy = datumyVRozsahu(vstup.od, vstup.do, vstup.dny);
    if (!datumy.length) {
      throw chybaKonflikt('V zadaném rozsahu nevychází ani jeden den.', {
        dny: 'Zkus vybrat jiné dny v týdnu.',
      });
    }
    if (datumy.length > MAX_HROMADNE) {
      throw chybaKonflikt(
        `Takhle by vzniklo ${datumy.length} termínů. Maximum je ${MAX_HROMADNE} — ` +
          'zkrať rozsah, nebo to rozděl na víc dávek.',
        { do: 'Příliš dlouhý rozsah.' }
      );
    }

    // Co už na ten den u kurzu je, se nezakládá podruhé. Omylem spuštěné
    // hromadné zadání tak nevyrobí dvojité termíny.
    const [uz] = await pool.query(
      `SELECT datum FROM terminy
        WHERE produkt_id = ? AND smazano_at IS NULL AND datum IN (?)`,
      [vstup.produkt_id, datumy]
    );
    const obsazene = new Set(uz.map((r) => String(r.datum)));
    const nove = datumy.filter((d) => !obsazene.has(d));

    const spojeni = await pool.getConnection();
    let serieId = null;
    try {
      await spojeni.beginTransaction();

      const [serie] = await spojeni.query(
        'INSERT INTO termin_serie (nazev, pravidlo, vytvoril_id) VALUES (?, ?, ?)',
        [
          vstup.nazev_serie ?? null,
          JSON.stringify({
            od: vstup.od, do: vstup.do, dny: vstup.dny,
            cas_od: vstup.cas_od, cas_do: vstup.cas_do,
            kapacita_mist: vstup.kapacita_mist, misto_id: vstup.misto_id ?? null,
          }),
          req.uzivatel.id,
        ]
      );
      serieId = serie.insertId;

      for (const datum of nove) {
        await vloz(spojeni, { ...vstup, datum }, req.uzivatel.id, serieId);
      }
      await spojeni.commit();
    } catch (chyba) {
      await spojeni.rollback();
      throw chyba;
    } finally {
      spojeni.release();
    }

    await zapisAudit({
      req, akce: 'vytvoreni', entita: 'termin',
      popis: `hromadné založení ${nove.length} termínů (${vstup.od} – ${vstup.do})`,
    });

    res.status(201).json({
      ok: true,
      serie_id: serieId,
      vytvoreno: nove.length,
      preskoceno: datumy.length - nove.length,
      zprava: zpravaOZalozeni('Založeno', nove.length, datumy.length - nove.length),
    });
  })
);

// POST /api/admin/terminy/:id/kopie - kopie dne na další data
router.post(
  '/:id(\\d+)/kopie',
  vyzaduje('terminy', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { datumy } = zvaliduj(
      z.object({
        datumy: z.array(schemaDatum).min(1, 'Vyber alespoň jedno datum.').max(50),
      }),
      req.body ?? {}
    );

    const vzor = await nactiDetail(id);
    if (!vzor || vzor.smazano_at) throw chybaNenalezeno('Termín nenalezen.');

    const unikatni = [...new Set(datumy)];
    const [uz] = await pool.query(
      `SELECT datum FROM terminy
        WHERE produkt_id = ? AND smazano_at IS NULL AND datum IN (?)`,
      [vzor.produkt_id, unikatni]
    );
    const obsazene = new Set(uz.map((r) => String(r.datum)));
    const nove = unikatni.filter((d) => !obsazene.has(d));

    const spojeni = await pool.getConnection();
    try {
      await spojeni.beginTransaction();
      for (const datum of nove) {
        // Kopíruje se zadání dne, ne jeho průběh: obsazenost začíná na nule
        // a stav je vždycky otevřeno, i když vzor byl zrušený nebo proběhlý.
        const novyId = await vloz(
          spojeni,
          { ...vzor, datum, viditelny: Boolean(vzor.viditelny) },
          req.uzivatel.id
        );
        for (const instruktor of vzor.instruktori) {
          await spojeni.query(
            'INSERT INTO termin_instruktori (termin_id, uzivatel_id, role) VALUES (?, ?, ?)',
            [novyId, instruktor.uzivatel_id, instruktor.role]
          );
        }
      }
      await spojeni.commit();
    } catch (chyba) {
      await spojeni.rollback();
      throw chyba;
    } finally {
      spojeni.release();
    }

    await zapisAudit({
      req, akce: 'vytvoreni', entita: 'termin', entitaId: id,
      popis: `kopie termínu ${vzor.datum} na ${nove.length} ${sklonTerminu(nove.length)}`,
    });

    res.status(201).json({
      ok: true,
      vytvoreno: nove.length,
      preskoceno: unikatni.length - nove.length,
      zprava: zpravaOZalozeni('Zkopírováno na', nove.length, unikatni.length - nove.length),
    });
  })
);

// PATCH /api/admin/terminy/:id
router.patch(
  '/:id(\\d+)',
  vyzaduje('terminy', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const vstup = zvaliduj(schemaUprava, req.body ?? {});

    const pred = await nactiDetail(id);
    if (!pred || pred.smazano_at) throw chybaNenalezeno('Termín nenalezen.');
    await zkontroluj(vstup, pred);

    const zmeny = {};
    for (const sloupec of UPRAVITELNE) {
      if (vstup[sloupec] === undefined) continue;
      zmeny[sloupec] = typeof vstup[sloupec] === 'boolean' ? (vstup[sloupec] ? 1 : 0) : vstup[sloupec];
    }

    // Přepnutím zpět na otevřeno se zahodí i důvod zrušení - jinak by u živého
    // termínu zůstalo svítit, že je zrušený.
    if (zmeny.stav && zmeny.stav !== 'zruseno' && pred.stav === 'zruseno') {
      zmeny.zruseno_duvod = null;
      zmeny.zruseno_at = null;
    }

    if (!Object.keys(zmeny).length) return res.json(pred);

    zmeny.upravil_id = req.uzivatel.id;
    const sloupce = Object.keys(zmeny);
    await pool.query(
      `UPDATE terminy SET ${sloupce.map((s) => `${s} = ?`).join(', ')} WHERE id = ?`,
      [...sloupce.map((s) => zmeny[s]), id]
    );

    await zapisAudit({
      req, akce: 'zmena', entita: 'termin', entitaId: id,
      popis: `${pred.produkt_nazev} — ${pred.datum}`,
      pred: vyber(pred, sloupce), po: vyber(zmeny, sloupce),
    });
    res.json(await nactiDetail(id));
  })
);

// PUT /api/admin/terminy/:id/instruktori - celý seznam najednou
router.put(
  '/:id(\\d+)/instruktori',
  vyzaduje('terminy', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { instruktori } = zvaliduj(
      z.object({
        instruktori: z.array(
          z.object({
            uzivatel_id: z.coerce.number().int().positive(),
            role: z.enum(ROLE_INSTRUKTORU, { error: 'Neznámá role instruktora.' }),
          })
        ).max(50),
      }),
      req.body ?? {}
    );

    const termin = await nactiDetail(id);
    if (!termin || termin.smazano_at) throw chybaNenalezeno('Termín nenalezen.');

    // Tentýž člověk v téže roli dvakrát je překlep, ne chyba k nahlášení.
    const unikatni = [];
    const videne = new Set();
    for (const i of instruktori) {
      const klic = `${i.uzivatel_id}:${i.role}`;
      if (videne.has(klic)) continue;
      videne.add(klic);
      unikatni.push(i);
    }

    if (unikatni.length) {
      const [lide] = await pool.query(
        'SELECT id FROM uzivatele WHERE id IN (?) AND smazano_at IS NULL',
        [unikatni.map((i) => i.uzivatel_id)]
      );
      if (lide.length !== new Set(unikatni.map((i) => i.uzivatel_id)).size) {
        throw chybaNenalezeno('Někdo ze seznamu už v administraci není.');
      }
    }

    const spojeni = await pool.getConnection();
    try {
      await spojeni.beginTransaction();
      await spojeni.query('DELETE FROM termin_instruktori WHERE termin_id = ?', [id]);
      for (const i of unikatni) {
        await spojeni.query(
          'INSERT INTO termin_instruktori (termin_id, uzivatel_id, role) VALUES (?, ?, ?)',
          [id, i.uzivatel_id, i.role]
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
      req, akce: 'zmena', entita: 'termin', entitaId: id,
      popis: `${termin.produkt_nazev} ${termin.datum} — instruktoři`,
    });
    res.json(await nactiDetail(id));
  })
);

// ------------------------------------------------------------------ zrušení

// POST /api/admin/terminy/:id/zrusit
router.post(
  '/:id(\\d+)/zrusit',
  vyzaduje('terminy', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { duvod, poslat_email: poslatEmail } = zvaliduj(
      z.object({
        duvod: z.string({ error: 'Napiš důvod zrušení.' }).trim()
          .min(3, 'Napiš důvod zrušení — přečte si ho i přihlášený.')
          .max(500, 'Důvod je příliš dlouhý.'),
        // Komu se zruší termín, ten se to má dozvědět. Přepínač tu přesto je:
        // někdy provoz všem zavolá dřív, než stihne kliknout.
        poslat_email: z.coerce.boolean().default(true),
      }),
      req.body ?? {}
    );

    const pred = await nactiDetail(id);
    if (!pred || pred.smazano_at) throw chybaNenalezeno('Termín nenalezen.');
    if (pred.stav === 'zruseno') throw chybaKonflikt('Termín je už zrušený.');

    await pool.query(
      `UPDATE terminy SET stav = 'zruseno', zruseno_duvod = ?, zruseno_at = NOW(), upravil_id = ?
        WHERE id = ?`,
      [duvod, req.uzivatel.id, id]
    );

    await zapisAudit({
      req, akce: 'zmena', entita: 'termin', entitaId: id,
      popis: `zrušení termínu ${pred.produkt_nazev} ${pred.datum}`,
      pred: { stav: pred.stav }, po: { stav: 'zruseno', zruseno_duvod: duvod },
    });

    // Přihlášky zůstávají a přesouvá je provoz ručně (rozhodnutí 7
    // v docs/plan-kurzy.md) - zrušení termínu je nesmí odstranit ani stornovat.
    // Odejde jen e-mail, že se neletí.
    const komu = await prihlaseniNaTerminu(id);
    let odeslano = 0;
    if (poslatEmail) {
      for (const rezervaceId of komu) {
        const prihlaska = await nactiPrihlasku(rezervaceId);
        const vysledek = await posliOznameni('termin_zruseny', prihlaska, { duvod }).catch(
          (chyba) => {
            console.error('[terminy] e-mail o zrušení neodešel:', chyba.message);
            return null;
          }
        );
        if (vysledek) odeslano += 1;
      }
    }

    res.json({
      ...(await nactiDetail(id)),
      prihlasek: komu.length,
      emailu_odeslano: odeslano,
      zprava:
        'Termín je zrušený. Na webu se přestane nabízet.' +
        (komu.length
          ? ` Přihlášek zůstává ${komu.length}${odeslano ? `, e-mail odešel ${odeslano}×` : ''} — přesun domluv s lidmi sama.`
          : ''),
    });
  })
);

// ------------------------------------------------------------------- mazání

// DELETE /api/admin/terminy/:id - měkké smazání
router.delete(
  '/:id(\\d+)',
  vyzaduje('terminy', 'menit'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const termin = await nactiDetail(id);
    if (!termin || termin.smazano_at) throw chybaNenalezeno('Termín nenalezen.');

    // Termín s přihláškami se nemaže - od toho je zrušení s důvodem, které
    // přihlášky zachová. (Od E5, kdy přihlášky vzniknou.)
    if (termin.obsazeno_mist > 0) {
      throw chybaKonflikt(
        'Na termín jsou přihlášení lidé. Použij Zrušit termín — přihlášky zůstanou a dá se jim napsat.'
      );
    }

    await pool.query(
      'UPDATE terminy SET smazano_at = NOW(), viditelny = 0, upravil_id = ? WHERE id = ?',
      [req.uzivatel.id, id]
    );
    await zapisAudit({
      req, akce: 'smazani', entita: 'termin', entitaId: id,
      popis: `${termin.produkt_nazev} — ${termin.datum}`,
    });
    res.json({ ok: true, zprava: 'Termín je ve smazaných. Dá se obnovit.' });
  })
);

// POST /api/admin/terminy/:id/obnovit
router.post(
  '/:id(\\d+)/obnovit',
  vyzaduje('terminy', 'menit'),
  asyncHandler(async (req, res) => {
    // Obnovený termín zůstává skrytý - na web se vrátí až vědomě.
    const [vysledek] = await pool.query(
      'UPDATE terminy SET smazano_at = NULL, upravil_id = ? WHERE id = ? AND smazano_at IS NOT NULL',
      [req.uzivatel.id, req.params.id]
    );
    if (vysledek.affectedRows === 0) throw chybaNenalezeno('Smazaný termín nenalezen.');

    await zapisAudit({ req, akce: 'obnoveni', entita: 'termin', entitaId: Number(req.params.id) });
    res.json({ ok: true, zprava: 'Termín je zpátky, zatím skrytý na webu.' });
  })
);

// ------------------------------------------------------------------ pomocné

// "Založeno 10 termínů, 2 vynechané" — a když nevzniklo nic, řekne to rovnou.
// Hláška "Založeno 0 termínů" by vypadala jako chyba, i když je všechno v pořádku.
function zpravaOZalozeni(sloveso, vytvoreno, preskoceno) {
  if (vytvoreno === 0) {
    return 'Nevzniklo nic nového — na všechny vybrané dny už termín byl.';
  }
  return (
    `${sloveso} ${vytvoreno} ${sklonTerminu(vytvoreno)}` +
    (preskoceno ? `, ${preskoceno} vynecháno — na ty dny už termín byl.` : '.')
  );
}

// Živé přihlášky na termín. Stornované se neoznamují - ti lidé už nejedou.
async function prihlaseniNaTerminu(terminId) {
  const [rows] = await pool.query(
    `SELECT id FROM rezervace
      WHERE termin_id = ? AND smazano_at IS NULL
        AND stav IN ('nova','potvrzena','zaplacena')
      ORDER BY id`,
    [terminId]
  );
  return rows.map((r) => r.id);
}

function sklonTerminu(pocet) {
  if (pocet === 1) return 'termín';
  if (pocet >= 2 && pocet <= 4) return 'termíny';
  return 'termínů';
}

function vyber(zdroj, sloupce) {
  const vybrano = {};
  for (const sloupec of sloupce) {
    vybrano[sloupec] = sloupec === 'popis' ? (zdroj[sloupec] ? '(text)' : null) : zdroj[sloupec] ?? null;
  }
  return vybrano;
}

export default router;
