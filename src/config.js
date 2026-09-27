// src/config.js
//
// Jediné místo, kde se čte process.env. Konfigurace se při startu zvaliduje,
// takže aplikace spadne hned a s jasnou zprávou, ne až za tři dny u prvního
// e-mailu s chybějícím klíčem.
//
// Pravidlo: v kódu nikdy nesmí být natvrdo napsaná doména. Všechny absolutní
// adresy (canonical, OG, odkazy v e-mailech, návratové URL platební brány)
// se skládají z APP_URL. Přechod na jinou doménu je tím jen změna .env.

import 'dotenv/config';
import { z } from 'zod';

const bool = (vychozi) =>
  z
    .enum(['true', 'false', '1', '0', 'ano', 'ne'])
    .default(vychozi)
    .transform((v) => v === 'true' || v === '1' || v === 'ano');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Základ všech absolutních adres. Bez koncového lomítka.
  APP_URL: z
    .string()
    .url('APP_URL musí být celá adresa včetně https://')
    .default('http://127.0.0.1:3000')
    .transform((v) => v.replace(/\/+$/, '')),

  // Jméno prostředí se ukazuje v administraci, aby bylo poznat, kde člověk je.
  PROSTREDI: z.enum(['vyvoj', 'test', 'produkce']).default('vyvoj'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),

  // povolit = normální indexace, zakazat = robots.txt Disallow + X-Robots-Tag
  ROBOTS: z.enum(['povolit', 'zakazat']).default('zakazat'),

  // Odesílání e-mailů. Výchozí 'vypnuto' je záměr: dokud se režim nenastaví
  // vědomě, e-mail se jen zaloguje a nikam neodejde.
  EMAIL_REZIM: z.enum(['live', 'test', 'vypnuto']).default('vypnuto'),
  EMAIL_TEST_PRIJEMCE: z.string().email().optional(),
  EMAIL_ODESILATEL: z.string().min(3).default('LSD <rezervace@example.invalid>'),
  RESEND_API_KEY: z.string().min(1).optional(),

  // Platební brána Mo.one (fáze 4, teď jen připraveno)
  MOONE_BASE_URL: z.string().url().optional(),
  MOONE_CLIENT_ID: z.string().optional(),
  MOONE_CLIENT_SECRET: z.string().optional(),

  // Délka platnosti přihlášení ve dnech
  SESSION_DNI: z.coerce.number().int().positive().default(14),
});

// Prázdná hodnota v .env (`RESEND_API_KEY=`) znamená "nenastaveno", ne
// "nastaveno na prázdný řetězec" - jinak by nepovinné položky padaly na
// validaci jen proto, že je někdo v souboru nechal vypsané.
const prostredi = Object.fromEntries(
  Object.entries(process.env).filter(([, hodnota]) => String(hodnota ?? '').trim() !== '')
);

const vysledek = schema.safeParse(prostredi);

if (!vysledek.success) {
  const chyby = vysledek.error.issues
    .map((i) => `  ${i.path.join('.') || '(koren)'}: ${i.message}`)
    .join('\n');
  console.error('Chybná konfigurace v .env:\n' + chyby);
  process.exit(1);
}

const env = vysledek.data;

const config = {
  ...env,
  jeProdukce: env.NODE_ENV === 'production',
  jeTest: env.NODE_ENV === 'test',

  // Absolutní adresa k cestě. Jediný správný způsob, jak v aplikaci vyrobit
  // odkaz do světa (e-mail, canonical, webhook).
  url(cesta = '/') {
    return env.APP_URL + (cesta.startsWith('/') ? cesta : '/' + cesta);
  },
};

// V produkci nechceme běžet s výchozími hodnotami, které vypadají nastaveně.
if (config.jeProdukce) {
  const chybi = [];
  if (env.APP_URL.includes('127.0.0.1')) chybi.push('APP_URL');
  if (env.EMAIL_ODESILATEL.includes('example.invalid')) chybi.push('EMAIL_ODESILATEL');
  if (env.EMAIL_REZIM !== 'vypnuto' && !env.RESEND_API_KEY) chybi.push('RESEND_API_KEY');
  if (env.EMAIL_REZIM === 'test' && !env.EMAIL_TEST_PRIJEMCE) chybi.push('EMAIL_TEST_PRIJEMCE');
  if (chybi.length) {
    console.error(`V produkci musí být nastaveno: ${chybi.join(', ')}`);
    process.exit(1);
  }
}

// Testovací režim bez cílové adresy je horší než vypnuté odesílání - e-mail by
// odešel skutečnému zákazníkovi. Padáme v každém prostředí, ne jen v produkci.
if (env.EMAIL_REZIM === 'test' && !env.EMAIL_TEST_PRIJEMCE) {
  console.error('EMAIL_REZIM=test vyžaduje EMAIL_TEST_PRIJEMCE, jinak by e-maily odešly zákazníkům.');
  process.exit(1);
}

export default config;
