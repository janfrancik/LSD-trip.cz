// src/validace.js
//
// Validace vstupů přes zod. Chyby se překládají do češtiny a vracejí po polích,
// aby je administrace mohla zobrazit přímo u vstupu.

import { z } from 'zod';
import { chybaSpatnyVstup } from './chyby.js';

// Pole, na kterých záleží napříč aplikací.
export const schemaEmail = z
  .string({ error: 'E-mail je povinný.' })
  .trim()
  .min(3, 'E-mail je povinný.')
  .max(255, 'E-mail je příliš dlouhý.')
  .email('Tohle není platná e-mailová adresa.')
  .transform((v) => v.toLowerCase());

export const schemaHeslo = z
  .string({ error: 'Heslo je povinné.' })
  .min(10, 'Heslo musí mít alespoň 10 znaků.')
  .max(200, 'Heslo je příliš dlouhé.');

export const schemaJmeno = z
  .string({ error: 'Jméno je povinné.' })
  .trim()
  .min(2, 'Jméno je povinné.')
  .max(160, 'Jméno je příliš dlouhé.');

export const schemaTelefon = z
  .string()
  .trim()
  .max(40, 'Telefon je příliš dlouhý.')
  .optional()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));

export const schemaRole = z.enum(['admin', 'provoz', 'instruktor', 'ucetni', 'tester'], {
  error: 'Neznámá role.',
});

// Stránkování a hledání - stejné u všech seznamů v administraci.
export const schemaSeznam = z.object({
  strana: z.coerce.number().int().min(1).default(1),
  na_strane: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  razeni: z.string().trim().max(60).optional(),
});

// Zvaliduje data a při chybě vyhodí ChybaApi s detaily po polích.
export function zvaliduj(schema, data) {
  const vysledek = schema.safeParse(data);
  if (vysledek.success) return vysledek.data;

  const detaily = {};
  for (const issue of vysledek.error.issues) {
    const pole = issue.path.join('.') || '_';
    if (!detaily[pole]) detaily[pole] = issue.message;
  }
  const prvni = Object.values(detaily)[0] ?? 'Neplatný vstup.';
  throw chybaSpatnyVstup(prvni, detaily);
}
