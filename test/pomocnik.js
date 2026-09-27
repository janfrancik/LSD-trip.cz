// test/pomocnik.js
//
// Společné zázemí testů. Testy běží proti SKUTEČNÉ MariaDB (té z
// docker-compose.dev.yml), ale do samostatné databáze `<DB_NAME>_test`, takže
// se nemohou potkat s daty, se kterými se vyvíjí.
//
// Proměnné prostředí se nastavují PŘED importem aplikace - config.js je čte
// při načtení modulu.

import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const TEST_DB = (process.env.DB_NAME ?? 'lsdtrip') + '_test';

// Testy nikdy nesmí posílat e-maily ven. Režim 'test' navíc ověřujeme
// samostatným testem - tady jen zajišťujeme, že cíl je neexistující doména.
const TESTOVACI_ENV = {
  NODE_ENV: 'test',
  PROSTREDI: 'vyvoj',
  DB_NAME: TEST_DB,
  DB_HOST: '127.0.0.1',
  APP_URL: 'http://127.0.0.1:3999',
  ROBOTS: 'zakazat',
  EMAIL_REZIM: 'test',
  EMAIL_TEST_PRIJEMCE: 'testovaci-schranka@example.invalid',
  EMAIL_ODESILATEL: 'LSD test <test@example.invalid>',
  RESEND_API_KEY: '',
};

Object.assign(process.env, TESTOVACI_ENV);

// ------------------------------------------------------------- příprava DB

export async function pripravDatabazi() {
  const root = await mysql.createConnection({
    host: '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: 'root',
    password: process.env.DB_ROOT_PASSWORD,
    multipleStatements: true,
  });

  await root.query(
    `CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\`
       DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await root.query(`GRANT ALL PRIVILEGES ON \`${TEST_DB}\`.* TO ?@'%'`, [process.env.DB_USER]);
  await root.query('FLUSH PRIVILEGES');
  await root.end();

  // Migrace pouštíme v samostatném procesu - má vlastní pool, který si na
  // konci zavře, a nezasahuje tak do spojení použitého testy.
  const vysledek = spawnSync(process.execPath, ['scripts/migrate.js'], {
    cwd: rootDir,
    env: { ...process.env, ...TESTOVACI_ENV },
    encoding: 'utf8',
  });
  if (vysledek.status !== 0) {
    throw new Error('Migrace testovací databáze selhaly:\n' + (vysledek.stderr || vysledek.stdout));
  }
}

// Vyprázdnění dat mezi testy. Pořadí respektuje cizí klíče.
export async function vycistiData(pool) {
  const tabulky = [
    'email_udalosti',
    'emaily',
    'audit_log',
    'reset_hesla',
    'prihlaseni_pokusy',
    'sessions',
    'nastaveni',
    'poptavky',
    'uzivatele',
  ];
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tabulky) await pool.query(`TRUNCATE TABLE \`${t}\``);
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}

// -------------------------------------------------------------- testovací server

export async function spustServer() {
  const { vytvorApp } = await import('../src/app.js');
  const app = vytvorApp();

  const server = await new Promise((vyres) => {
    const s = app.listen(0, '127.0.0.1', () => vyres(s));
  });
  const port = server.address().port;

  return {
    server,
    url: `http://127.0.0.1:${port}`,
    async zavri() {
      await new Promise((vyres) => server.close(vyres));
    },
  };
}

// Klient s vlastní "sklenicí" na cookies - fetch v Node cookies sám nedrží.
export function vytvorKlienta(zakladniUrl) {
  const cookies = new Map();

  function hlavickaCookie() {
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  function ulozCookies(odpoved) {
    const hlavicky = odpoved.headers.getSetCookie?.() ?? [];
    for (const radek of hlavicky) {
      const [dvojice] = radek.split(';');
      const index = dvojice.indexOf('=');
      const klic = dvojice.slice(0, index).trim();
      const hodnota = dvojice.slice(index + 1).trim();
      if (hodnota === '' || /expires=Thu, 01 Jan 1970/i.test(radek)) cookies.delete(klic);
      else cookies.set(klic, hodnota);
    }
  }

  async function zavolej(metoda, cesta, telo) {
    const hlavicky = {};
    if (telo !== undefined) hlavicky['Content-Type'] = 'application/json';
    const cookie = hlavickaCookie();
    if (cookie) hlavicky.Cookie = cookie;

    // Klient se chová jako administrace: u zápisů posílá CSRF token z cookie.
    if (metoda !== 'GET' && cookies.has('lsd_csrf')) {
      hlavicky['X-CSRF-Token'] = cookies.get('lsd_csrf');
    }

    const odpoved = await fetch(zakladniUrl + cesta, {
      method: metoda,
      headers: hlavicky,
      body: telo === undefined ? undefined : JSON.stringify(telo),
    });
    ulozCookies(odpoved);

    let data = null;
    const typ = odpoved.headers.get('content-type') ?? '';
    if (typ.includes('application/json')) data = await odpoved.json();
    else data = await odpoved.text();

    return { status: odpoved.status, data, hlavicky: odpoved.headers };
  }

  return {
    get: (cesta) => zavolej('GET', cesta),
    post: (cesta, telo = {}) => zavolej('POST', cesta, telo),
    patch: (cesta, telo = {}) => zavolej('PATCH', cesta, telo),
    del: (cesta) => zavolej('DELETE', cesta),
    cookies,
    // Pro test CSRF: požadavek bez hlavičky, ale s platnou session cookie.
    async bezCsrf(metoda, cesta, telo = {}) {
      const odpoved = await fetch(zakladniUrl + cesta, {
        method: metoda,
        headers: { 'Content-Type': 'application/json', Cookie: hlavickaCookie() },
        body: JSON.stringify(telo),
      });
      return { status: odpoved.status, data: await odpoved.json().catch(() => null) };
    },
  };
}

// Vytvoří uživatele s heslem rovnou v databázi - testy nemusí chodit přes
// pozvánkový e-mail, když testují něco jiného.
export async function vytvorUzivatele(pool, { email, jmeno = 'Testovací člověk', role = 'admin', heslo }) {
  const { zahashujHeslo } = await import('../src/auth/hesla.js');
  const [vysledek] = await pool.query(
    'INSERT INTO uzivatele (email, jmeno, role, heslo_hash) VALUES (?, ?, ?, ?)',
    [email, jmeno, role, heslo ? await zahashujHeslo(heslo) : null]
  );
  return vysledek.insertId;
}

// Heslo pro testovací účty. Generuje se při každém běhu, takže se nedá
// omylem použít nikde jinde než v testech.
export function testovaciHeslo() {
  return 'test-' + Math.random().toString(36).slice(2) + '-2026';
}
