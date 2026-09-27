// src/auth/totp.js
//
// Dvoufázové ověření přes TOTP (Google Authenticator, Authy, 1Password).
// Je volitelné - kdo si ho nezapne, přihlašuje se jen heslem.

import { TOTP, Secret } from 'otpauth';

const VYDAVATEL = 'LSD administrace';

function totp(secret, ucet = 'admin') {
  return new TOTP({
    issuer: VYDAVATEL,
    label: ucet,
    algorithm: 'SHA1', // co podporují všechny běžné aplikace
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
}

export function vytvorTotpSecret() {
  return new Secret({ size: 20 }).base32;
}

export function totpUrl(secret, ucet) {
  return totp(secret, ucet).toString();
}

// Tolerance jednoho okna v obou směrech kvůli rozcházejícím se hodinám.
export function overTotpKod(secret, kod) {
  if (!secret || !kod) return false;
  const cisty = String(kod).replace(/\s/g, '');
  if (!/^\d{6}$/.test(cisty)) return false;
  try {
    return totp(secret).validate({ token: cisty, window: 1 }) !== null;
  } catch {
    return false;
  }
}
