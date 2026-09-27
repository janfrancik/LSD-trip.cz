// src/akceptace/souhrn.js
//
// Čtení akceptačních dat a jejich vyhodnocení na jednom místě, aby API,
// přehled pro admina i export do Markdownu počítaly stejně.
//
// Vyhodnocení úkolu: rozhoduje nejhorší výsledek. Jeden tester, kterému něco
// nefunguje, váží víc než tři, kterým to šlo - a dokud ho někdo neotestuje,
// úkol není hotový.

import pool from '../db.js';
import { prilohyPro } from './prilohy.js';

export const STAVY_VYSLEDKU = ['funguje', 'nefunguje', 'nerozumim', 'k_pretestovani'];

export const POPIS_STAVU = {
  funguje: 'funguje',
  nefunguje: 'nefunguje',
  nerozumim: 'nerozumím zadání',
  k_pretestovani: 'k přetestování',
  neotestovano: 'neotestováno',
};

export const STAVY_HLASENI = ['nove', 'resi_se', 'vyreseno', 'zamitnuto'];
export const OTEVRENA_HLASENI = ['nove', 'resi_se'];

// Od nejhoršího k nejlepšímu.
const PORADI_STAVU = ['nefunguje', 'nerozumim', 'k_pretestovani', 'funguje'];

export function stavUkolu(vysledky) {
  if (!vysledky || vysledky.length === 0) return 'neotestovano';
  for (const stav of PORADI_STAVU) {
    if (vysledky.some((v) => v.stav === stav)) return stav;
  }
  return 'neotestovano';
}

export function souhrnUkolu(ukoly) {
  const pocty = { funguje: 0, nefunguje: 0, nerozumim: 0, k_pretestovani: 0, neotestovano: 0 };
  for (const u of ukoly) pocty[u.stav] = (pocty[u.stav] ?? 0) + 1;
  return { celkem: ukoly.length, ...pocty };
}

/**
 * Verze se všemi úkoly, výsledky a hlášeními. Jeden dotaz na úkoly, jeden na
 * výsledky - ne dotaz na úkol, protože úkolů bude ve fázi 2 a dál desítky.
 */
export async function nactiVerzi(verzeId) {
  const [[verze]] = await pool.query(
    `SELECT v.*, u.jmeno AS schvalil_jmeno
       FROM akceptace_verze v
       LEFT JOIN uzivatele u ON u.id = v.schvalil_id
      WHERE v.id = ?`,
    [verzeId]
  );
  if (!verze) return null;

  const [ukoly] = await pool.query(
    `SELECT id, kod, nazev, postup, ocekavany_vysledek, odkaz, oblast, poradi, aktivni, zmeneno_at
       FROM akceptace_ukoly WHERE verze_id = ? ORDER BY aktivni DESC, poradi, id`,
    [verzeId]
  );

  const [vysledky] = await pool.query(
    `SELECT r.id, r.ukol_id, r.uzivatel_id, r.stav, r.komentar, r.predchozi_stav,
            r.created_at, r.updated_at, u.jmeno AS kdo, u.role AS role_kdo,
            (SELECT COUNT(*) FROM akceptace_prilohy p WHERE p.vysledek_id = r.id) AS prilohy
       FROM akceptace_vysledky r
       JOIN uzivatele u ON u.id = r.uzivatel_id
      WHERE r.ukol_id IN (SELECT id FROM akceptace_ukoly WHERE verze_id = ?)
      ORDER BY r.updated_at DESC`,
    [verzeId]
  );

  const podleUkolu = new Map();
  for (const v of vysledky) {
    if (!podleUkolu.has(v.ukol_id)) podleUkolu.set(v.ukol_id, []);
    podleUkolu.get(v.ukol_id).push(v);
  }

  const sUkoly = ukoly.map((u) => {
    const moje = podleUkolu.get(u.id) ?? [];
    return { ...u, aktivni: Boolean(u.aktivni), vysledky: moje, stav: stavUkolu(moje) };
  });

  const [hlaseni] = await pool.query(
    `SELECT h.*, u.jmeno AS kdo, r.jmeno AS vyresil_jmeno,
            (SELECT COUNT(*) FROM akceptace_prilohy p WHERE p.hlaseni_id = h.id) AS prilohy
       FROM akceptace_hlaseni h
       LEFT JOIN uzivatele u ON u.id = h.uzivatel_id
       LEFT JOIN uzivatele r ON r.id = h.vyresil_id
      WHERE h.verze_id = ?
      ORDER BY FIELD(h.stav,'nove','resi_se','vyreseno','zamitnuto'), h.created_at DESC`,
    [verzeId]
  );

  const aktivniUkoly = sUkoly.filter((u) => u.aktivni);
  return {
    verze,
    ukoly: sUkoly,
    hlaseni,
    souhrn: {
      ...souhrnUkolu(aktivniUkoly),
      hlaseni_celkem: hlaseni.length,
      hlaseni_otevrena: hlaseni.filter((h) => OTEVRENA_HLASENI.includes(h.stav)).length,
    },
  };
}

