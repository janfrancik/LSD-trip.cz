// src/auth/hesla.js
//
// Hashování hesel argon2id s parametry podle doporučení OWASP (2024):
// 19 MiB paměti, 2 iterace, paralelismus 1. Sůl a parametry si argon2 ukládá
// do výsledného řetězce, nic dalšího se v databázi držet nemusí.

import { hash, verify, Algorithm } from '@node-rs/argon2';

const NASTAVENI = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function zahashujHeslo(heslo) {
  return hash(heslo, NASTAVENI);
}

// Vrací true/false, nikdy nevyhazuje - poškozený hash v databázi znamená
// "neplatné heslo", ne spadlé přihlášení.
export async function overHeslo(hashHesla, heslo) {
  if (!hashHesla) return false;
  try {
    return await verify(hashHesla, heslo);
  } catch {
    return false;
  }
}
