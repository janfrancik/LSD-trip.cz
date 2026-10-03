// src/api/verejne.js
//
// Veřejné API webu: kontaktní formulář, healthcheck a obsah kurzů.
//
// Zásada: veřejné endpointy nikdy nevracejí osobní údaje. Poptávku je možné
// odeslat, ale ne si ji přečíst - to umí jen administrace. U termínu jde ven
// počet volných míst, ne jména přihlášených.
//
// Cesty jsou generické podle typu produktu, ne kurzové (docs/plan-kurzy.md §3):
// tandem a expedice půjdou stejnou cestou, až na ně přijde řada.

import express from 'express';
import { z } from 'zod';
import pool from '../db.js';
import config from '../config.js';
import { asyncHandler, chybaSpatnyVstup, chybaNenalezeno, chybaKonflikt } from '../chyby.js';
import { zvaliduj, schemaEmail, schemaJmeno, schemaTelefon } from '../validace.js';
import { isoDatum } from '../cas.js';
import { limitPoptavky, limitPrihlasek } from '../auth/limit.js';
import { nactiVerejneKurzy, nactiVerejnyKurz, nactiVerejneTerminyKurzu } from '../kurzy.js';
import { zapisPrihlasku, nactiPrihlasku, nactiPrihlaskuPodleKodu, posliOznameni, popisTerminu } from '../prihlasky.js';
import { hodnota } from '../nastaveni.js';
import { posliZeSablony } from '../email/sablony.js';

const router = express.Router();

const schemaPoptavka = z.object({
  jmeno: schemaJmeno,
  email: schemaEmail,
  telefon: schemaTelefon,
  zprava: z.string().trim().max(5000, 'Zpráva je příliš dlouhá.').optional(),
  // Past na roboty: pole je ve formuláři skryté, člověk ho nevyplní.
  web: z.string().max(200).optional(),
});

