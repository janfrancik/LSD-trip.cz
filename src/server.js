// src/server.js
//
// Spuštění serveru: poslech na portu, pravidelná údržba a slušné ukončení.
// Sestavení aplikace samotné je v src/app.js.

import config from './config.js';
import pool from './db.js';
import { vytvorApp } from './app.js';
import { spustUdrzbu } from './udrzba.js';
import { naimportujAkceptaci } from './akceptace/import.js';
import { oznamVerzi } from './akceptace/oznameni.js';

const app = vytvorApp();

const server = app.listen(config.PORT, () => {
  console.log(
    `LSD ${config.PROSTREDI} běží na ${config.url('/')} ` +
      `(e-maily: ${config.EMAIL_REZIM}, indexace: ${config.ROBOTS})`
  );
});

const zastavUdrzbu = spustUdrzbu();

// Zadání akceptačních testů se při každém nasazení načte z repozitáře. Import
// je idempotentní a výsledky testerů nechává být, takže se může spustit při
// každém startu. Chyba v zadání nesmí shodit aplikaci - jen se ohlásí.
if (config.akceptaceZapnuta) {
  naimportujAkceptaci()
    .then(async (prehled) => {
      for (const v of prehled) {
        if (v.pridano || v.zmeneno || v.deaktivovano) {
          console.log(
            `[akceptace] ${v.kod}: +${v.pridano} nových, ${v.zmeneno} změněných, ` +
              `${v.deaktivovano} vyřazených úkolů`
          );
        }
        // O nové verzi dá vědět e-mail - ale jen když je odesílání zapnuté.
        // V režimu 'vypnuto' zůstane oznámení jen v administraci (zvoneček
        // a karta na přehledu) a rozeslat se dá později tlačítkem.
        if (v.nova && config.EMAIL_REZIM !== 'vypnuto') {
          const vysledek = await oznamVerzi(v.id, { pocetUkolu: v.pridano });
          console.log(`[akceptace] oznámení o verzi ${v.kod}: odesláno ${vysledek.odeslano}`);
        }
      }
    })
    .catch((err) => console.error('[akceptace] import zadání selhal:', err.message));
}

// Slušné ukončení: dokončit rozběhnuté požadavky a zavřít spojení do databáze.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} - ukončuji.`);
    zastavUdrzbu();
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
    // Kdyby se spojení nezavřela, nečekáme na ně věčně.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
