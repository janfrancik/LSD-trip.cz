// src/api/admin/akceptace.js
//
// Modul „Ke schválení“: akceptační testování nové verze na testovacím webu.
// Router se montuje jen tam, kde je akceptace zapnutá (src/api/admin/index.js) -
// v produkci tyhle cesty neexistují, vrátí 404 jako každý neznámý endpoint.
//
// Rozdělení pohledů:
//   tester          vidí úkoly a svoje výsledky, může hlásit problém
//   provoz + admin  vidí navíc výsledky ostatních a vyřizují hlášení
//   admin           schvaluje verzi, spouští import a rozesílá oznámení

import express from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import config from '../../config.js';
import {
  asyncHandler, chybaNenalezeno, chybaKonflikt, chybaBezOpravneni,
} from '../../chyby.js';
import { zvaliduj } from '../../validace.js';
import { okamzik } from '../../cas.js';
import { vyzaduje } from '../../auth/opravneni.js';
import { zapisAudit } from '../../audit.js';
import { naimportujAkceptaci, stavImportu } from '../../akceptace/import.js';
import { ulozPrilohu, pripojPrilohy, prilohyPro, cestaKPriloze } from '../../akceptace/prilohy.js';
import { oznamVerzi, seznamTesteru } from '../../akceptace/oznameni.js';
import {
  nactiVerzi, duvodyProtiSchvaleni, exportMarkdown, poctyProOdznak,
  ukolPatriUzivateli, testeriVerze, ROLE_TESTERU,
  STAVY_VYSLEDKU, STAVY_HLASENI, POPIS_STAVU, ZNACKA_STAVU,
} from '../../akceptace/souhrn.js';

const router = express.Router();

function jeAdmin(req) {
  return req.uzivatel?.role === 'admin';
}

// Tester nevidí, jak hlasovali ostatní - ať ho to při testování neovlivní.
// Provoz a admin vidí všechno, protože podle toho rozhodují o nasazení.
function vidiCiziVysledky(req) {
  return req.uzivatel?.role !== 'tester';
}

function jenAdmin(req) {
  if (!jeAdmin(req)) {
    throw chybaBezOpravneni('Tuhle akci může udělat jen administrátor.');
  }
}

async function najdiVerzi(klic) {
  const [rows] = await pool.query(
    `SELECT id FROM akceptace_verze WHERE ${/^\d+$/.test(String(klic)) ? 'id = ?' : 'kod = ?'}`,
    [klic]
  );
  if (!rows[0]) throw chybaNenalezeno('Verze nenalezena.');
  return rows[0].id;
}

// Výsledky, které tester nemá vidět, se z odpovědi vyhodí úplně - ne že by se
// jen neukázaly v prohlížeči. `muj_stav` je pro každého jeho vlastní: to, že
// úkol zkusil někdo jiný, mě nezbavuje povinnosti ho zkusit taky.
function oseklyUkol(ukol, uzivatel, vidiVse) {
  const muj = ukol.vysledky.find((v) => v.uzivatel_id === uzivatel.id) ?? null;
  const patriMi = ukolPatriUzivateli(ukol, uzivatel);

  return {
    ...ukol,
    zadani_zmeneno_po_testu: Boolean(
      muj && okamzik(ukol.zmeneno_at) > okamzik(muj.updated_at)
    ),
    patri_mi: patriMi,
    muj_vysledek: muj,
    muj_stav: muj?.stav ?? 'neotestovano',
    // Souhrnný stav za celý tým vidí jen ten, kdo řídí nasazení.
    stav_tymu: vidiVse ? ukol.stav : undefined,
    vysledky: vidiVse ? ukol.vysledky : [],
    pocet_vysledku: ukol.vysledky.length,
  };
}

