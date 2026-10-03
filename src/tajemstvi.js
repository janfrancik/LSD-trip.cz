// src/tajemstvi.js
//
// Čištění citlivých údajů z textů, které jdou do logu, do databáze nebo na
// obrazovku.
//
// Vzniklo po incidentu: odesílací služba vrátila chybu z `Headers.append`,
// a ta v sobě měla celou hodnotu hlavičky `Authorization` - tedy API klíč.
// Text chyby se zapsal do logu i do `emaily.chyba` a klíč se musel zneplatnit.
//
// Pravidlo: **žádný text od cizí knihovny nejde do logu, do databáze ani do
// administrace, aniž projde `ocisti()`.** Není to obrana proti útočníkovi
// uvnitř aplikace - ten si klíč přečte z konfigurace. Je to obrana proti
// tomu, aby se tajemství rozteklo do míst, která se čtou a archivují jinak
// než konfigurace: logy, zálohy databáze, snímky obrazovky v hlášení chyby.

const MASKA = '***';

// Pozor na pořadí: delší a konkrétnější vzory první, ať `Bearer re_xxx`
// nezůstane napůl očištěný.
const VZORY = [
  // Authorization: Bearer <cokoli až do konce řádku/uvozovky>
  [/\b(Bearer)\s+[A-Za-z0-9._\-+/=]+/gi, `$1 ${MASKA}`],
  [/\b(Authorization)\s*[:=]\s*["']?[^"'\s,}]+/gi, `$1: ${MASKA}`],
  // Klíče Resendu. `re_` a za ním cokoli, co vypadá jako klíč.
  [/\bre_[A-Za-z0-9._-]{4,}/g, MASKA],
  // Obecné "api key"/"token" v JSON i v prosté větě.
  [/\b(api[_-]?key|apikey|token|secret|password|heslo)\s*[:=]\s*["']?[^"'\s,}]+/gi,
    `$1: ${MASKA}`],
];

/**
 * Vrátí text bez tajemství. Nikdy nevyhodí výjimku - používá se v místech,
 * kde se právě něco pokazilo a druhá chyba by zakryla tu první.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function ocisti(text) {
  try {
    let vysledek = String(text ?? '');
    for (const [vzor, nahrada] of VZORY) vysledek = vysledek.replace(vzor, nahrada);

    // Poslední pojistka: kdyby se klíč dostal do textu v podobě, kterou
    // vzory výš nechytly, najdeme ho podle skutečné hodnoty z konfigurace.
    // Schválně až tady a bez importu configu - ten by vyrobil cyklus.
    const zKonfigurace = process.env.RESEND_API_KEY;
    if (zKonfigurace && zKonfigurace.length > 8) {
      vysledek = vysledek.split(zKonfigurace).join(MASKA);
    }

    return vysledek;
  } catch {
    // Když se nepovede ani čištění, je bezpečnější zahodit text celý než
    // ho pustit dál neočištěný.
    return 'Text chyby se nepodařilo očistit, proto se nevypisuje.';
  }
}

/**
 * Očistí text z výjimky. Bere `err.message`, ale i samotný řetězec.
 */
export function ocistiChybu(err) {
  return ocisti(err?.message ?? err);
}

/**
 * Kontrola tvaru klíče k Resendu.
 *
 * Nejde o to uhodnout, jestli klíč platí - to pozná až služba. Jde o tvary,
 * které rozbijí sestavení HTTP hlavičky: zalomený řádek, mezera, omylem
 * zkopírovaný klíč dvakrát. Právě takový klíč vyrobil chybu, ve které pak
 * byla jeho vlastní hodnota.
 *
 * @returns {string|null} popis problému, nebo null když je tvar v pořádku
 */
export function zkontrolujTvarKlice(klic) {
  const text = String(klic ?? '');
  if (!text) return null; // prázdný klíč řeší jinde - tady je to v pořádku

  if (/\s/.test(text)) {
    return 'obsahuje mezeru nebo zalomení řádku (nejspíš se zkopíroval i konec řádku)';
  }
  if (!text.startsWith('re_')) {
    return 'nezačíná na "re_"';
  }
  // Dvojí výskyt = klíč nalepený dvakrát za sebou.
  if (text.indexOf('re_', 1) !== -1) {
    return 'obsahuje "re_" víckrát než jednou (nejspíš se vložil dvakrát)';
  }
  if (text.length < 20 || text.length > 200) {
    return `má nezvyklou délku ${text.length} znaků`;
  }
  if (!/^re_[A-Za-z0-9._-]+$/.test(text)) {
    return 'obsahuje znaky, které do klíče nepatří';
  }
  return null;
}
