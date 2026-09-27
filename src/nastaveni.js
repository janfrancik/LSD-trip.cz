// src/nastaveni.js
//
// Nastavení aplikace: popis klíčů (typ, popisek, nápověda, výchozí hodnota) je
// v kódu, hodnoty v databázi. Administrace z registru vygeneruje formulář, takže
// majitelka nevidí klíč "rezervace.drzeni_hodin", ale pole "Jak dlouho držíme
// místo, než je platba zaplacená" s nápovědou.
//
// Tajemství (API klíče, hesla) v nastavení NEJSOU - patří do .env. V administraci
// se z nich ukazuje jen stav "nastaveno / nenastaveno".

import pool from './db.js';

export const SKUPINY = [
  { klic: 'spolek', nazev: 'Údaje spolku', popis: 'Objevují se na dokladech, v e-mailech a v patičce webu.' },
  { klic: 'provoz', nazev: 'Provoz', popis: 'Sezóna, časy startů a kontaktní údaje.' },
  { klic: 'rezervace', nazev: 'Rezervace a platby', popis: 'Lhůty, držení místa a storno podmínky.' },
  { klic: 'poukazy', nazev: 'Dárkové poukazy', popis: 'Platnost a texty poukazů.' },
  { klic: 'emaily', nazev: 'E-maily', popis: 'Kdy se rozesílají připomínky a jaké jsou výchozí texty.' },
];

// typ: text | textarea | cislo | bool | datum | email | telefon
export const REGISTR = {
  'spolek.nazev': {
    skupina: 'spolek', typ: 'text', popisek: 'Název spolku',
    vychozi: 'Letecká společnost dobrodruhů z.s.', povinne: true, max: 160,
  },
  'spolek.ico': {
    skupina: 'spolek', typ: 'text', popisek: 'IČO', vychozi: '', max: 20,
    napoveda: 'Osm číslic bez mezer.',
  },
  'spolek.dic': {
    skupina: 'spolek', typ: 'text', popisek: 'DIČ', vychozi: '', max: 20,
    napoveda: 'Například CZ12345678. Nechte prázdné, pokud spolek není plátce DPH.',
  },
  'spolek.platce_dph': {
    skupina: 'spolek', typ: 'bool', popisek: 'Spolek je plátce DPH', vychozi: 'true',
    napoveda: 'Ovlivní podobu nově vystavených dokladů. Už vystavené doklady se nemění.',
  },
  'spolek.ulice': { skupina: 'spolek', typ: 'text', popisek: 'Ulice a číslo', vychozi: 'Holečkova 49/789', max: 160 },
  'spolek.mesto': { skupina: 'spolek', typ: 'text', popisek: 'Město', vychozi: 'Praha 5', max: 100 },
  'spolek.psc': { skupina: 'spolek', typ: 'text', popisek: 'PSČ', vychozi: '150 00', max: 20 },
  'spolek.zapis': {
    skupina: 'spolek', typ: 'text', popisek: 'Zápis ve spolkovém registru', vychozi: '', max: 200,
    napoveda: 'Text, který má být na faktuře, například „Spolek zapsaný u Městského soudu v Praze, sp. zn. L 1234“.',
  },
  'spolek.bankovni_ucet': {
    skupina: 'spolek', typ: 'text', popisek: 'Bankovní účet', vychozi: '', max: 40,
    napoveda: 'Ve formátu 123456789/0800. Používá se pro QR platbu.',
  },
  'spolek.iban': {
    skupina: 'spolek', typ: 'text', popisek: 'IBAN', vychozi: '', max: 40,
    napoveda: 'Potřebný pro QR platbu. Například CZ6508000000192000145399.',
  },

  'provoz.telefon': { skupina: 'provoz', typ: 'telefon', popisek: 'Telefon pro rezervace', vychozi: '+420 777 310 959' },
  'provoz.email': {
    skupina: 'provoz', typ: 'email', popisek: 'Kontaktní e-mail', vychozi: '',
    napoveda: 'Adresa, která se ukazuje na webu a v e-mailech. Doplň v nastavení — v kódu záměrně žádná doména není.',
  },
  'provoz.letiste': { skupina: 'provoz', typ: 'text', popisek: 'Letiště', vychozi: 'Letiště Jihlava — Henčov', max: 160 },
  'provoz.sezona_od': {
    skupina: 'provoz', typ: 'text', popisek: 'Začátek sezóny', vychozi: 'duben', max: 40,
    napoveda: 'Zobrazuje se na webu, například „duben“.',
  },
  'provoz.sezona_do': { skupina: 'provoz', typ: 'text', popisek: 'Konec sezóny', vychozi: 'říjen', max: 40 },
  'provoz.casy_startu': {
    skupina: 'provoz', typ: 'text', popisek: 'Časy startů', vychozi: 'Starty dle počasí od 8:30', max: 160,
  },

  'rezervace.drzeni_hodin': {
    skupina: 'rezervace', typ: 'cislo', popisek: 'Jak dlouho držíme místo bez zaplacení (hodin)',
    vychozi: '48', min: 1, max: 720,
    napoveda: 'Po vypršení se rezervace nezruší sama — objeví se na dashboardu v sekci „K prošetření“.',
  },
  'rezervace.splatnost_dni': {
    skupina: 'rezervace', typ: 'cislo', popisek: 'Lhůta splatnosti (dní)', vychozi: '7', min: 1, max: 90,
  },
  'rezervace.storno_podminky': {
    skupina: 'rezervace', typ: 'textarea', popisek: 'Storno podmínky', vychozi: '',
    napoveda: 'Text se ukazuje v rezervačním toku a připojuje k potvrzovacímu e-mailu.',
  },

  'poukazy.platnost_mesicu': {
    skupina: 'poukazy', typ: 'cislo', popisek: 'Platnost poukazu (měsíců)', vychozi: '12', min: 1, max: 60,
  },
  'poukazy.text_na_poukazu': {
    skupina: 'poukazy', typ: 'textarea', popisek: 'Text na poukazu', vychozi: '',
  },

  'emaily.pripominka_dni_predem': {
    skupina: 'emaily', typ: 'cislo', popisek: 'Připomínka termínu kolik dní předem', vychozi: '3', min: 1, max: 30,
  },
  'emaily.podpis': {
    skupina: 'emaily', typ: 'textarea', popisek: 'Podpis pod e-maily',
    vychozi: 'Letecká společnost dobrodruhů z.s.',
  },
};

