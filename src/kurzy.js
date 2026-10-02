// src/kurzy.js
//
// Kurzy tak, jak je vidí návštěvník webu. Jedno místo pro veřejné API
// (src/api/verejne.js) i pro stránky vykreslené na serveru (src/web/),
// aby se /kurzy a /api/produkty nemohly rozejít.
//
// Zásada veřejné části: ven jde jen to, co má být na webu. Žádné `id`
// instruktorů, žádné interní poznámky k termínu, žádná jména přihlášených -
// u termínu jen počet volných míst.
//
// Co se na web vůbec nedostane:
//   - nezveřejněný (`aktivni = 0`) nebo smazaný kurz,
//   - skrytý (`viditelny = 0`), smazaný, zrušený nebo proběhlý termín.
// Platí to i pro přímou adresu - detail skrytého kurzu vrací 404, ne stránku.

import pool from './db.js';
import { isoDatum } from './cas.js';

// Sloupce, které smí ven. Výčet je ruční schválně: `SELECT *` by na web
// pustil i sloupec, který se teprve přidá.
const SLOUPCE_KURZU = `
  p.id, p.slug, p.nazev, p.podtitul, p.stitek, p.perex,
  p.cena_hal, p.cena_na_dotaz, p.delka_text, p.uroven_text,
  p.min_vek, p.max_vek, p.max_vaha_kg, p.souhlas_zastupce_do_let,
  p.vyzaduje_lekarskou_prohlidku, p.vyzaduje_zdravotni_prohlaseni`;

function prositKurz(radek) {
  return {
    slug: radek.slug,
    nazev: radek.nazev,
    podtitul: radek.podtitul,
    stitek: radek.stitek,
    perex: radek.perex,
    cena_hal: radek.cena_na_dotaz ? null : radek.cena_hal,
    cena_na_dotaz: Boolean(radek.cena_na_dotaz),
    delka_text: radek.delka_text,
    uroven_text: radek.uroven_text,
    pozadavky: {
      min_vek: radek.min_vek,
      max_vek: radek.max_vek,
      max_vaha_kg: radek.max_vaha_kg,
      souhlas_zastupce_do_let: radek.souhlas_zastupce_do_let,
      lekarska_prohlidka: Boolean(radek.vyzaduje_lekarskou_prohlidku),
      zdravotni_prohlaseni: Boolean(radek.vyzaduje_zdravotni_prohlaseni),
    },
  };
}

// Adresa fotky je /media/<kod> - náhodný kód, ne pořadové číslo (migrace 010).
function prositFotku(radek) {
  return { url: `/media/${radek.kod}`, alt: radek.alt, titulni: Boolean(radek.titulni) };
}

/**
 * Termín pro web. `volno === null` znamená "bez omezení kapacity" - takový
 * termín se nabízí vždycky, jen u něj nesvítí počet míst.
 */
function prositTermin(radek) {
  const volno = radek.kapacita_mist > 0
    ? Math.max(0, radek.kapacita_mist - radek.obsazeno_mist)
    : null;
  return {
    id: radek.id,
    kurz_slug: radek.slug,
    nazev: radek.nazev_prepis || radek.produkt_nazev,
    datum: radek.datum,
    cas_od: radek.cas_od,
    cas_do: radek.cas_do,
    popis_casu: radek.popis_casu,
    misto: radek.misto_nazev,
    kapacita: radek.kapacita_mist || null,
    volno,
    plno: volno === 0,
    cena_hal: radek.cena_hal_prepis ?? (radek.cena_na_dotaz ? null : radek.cena_hal),
    cena_na_dotaz: Boolean(radek.cena_na_dotaz) && radek.cena_hal_prepis == null,
    popis: radek.popis,
  };
}

// Termíny, které se smí ukázat na webu. Zrušený ani proběhlý mezi ně nepatří;
// "dnes" je pražský den, ne UTC - jinak by termín na dnešek v jednu v noci
// z webu zmizel.
const KDE_VIDITELNY_TERMIN = `
  t.smazano_at IS NULL AND t.viditelny = 1
  AND t.stav IN ('otevreno','plno')
  AND t.datum >= ?`;

const VYBER_TERMINU = `
  t.id, t.datum, t.cas_od, t.cas_do, t.popis_casu, t.nazev_prepis,
  t.kapacita_mist, t.obsazeno_mist, t.cena_hal_prepis, t.popis,
  m.nazev AS misto_nazev,
  p.slug, p.nazev AS produkt_nazev, p.cena_hal, p.cena_na_dotaz`;

