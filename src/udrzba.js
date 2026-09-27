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

const HODINA_MS = 60 * 60 * 1000;

async function uklid() {
  try {
    const session = await uklidProslychSession();
    const pokusy = await uklidStarePokusy();
    // Snímky obrazovky, které někdo nahrál a formulář pak neodeslal.
    const prilohy = config.akceptaceZapnuta ? await uklidNepouzitePrilohy() : 0;
    if (session || pokusy || prilohy) {
      console.log(
        `[údržba] smazáno ${session} prošlých přihlášení, ${pokusy} starých pokusů` +
          (prilohy ? `, ${prilohy} nepoužitých příloh` : '')
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
