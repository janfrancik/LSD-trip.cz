// src/api/admin/index.js
//
// Sestavení administrátorského API. Pořadí je důležité:
//   1) načtení session (kdo jsem),
//   2) CSRF u všeho, co mění data,
//   3) jednotlivé routery, které si samy kontrolují oprávnění.
//
// Přihlášení se NEvyžaduje globálně - /prihlaseni a /reset-hesla musí jít
// zavolat i bez něj. Ostatní routery mají vyzaduje(...) u každé cesty.

import express from 'express';
import config from '../../config.js';
import { nactiSession, prodluzSession } from '../../auth/session.js';
import { overCsrf } from '../../auth/csrf.js';
import { asyncHandler } from '../../chyby.js';
import { verzeKlienta } from '../../verze.js';

import auth from './auth.js';
import uzivatele from './uzivatele.js';
import poptavky from './poptavky.js';
import audit from './audit.js';
import nastaveni from './nastaveni.js';
import dashboard from './dashboard.js';
import emaily from './emaily.js';
import akceptace from './akceptace.js';
import produkty from './produkty.js';
import dph from './dph.js';
import soubory from './soubory.js';
import mista from './mista.js';
import terminy from './terminy.js';

const router = express.Router();

// Otisk klientské části. Administrace si ho pamatuje z prvního požadavku;
// když se změní, ví, že v záložce běží starý kód, a nabídne načtení znovu.
router.use((req, res, next) => {
  res.setHeader('X-Admin-Verze', verzeKlienta());
  next();
});

// Kdo je přihlášený. Chybějící nebo prošlá session není chyba - jen prázdný req.uzivatel.
router.use(
  asyncHandler(async (req, res, next) => {
    const session = await nactiSession(req);
    if (session) {
      req.session = session;
      req.uzivatel = session.uzivatel;
      await prodluzSession(res, session);
    }
    next();
  })
);

router.use(overCsrf);

router.use('/', auth);
router.use('/dashboard', dashboard);
router.use('/uzivatele', uzivatele);
router.use('/poptavky', poptavky);
router.use('/audit', audit);
router.use('/nastaveni', nastaveni);
router.use('/emaily', emaily);
router.use('/produkty', produkty);
router.use('/dph-sazby', dph);
router.use('/soubory', soubory);
router.use('/mista', mista);
router.use('/terminy', terminy);

// Akceptační testování je nástroj testovacího prostředí. V produkci se router
// vůbec nenamontuje - cesty tam tedy neexistují, ne že by jen vracely 403.
if (config.akceptaceZapnuta) {
  router.use('/akceptace', akceptace);
}

export default router;