async function terminyProKurzy(idKurzu) {
  if (!idKurzu.length) return new Map();
  const [rows] = await pool.query(
    `SELECT ${VYBER_TERMINU}
       FROM terminy t
       JOIN produkty p ON p.id = t.produkt_id
       LEFT JOIN mista m ON m.id = t.misto_id
      WHERE t.produkt_id IN (?) AND ${KDE_VIDITELNY_TERMIN}
      ORDER BY t.datum, t.cas_od, t.id`,
    [idKurzu, isoDatum(new Date())]
  );

  const podleKurzu = new Map();
  for (const radek of rows) {
    const seznam = podleKurzu.get(radek.slug) ?? [];
    seznam.push(prositTermin(radek));
    podleKurzu.set(radek.slug, seznam);
  }
  return podleKurzu;
}

/**
 * Zveřejněné kurzy v pořadí z administrace, s titulní fotkou a nejbližším
 * termínem. Tohle vidí titulka i přehled /kurzy.
 */
export async function nactiVerejneKurzy() {
  const [kurzy] = await pool.query(
    `SELECT ${SLOUPCE_KURZU}
       FROM produkty p
      WHERE p.typ = 'kurz' AND p.aktivni = 1 AND p.smazano_at IS NULL
      ORDER BY p.poradi, p.nazev`
  );
  if (!kurzy.length) return [];

  const idKurzu = kurzy.map((k) => k.id);
  const [fotky] = await pool.query(
    `SELECT f.produkt_id, s.kod, s.alt, f.titulni
       FROM produkt_fotky f
       JOIN soubory s ON s.id = f.soubor_id
      WHERE f.produkt_id IN (?) AND f.titulni = 1 AND s.smazano_at IS NULL`,
    [idKurzu]
  );
  const titulni = new Map(fotky.map((f) => [f.produkt_id, prositFotku(f)]));
  const terminy = await terminyProKurzy(idKurzu);

  return kurzy.map((k) => {
    const vlastni = terminy.get(k.slug) ?? [];
    return {
      ...prositKurz(k),
      foto: titulni.get(k.id) ?? null,
      nejblizsi_termin: vlastni.find((t) => !t.plno) ?? vlastni[0] ?? null,
      pocet_terminu: vlastni.length,
      volnych_mist: vlastni.reduce((a, t) => a + (t.volno ?? 0), 0),
    };
  });
}

/**
 * Detail kurzu pro /kurz/:slug. Vrací null, když kurz neexistuje, je smazaný
 * nebo není zveřejněný - volající z toho udělá 404, ne prázdnou stránku.
 */
export async function nactiVerejnyKurz(slug) {
  const [rows] = await pool.query(
    `SELECT ${SLOUPCE_KURZU}, p.popis, p.co_je_v_cene, p.seo_title, p.seo_description
       FROM produkty p
      WHERE p.slug = ? AND p.typ = 'kurz' AND p.aktivni = 1 AND p.smazano_at IS NULL
      LIMIT 1`,
    [slug]
  );
  const kurz = rows[0];
  if (!kurz) return null;

  const [pozadavky] = await pool.query(
    'SELECT text FROM produkt_pozadavky WHERE produkt_id = ? ORDER BY poradi, id',
    [kurz.id]
  );
  const [kroky] = await pool.query(
    'SELECT cislo, nadpis, text FROM produkt_kroky WHERE produkt_id = ? ORDER BY poradi, id',
    [kurz.id]
  );
  const [fotky] = await pool.query(
    `SELECT s.kod, s.alt, f.titulni
       FROM produkt_fotky f
       JOIN soubory s ON s.id = f.soubor_id
      WHERE f.produkt_id = ? AND s.smazano_at IS NULL
      ORDER BY f.titulni DESC, f.poradi, f.soubor_id`,
    [kurz.id]
  );
  const terminy = (await terminyProKurzy([kurz.id])).get(kurz.slug) ?? [];

  return {
    ...prositKurz(kurz),
    popis: kurz.popis,
    co_je_v_cene: kurz.co_je_v_cene,
    seo_title: kurz.seo_title,
    seo_description: kurz.seo_description,
    checklist: pozadavky.map((p) => p.text),
    kroky: kroky.map((k) => ({ cislo: k.cislo, nadpis: k.nadpis, text: k.text })),
    fotky: fotky.map(prositFotku),
    foto: fotky.length ? prositFotku(fotky[0]) : null,
    terminy,
  };
}

/**
 * Termíny kurzů napříč kurzy - pro kalendář na webu.
 */
export async function nactiVerejneTerminyKurzu() {
  const [rows] = await pool.query(
    `SELECT ${VYBER_TERMINU}
       FROM terminy t
       JOIN produkty p ON p.id = t.produkt_id
       LEFT JOIN mista m ON m.id = t.misto_id
      WHERE p.typ = 'kurz' AND p.aktivni = 1 AND p.smazano_at IS NULL
        AND ${KDE_VIDITELNY_TERMIN}
      ORDER BY t.datum, t.cas_od, t.id`,
    [isoDatum(new Date())]
  );
  return rows.map(prositTermin);
}