// POST /api/poptavky - odeslání kontaktního formuláře
router.post(
  '/poptavky',
  limitPoptavky,
  asyncHandler(async (req, res) => {
    const vstup = zvaliduj(schemaPoptavka, req.body ?? {});

    // Vyplněná past = robot. Odpovíme jako při úspěchu, ať se nemá čeho chytit.
    if (vstup.web) {
      return res.status(201).json({ ok: true, zprava: 'Zprávu jsme dostali.' });
    }
    if (!vstup.zprava && !vstup.telefon) {
      throw chybaSpatnyVstup('Napiš nám prosím zprávu nebo nech telefon.', {
        zprava: 'Napiš zprávu nebo nech telefon.',
      });
    }

    const [vlozeno] = await pool.query(
      `INSERT INTO poptavky (jmeno, email, telefon, zprava, zdroj, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [vstup.jmeno, vstup.email, vstup.telefon, vstup.zprava ?? null, 'web', req.ip ?? null]
    );

    // Upozornění provozu. Stejně jako u přihlášky nesmí e-mail shodit uložení:
    // poptávka je v databázi a v administraci ji provoz uvidí i tehdy, když
    // se odeslání nepovede. Zákazníkovi se odtud nic neposílá - odpovídá se
    // mu ručně z administrace (Poptávky → Odpovědět).
    try {
      const provoz = await hodnota('provoz.email');
      if (provoz) {
        await posliZeSablony('poptavka_provoz', {
          prijemce: provoz,
          data: {
            jmeno: vstup.jmeno,
            email: vstup.email,
            telefon: vstup.telefon ?? '',
            zprava: vstup.zprava ?? '',
            odkaz_admin: config.url(`/admin/poptavky/${vlozeno.insertId}`),
          },
          vazby: { poptavkaId: vlozeno.insertId },
        });
      }
    } catch (chyba) {
      console.error('[poptavky] upozornění provozu se nepodařilo odeslat:', chyba.message);
    }

    // Vracíme jen potvrzení, ne uloženou poptávku - nemá cenu posílat zpátky
    // data, která už odesílatel zná, a zejména ne id a interní pole.
    res.status(201).json({
      ok: true,
      zprava: 'Zprávu jsme dostali, ozveme se do 24 hodin.',
    });
  })
);

// ------------------------------------------------------------------ kurzy

// GET /api/produkty?typ=kurz - přehled zveřejněných kurzů
//
// Jiný typ než kurz zatím nemá v databázi obsah (tandem a expedice jsou do
// svých modulů pořád v data.js), takže se vrací prázdný seznam - ne chyba.
router.get(
  '/produkty',
  asyncHandler(async (req, res) => {
    const typ = String(req.query.typ ?? 'kurz');
    const data = typ === 'kurz' ? await nactiVerejneKurzy() : [];
    res.json({ data, celkem: data.length });
  })
);

// GET /api/produkty/:slug - detail kurzu
router.get(
  '/produkty/:slug',
  asyncHandler(async (req, res) => {
    const kurz = await nactiVerejnyKurz(String(req.params.slug));
    // Nezveřejněný kurz se nesmí dát přečíst ani přes přímou adresu. 404,
    // ne 403 - veřejná část nemá prozrazovat, že takový kurz existuje.
    if (!kurz) throw chybaNenalezeno('Kurz nenalezen.');
    res.json(kurz);
  })
);

// GET /api/terminy?typ=kurz - termíny pro kalendář
router.get(
  '/terminy',
  asyncHandler(async (req, res) => {
    const typ = String(req.query.typ ?? 'kurz');
    const data = typ === 'kurz' ? await nactiVerejneTerminyKurzu() : [];
    res.json({ data, celkem: data.length });
  })
);


// --------------------------------------------------------------- přihlášky

const schemaUcastnik = z.object({
  jmeno: z.string({ error: 'Jméno účastníka je povinné.' }).trim()
    .min(2, 'Jméno účastníka je povinné.').max(160, 'Jméno je příliš dlouhé.'),
  // Datum narození je tu kvůli dvěma věcem: věkovému limitu kurzu a souhlasu
  // zákonného zástupce. Nic jiného se z něj nepočítá.
  datum_narozeni: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum narození zadej jako 1990-05-17.')
    .nullable().optional().or(z.literal('')).transform((v) => (v ? v : null)),
  vaha_kg: z.coerce.number().int().min(20, 'Hmotnost zadej v kilogramech.')
    .max(300, 'Hmotnost zadej v kilogramech.').nullable().optional(),
  telefon: z.string().trim().max(40).nullable().optional().or(z.literal(''))
    .transform((v) => (v ? v : null)),
  email: z.string().trim().max(255).nullable().optional().or(z.literal(''))
    .transform((v) => (v ? v : null)),
  doklada_prohlidku: z.coerce.boolean().default(false),
  zajisti_souhlas_zastupce: z.coerce.boolean().default(false),
  poznamka: z.string().trim().max(500).nullable().optional().or(z.literal(''))
    .transform((v) => (v ? v : null)),
});

const schemaPrihlaska = z.object({
  termin_id: z.coerce.number({ error: 'Vyber termín.' }).int().positive('Vyber termín.'),
  jmeno: schemaJmeno,
  email: schemaEmail,
  telefon: schemaTelefon,
  mesto: z.string().trim().max(100).nullable().optional().or(z.literal(''))
    .transform((v) => (v ? v : null)),
  ucastnici: z.array(schemaUcastnik)
    .min(1, 'Přidej aspoň jednoho účastníka.')
    .max(10, 'Víc než deset lidí naráz raději domluvíme telefonem.'),
  zprava: z.string().trim().max(2000).nullable().optional().or(z.literal(''))
    .transform((v) => (v ? v : null)),
  // Souhlasy jsou povinné všechny tři - bez nich přihlášku zpracovat nejde.
  souhlas_vop: z.coerce.boolean(),
  souhlas_gdpr: z.coerce.boolean(),
  souhlas_zdravi: z.coerce.boolean(),
  // Past na roboty: pole je ve formuláři skryté, člověk ho nevyplní.
  web: z.string().max(200).optional(),
});

// Další termíny téhož kurzu - posílají se, když je ten vybraný plný.
// Čekací listinu nevedeme, ale člověk nemá skončit u slepé uličky.
async function dalsiTerminy(produktId, kromeTerminu) {
  const [rows] = await pool.query(
    `SELECT t.id, t.datum, t.cas_od, t.popis_casu, t.kapacita_mist, t.obsazeno_mist,
            m.nazev AS misto_nazev
       FROM terminy t
       LEFT JOIN mista m ON m.id = t.misto_id
      WHERE t.produkt_id = ? AND t.id <> ? AND t.smazano_at IS NULL
        AND t.viditelny = 1 AND t.stav = 'otevreno' AND t.datum >= ?
      ORDER BY t.datum
      LIMIT 5`,
    [produktId, kromeTerminu, isoDatum(new Date())]
  );
  return rows
    .filter((t) => !t.kapacita_mist || t.obsazeno_mist < t.kapacita_mist)
    .map((t) => ({
      id: t.id,
      datum: t.datum,
      misto: t.misto_nazev,
      volno: t.kapacita_mist ? t.kapacita_mist - t.obsazeno_mist : null,
    }));
}

// POST /api/prihlasky - přihláška na termín kurzu
router.post(
  '/prihlasky',
  limitPrihlasek,
  asyncHandler(async (req, res) => {
    const vstup = zvaliduj(schemaPrihlaska, req.body ?? {});

    // Vyplněná past = robot. Odpovíme jako při úspěchu, ať se nemá čeho chytit.
    if (vstup.web) {
      return res.status(201).json({ ok: true, kod: null, zprava: 'Přihlášku máme.' });
    }

    const chybejici = [];
    if (!vstup.souhlas_vop) chybejici.push(['souhlas_vop', 'Bez souhlasu s podmínkami to nejde.']);
    if (!vstup.souhlas_gdpr) chybejici.push(['souhlas_gdpr', 'Bez souhlasu se zpracováním údajů to nejde.']);
    if (!vstup.souhlas_zdravi) chybejici.push(['souhlas_zdravi', 'Bez zdravotního prohlášení to nejde.']);
    if (chybejici.length) {
      throw chybaSpatnyVstup(chybejici[0][1], Object.fromEntries(chybejici));
    }

    let vysledek;
    try {
      vysledek = await zapisPrihlasku({
        terminId: vstup.termin_id,
        kontakt: {
          jmeno: vstup.jmeno, email: vstup.email,
          telefon: vstup.telefon, mesto: vstup.mesto,
        },
        ucastnici: vstup.ucastnici,
        souhlasy: {
          vop: vstup.souhlas_vop, gdpr: vstup.souhlas_gdpr, zdravi: vstup.souhlas_zdravi,
        },
        zprava: vstup.zprava,
        zdroj: 'web',
      });
    } catch (chyba) {
      // Plný termín: místo slepé uličky nabídneme další termíny toho kurzu.
      if (chyba.status === 409 && chyba.detaily?.produkt_id) {
        const dalsi = await dalsiTerminy(chyba.detaily.produkt_id, vstup.termin_id);
        throw chybaKonflikt(chyba.message, { volno: chyba.detaily.volno, dalsi_terminy: dalsi });
      }
      throw chyba;
    }

    const prihlaska = await nactiPrihlasku(vysledek.id);

    // E-maily nesmí shodit přihlášku: ta je v databázi a provoz ji uvidí
    // i tehdy, když se odeslání nepovede.
    try {
      await posliOznameni('prihlaska_prijata', prihlaska);
      const provoz = await hodnota('provoz.email');
      if (provoz) await posliOznameni('prihlaska_provoz', prihlaska, { prijemce: provoz });
    } catch (chyba) {
      console.error('[prihlasky] e-mail se nepodařilo odeslat:', chyba.message);
    }

    res.status(201).json({
      ok: true,
      kod: prihlaska.kod,
      odkaz: `/prihlaska/${prihlaska.kod}?t=${prihlaska.verejny_token}`,
      termin: popisTerminu(prihlaska),
      // Účastník mimo limit se přihlásí, ale musí o tom vědět (rozhodnutí 3).
      varovani: vysledek.varovani,
      // Neslibovat e-mail, který neodejde. V režimech bez odesílání zákazníkům
      // by se člověk díval do schránky na něco, co nikdy nepřijde - a když se
      // neozve ani provoz, bere to jako že se přihláška ztratila.
      zprava: config.muzeZakaznikovi
        ? 'Přihlášku máme. Potvrzení jsme poslali e-mailem.'
        : 'Přihlášku máme a ozveme se vám. Potvrzovací e-mail zatím neposíláme — '
          + 'číslo přihlášky si prosím poznamenejte.',
    });
  })
);

// GET /api/prihlasky/:kod?t=token - účastník vidí svou přihlášku
//
// Bez správného tokenu 404, ne 403: z odpovědi nemá jít poznat, jestli
// takové číslo přihlášky existuje.
router.get(
  '/prihlasky/:kod',
  asyncHandler(async (req, res) => {
    const prihlaska = await nactiPrihlaskuPodleKodu(String(req.params.kod));
    if (!prihlaska || prihlaska.verejny_token !== String(req.query.t ?? '')) {
      throw chybaNenalezeno('Přihláška nenalezena.');
    }
    res.json(prositPrihlasku(prihlaska));
  })
);

// Co z přihlášky smí ven. Interní poznámka provozu ani token tam nepatří.
export function prositPrihlasku(p) {
  return {
    kod: p.kod,
    stav: p.stav,
    kurz: p.produkt_nazev,
    kurz_slug: p.produkt_slug,
    termin: popisTerminu(p),
    datum: p.datum,
    misto: p.misto_nazev,
    termin_stav: p.termin_stav,
    pocet_osob: p.pocet_osob,
    cena_hal: p.cena_hal,
    zprava: p.zprava,
    storno_duvod: p.storno_duvod,
    created_at: p.created_at,
    ucastnici: p.ucastnici.map((u) => ({
      jmeno: u.jmeno,
      vek: u.vek,
      vaha_kg: u.vaha_kg,
      varovani: u.varovani,
    })),
    souhlasy: {
      vop: p.souhlas_vop_at, gdpr: p.souhlas_gdpr_at, zdravi: p.souhlas_zdravi_at,
    },
  };
}

// GET /api/health - dostupnost aplikace a databáze
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const [[{ migrace }]] = await pool.query(
      'SELECT COUNT(*) AS migrace FROM _migrace'
    );
    res.json({
      status: 'ok',
      prostredi: config.PROSTREDI,
      migrace,
      cas: new Date().toISOString(),
    });
  })
);

export default router;
