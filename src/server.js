// src/server.js
//
// Spuštění serveru: poslech na portu, pravidelná údržba a slušné ukončení.
// Sestavení aplikace samotné je v src/app.js.

import config from './config.js';
import pool from './db.js';
import { vytvorApp } from './app.js';
import { spustUdrzbu } from './udrzba.js';

const app = vytvorApp();

const server = app.listen(config.PORT, () => {
  console.log(
    `LSD ${config.PROSTREDI} běží na ${config.url('/')} ` +
      `(e-maily: ${config.EMAIL_REZIM}, indexace: ${config.ROBOTS})`
  );
});

const zastavUdrzbu = spustUdrzbu();

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
