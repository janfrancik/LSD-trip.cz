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
import path from 'node:path';
import { z } from 'zod';

// Jediný seznam režimů odesílání. Ostrý režim se jmenuje 'live' - stejně
// v .env, v návodu, v testech i ve sloupci emaily.rezim v databázi.
export const REZIMY_EMAILU = ['live', 'jen_provoz', 'schranka', 'test', 'vypnuto'];

// Režimy, ve kterých smí e-mail dojít zákazníkovi. Jediné místo, kde se to
// rozhoduje - používá to odesílání, API i administrace (tlačítko "Odeslat
// znovu" se v ostatních režimech vůbec nenabídne).
export const REZIMY_ZAKAZNIKOVI = ['live', 'test'];

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
  //
  //   live       = posílá se zákazníkům (jen produkce)
  //   jen_provoz = interní upozornění jdou na EMAIL_PROVOZ_PRIJEMCE,
  //                zákazníkům se neposílá nic (stav 'neodeslano')
  //   test       = všechno se přepíše na EMAIL_TEST_PRIJEMCE
  //   schranka   = neodesílá se vůbec, ale celý e-mail se uloží do testovací
  //                schránky v administraci (na testu, kde není Resend)
  //   vypnuto    = neodejde nic, záznam zůstane se stavem 'neodeslano'
  EMAIL_REZIM: z.enum(REZIMY_EMAILU).default('vypnuto'),
  EMAIL_TEST_PRIJEMCE: z.string().email().optional(),

  // Kam chodí interní upozornění v režimu 'jen_provoz'. Bez ověřené domény
  // umí Resend odeslat jen na adresu majitele účtu, takže tady musí být
  // právě ona - jinak se vrátí 403.
  EMAIL_PROVOZ_PRIJEMCE: z.string().email().optional(),
  EMAIL_ODESILATEL: z.string().min(3).default('LSD <rezervace@example.invalid>'),
  RESEND_API_KEY: z.string().min(1).optional(),

  // Platební brána Mo.one (fáze 4, teď jen připraveno)
  MOONE_BASE_URL: z.string().url().optional(),
  MOONE_CLIENT_ID: z.string().optional(),
  MOONE_CLIENT_SECRET: z.string().optional(),

  // Délka platnosti přihlášení ve dnech
  SESSION_DNI: z.coerce.number().int().positive().default(14),

  // Kam se ukládají nahrané soubory (přílohy akceptace, ve fázi 5 fotogalerie).
  // V Dockeru je to /app/uploads, což je volume - přežije přestavbu image.
  UPLOAD_DIR: z.string().min(1).default('uploads'),
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

  // Ostrý režim se jmenuje 'live'. Jiné pojmenování (typicky 'ostry') je
  // častý překlep z diskuse - ať člověk nemusí hledat v kódu, co se čeká.
  const rezim = String(process.env.EMAIL_REZIM ?? '').trim();
  const napoveda =
    rezim && !REZIMY_EMAILU.includes(rezim)
      ? `\nEMAIL_REZIM smí být: ${REZIMY_EMAILU.join(' | ')}. ` +
        `Ostrému odesílání se říká "live"${rezim === 'ostry' ? ', ne "ostry"' : ''}.`
      : '';

  console.error('Chybná konfigurace v .env:\n' + chyby + napoveda);
  process.exit(1);
}

const env = vysledek.data;

