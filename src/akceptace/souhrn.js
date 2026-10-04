// src/akceptace/souhrn.js
//
// Čtení akceptačních dat a jejich vyhodnocení na jednom místě, aby API,
// přehled pro admina i export do Markdownu počítaly stejně.
//
// Klíčové pravidlo: **výsledek má každý tester svůj**. Když úkol otestuje
// jeden člověk, ostatním se tím nesplní - majitelka musí projít svoje úkoly
// sama, i když je provozák už zkoušel. Souhrnný stav úkolu (nejhorší výsledek)
// slouží jen pro přehled, ne pro odškrtávání.

import pool from '../db.js';
import { datumCas } from '../cas.js';
import { PRAVA } from '../auth/opravneni.js';

export const STAVY_VYSLEDKU = ['funguje', 'nefunguje', 'nerozumim', 'k_pretestovani'];

export const POPIS_STAVU = {
  funguje: 'funguje',
  nefunguje: 'nefunguje',
  nerozumim: 'nerozumím zadání',
  k_pretestovani: 'k přetestování',
  neotestovano: 'neotestováno',
};

export const ZNACKA_STAVU = {
  funguje: '✓',
  nefunguje: '✕',
  nerozumim: '?',
  k_pretestovani: '↻',
  neotestovano: '·',
};

export const STAVY_HLASENI = ['nove', 'resi_se', 'vyreseno', 'zamitnuto'];
export const OTEVRENA_HLASENI = ['nove', 'resi_se'];

// Role, které smí testovat. Bere se z oprávnění, ne z vlastního výčtu.
export const ROLE_TESTERU = Object.entries(PRAVA)
  .filter(([, prava]) => prava.akceptace)
  .map(([role]) => role);

// Od nejhoršího k nejlepšímu.
const PORADI_STAVU = ['nefunguje', 'nerozumim', 'k_pretestovani', 'funguje'];

export function stavUkolu(vysledky) {
  if (!vysledky || vysledky.length === 0) return 'neotestovano';
  for (const stav of PORADI_STAVU) {
    if (vysledky.some((v) => v.stav === stav)) return stav;
  }
  return 'neotestovano';
}

// Komu se úkol ukáže. `jen_admin` je pro úkoly typu "schval verzi",
// `role_filtr` pro ty, které dávají smysl jen někomu.
export function ukolPatriUzivateli(ukol, uzivatel) {
  if (!uzivatel) return false;
  if (ukol.jen_admin) return uzivatel.role === 'admin';
  if (!ukol.role_filtr) return true;
  return ukol.role_filtr
    .split(',')
    .map((r) => r.trim())
    .includes(uzivatel.role);
}

export function souhrnUkolu(ukoly) {
  const pocty = { funguje: 0, nefunguje: 0, nerozumim: 0, k_pretestovani: 0, neotestovano: 0 };
  for (const u of ukoly) pocty[u.stav] = (pocty[u.stav] ?? 0) + 1;
  return { celkem: ukoly.length, ...pocty };
}

/**
 * Kdo verzi testuje. Výchozí (bez výslovného přiřazení) jsou všichni aktivní
 * lidé s právem na akceptaci - aby modul fungoval hned, než někdo začne
 * přiřazovat ručně.
 */
export async function testeriVerze(verzeId) {
  const [prirazeni] = await pool.query(
    `SELECT u.id, u.jmeno, u.email, u.role
       FROM akceptace_testeri t
       JOIN uzivatele u ON u.id = t.uzivatel_id
      WHERE t.verze_id = ? AND u.aktivni = 1 AND u.smazano_at IS NULL
      ORDER BY u.jmeno`,
    [verzeId]
  );
  if (prirazeni.length) return { testeri: prirazeni, vychozi: false };

  const [vychozi] = await pool.query(
    `SELECT id, jmeno, email, role FROM uzivatele
      WHERE role IN (?) AND aktivni = 1 AND smazano_at IS NULL
      ORDER BY jmeno`,
    [ROLE_TESTERU]
  );
  return { testeri: vychozi, vychozi: true };
}

/**
 * Verze se vším, co je k ní potřeba: úkoly, výsledky po testerech, hlášení
 * a souhrn za každého testera zvlášť.
 */