// GET /api/admin/akceptace - seznam verzí s průběhem
router.get(
  '/',
  vyzaduje('akceptace'),
  asyncHandler(async (req, res) => {
    const [verze] = await pool.query(
      `SELECT v.id, v.kod, v.nazev, v.popis, v.stav, v.poradi, v.schvaleno_at, v.oznameno_at,
              u.jmeno AS schvalil_jmeno,
              (SELECT COUNT(*) FROM akceptace_ukoly k WHERE k.verze_id = v.id AND k.aktivni = 1) AS ukolu,
              (SELECT COUNT(*) FROM akceptace_ukoly k
                 LEFT JOIN akceptace_vysledky r ON r.ukol_id = k.id AND r.uzivatel_id = ?
                WHERE k.verze_id = v.id AND k.aktivni = 1
                  AND (r.id IS NULL OR r.stav = 'k_pretestovani')
                  AND (k.jen_admin = 0 OR ? = 'admin')
                  AND (k.role_filtr IS NULL OR k.role_filtr = '' OR FIND_IN_SET(?, k.role_filtr))
                  AND (
                    NOT EXISTS (SELECT 1 FROM akceptace_testeri t WHERE t.verze_id = v.id)
                    OR EXISTS (SELECT 1 FROM akceptace_testeri t
                                WHERE t.verze_id = v.id AND t.uzivatel_id = ?)
                  )) AS ceka_na_me,
              (SELECT COUNT(*) FROM akceptace_hlaseni h
                WHERE h.verze_id = v.id AND h.stav IN ('nove','resi_se')) AS hlaseni_otevrena
         FROM akceptace_verze v
         LEFT JOIN uzivatele u ON u.id = v.schvalil_id
        ORDER BY v.stav = 'schvalena', v.poradi, v.id`,
      [req.uzivatel.id, req.uzivatel.role, req.uzivatel.role, req.uzivatel.id]
    );

    res.json({
      prostredi: config.PROSTREDI,
      muzu_schvalovat: jeAdmin(req),
      vidim_ciz_vysledky: vidiCiziVysledky(req),
      verze,
      // Když import zadání selhal, modul by jinak vypadal jen prázdně.
      // Administrace z tohohle udělá upozornění s tlačítkem na nový pokus.
      import: stavImportu(),
      pocty: await poctyProOdznak(req.uzivatel),
    });
  })
);

// GET /api/admin/akceptace/pocty - pro zvoneček v hlavičce
router.get(
  '/pocty',
  vyzaduje('akceptace'),
  asyncHandler(async (req, res) => {
    res.json(await poctyProOdznak(req.uzivatel));
  })
);

// GET /api/admin/akceptace/verze/:klic - detail podle kódu nebo id
router.get(
  '/verze/:klic',
  vyzaduje('akceptace'),
  asyncHandler(async (req, res) => {
    const data = await nactiVerzi(await najdiVerzi(req.params.klic));
    if (!data) throw chybaNenalezeno('Verze nenalezena.');
    const vidiVse = vidiCiziVysledky(req);

    const ukoly = data.ukoly
      .map((u) => oseklyUkol(u, req.uzivatel, vidiVse))
      // Co se mě netýká, nemá co plést seznam - ledaže mám přehled za všechny.
      .filter((u) => u.patri_mi || vidiVse);

    const mujSouhrn = data.poTesterech.find((t) => t.uzivatel.id === req.uzivatel.id) ?? null;

    res.json({
      verze: data.verze,
      souhrn: data.souhrn,
      muj_souhrn: mujSouhrn,
      ukoly,
      testeri: vidiVse ? data.testeri : undefined,
      testeri_vychozi: vidiVse ? data.testeriVychozi : undefined,
      po_testerech: vidiVse ? data.poTesterech : undefined,
      znacky: ZNACKA_STAVU,
      hlaseni: vidiVse
        ? data.hlaseni
        : data.hlaseni.filter((h) => h.uzivatel_id === req.uzivatel.id),
      muzu_schvalovat: jeAdmin(req),
      duvody_proti_schvaleni: vidiVse ? duvodyProtiSchvaleni(data) : [],
      popis_stavu: POPIS_STAVU,
    });
  })
);

// ------------------------------------------------------------------ výsledky

const schemaVysledek = z.object({
  stav: z.enum(['funguje', 'nefunguje', 'nerozumim'], {
    error: 'Vyber, jestli to funguje, nefunguje, nebo je zadání nejasné.',
  }),
  komentar: z.string().trim().max(5000).optional(),
  prilohy: z.array(z.coerce.number().int().positive()).max(10).optional(),
});

