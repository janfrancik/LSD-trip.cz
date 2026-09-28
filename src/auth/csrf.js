// src/auth/csrf.js
//
// Ochrana proti CSRF metodou double-submit: v cookie lsd_csrf je náhodný token
// (čitelný JavaScriptem), administrace ho posílá zpátky v hlavičce X-CSRF-Token.
// Útočník z cizí stránky cookie nepřečte, takže hlavičku nedokáže vyplnit.
//
// Cookie session je navíc SameSite=Strict, takže tohle je druhá vrstva - ale
// spoléhat na jedinou vrstvu u peněz a osobních údajů nechceme.

import crypto from 'node:crypto';
import config from '../config.js';
import { chybaBezOpravneni } from '../chyby.js';

export const COOKIE_CSRF = 'lsd_csrf';
const HLAVICKA = 'x-csrf-token';
const BEZPECNE_METODY = new Set(['GET', 'HEAD', 'OPTIONS']);

export function zajistiCsrfToken(req, res) {
  let token = req.cookies?.[COOKIE_CSRF];
  if (!token || token.length < 32) {
    token = crypto.randomBytes(24).toString('base64url');
    res.cookie(COOKIE_CSRF, token, {
      httpOnly: false, // administrace ho musí přečíst a poslat v hlavičce
      secure: config.jeHttps,
      sameSite: 'strict',
      path: '/',
    });
  }
  return token;
}

export function overCsrf(req, res, next) {
  if (BEZPECNE_METODY.has(req.method)) return next();

  const zCookie = req.cookies?.[COOKIE_CSRF];
  const zHlavicky = req.get(HLAVICKA);

  if (!zCookie || !zHlavicky || !stejneBezpecne(zCookie, zHlavicky)) {
    return next(
      chybaBezOpravneni('Vypršelo zabezpečení formuláře. Obnov stránku a zkus to znovu.')
    );
  }
  return next();
}

function stejneBezpecne(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
