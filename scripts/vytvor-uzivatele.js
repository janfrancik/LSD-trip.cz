// scripts/vytvor-uzivatele.js
//
// Založí uživatele administrace a vypíše odkaz pro nastavení hesla. Tímhle se
// zakládá první správce, pak už se lidé přidávají přímo v administraci.
//
// Heslo se nikdy nezadává na příkazové řádce - zůstalo by v historii shellu.
// Uživatel si ho nastaví sám přes jednorázový odkaz.
//
// Použití:
//   node scripts/vytvor-uzivatele.js <email> "<Jméno Příjmení>" [role]
//
// Role: admin (výchozí) | provoz | instruktor | ucetni | tester
//
// V Dockeru:
//   docker compose -f docker-compose.dev.yml exec app \
//     node scripts/vytvor-uzivatele.js sefka@example.cz "Kateřina Fojtová" admin

import crypto from 'node:crypto';
import pool from '../src/db.js';
import config from '../src/config.js';
import { hashTokenu } from '../src/auth/session.js';
import { posliEmail } from '../src/email/posli.js';
import { obalka, tlacitko } from '../src/email/sablona.js';
import { schemaRole } from '../src/validace.js';

// Seznam rolí se bere z validace, ne z vlastního výčtu - jinak by se skript
// rozešel s aplikací, jakmile přibude role (přesně to se stalo u role tester).
const ROLE = schemaRole.options;

async function run() {
  const [email, jmeno, role = 'admin'] = process.argv.slice(2);

  if (!email || !jmeno) {
    console.error(
      'Použití: node scripts/vytvor-uzivatele.js <email> "<Jméno Příjmení>" [admin|provoz|instruktor|ucetni]'
    );
    process.exit(1);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`"${email}" není platná e-mailová adresa.`);
    process.exit(1);
  }
  if (!ROLE.includes(role)) {
    console.error(`Neznámá role "${role}". Použij jednu z: ${ROLE.join(', ')}`);
    process.exit(1);
  }

  const emailMale = email.toLowerCase();

  const [existuje] = await pool.query('SELECT id, smazano_at FROM uzivatele WHERE email = ?', [
    emailMale,
  ]);

  let id;
  if (existuje[0]) {
    id = existuje[0].id;
    await pool.query(
      'UPDATE uzivatele SET jmeno = ?, role = ?, aktivni = 1, smazano_at = NULL WHERE id = ?',
      [jmeno, role, id]
    );
    console.log(`Uživatel ${emailMale} už existoval (#${id}) - aktualizoval jsem jméno a roli.`);
  } else {
    const [vysledek] = await pool.query(
      'INSERT INTO uzivatele (email, jmeno, role) VALUES (?, ?, ?)',
      [emailMale, jmeno, role]
    );
    id = vysledek.insertId;
    console.log(`Vytvořen uživatel #${id}: ${jmeno} <${emailMale}>, role ${role}.`);
  }

  // Jednorázový odkaz na nastavení hesla, platnost 3 dny.
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    'UPDATE reset_hesla SET pouzito_at = NOW() WHERE uzivatel_id = ? AND pouzito_at IS NULL',
    [id]
  );
  await pool.query(
    `INSERT INTO reset_hesla (uzivatel_id, token_hash, ucel, expires_at)
     VALUES (?, ?, 'pozvanka', DATE_ADD(NOW(), INTERVAL 72 HOUR))`,
    [id, hashTokenu(token)]
  );

  const url = config.url(`/admin/nove-heslo/${token}`);

  // E-mail se odešle jen pokud je odesílání zapnuté; odkaz vypíšeme vždy,
  // aby se dal první správce založit i bez fungujícího Resendu.
  const vysledek = await posliEmail({
    prijemce: emailMale,
    predmet: 'Přístup do administrace LSD',
    sablona: 'pozvanka',
    vazby: { uzivatelId: id },
    telo: obalka({
      titulek: 'Přístup do administrace LSD',
      obsahHtml: `<p>Ahoj ${jmeno},</p>
        <p>máš přístup do administrace webu LSD. Nastav si heslo tímhle odkazem — platí 3 dny.</p>
        <p style="margin:22px 0">${tlacitko('Nastavit heslo', url)}</p>`,
      podpis: 'Letecká společnost dobrodruhů z.s.',
    }),
  });

  console.log('');
  console.log('Odkaz pro nastavení hesla (platí 72 hodin, jde použít jednou):');
  console.log(`  ${url}`);
  console.log('');
  console.log(
    vysledek.odeslano
      ? `E-mail odešel na ${vysledek.prijemceSkutecny}.`
      : `E-mail neodešel (režim ${config.EMAIL_REZIM}) - pošli odkaz výše ručně.`
  );

  await pool.end();
}

run().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