// PUT /api/admin/akceptace/ukoly/:id/vysledek - můj výsledek u úkolu
router.put(
  '/ukoly/:id/vysledek',
  vyzaduje('akceptace', 'menit'),
  asyncHandler(async (req, res) => {
    const vstup = zvaliduj(schemaVysledek, req.body ?? {});

    const [[ukol]] = await pool.query(
      `SELECT k.id, k.nazev, k.aktivni, k.role_filtr, k.jen_admin,
              v.id AS verze_id, v.stav AS verze_stav, v.nazev AS verze_nazev
         FROM akceptace_ukoly k JOIN akceptace_verze v ON v.id = k.verze_id
        WHERE k.id = ?`,
      [req.params.id]
    );
    if (!ukol) throw chybaNenalezeno('Úkol nenalezen.');
    if (!ukol.aktivni) throw chybaKonflikt('Tenhle úkol už není součástí zadání.');
    if (!ukolPatriUzivateli(ukol, req.uzivatel)) {
      throw chybaBezOpravneni('Tenhle úkol testuje někdo jiný.');
    }
    if (ukol.verze_stav === 'schvalena') {
      throw chybaKonflikt('Verze je už schválená, výsledky se nedají měnit.');
    }
    if (vstup.stav === 'nefunguje' && !vstup.komentar) {
      throw chybaKonflikt('Napiš prosím do komentáře, co nefunguje — jinak to nejde opravit.', {
        komentar: 'U nefunkčního úkolu je komentář povinný.',
      });
    }

    // Zařízení bereme z hlavičky, ne z těla - u "nefunguje" je to první
    // otázka, kterou si člověk položí, a opisovat se to nemá.
    const zarizeni = (req.get('user-agent') ?? '').slice(0, 255) || null;

    await pool.query(
      `INSERT INTO akceptace_vysledky (ukol_id, uzivatel_id, stav, komentar, zarizeni)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         stav = VALUES(stav), komentar = VALUES(komentar),
         zarizeni = VALUES(zarizeni), predchozi_stav = NULL`,
      [ukol.id, req.uzivatel.id, vstup.stav, vstup.komentar ?? null, zarizeni]
    );
    const [[vysledek]] = await pool.query(
      'SELECT id FROM akceptace_vysledky WHERE ukol_id = ? AND uzivatel_id = ?',
      [ukol.id, req.uzivatel.id]
    );

    const pripojeno = await pripojPrilohy(vstup.prilohy, {
      vysledekId: vysledek.id,
      uzivatelId: req.uzivatel.id,
    });

    await zapisAudit({
      req,
      akce: 'akceptace_vysledek',
      entita: 'akceptace_ukol',
      entitaId: ukol.id,
      popis: `${ukol.nazev}: ${POPIS_STAVU[vstup.stav]}`,
      po: { stav: vstup.stav, komentar: vstup.komentar ?? null, prilohy: pripojeno },
    });

    res.json({ ok: true, zprava: 'Zapsáno, díky.' });
  })
);

// POST /api/admin/akceptace/ukoly/:id/k-pretestovani
// Po opravě a novém nasazení: nefunkční úkol se vrátí testerům.
router.post(
  '/ukoly/:id/k-pretestovani',
  vyzaduje('akceptace', 'menit'),
  asyncHandler(async (req, res) => {
    if (!vidiCiziVysledky(req)) {
      throw chybaBezOpravneni('K přetestování posílá úkol provoz nebo administrátor.');
    }
    const [[ukol]] = await pool.query('SELECT id, nazev FROM akceptace_ukoly WHERE id = ?', [
      req.params.id,
    ]);
    if (!ukol) throw chybaNenalezeno('Úkol nenalezen.');

    const vsem = req.body?.vsem === true;
    const pocet = await posliKPretestovani({ ukolId: ukol.id, vsem });
    await zapisAudit({
      req,
      akce: 'akceptace_k_pretestovani',
      entita: 'akceptace_ukol',
      entitaId: ukol.id,
      popis: ukol.nazev,
      po: { prepnuto_vysledku: pocet, vsem },
    });

    res.json({
      ok: true,
      prepnuto: pocet,
      zprava: pocet
        ? `Úkol je znovu u ${pocet} ${pocet === 1 ? 'testera' : 'testerů'}.`
        : vsem
          ? 'U tohoto úkolu zatím nikdo nic nevyplnil.'
          : 'U tohoto úkolu nikdo nehlásil problém — k přetestování nebylo co vracet.',
    });
  })
);