// Proč verze (ne)jde schválit. Vrací seznam důvodů - prázdný seznam znamená
// „jde“. Text čte člověk, takže je konkrétní, ne „podmínky nesplněny“.
export function duvodyProtiSchvaleni({ verze, ukoly, souhrn }) {
  const duvody = [];
  if (verze.stav === 'schvalena') duvody.push('Verze už je schválená.');
  if (ukoly.filter((u) => u.aktivni).length === 0) duvody.push('Verze nemá žádné úkoly.');
  if (souhrn.neotestovano > 0) duvody.push(`Neotestovaných úkolů: ${souhrn.neotestovano}.`);
  if (souhrn.k_pretestovani > 0) duvody.push(`Úkolů čekajících na přetestování: ${souhrn.k_pretestovani}.`);
  if (souhrn.nefunguje > 0) duvody.push(`Úkolů označených „nefunguje“: ${souhrn.nefunguje}.`);
  if (souhrn.nerozumim > 0) duvody.push(`Úkolů s nejasným zadáním: ${souhrn.nerozumim}.`);
  if (souhrn.hlaseni_otevrena > 0) duvody.push(`Nevyřešených hlášení: ${souhrn.hlaseni_otevrena}.`);
  return duvody;
}

// ------------------------------------------------------------------- export

function datumCas(hodnota) {
  if (!hodnota) return '—';
  const [den, cas] = String(hodnota).split(' ');
  const [r, m, d] = den.split('-');
  return `${Number(d)}. ${Number(m)}. ${r}${cas ? ' ' + cas.slice(0, 5) : ''}`;
}

/**
 * Souhrn verze jako Markdown - k uložení do docs/akceptace/ vedle zadání.
 * Je to zápis o akceptaci: kdo co testoval, kdy a kdo verzi schválil.
 */
export async function exportMarkdown(verzeId) {
  const data = await nactiVerzi(verzeId);
  if (!data) return null;
  const { verze, ukoly, hlaseni, souhrn } = data;

  const radky = [];
  radky.push(`# Akceptace: ${verze.nazev}`, '');
  radky.push(`- Kód verze: \`${verze.kod}\``);
  radky.push(
    `- Stav: ${verze.stav === 'schvalena' ? 'schválená' : 'otevřená'}` +
      (verze.stav === 'schvalena'
        ? ` (${datumCas(verze.schvaleno_at)}, schválil/a ${verze.schvalil_jmeno ?? '—'})`
        : '')
  );
  if (verze.schvaleni_poznamka) radky.push(`- Poznámka ke schválení: ${verze.schvaleni_poznamka}`);
  radky.push(
    `- Úkoly: ${souhrn.celkem} (funguje ${souhrn.funguje}, nefunguje ${souhrn.nefunguje}, ` +
      `nejasné zadání ${souhrn.nerozumim}, k přetestování ${souhrn.k_pretestovani}, ` +
      `neotestováno ${souhrn.neotestovano})`
  );
  radky.push(`- Hlášení: ${souhrn.hlaseni_celkem} (nevyřešená ${souhrn.hlaseni_otevrena})`);
  radky.push(`- Vygenerováno: ${datumCas(new Date().toISOString().slice(0, 19).replace('T', ' '))}`, '');

  radky.push('## Úkoly', '');
  for (const u of ukoly) {
    radky.push(
      `### ${u.nazev}` + (u.aktivni ? '' : ' _(vyřazeno ze zadání)_'),
      '',
      `- Kód: \`${u.kod}\``,
      `- Výsledek: **${POPIS_STAVU[u.stav]}**`
    );
    if (u.vysledky.length === 0) {
      radky.push('- Zatím nikdo netestoval.');
    } else {
      for (const v of u.vysledky) {
        radky.push(
          `- ${v.kdo}: ${POPIS_STAVU[v.stav]} (${datumCas(v.updated_at)})` +
            (v.komentar ? ` — ${jednaRadka(v.komentar)}` : '') +
            (v.prilohy > 0 ? ` [příloh: ${v.prilohy}]` : '')
        );
      }
    }
    radky.push('');
  }

  if (hlaseni.length) {
    radky.push('## Hlášení problémů', '');
    for (const h of hlaseni) {
      radky.push(
        `### #${h.id} — ${POPIS_HLASENI[h.stav]} (${datumCas(h.created_at)}, ${h.kdo ?? 'neznámý'})`,
        '',
        jednaRadka(h.text),
        '',
        `- Adresa: ${h.url ?? '—'}`,
        `- Prohlížeč: ${h.prohlizec ?? '—'}${h.rozliseni ? ` · ${h.rozliseni}` : ''}`
      );
      if (h.odpoved) radky.push(`- Vyřešení: ${jednaRadka(h.odpoved)}${h.vyresil_jmeno ? ` (${h.vyresil_jmeno})` : ''}`);
      radky.push('');
    }
  }

  return radky.join('\n');
}

