// scripts/migrate.js
//
// Aplikuje SQL migrace z migrations/ v pořadí podle jejich čísla v názvu.
// Stav aplikovaných migrací se drží v tabulce `_migrace`, takže je skript
// bezpečně opakovatelný - migrace, které už v tabulce jsou zaznamenané,
// se přeskočí.
//
// Pozn.: MariaDB (stejně jako MySQL) provádí u DDL příkazů (CREATE TABLE,
// ALTER TABLE, ...) implicitní commit, takže transakce kolem takového
// příkazu nelze reálně vrátit zpět. Transakce zde slouží hlavně k tomu,
// aby zápis do _migrace proběhl spolu s (čistě DML) obsahem migrace
// atomicky; u migrací s DDL doporučujeme psát je tak, aby šly bezpečně
// spustit znovu (IF NOT EXISTS apod.).

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pool from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS _migrace (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_migrace_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function getAppliedMigrations(conn) {
  const [rows] = await conn.query('SELECT name FROM _migrace');
  return new Set(rows.map((row) => row.name));
}

// Rozdělení migrace na jednotlivé příkazy.
//
// Dělení podle ';' by rozbilo cokoli, co středník obsahuje uvnitř - tělo
// triggeru, procedury nebo textovou konstantu. Proto: pokud migrace obsahuje
// řádek '-- >>>', bere se jako výslovný oddělovač příkazů a nic jiného se
// nedělí. Bez něj se dělí podle ';', ale se přeskočením komentářů a
// řetězcových literálů.
function splitStatements(sql) {
  if (/^\s*--\s*>>>\s*$/m.test(sql)) {
    return sql
      .split(/^\s*--\s*>>>\s*$/m)
      .map((s) => odstranKomentare(s).trim())
      .filter((s) => s.length > 0);
  }

  const prikazy = [];
  let aktualni = '';
  let vRetezci = null; // ', " nebo `
  let vKomentari = null; // 'radkovy' nebo 'blokovy'

  for (let i = 0; i < sql.length; i++) {
    const z = sql[i];
    const dalsi = sql[i + 1];

    if (vKomentari === 'radkovy') {
      if (z === '\n') vKomentari = null;
      aktualni += z;
      continue;
    }
    if (vKomentari === 'blokovy') {
      aktualni += z;
      if (z === '*' && dalsi === '/') {
        aktualni += dalsi;
        i++;
        vKomentari = null;
      }
      continue;
    }
    if (vRetezci) {
      aktualni += z;
      if (z === '\\') {
        aktualni += dalsi ?? '';
        i++;
      } else if (z === vRetezci) {
        vRetezci = null;
      }
      continue;
    }

    if (z === '-' && dalsi === '-') {
      vKomentari = 'radkovy';
      aktualni += z;
      continue;
    }
    if (z === '#') {
      vKomentari = 'radkovy';
      aktualni += z;
      continue;
    }
    if (z === '/' && dalsi === '*') {
      vKomentari = 'blokovy';
      aktualni += z;
      continue;
    }
    if (z === "'" || z === '"' || z === '`') {
      vRetezci = z;
      aktualni += z;
      continue;
    }
    if (z === ';') {
      prikazy.push(aktualni);
      aktualni = '';
      continue;
    }
    aktualni += z;
  }
  prikazy.push(aktualni);

  return prikazy.map((p) => odstranKomentare(p).trim()).filter((p) => p.length > 0);
}

// Příkaz složený jen z komentářů nemá smysl posílat do databáze.
function odstranKomentare(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((radek) => !/^\s*(--|#)/.test(radek))
    .join('\n');
}

async function run() {
  const conn = await pool.getConnection();

  try {
    await ensureMigrationsTable(conn);
    const applied = await getAppliedMigrations(conn);

    const allFiles = await readdir(migrationsDir);
    const migrationFiles = allFiles.filter((f) => f.endsWith('.sql')).sort();

    if (migrationFiles.length === 0) {
      console.log('Ve složce migrations/ nejsou žádné .sql soubory.');
      return;
    }

    let appliedCount = 0;

    for (const file of migrationFiles) {
      if (applied.has(file)) {
        console.log(`- ${file} (již aplikováno, přeskočeno)`);
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      const statements = splitStatements(sql);

      console.log(`> aplikuji ${file} ...`);

      await conn.beginTransaction();
      try {
        for (const statement of statements) {
          await conn.query(statement);
        }
        await conn.query('INSERT INTO _migrace (name) VALUES (?)', [file]);
        await conn.commit();
        console.log(`  OK: ${file}`);
        appliedCount += 1;
      } catch (err) {
        await conn.rollback();
        throw new Error(`Migrace "${file}" selhala: ${err.message}`);
      }
    }

    console.log(
      appliedCount > 0
        ? `Hotovo, nově aplikováno migrací: ${appliedCount}.`
        : 'Hotovo, databáze je aktuální - žádná nová migrace k aplikaci.'
    );
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
