// src/csv.js
//
// Export do CSV, které otevře Excel v češtině bez tancování kolem průvodce
// importem: středník jako oddělovač a BOM na začátku, aby Excel poznal UTF-8.
// Bez BOM by se z "Jiří" stalo "JiÅ™Ã­" a majitelka by to řešila ručně.

const ODDELOVAC = ';';

function pole(hodnota) {
  const text = hodnota == null ? '' : String(hodnota);
  // Uvozovky kolem všeho, co by rozbilo řádek nebo sloupec.
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * @param {string[]} hlavicka
 * @param {Array<Array<unknown>>} radky
 * @returns {string} obsah souboru včetně BOM
 */
export function doCsv(hlavicka, radky) {
  const obsah = [hlavicka, ...radky]
    .map((radek) => radek.map(pole).join(ODDELOVAC))
    // CRLF kvůli Excelu na Windows.
    .join('\r\n');
  return `﻿${obsah}\r\n`;
}

/**
 * Nastaví hlavičky a pošle CSV ke stažení.
 */
export function posliCsv(res, nazevSouboru, hlavicka, radky) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nazevSouboru}"`);
  res.send(doCsv(hlavicka, radky));
}

// Ano/ne do tabulky. Prázdné políčko se čte hůř než výslovné "ne".
export function anoNe(hodnota) {
  return hodnota ? 'ano' : 'ne';
}
