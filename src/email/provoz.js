// src/email/provoz.js
//
// Kam chodí interní upozornění (nová přihláška, nová poptávka).
//
// Adresy jsou dvě a je potřeba jedno pravidlo, ne dvě:
//
//   **Když je v `.env` vyplněné EMAIL_PROVOZ_PRIJEMCE, platí ono.
//     Když není, platí Kontaktní e-mail z Nastavení → Provoz.**
//
// Proč vůbec ta druhá adresa existuje: Resend bez ověřené domény odešle jen
// na adresu majitele účtu, na kohokoli jiného vrátí 403. Kontaktní e-mail
// z nastavení si majitelka nastaví jaký chce, a dokud doména není ověřená,
// upozornění by na něj neodešlo. `EMAIL_PROVOZ_PRIJEMCE` je proto dočasná
// objížďka, ne druhé nastavení - po ověření domény se z `.env` smaže a
// pravidlo samo vrátí platnost adrese z administrace.
//
// Aby to nebyla past, administrace u toho pole ukazuje, která adresa zrovna
// platí a odkud se bere.

import config from '../config.js';
import { hodnota } from '../nastaveni.js';

/**
 * Vrátí adresu, na kterou se posílají upozornění provozu, a odkud je.
 *
 * @returns {Promise<{adresa: string|null, zdroj: 'env'|'nastaveni'|null}>}
 */
export async function adresaProvozu() {
  const zEnv = config.EMAIL_PROVOZ_PRIJEMCE;
  if (zEnv) return { adresa: zEnv, zdroj: 'env' };

  const zNastaveni = await hodnota('provoz.email');
  if (zNastaveni) return { adresa: zNastaveni, zdroj: 'nastaveni' };

  // Ani jedno. Upozornění nevznikne - a protože se o nových přihláškách
  // jinak nikdo nedozví, říká to administrace na přehledu i u toho pole.
  return { adresa: null, zdroj: null };
}
