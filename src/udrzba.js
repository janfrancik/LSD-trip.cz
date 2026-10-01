// src/udrzba.js
//
// Pravidelný úklid. Nic, co by se muselo řešit cronem zvlášť - běží v procesu
// aplikace, jednou za hodinu, a při ukončení se zastaví.
//
// Zálohy databáze jsou naopak věc VPS (cron + scripts/zaloha.sh), ne aplikace -
// kontejner nemá k hostiteli přístup a záloha musí přežít i spadlou aplikaci.

import config from './config.js';
import { uklidProslychSession } from './auth/session.js';
import { uklidStarePokusy } from './auth/limit.js';
import { uklidNepouzitePrilohy } from './akceptace/prilohy.js';
import { uklidOsireleSoubory, dopocitejChybejiciVarianty } from './soubory.js';

const HODINA_MS = 60 * 60 * 1000;

async function uklid() {
  try {
    const session = await uklidProslychSession();
    const pokusy = await uklidStarePokusy();
    // Snímky obrazovky, které někdo nahrál a formulář pak neodeslal.
    const prilohy = config.akceptaceZapnuta ? await uklidNepouzitePrilohy() : 0;
    // Fotky smazané v administraci, na kterých už nic nevisí. Z disku zmizí
    // až den po smazání - do té doby je šance říct si, že to byl omyl.
    const fotky = await uklidOsireleSoubory();
    // Fotky bez webové verze - nahrané dřív, než se zmenšování zavedlo,
    // nebo přinesené importem. Dopočítá se jich pár za kolo, ať to nikdo
    // nemusí spouštět ručně.
    const zmensene = await dopocitejChybejiciVarianty();

    if (session || pokusy || prilohy || fotky || zmensene) {
      console.log(
        `[údržba] smazáno ${session} prošlých přihlášení, ${pokusy} starých pokusů` +
          (prilohy ? `, ${prilohy} nepoužitých příloh` : '') +
          (fotky ? `, ${fotky} osiřelých souborů` : '') +
          (zmensene ? `, zmenšeno ${zmensene} fotek pro web` : '')
      );
    }
  } catch (err) {
    console.error('[údržba] selhala:', err.message);
  }
}

export function spustUdrzbu() {
  // První úklid až po chvíli, ať start aplikace nečeká na databázi.
  const prvni = setTimeout(uklid, 30 * 1000);
  const casovac = setInterval(uklid, HODINA_MS);
  casovac.unref();
  prvni.unref();

  return function zastav() {
    clearTimeout(prvni);
    clearInterval(casovac);
  };
}