// POST /api/admin/akceptace/verze/:klic/k-pretestovani - hromadně po nasazení opravy
router.post(
  '/verze/:klic/k-pretestovani',
  vyzaduje('akceptace', 'menit'),
  asyncHandler(async (req, res) => {
    if (!vidiCiziVysledky(req)) {
      throw chybaBezOpravneni('K přetestování posílá úkoly provoz nebo administrátor.');
    }
    const verzeId = await najdiVerzi(req.params.klic);
    const vsem = req.body?.vsem === true;
    const pocet = await posliKPretestovani({ verzeId, vsem });
    await zapisAudit({
      req,
      akce: 'akceptace_k_pretestovani',
      entita: 'akceptace_verze',
      entitaId: verzeId,
      po: { prepnuto_vysledku: pocet, vsem },
    });
    res.json({
      ok: true,
      prepnuto: pocet,
      zprava: pocet
        ? vsem
          ? `Celá verze je znovu k otestování (${pocet} výsledků).`
          : `Nefunkční úkoly jsou znovu u testerů, kteří je hlásili (${pocet}).`
        : 'Nebylo co přetestovat.',
    });
  })
);

// Vrací úkol testerům. Ve výchozím stavu jen těm, kterým nefungoval nebo
// nerozuměli zadání - komu fungoval, nemá co zkoušet znovu. Volba `vsem`
// je pro případ, kdy se opravou změnilo chování pro všechny.
//
// Původní stav zůstává v predchozi_stav, ať je v přehledu vidět, co se
// vlastně opravovalo.
async function posliKPretestovani({ ukolId = null, verzeId = null, vsem = false }) {
  const stavy = vsem ? ['funguje', 'nefunguje', 'nerozumim'] : ['nefunguje', 'nerozumim'];
  const [vysledek] = await pool.query(
    `UPDATE akceptace_vysledky r
        ${verzeId ? 'JOIN akceptace_ukoly k ON k.id = r.ukol_id' : ''}
        SET r.predchozi_stav = r.stav, r.stav = 'k_pretestovani'
      WHERE ${verzeId ? 'k.verze_id = ?' : 'r.ukol_id = ?'}
        AND r.stav IN (?)`,
    [verzeId ?? ukolId, stavy]
  );
  return vysledek.affectedRows;
}

// ------------------------------------------------------------------- přílohy

const schemaPriloha = z.object({
  obsah: z.string().min(10, 'Příloha je prázdná.'),
  nazev: z.string().trim().max(255).optional(),
});

// POST /api/admin/akceptace/prilohy - nahrání snímku obrazovky
router.post(
  '/prilohy',
  vyzaduje('akceptace', 'menit'),
  asyncHandler(async (req, res) => {
    const vstup = zvaliduj(schemaPriloha, req.body ?? {});
    const priloha = await ulozPrilohu({
      obsah: vstup.obsah,
      nazev: vstup.nazev ?? null,
      uzivatelId: req.uzivatel.id,
    });
    res.status(201).json({
      id: priloha.id,
      mime: priloha.mime,
      velikost: priloha.velikost,
      url: `/api/admin/akceptace/prilohy/${priloha.id}`,
    });
  })
);

