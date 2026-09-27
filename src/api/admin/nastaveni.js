// src/api/admin/nastaveni.js
//
// Nastavení aplikace. Formulář se generuje z registru v src/nastaveni.js, takže
// přidání položky je jedna řádka v kódu a žádná změna v administraci.

import express from 'express';
import config from '../../config.js';
import { asyncHandler, chybaSpatnyVstup } from '../../chyby.js';
import { vyzaduje } from '../../auth/opravneni.js';
import { registrProKlienta, ulozNastaveni, REGISTR, nactiNastaveni } from '../../nastaveni.js';
import { zapisAudit, rozdil } from '../../audit.js';

const router = express.Router();

// GET /api/admin/nastaveni
router.get(
  '/',
  vyzaduje('nastaveni'),
  asyncHandler(async (req, res) => {
    res.json(await registrProKlienta());
  })
);

// PATCH /api/admin/nastaveni
router.patch(
  '/',
  vyzaduje('nastaveni', 'menit'),
  asyncHandler(async (req, res) => {
    const telo = req.body ?? {};
    if (typeof telo !== 'object' || Array.isArray(telo)) {
      throw chybaSpatnyVstup('Očekávám objekt s klíči nastavení.');
    }

    const nezname = Object.keys(telo).filter((k) => !REGISTR[k]);
    if (nezname.length) {
      throw chybaSpatnyVstup(`Neznámé nastavení: ${nezname.join(', ')}`);
    }

    // Kontrola typů podle registru, ať se do čísla nedostane text.
    const detaily = {};
    for (const [klic, hodnotaVstup] of Object.entries(telo)) {
      const popis = REGISTR[klic];
      if (popis.typ === 'cislo') {
        const c = Number(hodnotaVstup);
        if (!Number.isFinite(c)) detaily[klic] = 'Zadej číslo.';
        else if (popis.min != null && c < popis.min) detaily[klic] = `Nejméně ${popis.min}.`;
        else if (popis.max != null && c > popis.max) detaily[klic] = `Nejvíce ${popis.max}.`;
      } else if (popis.typ === 'email' && hodnotaVstup) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(hodnotaVstup))) {
          detaily[klic] = 'Tohle není platná e-mailová adresa.';
        }
      } else if (popis.povinne && !String(hodnotaVstup ?? '').trim()) {
        detaily[klic] = 'Tohle pole je povinné.';
      } else if (popis.max && popis.typ !== 'cislo' && String(hodnotaVstup ?? '').length > popis.max) {
        detaily[klic] = `Nejvíc ${popis.max} znaků.`;
      }
    }
    if (Object.keys(detaily).length) {
      throw chybaSpatnyVstup(Object.values(detaily)[0], detaily);
    }

    const pred = await nactiNastaveni();
    await ulozNastaveni(telo, req.uzivatel.id);
    const po = await nactiNastaveni();

    const zmena = rozdil(
      Object.fromEntries(Object.keys(telo).map((k) => [k, pred[k]])),
      Object.fromEntries(Object.keys(telo).map((k) => [k, po[k]]))
    );
    if (zmena) {
      await zapisAudit({
        req,
        akce: 'zmena',
        entita: 'nastaveni',
        popis: Object.keys(zmena.po).join(', '),
        pred: zmena.pred,
        po: zmena.po,
      });
    }

    res.json(await registrProKlienta());
  })
);

// GET /api/admin/nastaveni/integrace
//
// Klíče k externím službám jsou v .env, ne v databázi. Administrace o nich
// ukazuje jen to, jestli jsou nastavené - samotné hodnoty se nikdy neposílají.
router.get(
  '/integrace',
  vyzaduje('nastaveni'),
  asyncHandler(async (req, res) => {
    res.json({
      prostredi: config.PROSTREDI,
      indexace: config.ROBOTS,
      app_url: config.APP_URL,
      sluzby: [
        {
          klic: 'resend',
          nazev: 'Resend (odesílání e-mailů)',
          nastaveno: Boolean(config.RESEND_API_KEY),
          rezim: config.EMAIL_REZIM,
          odesilatel: config.EMAIL_ODESILATEL,
          testovaci_prijemce: config.EMAIL_TEST_PRIJEMCE ?? null,
          poznamka:
            config.EMAIL_REZIM === 'test'
              ? 'Testovací režim: všechny e-maily chodí na testovací adresu, zákazníkům nic neodejde.'
              : config.EMAIL_REZIM === 'vypnuto'
                ? 'Odesílání je vypnuté, e-maily se jen zapisují do logu.'
                : 'Ostrý režim: e-maily chodí skutečným adresátům.',
        },
        {
          klic: 'moone',
          nazev: 'Mo.one (platební brána)',
          nastaveno: Boolean(config.MOONE_CLIENT_ID && config.MOONE_CLIENT_SECRET),
          rezim: config.MOONE_BASE_URL?.includes('api-test') ? 'test' : 'live',
          poznamka: 'Napojení přijde ve fázi 4.',
        },
      ],
    });
  })
);

export default router;
