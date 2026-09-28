// src/verze.js
//
// Otisk klientské části administrace. Administrace je jednostránková aplikace:
// jednou načtené moduly zůstanou v paměti záložky, dokud ji někdo nenačte znovu.
// Po nasazení tak v otevřené záložce běží starý kód nad novými daty - přesně
// tak se stalo, že audit ukazoval časy o dvě hodiny pozadu, i když server
// i data už byly v pořádku.
//
// Server proto ke každé odpovědi administrace přidá otisk souborů, ze kterých
// se administrace skládá. Když se od toho, se kterým se záložka načetla, liší,
// administrace nabídne načtení znovu.

import { readdirSync, statSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Co všechno tvoří klienta: celá administrace plus sdílený modul času,
// který se jí servíruje z src/.
const SLEDOVANE = [
  path.join(rootDir, 'public', 'admin'),
  path.join(rootDir, 'src', 'cas.js'),
];

function projdi(cesta, zapis) {
  const udaje = statSync(cesta);
  if (udaje.isDirectory()) {
    for (const polozka of readdirSync(cesta).sort()) projdi(path.join(cesta, polozka), zapis);
    return;
  }
  // Jméno, velikost a čas změny stačí: v kontejneru se soubory při sestavení
  // image zapisují znovu, takže se otisk po nasazení změní vždy, když se změní
  // klient - a nezmění se, když se nasadí jen serverová část.
  zapis(`${path.relative(rootDir, cesta)}:${udaje.size}:${Math.floor(udaje.mtimeMs)}`);
}

export function spocitejVerziKlienta() {
  const otisk = crypto.createHash('sha256');
  for (const cesta of SLEDOVANE) {
    try {
      projdi(cesta, (radek) => otisk.update(radek));
    } catch {
      // Chybějící soubor je věc nasazení, ne důvod k pádu aplikace.
    }
  }
  return otisk.digest('hex').slice(0, 12);
}

let ulozena = null;

export function verzeKlienta() {
  if (!ulozena) ulozena = spocitejVerziKlienta();
  return ulozena;
}
