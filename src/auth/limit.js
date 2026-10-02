// src/auth/limit.js
//
// Rate limity. Přihlášení je nejcennější cíl, takže má nejtvrdší limit a navíc
// zámek účtu v databázi (limit v paměti zmizí s restartem kontejneru, zámek ne).

import rateLimit from 'express-rate-limit';
import pool from '../db.js';

const MINUTA = 60 * 1000;

function zprava(text) {
  return (req, res) => res.status(429).json({ chyba: text });
}

// 10 pokusů za 15 minut na IP. Počítají se jen neúspěšné - kdo se přihlásí,
// nemá důvod být blokovaný.
export const limitPrihlaseni = rateLimit({
  windowMs: 15 * MINUTA,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: zprava('Příliš mnoho pokusů o přihlášení. Zkus to znovu za 15 minut.'),
});

// Odeslání odkazu na reset hesla - jinak by šlo někomu zaplavit schránku.
export const limitResetHesla = rateLimit({
  windowMs: 60 * MINUTA,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: zprava('Příliš mnoho žádostí o reset hesla. Zkus to znovu za hodinu.'),
});

// Veřejný kontaktní formulář.
export const limitPoptavky = rateLimit({
  windowMs: 60 * MINUTA,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: zprava('Zprávu jsi už poslal několikrát. Ozveme se, nebo zavolej na uvedené číslo.'),
});

// Přihlášky na termín. Volnější než u poptávky: z jedné IP se může hlásit
// rodina i několikrát po sobě, ale robot ať formulář nezahltí.
export const limitPrihlasek = rateLimit({
  windowMs: 60 * MINUTA,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: zprava('Přihlášek z tohohle připojení přišlo moc. Zkus to za chvíli, nebo nám zavolej.'),
});

// Obecný strop na veřejné API, ať web nikdo nezahltí.
export const limitVerejneApi = rateLimit({
  windowMs: MINUTA,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: zprava('Příliš mnoho požadavků, zkus to za chvíli.'),
});

// Testy potřebují limity vynulovat mezi případy, jinak by se ovlivňovaly.
// V běžném provozu se tahle funkce nikdy nevolá.
export async function vynulujLimity() {
  for (const limiter of [limitPrihlaseni, limitResetHesla, limitPoptavky, limitPrihlasek, limitVerejneApi]) {
    await limiter.resetKey?.('::ffff:127.0.0.1');
    await limiter.resetKey?.('127.0.0.1');
  }
}

// ---------------------------------------------------------------- zámek účtu

const POCET_POKUSU_ZAMEK = 10;
const OKNO_MINUT = 15;
const ZAMEK_MINUT = 15;

export async function zapisPokus(email, ip, uspech, duvod = null) {
  await pool.query(
    'INSERT INTO prihlaseni_pokusy (email, ip, uspech, duvod) VALUES (?, ?, ?, ?)',
    [email, ip ?? null, uspech ? 1 : 0, duvod]
  );
}

// Po deseti neúspěších za 15 minut se účet zamkne na dalších 15 minut.
export async function vyhodnotZamek(email) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS pocet FROM prihlaseni_pokusy
      WHERE email = ? AND uspech = 0
        AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [email, OKNO_MINUT]
  );
  if (rows[0].pocet < POCET_POKUSU_ZAMEK) return false;

  await pool.query(
    'UPDATE uzivatele SET zamceno_do = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE email = ?',
    [ZAMEK_MINUT, email]
  );
  return true;
}

export async function uklidStarePokusy() {
  const [r] = await pool.query(
    'DELETE FROM prihlaseni_pokusy WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)'
  );
  return r.affectedRows;
}
