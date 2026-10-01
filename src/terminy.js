// src/terminy.js
//
// Zázemí k termínům, které nepatří do API.
//
// `terminy.datum` je den na kalendáři, ne okamžik na ose času. Počítání
// s takovými dny je v src/cas.js (datumyVRozsahu, pocetDni, oDniDal) -
// jedno místo pro čas, jak říká CLAUDE.md. Tady zůstává jen to, co sahá
// do databáze.

import pool from './db.js';
import { isoDatum } from './cas.js';

/**
 * Včerejší a starší termíny přepne z "otevřeno"/"plno" na "proběhlo".
 *
 * Bez toho by na webu i v administraci svítilo "otevřeno" u všeho, co se
 * už odlétalo, a provoz by musel po každé sezóně odklikat padesát termínů
 * ručně. Zrušených se to netýká - ty mají zůstat zrušené.
 *
 * Dnešek je pražský den, ne UTC: v kontejneru běží UTC, takže od půlnoci
 * do dvou ráno je v UTC ještě včerejšek a termín na dnešek by se v jednu
 * v noci označil za proběhlý.
 */
export async function oznacProbehleTerminy() {
  const [vysledek] = await pool.query(
    `UPDATE terminy
        SET stav = 'probehlo'
      WHERE datum < ? AND smazano_at IS NULL AND stav IN ('otevreno','plno')`,
    [isoDatum(new Date())]
  );
  return vysledek.affectedRows;
}
