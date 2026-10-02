// src/auth/opravneni.js
//
// Oprávnění na jednom místě, ne rozeseté po endpointech. Každá role má výčet
// oblastí a úrovní (cist / menit). Kdo přidá novou obrazovku, doplní práva tady
// a nemusí hledat, kde se kontroluje co.

import { chybaNeprihlasen, chybaBezOpravneni } from '../chyby.js';

// Oblasti odpovídají modulům administrace.
export const OBLASTI = [
  'dashboard',
  'produkty',
  'terminy',
  'manifest',
  'rezervace',
  'poukazy',
  'platby',
  'doklady',
  'emaily_sablony',
  'emaily_odeslat',
  // Odeslané e-maily: na testu schránka, v produkci log s doručením.
  'emaily_log',
  'galerie',
  'obsah',
  'poptavky',
  'zakaznici',
  'uzivatele',
  'audit',
  'nastaveni',
  // Akceptační testování. Oblast existuje ve všech prostředích, ale API se
  // v produkci vůbec nenamontuje (viz config.akceptaceZapnuta) - právo tedy
  // samo o sobě nikam nepustí.
  'akceptace',
];

const VSE_MENIT = Object.fromEntries(OBLASTI.map((o) => [o, 'menit']));

export const PRAVA = {
  admin: VSE_MENIT,

  provoz: {
    dashboard: 'menit',
    produkty: 'cist',
    terminy: 'menit',
    manifest: 'menit',
    rezervace: 'menit',
    poukazy: 'menit',
    platby: 'cist',
    doklady: 'cist',
    emaily_odeslat: 'menit',
    emaily_log: 'cist',
    galerie: 'menit',
    obsah: 'menit',
    poptavky: 'menit',
    zakaznici: 'menit',
    akceptace: 'menit',
  },

  instruktor: {
    dashboard: 'cist',
    terminy: 'cist',
    manifest: 'menit', // odškrtnutí, že účastník dorazil
  },

  ucetni: {
    dashboard: 'cist',
    produkty: 'cist',
    rezervace: 'cist',
    poukazy: 'menit',
    platby: 'menit',
    doklady: 'menit',
    zakaznici: 'cist',
  },

  // Tester je člověk přizvaný k odzkoušení nové verze na testu. Nevidí nic
  // z provozu - jen modul Ke schválení a obrazovky, na které ho pošle zadání
  // úkolu. Do produkce se takový účet nikdy nedostane k ničemu, protože tam
  // akceptace neexistuje.
  tester: {
    akceptace: 'menit',
  },
};

export function maPravo(role, oblast, uroven = 'cist') {
  const prava = PRAVA[role];
  if (!prava) return false;
  const moje = prava[oblast];
  if (!moje) return false;
  return uroven === 'cist' ? true : moje === 'menit';
}

// Přehled práv pro administraci - podle něj se skrývají položky v menu,
// aby uživatel nekoukal na obrazovky, na které nemá právo.
export function pravaProKlienta(role) {
  return PRAVA[role] ?? {};
}

// ------------------------------------------------------------------ middleware

export function vyzadujePrihlaseni(req, res, next) {
  if (!req.uzivatel) return next(chybaNeprihlasen());
  return next();
}

export function vyzaduje(oblast, uroven = 'cist') {
  return (req, res, next) => {
    if (!req.uzivatel) return next(chybaNeprihlasen());
    if (!maPravo(req.uzivatel.role, oblast, uroven)) {
      return next(chybaBezOpravneni('Tuhle část administrace nemáš povolenou.'));
    }
    return next();
  };
}

/**
 * Jen pro správce, bez ohledu na oblasti.
 *
 * Pro nevratné zásahy, u kterých nestačí "má právo na tuhle oblast":
 * anonymizace zákazníka se nedá vrátit a má ji dělat ten, kdo za data ručí.
 * Nejdřív se kontroluje oblast (vyzaduje), pak tohle - pořadí je schválně,
 * ať se nikdo nedozví o existenci akce, na kterou stejně nemá právo.
 */
export function jenSpravce(req, res, next) {
  if (!req.uzivatel) return next(chybaNeprihlasen());
  if (req.uzivatel.role !== 'admin') {
    return next(chybaBezOpravneni('Tohle může udělat jen správce.'));
  }
  return next();
}