export async function nactiVerzi(verzeId) {
  const [[verze]] = await pool.query(
    `SELECT v.*, u.jmeno AS schvalil_jmeno, n.jmeno AS nasadil_jmeno
       FROM akceptace_verze v
       LEFT JOIN uzivatele u ON u.id = v.schvalil_id
       LEFT JOIN uzivatele n ON n.id = v.nasadil_id
      WHERE v.id = ?`,
    [verzeId]
  );
  if (!verze) return null;

  const [ukoly] = await pool.query(
    `SELECT id, kod, nazev, postup, ocekavany_vysledek, odkaz, oblast,
            role_filtr, jen_admin, poradi, aktivni, zmeneno_at
       FROM akceptace_ukoly WHERE verze_id = ? ORDER BY aktivni DESC, poradi, id`,
    [verzeId]
  );

  const [vysledky] = await pool.query(
    `SELECT r.id, r.ukol_id, r.uzivatel_id, r.stav, r.komentar, r.predchozi_stav,
            r.zarizeni, r.created_at, r.updated_at,
            u.jmeno AS kdo, u.role AS role_kdo
       FROM akceptace_vysledky r
       JOIN uzivatele u ON u.id = r.uzivatel_id
      WHERE r.ukol_id IN (SELECT id FROM akceptace_ukoly WHERE verze_id = ?)
      ORDER BY r.updated_at DESC`,
    [verzeId]
  );

  // Přílohy jedním dotazem, ne dotazem na výsledek.
  const [prilohy] = await pool.query(
    `SELECT p.id, p.vysledek_id, p.nazev, p.mime, p.velikost
       FROM akceptace_prilohy p
      WHERE p.vysledek_id IN (
        SELECT r.id FROM akceptace_vysledky r
         WHERE r.ukol_id IN (SELECT id FROM akceptace_ukoly WHERE verze_id = ?))
      ORDER BY p.id`,
    [verzeId]
  );
  const prilohyPodleVysledku = new Map();
  for (const p of prilohy) {
    if (!prilohyPodleVysledku.has(p.vysledek_id)) prilohyPodleVysledku.set(p.vysledek_id, []);
    prilohyPodleVysledku.get(p.vysledek_id).push(p);
  }

  const podleUkolu = new Map();
  for (const v of vysledky) {
    if (!podleUkolu.has(v.ukol_id)) podleUkolu.set(v.ukol_id, []);
    podleUkolu.get(v.ukol_id).push({ ...v, prilohy: prilohyPodleVysledku.get(v.id) ?? [] });
  }

  const sUkoly = ukoly.map((u) => {
    const moje = podleUkolu.get(u.id) ?? [];
    return {
      ...u,
      aktivni: Boolean(u.aktivni),
      jen_admin: Boolean(u.jen_admin),
      vysledky: moje,
      stav: stavUkolu(moje),
    };
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

  const { testeri, vychozi } = await testeriVerze(verzeId);
  const aktivniUkoly = sUkoly.filter((u) => u.aktivni);

  // Lidé, kteří verzi testovali, ale nejsou mezi přiřazenými testery.
  //
  // Stávalo se to a bylo to zrádné: patnáct úkolů otestoval člověk, který
  // k verzi nebyl přiřazený, a v přehledu „kdo kolik otestoval" po něm
  // nezůstala ani stopa - stálo tam 0/19, jako by netestoval nikdo.
  // Výsledky se přitom do souhrnu úkolů počítaly. Schválení ale brzdit
  // nemůžou: kdo není přiřazený, nemá co dokončovat.
  const idTesteru = new Set(testeri.map((t) => t.id));
  const mimoSeznam = new Map();
  for (const v of vysledky) {
    if (idTesteru.has(v.uzivatel_id) || mimoSeznam.has(v.uzivatel_id)) continue;
    mimoSeznam.set(v.uzivatel_id, { id: v.uzivatel_id, jmeno: v.kdo, role: v.role_kdo });
  }

  return {
    verze,
    ukoly: sUkoly,
    hlaseni,
    testeri,
    testeriVychozi: vychozi,
    // Průběh každého testera zvlášť - podle tohohle se verze schvaluje.
    poTesterech: testeri.map((t) => souhrnTestera(aktivniUkoly, t)),
    // Totéž za ty, kdo testovali bez přiřazení. Do schvalování nevstupují,
    // ale musí být vidět - jinak se jejich práce ztratí.
    mimoTestery: [...mimoSeznam.values()].map((t) => ({
      ...souhrnTestera(aktivniUkoly, t),
      mimo_seznam: true,
    })),
    souhrn: {
      ...souhrnUkolu(aktivniUkoly),
      hlaseni_celkem: hlaseni.length,
      hlaseni_otevrena: hlaseni.filter((h) => OTEVRENA_HLASENI.includes(h.stav)).length,
    },
  };
}

// Kolik má konkrétní tester hotovo ze svých úkolů (12/24) a co mu zbývá.
export function souhrnTestera(ukoly, tester) {
  const moje = ukoly.filter((u) => ukolPatriUzivateli(u, tester));
  const stavy = moje.map((u) => ({
    ukol: u,
    stav: u.vysledky.find((v) => v.uzivatel_id === tester.id)?.stav ?? 'neotestovano',
  }));

  const pocet = (stav) => stavy.filter((s) => s.stav === stav).length;
  return {
    uzivatel: { id: tester.id, jmeno: tester.jmeno, role: tester.role },
    celkem: moje.length,
    // "Hotovo" = otestováno a v pořádku; k přetestování se počítá jako nehotové.
    hotovo: pocet('funguje'),
    funguje: pocet('funguje'),
    nefunguje: pocet('nefunguje'),
    nerozumim: pocet('nerozumim'),
    k_pretestovani: pocet('k_pretestovani'),
    neotestovano: pocet('neotestovano'),
  };
}

// Proč verze (ne)jde schválit. Říká konkrétně kdo a co, ne "podmínky nesplněny".
export function duvodyProtiSchvaleni({ verze, ukoly, souhrn, poTesterech }) {
  const duvody = [];
  if (verze.stav === 'schvalena') duvody.push('Verze už je schválená.');
  if (ukoly.filter((u) => u.aktivni).length === 0) duvody.push('Verze nemá žádné úkoly.');
  if (!poTesterech || poTesterech.length === 0) {
    duvody.push('K verzi není přiřazený nikdo, kdo by ji testoval.');
  }

  for (const t of poTesterech ?? []) {
    const chybi = [];
    if (t.neotestovano > 0) chybi.push(`${t.neotestovano} ${sklonUkoly(t.neotestovano, 'neotestovaný', 'neotestované', 'neotestovaných')}`);
    if (t.k_pretestovani > 0) chybi.push(`${t.k_pretestovani} k přetestování`);
    if (t.nefunguje > 0) chybi.push(`${t.nefunguje} ${sklonUkoly(t.nefunguje, 'nefunguje', 'nefungují', 'nefunguje')}`);
    if (t.nerozumim > 0) chybi.push(`${t.nerozumim} s nejasným zadáním`);
    if (chybi.length) duvody.push(`${t.uzivatel.jmeno}: ${chybi.join(', ')}.`);
  }

  if (souhrn.hlaseni_otevrena > 0) duvody.push(`Nevyřešená hlášení: ${souhrn.hlaseni_otevrena}.`);
  return duvody;
}

function sklonUkoly(pocet, jeden, dva, vic) {
  if (pocet === 1) return `úkol ${jeden}`;
  if (pocet >= 2 && pocet <= 4) return `úkoly ${dva}`;
  return `úkolů ${vic}`;
}

// ------------------------------------------------- počty pro menu a přehled

// Kolik úkolů čeká na TOHOTO člověka: jen ty, které mu patří, ve verzích,
// které testuje, a jen ty, kde nemá vlastní výsledek (nebo je k přetestování).
export async function pocetKOtestovani(uzivatel) {
  if (!uzivatel) return 0;
  const [[radek]] = await pool.query(
    `SELECT COUNT(*) AS pocet
       FROM akceptace_ukoly u
       JOIN akceptace_verze v ON v.id = u.verze_id
       LEFT JOIN akceptace_vysledky r ON r.ukol_id = u.id AND r.uzivatel_id = ?
      WHERE u.aktivni = 1 AND v.stav = 'otevrena'
        AND (r.id IS NULL OR r.stav = 'k_pretestovani')
        AND (u.jen_admin = 0 OR ? = 'admin')
        AND (u.role_filtr IS NULL OR u.role_filtr = '' OR FIND_IN_SET(?, u.role_filtr))
        AND (
          NOT EXISTS (SELECT 1 FROM akceptace_testeri t WHERE t.verze_id = v.id)
          OR EXISTS (SELECT 1 FROM akceptace_testeri t
                      WHERE t.verze_id = v.id AND t.uzivatel_id = ?)
        )`,
    [uzivatel.id, uzivatel.role, uzivatel.role, uzivatel.id]
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

export async function poctyProOdznak(uzivatel) {
  const [kOtestovani, hlaseni] = await Promise.all([
    pocetKOtestovani(uzivatel),
    pocetOtevrenychHlaseni(),
  ]);
  return { k_otestovani: kOtestovani, hlaseni_otevrena: hlaseni };
}

/**
 * Karta na přehled: nejbližší otevřená verze a jak daleko je testování
 * přihlášeného člověka. Čísla jsou jeho, ne týmová.
 */
export async function kartaNaPrehled(uzivatel) {
  const [[verze]] = await pool.query(
    `SELECT id, kod, nazev, oznameno_at FROM akceptace_verze
      WHERE stav = 'otevrena' AND EXISTS (
        SELECT 1 FROM akceptace_ukoly u WHERE u.verze_id = akceptace_verze.id AND u.aktivni = 1
      )
      ORDER BY poradi, id LIMIT 1`
  );
  if (!verze) return null;

  const data = await nactiVerzi(verze.id);
  const moje =
    data.poTesterech.find((t) => t.uzivatel.id === uzivatel.id) ??
    souhrnTestera(data.ukoly.filter((u) => u.aktivni), uzivatel);

  return {
    kod: verze.kod,
    nazev: verze.nazev,
    oznameno: Boolean(verze.oznameno_at),
    moje_hotovo: moje.hotovo,
    moje_celkem: moje.celkem,
    souhrn: data.souhrn,
    po_testerech: data.poTesterech,
  };
}

// ------------------------------------------------------------------- export

/**
 * Souhrn verze jako Markdown - k uložení do docs/akceptace/ vedle zadání.
 * Je to zápis o akceptaci: kdo co testoval, kdy a kdo verzi schválil.
 */
export async function exportMarkdown(verzeId) {
  const data = await nactiVerzi(verzeId);
  if (!data) return null;
  const { verze, ukoly, hlaseni, souhrn, testeri, poTesterech, mimoTestery } = data;

  const radky = [];
  radky.push(`# Akceptace: ${verze.nazev}`, '');
  radky.push(`- Kód verze: \`${verze.kod}\``);
  // Stav se vypisuje ze seznamu, ne přes "schvalena ? : otevřená" - při
  // přidání stavu v_produkci by se jinak nasazená verze tvářila jako otevřená.
  radky.push(
    `- Stav: ${POPIS_STAVU_VERZE[verze.stav] ?? verze.stav}` +
      (verze.schvaleno_at
        ? ` (schváleno ${datumCas(verze.schvaleno_at)}, ${verze.schvalil_jmeno ?? '—'})`
        : '')
  );
  if (verze.stav === 'v_produkci') {
    radky.push(
      `- Nasazeno: ${verze.nasazeno_at ? datumCas(verze.nasazeno_at) : '—'}` +
        (verze.nasadil_jmeno ? `, zapsal/a ${verze.nasadil_jmeno}` : '') +
        (verze.nasazeni_odkaz ? ` — ${verze.nasazeni_odkaz}` : '')
    );
  }
  if (verze.schvaleni_poznamka) radky.push(`- Poznámka ke schválení: ${verze.schvaleni_poznamka}`);
  radky.push(`- Úkolů: ${souhrn.celkem}`);
  radky.push(`- Hlášení: ${souhrn.hlaseni_celkem} (nevyřešená ${souhrn.hlaseni_otevrena})`);
  radky.push(`- Vygenerováno: ${datumCas(new Date())}`, '');

  radky.push('## Kdo kolik otestoval', '');
  for (const t of poTesterech) {
    radky.push(
      `- **${t.uzivatel.jmeno}** (${t.uzivatel.role}): ${t.hotovo}/${t.celkem}` +
        (t.nefunguje ? `, nefunguje ${t.nefunguje}` : '') +
        (t.nerozumim ? `, nejasné zadání ${t.nerozumim}` : '') +
        (t.k_pretestovani ? `, k přetestování ${t.k_pretestovani}` : '') +
        (t.neotestovano ? `, neotestováno ${t.neotestovano}` : '')
    );
  }
  for (const t of mimoTestery ?? []) {
    radky.push(
      `- **${t.uzivatel.jmeno}** (${t.uzivatel.role}): ${t.hotovo}/${t.celkem}` +
        (t.nefunguje ? `, nefunguje ${t.nefunguje}` : '') +
        (t.nerozumim ? `, nejasné zadání ${t.nerozumim}` : '') +
        ' _(testoval bez přiřazení — schválení nebrzdí)_'
    );
  }
  radky.push('');

  // Tabulka úkoly × testeři - na jeden pohled, kde je díra.
  radky.push('## Přehled úkoly × testeři', '');
  // Do tabulky patří i ti, kdo testovali bez přiřazení - jinak by sloupec
  // s jejich prací chyběl a tabulka by tvrdila, že se netestovalo.
  const sloupce = [
    ...testeri,
    ...(mimoTestery ?? []).map((t) => ({ ...t.uzivatel, mimoSeznam: true })),
  ];
  radky.push(
    `| Úkol | ${sloupce.map((t) => t.jmeno + (t.mimoSeznam ? ' *' : '')).join(' | ')} |`
  );
  radky.push(`| --- | ${sloupce.map(() => '---').join(' | ')} |`);
  for (const u of ukoly.filter((x) => x.aktivni)) {
    const bunky = sloupce.map((t) => {
      if (!ukolPatriUzivateli(u, t)) return '–';
      const vysledek = u.vysledky.find((v) => v.uzivatel_id === t.id);
      return ZNACKA_STAVU[vysledek?.stav ?? 'neotestovano'];
    });
    radky.push(`| ${u.nazev} | ${bunky.join(' | ')} |`);
  }
  if ((mimoTestery ?? []).length) {
    radky.push('', '\\* testoval bez přiřazení k verzi');
  }
  radky.push('', '(✓ funguje · ✕ nefunguje · ? nejasné zadání · ↻ k přetestování · · neotestováno · – netýká se)', '');

  radky.push('## Úkoly', '');
  for (const u of ukoly) {
    radky.push(
      `### ${u.nazev}` + (u.aktivni ? '' : ' _(vyřazeno ze zadání)_'),
      '',
      `- Kód: \`${u.kod}\``,
      `- Souhrnný výsledek: **${POPIS_STAVU[u.stav]}**` +
        (u.jen_admin ? ' _(jen pro admina)_' : u.role_filtr ? ` _(role: ${u.role_filtr})_` : '')
    );
    if (u.vysledky.length === 0) {
      radky.push('- Zatím nikdo netestoval.');
    } else {
      for (const v of u.vysledky) {
        radky.push(
          `- ${v.kdo}: ${POPIS_STAVU[v.stav]} (${datumCas(v.updated_at)})` +
            (v.komentar ? ` — ${jednaRadka(v.komentar)}` : '') +
            (v.prilohy.length ? ` [příloh: ${v.prilohy.length}]` : '')
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

export const POPIS_STAVU_VERZE = {
  otevrena: 'otevřená',
  schvalena: 'schválená',
  v_produkci: 'v produkci',
};

export const POPIS_HLASENI = {
  nove: 'nové',
  resi_se: 'řeší se',
  vyreseno: 'vyřešeno',
  zamitnuto: 'zamítnuto',
};

function jednaRadka(text) {
  return String(text ?? '').replace(/\s*\n\s*/g, ' ').trim();
}
