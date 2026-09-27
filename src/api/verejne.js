// src/api/verejne.js
//
// Veřejné API webu. Ve fázi 1 jen kontaktní formulář a healthcheck - čtení
// obsahu z databáze přijde ve fázi 2 spolu s napojením webu na API.
//
// Zásada: veřejné endpointy nikdy nevracejí osobní údaje. Poptávku je možné
// odeslat, ale ne si ji přečíst - to umí jen administrace.

import express from 'express';
import { z } from 'zod';
import pool from '../db.js';
import config from '../config.js';
import { asyncHandler, chybaSpatnyVstup } from '../chyby.js';
import { zvaliduj, schemaEmail, schemaJmeno, schemaTelefon } from '../validace.js';
import { limitPoptavky } from '../auth/limit.js';

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