export const POPIS_HLASENI = {
  nove: 'nové',
  resi_se: 'řeší se',
  vyreseno: 'vyřešeno',
  zamitnuto: 'zamítnuto',
};

function jednaRadka(text) {
  return String(text ?? '').replace(/\s*\n\s*/g, ' ').trim();
}

// ------------------------------------------------- počty pro menu a přehled

// Kolik úkolů čeká na TOHOTO člověka. Bere i „k přetestování“ - po opravě je
// úkol znovu na něm.
export async function pocetKOtestovani(uzivatelId) {
  const [[radek]] = await pool.query(
    `SELECT COUNT(*) AS pocet
       FROM akceptace_ukoly u
       JOIN akceptace_verze v ON v.id = u.verze_id
       LEFT JOIN akceptace_vysledky r ON r.ukol_id = u.id AND r.uzivatel_id = ?
      WHERE u.aktivni = 1 AND v.stav = 'otevrena'
        AND (r.id IS NULL OR r.stav = 'k_pretestovani')`,
    [uzivatelId]
  );
  return Number(radek.pocet ?? 0);
}

export async function pocetOtevrenychHlaseni() {
  const [[radek]] = await pool.query(
    `SELECT COUNT(*) AS pocet FROM akceptace_hlaseni WHERE stav IN (?)`,
    [OTEVRENA_HLASENI]
  );
  return Number(radek.pocet ?? 0);
}

export async function poctyProOdznak(uzivatelId) {
  const [kOtestovani, hlaseni] = await Promise.all([
    pocetKOtestovani(uzivatelId),
    pocetOtevrenychHlaseni(),
  ]);
  return { k_otestovani: kOtestovani, hlaseni_otevrena: hlaseni };
}

/**
 * Karta na přehled: nejbližší otevřená verze a jak daleko je její testování.
 * `moje_hotovo` je průběh konkrétního člověka (5/8), `souhrn` stav za všechny.
 */
export async function kartaNaPrehled(uzivatelId) {
  const [[verze]] = await pool.query(
    `SELECT id, kod, nazev, oznameno_at FROM akceptace_verze
      WHERE stav = 'otevrena' AND EXISTS (
        SELECT 1 FROM akceptace_ukoly u WHERE u.verze_id = akceptace_verze.id AND u.aktivni = 1
      )
      ORDER BY poradi, id LIMIT 1`
  );
  if (!verze) return null;

  const [[moje]] = await pool.query(
    `SELECT COUNT(*) AS celkem,
            SUM(CASE WHEN r.id IS NOT NULL AND r.stav <> 'k_pretestovani' THEN 1 ELSE 0 END) AS hotovo
       FROM akceptace_ukoly u
       LEFT JOIN akceptace_vysledky r ON r.ukol_id = u.id AND r.uzivatel_id = ?
      WHERE u.verze_id = ? AND u.aktivni = 1`,
    [uzivatelId, verze.id]
  );

  const data = await nactiVerzi(verze.id);
  return {
    kod: verze.kod,
    nazev: verze.nazev,
    oznameno: Boolean(verze.oznameno_at),
    moje_hotovo: Number(moje.hotovo ?? 0),
    moje_celkem: Number(moje.celkem ?? 0),
    souhrn: data.souhrn,
  };
}
