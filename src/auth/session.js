// src/auth/session.js
//
// Přihlášení drží náhodný 32bajtový token v cookie; v databázi je jen jeho
// SHA-256. Únik dumpu databáze tak neumožní přihlásit se za někoho jiného.
//
// Cookie: httpOnly (nedostupná z JS), secure v produkci, SameSite=Strict.
// Strict stačí, protože administrace je celá same-site; jako druhá vrstva
// proti CSRF je pak povinná hlavička X-CSRF-Token (viz auth/csrf.js).

import crypto from 'node:crypto';
import pool from '../db.js';
import { okamzik } from '../cas.js';
import config from '../config.js';

export const COOKIE_SESSION = 'lsd_admin';

const DEN_MS = 24 * 60 * 60 * 1000;

export function hashTokenu(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function nastavCookie(res, token, expiresAt) {
  res.cookie(COOKIE_SESSION, token, {
    httpOnly: true,
    secure: config.jeProdukce,
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  });
}

export async function vytvorSession(res, uzivatelId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.SESSION_DNI * DEN_MS);

  await pool.query(
    `INSERT INTO sessions (id, uzivatel_id, ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      hashTokenu(token),
      uzivatelId,
      req.ip ?? null,
      (req.get('user-agent') ?? '').slice(0, 255) || null,
      expiresAt,
    ]
  );

  nastavCookie(res, token, expiresAt);
  return token;
}

// Načte uživatele podle cookie. Vrací null, pokud session neexistuje,
// vypršela, nebo uživatel mezitím přestal být aktivní.
export async function nactiSession(req) {
  const token = req.cookies?.[COOKIE_SESSION];
  if (!token) return null;

  const [rows] = await pool.query(
    `SELECT s.id AS session_id, s.expires_at,
            u.id, u.email, u.jmeno, u.role, u.aktivni, u.totp_potvrzeno_at
       FROM sessions s
       JOIN uzivatele u ON u.id = s.uzivatel_id
      WHERE s.id = ? AND s.expires_at > NOW()
        AND u.aktivni = 1 AND u.smazano_at IS NULL`,
    [hashTokenu(token)]
  );
  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    sessionId: r.session_id,
    expiresAt: r.expires_at,
    uzivatel: {
      id: r.id,
      email: r.email,
      jmeno: r.jmeno,
      role: r.role,
      maTotp: Boolean(r.totp_potvrzeno_at),
    },
  };
}

// Posunutí platnosti při aktivitě, ale ne při každém požadavku - stačí, když
// se do expirace zbývá méně než polovina původní doby.
export async function prodluzSession(res, session) {
  const zbyva = okamzik(session.expiresAt).getTime() - Date.now();
  if (zbyva > (config.SESSION_DNI * DEN_MS) / 2) return;

  const expiresAt = new Date(Date.now() + config.SESSION_DNI * DEN_MS);
  await pool.query('UPDATE sessions SET expires_at = ? WHERE id = ?', [
    expiresAt,
    session.sessionId,
  ]);
}

export async function zrusSession(res, sessionId) {
  if (sessionId) await pool.query('DELETE FROM sessions WHERE id = ?', [sessionId]);
  res.clearCookie(COOKIE_SESSION, {
    httpOnly: true,
    secure: config.jeProdukce,
    sameSite: 'strict',
    path: '/',
  });
}

// Při změně hesla se odhlásí všechna zařízení - kdyby někdo heslo znal,
// přístup mu tím skončí.
export async function zrusVsechnySession(uzivatelId) {
  await pool.query('DELETE FROM sessions WHERE uzivatel_id = ?', [uzivatelId]);
}

export async function uklidProslychSession() {
  const [r] = await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
  return r.affectedRows;
}