// Krátká cache, aby se nastavení nečetlo při každém požadavku.
let cache = null;
let cacheDo = 0;
const CACHE_MS = 30 * 1000;

export function zapomenCache() {
  cache = null;
  cacheDo = 0;
}

function prevedTyp(klic, hodnota) {
  const popis = REGISTR[klic];
  if (!popis) return hodnota;
  if (hodnota == null) hodnota = popis.vychozi;
  switch (popis.typ) {
    case 'cislo': {
      const c = Number(hodnota);
      return Number.isFinite(c) ? c : Number(popis.vychozi);
    }
    case 'bool':
      return hodnota === true || hodnota === 'true' || hodnota === '1';
    default:
      return hodnota ?? '';
  }
}

// Všechna nastavení jako objekt s typovanými hodnotami. Klíče, které v databázi
// nejsou, se doplní z výchozích hodnot registru.
export async function nactiNastaveni() {
  if (cache && Date.now() < cacheDo) return cache;

  const [rows] = await pool.query('SELECT klic, hodnota FROM nastaveni');
  const zDb = Object.fromEntries(rows.map((r) => [r.klic, r.hodnota]));

  const vysledek = {};
  for (const klic of Object.keys(REGISTR)) {
    vysledek[klic] = prevedTyp(klic, zDb[klic] ?? null);
  }

  cache = vysledek;
  cacheDo = Date.now() + CACHE_MS;
  return vysledek;
}

export async function hodnota(klic) {
  const vse = await nactiNastaveni();
  return vse[klic];
}

// Uloží jen známé klíče. Neznámý klíč je chyba v kódu, ne v datech - zahazujeme
// ho tiše, aby se do databáze nedostal balast z podvrženého požadavku.
export async function ulozNastaveni(zmeny, uzivatelId = null) {
  const ulozene = {};
  for (const [klic, hodnotaVstup] of Object.entries(zmeny)) {
    if (!REGISTR[klic]) continue;
    const text =
      REGISTR[klic].typ === 'bool'
        ? hodnotaVstup === true || hodnotaVstup === 'true' || hodnotaVstup === '1'
          ? 'true'
          : 'false'
        : hodnotaVstup == null
          ? null
          : String(hodnotaVstup);

    await pool.query(
      `INSERT INTO nastaveni (klic, hodnota, upravil_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE hodnota = VALUES(hodnota), upravil_id = VALUES(upravil_id)`,
      [klic, text, uzivatelId]
    );
    ulozene[klic] = text;
  }
  zapomenCache();
  return ulozene;
}

// Popis registru pro administraci: skupiny, popisky, nápovědy a aktuální hodnoty.
export async function registrProKlienta() {
  const hodnoty = await nactiNastaveni();
  return {
    skupiny: SKUPINY,
    polozky: Object.entries(REGISTR).map(([klic, popis]) => ({
      klic,
      ...popis,
      hodnota: hodnoty[klic],
    })),
  };
}