// GET /api/admin/akceptace/prilohy/:id - soubor. Přes API, ne staticky,
// aby se k snímkům z testu nedostal nikdo nepřihlášený.
router.get(
  '/prilohy/:id',
  vyzaduje('akceptace'),
  asyncHandler(async (req, res) => {
    const [[priloha]] = await pool.query(
      'SELECT id, soubor, mime, uzivatel_id, vysledek_id, hlaseni_id FROM akceptace_prilohy WHERE id = ?',
      [req.params.id]
    );
    if (!priloha) throw chybaNenalezeno('Příloha nenalezena.');

    // Tester vidí svoje snímky a snímky připojené k hlášením, která zná;
    // cizí výsledky mu skryté zůstávají i v přílohách.
    if (!vidiCiziVysledky(req) && priloha.uzivatel_id !== req.uzivatel.id) {
      throw chybaBezOpravneni('Tuhle přílohu nemáš povolenou.');
    }

    const cesta = cestaKPriloze(priloha.soubor);
    if (!cesta) throw chybaNenalezeno('Příloha nenalezena.');

    res.type(priloha.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(cesta, (err) => {
      if (err && !res.headersSent) res.status(404).json({ chyba: 'Soubor přílohy chybí.' });
    });
  })
);

// ------------------------------------------------------------------ hlášení

const schemaHlaseni = z.object({
  text: z.string().trim().min(3, 'Napiš, co se stalo.').max(5000),
  url: z.string().trim().max(500).optional(),
  prohlizec: z.string().trim().max(255).optional(),
  rozliseni: z.string().trim().max(40).optional(),
  ukol_id: z.coerce.number().int().positive().optional(),
  verze_id: z.coerce.number().int().positive().optional(),
  prilohy: z.array(z.coerce.number().int().positive()).max(10).optional(),
});

// POST /api/admin/akceptace/hlaseni - tlačítko „Nahlásit problém“
router.post(
  '/hlaseni',
  vyzaduje('akceptace', 'menit'),
  asyncHandler(async (req, res) => {
    const vstup = zvaliduj(schemaHlaseni, req.body ?? {});

    // Když hlášení nepatří ke konkrétní verzi, přiřadí se k té, která se teď
    // testuje - jinak by se v přehledu verze neobjevilo.
    let verzeId = vstup.verze_id ?? null;
    if (!verzeId && vstup.ukol_id) {
      const [[ukol]] = await pool.query('SELECT verze_id FROM akceptace_ukoly WHERE id = ?', [
        vstup.ukol_id,
      ]);
      verzeId = ukol?.verze_id ?? null;
    }
    if (!verzeId) {
      const [[verze]] = await pool.query(
        `SELECT id FROM akceptace_verze WHERE stav = 'otevrena' ORDER BY poradi, id LIMIT 1`
      );
      verzeId = verze?.id ?? null;
    }

    const [vysledek] = await pool.query(
      `INSERT INTO akceptace_hlaseni
         (verze_id, ukol_id, uzivatel_id, text, url, prohlizec, rozliseni)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        verzeId,
        vstup.ukol_id ?? null,
        req.uzivatel.id,
        vstup.text,
        vstup.url ?? null,
        // Prohlížeč bere z hlavičky, ne z toho, co pošle stránka - do hlášení
        // patří skutečnost, ne přepsatelná hodnota.
        (vstup.prohlizec ?? req.get('user-agent') ?? '').slice(0, 255) || null,
        vstup.rozliseni ?? null,
      ]
    );

    const pripojeno = await pripojPrilohy(vstup.prilohy, {
      hlaseniId: vysledek.insertId,
      uzivatelId: req.uzivatel.id,
    });

    await zapisAudit({
      req,
      akce: 'akceptace_hlaseni',
      entita: 'akceptace_hlaseni',
      entitaId: vysledek.insertId,
      popis: vstup.text.slice(0, 120),
      po: { url: vstup.url ?? null, prilohy: pripojeno },
    });

    res.status(201).json({
      id: vysledek.insertId,
      ok: true,
      zprava: 'Díky, hlášení je zapsané. Podíváme se na to.',
    });
  })
);

// GET /api/admin/akceptace/hlaseni
router.get(
  '/hlaseni',
  vyzaduje('akceptace'),
  asyncHandler(async (req, res) => {
    const stav = STAVY_HLASENI.includes(req.query.stav) ? req.query.stav : null;
    const jenMoje = !vidiCiziVysledky(req);

    const kde = [];
    const params = [];
    if (stav) {
      kde.push('h.stav = ?');
      params.push(stav);
    }
    if (jenMoje) {
      kde.push('h.uzivatel_id = ?');
      params.push(req.uzivatel.id);
    }

    const [data] = await pool.query(
      `SELECT h.*, u.jmeno AS kdo, r.jmeno AS vyresil_jmeno, v.kod AS verze_kod,
              k.nazev AS ukol_nazev,
              (SELECT COUNT(*) FROM akceptace_prilohy p WHERE p.hlaseni_id = h.id) AS prilohy
         FROM akceptace_hlaseni h
         LEFT JOIN uzivatele u ON u.id = h.uzivatel_id
         LEFT JOIN uzivatele r ON r.id = h.vyresil_id
         LEFT JOIN akceptace_verze v ON v.id = h.verze_id
         LEFT JOIN akceptace_ukoly k ON k.id = h.ukol_id
        ${kde.length ? 'WHERE ' + kde.join(' AND ') : ''}
        ORDER BY FIELD(h.stav,'nove','resi_se','vyreseno','zamitnuto'), h.created_at DESC
        LIMIT 200`,
      params
    );

    const [pocty] = await pool.query(
      `SELECT stav, COUNT(*) AS pocet FROM akceptace_hlaseni
        ${jenMoje ? 'WHERE uzivatel_id = ?' : ''} GROUP BY stav`,
      jenMoje ? [req.uzivatel.id] : []
    );

    res.json({
      data,
      pocty: Object.fromEntries(pocty.map((p) => [p.stav, p.pocet])),
    });
  })
);

// GET /api/admin/akceptace/hlaseni/:id - detail včetně příloh
router.get(
  '/hlaseni/:id',
  vyzaduje('akceptace'),
  asyncHandler(async (req, res) => {
    const [[hlaseni]] = await pool.query(
      `SELECT h.*, u.jmeno AS kdo, r.jmeno AS vyresil_jmeno, v.kod AS verze_kod, k.nazev AS ukol_nazev
         FROM akceptace_hlaseni h
         LEFT JOIN uzivatele u ON u.id = h.uzivatel_id
         LEFT JOIN uzivatele r ON r.id = h.vyresil_id
         LEFT JOIN akceptace_verze v ON v.id = h.verze_id
         LEFT JOIN akceptace_ukoly k ON k.id = h.ukol_id
        WHERE h.id = ?`,
      [req.params.id]
    );
    if (!hlaseni) throw chybaNenalezeno('Hlášení nenalezeno.');
    if (!vidiCiziVysledky(req) && hlaseni.uzivatel_id !== req.uzivatel.id) {
      throw chybaBezOpravneni('Tohle hlášení nemáš povolené.');
    }
    res.json({ ...hlaseni, prilohy: await prilohyPro({ hlaseniId: hlaseni.id }) });
  })
);

const schemaUpravaHlaseni = z.object({
  stav: z.enum(STAVY_HLASENI).optional(),
  odpoved: z.string().trim().max(5000).optional(),
});

// PATCH /api/admin/akceptace/hlaseni/:id - vyřízení hlášení
router.patch(
  '/hlaseni/:id',
  vyzaduje('akceptace', 'menit'),
  asyncHandler(async (req, res) => {
    if (!vidiCiziVysledky(req)) {
      throw chybaBezOpravneni('Hlášení vyřizuje provoz nebo administrátor.');
    }
    const vstup = zvaliduj(schemaUpravaHlaseni, req.body ?? {});

    const [[pred]] = await pool.query(
      'SELECT id, stav, odpoved, text FROM akceptace_hlaseni WHERE id = ?',
      [req.params.id]
    );
    if (!pred) throw chybaNenalezeno('Hlášení nenalezeno.');

    const stav = vstup.stav ?? pred.stav;
    const vyreseno = ['vyreseno', 'zamitnuto'].includes(stav);

    await pool.query(
      `UPDATE akceptace_hlaseni
          SET stav = ?, odpoved = ?,
              vyresil_id = ?, vyreseno_at = ?
        WHERE id = ?`,
      [
        stav,
        vstup.odpoved ?? pred.odpoved,
        vyreseno ? req.uzivatel.id : null,
        vyreseno ? new Date() : null,
        pred.id,
      ]
    );

    await zapisAudit({
      req,
      akce: 'zmena',
      entita: 'akceptace_hlaseni',
      entitaId: pred.id,
      popis: pred.text.slice(0, 120),
      pred: { stav: pred.stav },
      po: { stav },
    });

    res.json({ ok: true });
  })
);

// ------------------------------------------------------------------ testeři

// GET /api/admin/akceptace/verze/:klic/testeri - kdo verzi testuje a z koho vybírat
router.get(
  '/verze/:klic/testeri',
  vyzaduje('akceptace'),
  asyncHandler(async (req, res) => {
    if (!vidiCiziVysledky(req)) throw chybaBezOpravneni('Přiřazení testerů vidí provoz a admin.');
    const verzeId = await najdiVerzi(req.params.klic);
    const { testeri, vychozi } = await testeriVerze(verzeId);

    const [moznosti] = await pool.query(
      `SELECT id, jmeno, email, role FROM uzivatele
        WHERE role IN (?) AND aktivni = 1 AND smazano_at IS NULL ORDER BY jmeno`,
      [ROLE_TESTERU]
    );

    res.json({ testeri, vychozi, moznosti });
  })
);

const schemaTesteri = z.object({
  uzivatele: z.array(z.coerce.number().int().positive()).max(50),
});

// PUT /api/admin/akceptace/verze/:klic/testeri - kdo verzi testuje
router.put(
  '/verze/:klic/testeri',
  vyzaduje('akceptace', 'menit'),
  asyncHandler(async (req, res) => {
    jenAdmin(req);
    const { uzivatele } = zvaliduj(schemaTesteri, req.body ?? {});
    const verzeId = await najdiVerzi(req.params.klic);

    // Přiřadit jde jen člověk, který na akceptaci vůbec má právo - jinak by
    // se do seznamu dal poslat kdokoli a čekalo by se na něj věčně.
    const [moznosti] = await pool.query(
      `SELECT id FROM uzivatele
        WHERE id IN (?) AND role IN (?) AND aktivni = 1 AND smazano_at IS NULL`,
      [uzivatele.length ? uzivatele : [0], ROLE_TESTERU]
    );
    const platni = moznosti.map((m) => m.id);

    await pool.query('DELETE FROM akceptace_testeri WHERE verze_id = ?', [verzeId]);
    for (const id of platni) {
      await pool.query(
        'INSERT INTO akceptace_testeri (verze_id, uzivatel_id, prirazeno_id) VALUES (?, ?, ?)',
        [verzeId, id, req.uzivatel.id]
      );
    }

    await zapisAudit({
      req,
      akce: 'akceptace_testeri',
      entita: 'akceptace_verze',
      entitaId: verzeId,
      po: { testeru: platni.length },
    });

    const { testeri, vychozi } = await testeriVerze(verzeId);
    res.json({
      ok: true,
      testeri,
      vychozi,
      zprava: platni.length
        ? `Verzi testuje ${platni.length} ${platni.length === 1 ? 'člověk' : 'lidí'}.`
        : 'Výběr zrušen — verzi testují všichni, kdo na to mají právo.',
    });
  })
);

// ------------------------------------------------------- schválení a export

const schemaSchvaleni = z.object({
  poznamka: z.string().trim().max(2000).optional(),
});

// POST /api/admin/akceptace/verze/:klic/schvalit
router.post(
  '/verze/:klic/schvalit',
  vyzaduje('akceptace', 'menit'),
  asyncHandler(async (req, res) => {
    jenAdmin(req);
    const { poznamka } = zvaliduj(schemaSchvaleni, req.body ?? {});
    const verzeId = await najdiVerzi(req.params.klic);
    const data = await nactiVerzi(verzeId);

    const duvody = duvodyProtiSchvaleni(data);
    if (duvody.length) {
      throw chybaKonflikt('Verzi ještě nejde schválit: ' + duvody.join(' '), { duvody });
    }

    await pool.query(
      `UPDATE akceptace_verze
          SET stav = 'schvalena', schvalil_id = ?, schvaleno_at = NOW(), schvaleni_poznamka = ?
        WHERE id = ?`,
      [req.uzivatel.id, poznamka ?? null, verzeId]
    );

    await zapisAudit({
      req,
      akce: 'akceptace_schvaleni',
      entita: 'akceptace_verze',
      entitaId: verzeId,
      popis: data.verze.nazev,
      po: {
        poznamka: poznamka ?? null,
        ukolu: data.souhrn.celkem,
        hlaseni: data.souhrn.hlaseni_celkem,
      },
    });

    res.json({ ok: true, zprava: `Verze „${data.verze.nazev}“ je schválená.` });
  })
);

// GET /api/admin/akceptace/verze/:klic/export - souhrn jako Markdown
router.get(
  '/verze/:klic/export',
  vyzaduje('akceptace'),
  asyncHandler(async (req, res) => {
    const verzeId = await najdiVerzi(req.params.klic);
    const [[verze]] = await pool.query('SELECT kod FROM akceptace_verze WHERE id = ?', [verzeId]);
    const obsah = await exportMarkdown(verzeId);
    res.json({ soubor: `${verze.kod}-akceptace.md`, obsah });
  })
);

// POST /api/admin/akceptace/verze/:klic/oznamit - e-mail testerům
router.post(
  '/verze/:klic/oznamit',
  vyzaduje('akceptace', 'menit'),
  asyncHandler(async (req, res) => {
    jenAdmin(req);
    const verzeId = await najdiVerzi(req.params.klic);
    const [[pocet]] = await pool.query(
      'SELECT COUNT(*) AS ukolu FROM akceptace_ukoly WHERE verze_id = ? AND aktivni = 1',
      [verzeId]
    );

    const vysledek = await oznamVerzi(verzeId, { pocetUkolu: Number(pocet.ukolu) });
    await zapisAudit({
      req,
      akce: 'akceptace_oznameni',
      entita: 'akceptace_verze',
      entitaId: verzeId,
      po: { odeslano: vysledek.odeslano, rezim: vysledek.rezim },
    });

    res.json({
      ok: true,
      ...vysledek,
      zprava: vysledek.bezTesteru
        ? 'Není komu poslat — žádný aktivní tester.'
        : vysledek.odeslano > 0
          ? `Oznámení odešlo (${vysledek.odeslano}).`
          : vysledek.doSchranky > 0
            ? `Oznámení je v testovací schránce (${vysledek.doSchranky} e-mailů) — ven nic neodešlo.`
            : 'Odesílání e-mailů je vypnuté, oznámení se jen zapsalo do logu e-mailů.',
    });
  })
);

// GET /api/admin/akceptace/testeri - komu by oznámení šlo
router.get(
  '/testeri',
  vyzaduje('akceptace'),
  asyncHandler(async (req, res) => {
    const testeri = await seznamTesteru();
    res.json({
      // E-maily vidí jen ten, kdo spravuje uživatele - testerovi stačí jméno.
      data: testeri.map((t) =>
        vidiCiziVysledky(req) ? t : { id: t.id, jmeno: t.jmeno, role: t.role }
      ),
    });
  })
);

// POST /api/admin/akceptace/import - znovu načíst zadání z repozitáře
router.post(
  '/import',
  vyzaduje('akceptace', 'menit'),
  asyncHandler(async (req, res) => {
    jenAdmin(req);

    let prehled;
    try {
      prehled = await naimportujAkceptaci();
    } catch (err) {
      // Chyba importu je buď v zadání, nebo v databázi (chybějící migrace).
      // Obojí je věc správce, ne uživatele - ale ať se to dozví česky.
      throw chybaKonflikt(`Zadání se nepodařilo načíst: ${err.message}`);
    }

    await zapisAudit({
      req,
      akce: 'akceptace_import',
      entita: 'akceptace_verze',
      po: { verze: prehled },
    });
    res.json({ ok: true, prehled, zprava: 'Zadání je načtené ze souborů v repozitáři.' });
  })
);

export default router;