const config = {
  ...env,

  // Skutečné prostředí se pozná podle PROSTREDI, NIKDY podle NODE_ENV.
  // V kontejneru je NODE_ENV=production i na testu (kvůli instalaci závislostí
  // bez dev balíčků), takže test se podle NODE_ENV tváří jako produkce -
  // přesně na tom spadl start s EMAIL_REZIM=schranka, protože se po něm
  // chtěl produkční RESEND_API_KEY.
  jeProdukce: env.PROSTREDI === 'produkce',
  jeVyvoj: env.PROSTREDI === 'vyvoj',

  // Secure cookies, HSTS a upgrade-insecure-requests patří k HTTPS, ne
  // k prostředí: test jede po HTTPS taky a cookie tam musí být Secure.
  jeHttps: env.APP_URL.startsWith('https://'),

  // Smí e-mail dojít zákazníkovi? V 'jen_provoz' a 'vypnuto' ne, takže se
  // v administraci nenabídne "Odeslat znovu" ani hromadné rozeslání - nemělo
  // by to kam jít a jen by to vyrobilo druhý záznam se stejným výsledkem.
  muzeZakaznikovi: REZIMY_ZAKAZNIKOVI.includes(env.EMAIL_REZIM),

  // Modul „Ke schválení“ (akceptační testování) je nástroj pro nasazení na
  // testu, ne součást provozu. V produkci se nezapne: nemá API, nezobrazí se
  // v menu a nikde se neukáže tlačítko „Nahlásit problém“. Ve vývoji zapnutý
  // je, jinak by se nedal vyzkoušet před nasazením na test.
  akceptaceZapnuta: env.PROSTREDI !== 'produkce',

  // Absolutní cesta k adresáři s nahranými soubory.
  uploadDir: path.resolve(process.cwd(), env.UPLOAD_DIR),

  // Absolutní adresa k cestě. Jediný správný způsob, jak v aplikaci vyrobit
  // odkaz do světa (e-mail, canonical, webhook).
  url(cesta = '/') {
    return env.APP_URL + (cesta.startsWith('/') ? cesta : '/' + cesta);
  },
};

function zastav(zprava) {
  console.error(`Chybná konfigurace (.env, PROSTREDI=${env.PROSTREDI}): ${zprava}`);
  process.exit(1);
}

// --- Pravidla pro odesílání e-mailů -----------------------------------------
//
// Klíč k Resendu potřebuje JEN ostrý režim. Režim 'schranka' ani 'vypnuto' ven
// nic neposílají, takže po nich klíč chtít nemá smysl - na testu žádný není
// a mít ho tam by bylo jen riziko navíc.

if (env.EMAIL_REZIM === 'live' && !env.RESEND_API_KEY) {
  zastav('EMAIL_REZIM=live vyžaduje RESEND_API_KEY, jinak by se e-maily tiše neodesílaly.');
}

// Jen_provoz opravdu odesílá (interní upozornění), takže bez klíče by to byl
// jen vypnuto s delším názvem - a nikdo by se o nové přihlášce nedozvěděl.
if (env.EMAIL_REZIM === 'jen_provoz' && !env.RESEND_API_KEY) {
  zastav('EMAIL_REZIM=jen_provoz vyžaduje RESEND_API_KEY - interní upozornění se opravdu odesílají.');
}

// Bez cílové adresy by režim mlčel stejně jako vypnuto, jenže by se tvářil,
// že provoz upozornění dostává. To je horší než vypnuté odesílání.
if (env.EMAIL_REZIM === 'jen_provoz' && !env.EMAIL_PROVOZ_PRIJEMCE) {
  zastav(
    'EMAIL_REZIM=jen_provoz vyžaduje EMAIL_PROVOZ_PRIJEMCE - jinak by interní upozornění ' +
      'neměla kam odejít a o nových přihláškách by nikdo nevěděl.'
  );
}

// Testovací režim bez cílové adresy je horší než vypnuté odesílání - e-mail by
// odešel skutečnému zákazníkovi.
if (env.EMAIL_REZIM === 'test' && !env.EMAIL_TEST_PRIJEMCE) {
  zastav('EMAIL_REZIM=test vyžaduje EMAIL_TEST_PRIJEMCE, jinak by e-maily odešly zákazníkům.');
}

// Schránka je nástroj testovacího prostředí. V produkci by znamenala, že se
// zákazníkům tiše nic neposílá a všechno leží v administraci.
if (config.jeProdukce && env.EMAIL_REZIM === 'schranka') {
  zastav(
    'EMAIL_REZIM=schranka je jen pro test. V produkci nastav live (ostré odesílání) ' +
      'nebo vypnuto, dokud není Resend hotový.'
  );
}

// --- Produkce nesmí běžet s výchozími hodnotami, které vypadají nastaveně ---

if (config.jeProdukce) {
  const chybi = [];
  if (env.APP_URL.includes('127.0.0.1')) chybi.push('APP_URL');
  if (env.EMAIL_ODESILATEL.includes('example.invalid')) chybi.push('EMAIL_ODESILATEL');
  if (chybi.length) zastav(`v produkci musí být nastaveno: ${chybi.join(', ')}`);
}

export default config;
