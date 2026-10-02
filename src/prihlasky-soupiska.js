// src/prihlasky-soupiska.js
//
// Soupiska termínu: papír, se kterým se jde na letiště.
//
// Jedno místo pro obrazovku, tisk i CSV - kdyby si každá verze tahala data
// po svém, dřív nebo později by se rozešly a provoz by měl v ruce něco
// jiného, než vidí v administraci.
//
// Účastník mimo limit věku nebo váhy se přihlásí (rozhodnutí 3), ale musí
// být vidět. Varování se počítá ke dni termínu, ne k dnešku: na soupisce má
// svítit věk, který účastník bude mít na letišti.

import pool from './db.js';
import { STAVY_DRZICI_MISTO, vek, varovaniKUcastnikovi } from './prihlasky.js';

const POPIS_STAVU = {
  nova: 'nová',
  potvrzena: 'potvrzená',
  zaplacena: 'zaplacená',
  probehla: 'proběhla',
  storno: 'storno',
  presunuta: 'přesunutá',
  no_show: 'nedorazil',
};

export async function nactiSoupisku(terminId) {
  const [[termin]] = await pool.query(
    `SELECT t.id, t.datum, t.cas_od, t.cas_do, t.popis_casu, t.kapacita_mist, t.obsazeno_mist,
            t.stav, t.zruseno_duvod, t.popis,
            m.nazev AS misto_nazev, m.adresa AS misto_adresa,
            p.id AS produkt_id, p.nazev AS produkt_nazev,
            p.min_vek, p.max_vek, p.max_vaha_kg, p.souhlas_zastupce_do_let,
            p.vyzaduje_lekarskou_prohlidku
       FROM terminy t
       JOIN produkty p ON p.id = t.produkt_id
       LEFT JOIN mista m ON m.id = t.misto_id
      WHERE t.id = ? AND t.smazano_at IS NULL`,
    [terminId]
  );
  if (!termin) return null;

  const [instruktori] = await pool.query(
    `SELECT u.jmeno, i.role
       FROM termin_instruktori i
       JOIN uzivatele u ON u.id = i.uzivatel_id
      WHERE i.termin_id = ?
      ORDER BY u.jmeno`,
    [terminId]
  );

  // Stornované přihlášky na soupisku nepatří - ti lidé nepřijedou.
  const [ucastnici] = await pool.query(
    `SELECT u.id, u.jmeno, u.datum_narozeni, u.vaha_kg, u.telefon, u.email,
            u.doklada_prohlidku, u.zajisti_souhlas_zastupce, u.dorazil, u.poznamka,
            r.id AS rezervace_id, r.kod, r.stav, r.uhrazeno_hal, r.k_uhrade_hal,
            z.jmeno AS zakaznik_jmeno, z.telefon AS zakaznik_telefon, z.email AS zakaznik_email
       FROM rezervace_ucastnici u
       JOIN rezervace r ON r.id = u.rezervace_id
       JOIN zakaznici z ON z.id = r.zakaznik_id
      WHERE r.termin_id = ? AND r.smazano_at IS NULL AND r.stav IN (?)
      ORDER BY z.jmeno, u.id`,
    [terminId, STAVY_DRZICI_MISTO]
  );

  const radky = ucastnici.map((u) => ({
    id: u.id,
    rezervace_id: u.rezervace_id,
    kod: u.kod,
    jmeno: u.jmeno,
    vek: vek(u.datum_narozeni, termin.datum),
    vaha_kg: u.vaha_kg,
    // Když účastník nemá vlastní kontakt, platí kontakt na přihlášce -
    // na letišti se volá tomu, kdo to zařizoval.
    telefon: u.telefon ?? u.zakaznik_telefon,
    email: u.email ?? u.zakaznik_email,
    stav: u.stav,
    stav_popis: POPIS_STAVU[u.stav] ?? u.stav,
    zaplaceno: u.stav === 'zaplacena' || (u.k_uhrade_hal > 0 && u.uhrazeno_hal >= u.k_uhrade_hal),
    doklada_prohlidku: Boolean(u.doklada_prohlidku),
    zajisti_souhlas_zastupce: Boolean(u.zajisti_souhlas_zastupce),
    dorazil: Boolean(u.dorazil),
    poznamka: u.poznamka,
    prihlasil: u.zakaznik_jmeno,
    varovani: varovaniKUcastnikovi(
      { ...u, zajisti_souhlas_zastupce: u.zajisti_souhlas_zastupce },
      termin,
      termin.datum
    ),
  }));

  return {
    termin: {
      id: termin.id,
      datum: termin.datum,
      cas_od: termin.cas_od,
      cas_do: termin.cas_do,
      popis_casu: termin.popis_casu,
      stav: termin.stav,
      zruseno_duvod: termin.zruseno_duvod,
      misto: termin.misto_nazev,
      misto_adresa: termin.misto_adresa,
      produkt_nazev: termin.produkt_nazev,
      kapacita_mist: termin.kapacita_mist,
      obsazeno_mist: termin.obsazeno_mist,
      vyzaduje_lekarskou_prohlidku: Boolean(termin.vyzaduje_lekarskou_prohlidku),
      limity: {
        min_vek: termin.min_vek,
        max_vek: termin.max_vek,
        max_vaha_kg: termin.max_vaha_kg,
        souhlas_zastupce_do_let: termin.souhlas_zastupce_do_let,
      },
    },
    instruktori,
    ucastnici: radky,
    pocty: {
      prihlaseno: radky.length,
      zaplaceno: radky.filter((u) => u.zaplaceno).length,
      mimo_limit: radky.filter((u) => u.varovani.length).length,
      volno: termin.kapacita_mist > 0 ? Math.max(0, termin.kapacita_mist - radky.length) : null,
    },
  };
}
