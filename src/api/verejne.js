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
import { asyncHandler, chybaSpatnyVstup, chybaNenalezeno } from '../chyby.js';
import { zvaliduj, schemaEmail, schemaJmeno, schemaTelefon } from '../validace.js';
import { limitPoptavky } from '../auth/limit.js';
import { nactiVerejneKurzy, nactiVerejnyKurz, nactiVerejneTerminyKurzu } from '../kurzy.js';

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

    await pool.query(
      `INSERT INTO poptavky (jmeno, email, telefon, zprava, zdroj, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [vstup.jmeno, vstup.email, vstup.telefon, vstup.zprava ?? null, 'web', req.ip ?? null]
    );

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
