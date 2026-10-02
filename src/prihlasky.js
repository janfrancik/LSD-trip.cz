// src/prihlasky.js
//
// Přihlášky na termín kurzu. Jedno místo pro veřejný formulář i pro
// zakládání z administrace, aby se kapacita nehlídala dvakrát a pokaždé
// trochu jinak.
//
// Klíčová část je transakce v `zapisPrihlasku`. Dvacet lidí může kliknout
// na "přihlásit" v tutéž vteřinu; bez zámku by se na pět míst dostalo
// dvacet přihlášek a provoz by to řešil telefonem. Autoritativní je součet
// z `rezervace` uvnitř transakce - `terminy.obsazeno_mist` je jen cache
// pro výpisy a přepočítá se v téže transakci (docs/plan-kurzy.md §5).
//
// Osobních údajů se ukládá jen tolik, kolik přihláška potřebuje. Datum
// narození slouží ke dvěma věcem: věkovému limitu kurzu a souhlasu
// zákonného zástupce. Nic jiného se z něj nepočítá.

import crypto from 'node:crypto';
import pool from './db.js';
import config from './config.js';
import { chybaKonflikt, chybaSpatnyVstup } from './chyby.js';
import { hodnota } from './nastaveni.js';
import { isoDatum, datum as formatujDatum } from './cas.js';
import { posliZeSablony } from './email/sablony.js';

// Stavy, které drží místo na termínu. Storno a přesun ho uvolňují.
export const STAVY_DRZICI_MISTO = ['nova', 'potvrzena', 'zaplacena', 'probehla'];

export const STAVY = [
  'nova', 'potvrzena', 'zaplacena', 'probehla', 'storno', 'presunuta', 'no_show',
];

function novyToken() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Věk k danému dni. Počítá se z data narození a dne termínu, ne z dneška -
 * na soupisce má svítit věk, který účastník bude mít na letišti.
 */
export function vek(datumNarozeni, keDni = null) {
  if (!datumNarozeni) return null;
  const narozeni = String(datumNarozeni).slice(0, 10).split('-').map(Number);
  const den = (keDni ? String(keDni).slice(0, 10) : isoDatum(new Date())).split('-').map(Number);
  if (narozeni.length !== 3 || den.length !== 3) return null;

  let let_ = den[0] - narozeni[0];
  if (den[1] < narozeni[1] || (den[1] === narozeni[1] && den[2] < narozeni[2])) let_ -= 1;
  return let_;
}

/**
 * Co na účastníkovi nesedí s požadavky kurzu.
 *
 * Záměrně se tím přihláška neodmítá (rozhodnutí 3): rozhodnutí je na provozu,
 * který účastníka uvidí. Vrácené věty jdou do odpovědi, na soupisku a do
 * administrace, aby to nikdo nepřehlédl.
 */
export function varovaniKUcastnikovi(ucastnik, kurz, denTerminu = null) {
  const varovani = [];
  const roky = vek(ucastnik.datum_narozeni, denTerminu);

  if (roky != null && kurz.min_vek && roky < kurz.min_vek) {
    varovani.push(`věk ${roky} let, kurz je od ${kurz.min_vek}`);
  }
  if (roky != null && kurz.max_vek && roky > kurz.max_vek) {
    varovani.push(`věk ${roky} let, kurz je do ${kurz.max_vek}`);
  }
  if (ucastnik.vaha_kg && kurz.max_vaha_kg && ucastnik.vaha_kg > kurz.max_vaha_kg) {
    varovani.push(`hmotnost ${ucastnik.vaha_kg} kg, limit je ${kurz.max_vaha_kg} kg`);
  }
  if (
    roky != null &&
    kurz.souhlas_zastupce_do_let &&
    roky < kurz.souhlas_zastupce_do_let &&
    !ucastnik.zajisti_souhlas_zastupce
  ) {
    varovani.push(`do ${kurz.souhlas_zastupce_do_let} let je potřeba souhlas zákonného zástupce`);
  }
  return varovani;
}

/**
 * Najde zákazníka podle e-mailu, nebo ho založí.
 *
 * Anonymizovaný zákazník se znovu nepoužije - e-mail už u něj není, takže
 * se nenajde a vznikne nový řádek. To je správně: anonymizace má minulost
 * odstřihnout, ne ji po příští přihlášce zase spojit.
 */
async function najdiNeboZalozZakaznika(spojeni, kontakt) {
  const [rows] = await spojeni.query(
    'SELECT * FROM zakaznici WHERE email = ? AND smazano_at IS NULL LIMIT 1',
    [kontakt.email]
  );

  if (rows[0]) {
    // Novější údaje přepíšou starší, prázdné nepřepíšou nic.
    await spojeni.query(
      `UPDATE zakaznici
          SET jmeno = ?,
              telefon = COALESCE(?, telefon),
              mesto = COALESCE(?, mesto),
              gdpr_souhlas_at = COALESCE(gdpr_souhlas_at, NOW())
        WHERE id = ?`,
      [kontakt.jmeno, kontakt.telefon ?? null, kontakt.mesto ?? null, rows[0].id]
    );
    return rows[0].id;
  }

  const [vysledek] = await spojeni.query(
    `INSERT INTO zakaznici (email, jmeno, telefon, mesto, gdpr_souhlas_at)
     VALUES (?, ?, ?, ?, NOW())`,
    [kontakt.email, kontakt.jmeno, kontakt.telefon ?? null, kontakt.mesto ?? null]
  );
  return vysledek.insertId;
}

/**
 * Zapíše přihlášku. Celé to běží v jedné transakci se zámkem na termínu.
 *
 * @param {object} p
 * @param {number} p.terminId
 * @param {object} p.kontakt      { jmeno, email, telefon, mesto }
 * @param {Array}  p.ucastnici    [{ jmeno, datum_narozeni, vaha_kg, telefon, email,
 *                                   doklada_prohlidku, zajisti_souhlas_zastupce, poznamka }]
 * @param {object} p.souhlasy     { vop: bool, gdpr: bool, zdravi: bool }
 * @param {string} [p.zprava]
 * @param {string} [p.zdroj]      'web' | 'admin' | 'telefon' | 'email'
 * @param {number} [p.uzivatelId] kdo přihlášku zapsal (z administrace)
 */
export async function zapisPrihlasku({
  terminId,
  kontakt,
  ucastnici,
  souhlasy,
  zprava = null,
  zdroj = 'web',
  uzivatelId = null,
}) {
  if (!ucastnici.length) throw chybaSpatnyVstup('Přihláška musí mít aspoň jednoho účastníka.');

  // Texty souhlasů se čtou před transakcí - je to čtení z nastavení,
  // které nemá co držet zámek na termínu.
  const [textVop, textGdpr, textZdravi] = await Promise.all([
    hodnota('souhlasy.vop_text'),
    hodnota('souhlasy.gdpr_text'),
    hodnota('souhlasy.zdravi_text'),
  ]);

  const spojeni = await pool.getConnection();
  try {
    await spojeni.beginTransaction();

    // FOR UPDATE drží termín do konce transakce. Druhá přihláška na totéž
    // místo počká tady, takže uvidí už započítanou tu první.
    const [[termin]] = await spojeni.query(
      `SELECT t.id, t.datum, t.kapacita_mist, t.stav, t.viditelny, t.smazano_at,
              t.cena_hal_prepis, t.produkt_id,
              p.nazev AS produkt_nazev, p.cena_hal, p.cena_na_dotaz,
              p.min_vek, p.max_vek, p.max_vaha_kg, p.souhlas_zastupce_do_let,
              s.procento AS dph_procento
         FROM terminy t
         JOIN produkty p ON p.id = t.produkt_id
         LEFT JOIN dph_sazby s ON s.id = p.dph_sazba_id
        WHERE t.id = ?
        FOR UPDATE`,
      [terminId]
    );

    if (!termin || termin.smazano_at || !termin.viditelny) {
      throw chybaKonflikt('Tenhle termín už není v nabídce. Vyber prosím jiný.');
    }
    if (termin.stav === 'zruseno') {
      throw chybaKonflikt('Termín je zrušený. Vyber prosím jiný.');
    }
    if (termin.stav === 'probehlo' || termin.datum < isoDatum(new Date())) {
      throw chybaKonflikt('Tenhle termín už proběhl. Vyber prosím jiný.');
    }

    // Autoritativní obsazenost: součet z přihlášek, ne cache u termínu.
    const [[{ obsazeno }]] = await spojeni.query(
      `SELECT COALESCE(SUM(pocet_osob), 0) AS obsazeno
         FROM rezervace
        WHERE termin_id = ? AND smazano_at IS NULL AND stav IN (?)`,
      [terminId, STAVY_DRZICI_MISTO]
    );

    const kapacita = Number(termin.kapacita_mist) || 0;
    const volno = kapacita > 0 ? kapacita - Number(obsazeno) : null;
    if (volno !== null && ucastnici.length > volno) {
      // Čekací listina se nevede (rozhodnutí v zadání E5): plný termín
      // přihlášku odmítne a nabídne další termíny téhož kurzu.
      throw chybaKonflikt(
        volno <= 0
          ? 'Tenhle termín je už plný.'
          : `Na termínu ${volno === 1 ? 'zbývá poslední místo' : `zbývají ${volno} místa`}, ` +
            `přihlašuješ ${ucastnici.length} lidí.`,
        { volno: volno < 0 ? 0 : volno, produkt_id: termin.produkt_id }
      );
    }

    const zakaznikId = await najdiNeboZalozZakaznika(spojeni, kontakt);

    const cenaZaOsobu = termin.cena_hal_prepis ?? (termin.cena_na_dotaz ? 0 : termin.cena_hal ?? 0);
    const celkem = cenaZaOsobu * ucastnici.length;
    const ted = new Date();

    const [vysledek] = await spojeni.query(
      `INSERT INTO rezervace
         (kod, verejny_token, zakaznik_id, termin_id, produkt_id, pocet_osob, zdroj,
          cena_hal, k_uhrade_hal,
          souhlas_vop_at, souhlas_vop_text,
          souhlas_gdpr_at, souhlas_gdpr_text,
          souhlas_zdravi_at, souhlas_zdravi_text,
          zprava, vytvoril_id, upravil_id)
       VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        novyToken(), zakaznikId, terminId, termin.produkt_id, ucastnici.length, zdroj,
        celkem, celkem,
        souhlasy.vop ? ted : null, souhlasy.vop ? textVop : null,
        souhlasy.gdpr ? ted : null, souhlasy.gdpr ? textGdpr : null,
        souhlasy.zdravi ? ted : null, souhlasy.zdravi ? textZdravi : null,
        zprava, uzivatelId, uzivatelId,
      ]
    );
    const id = vysledek.insertId;

    // Kód se skládá až z id, aby byl jednoznačný bez dalšího čítače.
    const kod = `LSD-${isoDatum(ted).slice(0, 4)}-${String(id).padStart(4, '0')}`;
    await spojeni.query('UPDATE rezervace SET kod = ? WHERE id = ?', [kod, id]);

    // Cena a název v položce jsou kopie z dneška: po změně ceníku se stará
    // přihláška ani doklad k ní nesmí přepočítat.
    await spojeni.query(
      `INSERT INTO rezervace_polozky
         (rezervace_id, typ, entita_id, nazev_snapshot, mnozstvi, cena_jed_hal, dph_procento, celkem_hal)
       VALUES (?, 'produkt', ?, ?, ?, ?, ?, ?)`,
      [
        id, termin.produkt_id,
        `${termin.produkt_nazev} — ${termin.datum}`,
        ucastnici.length, cenaZaOsobu, termin.dph_procento ?? null, celkem,
      ]
    );

    for (const u of ucastnici) {
      await spojeni.query(
        `INSERT INTO rezervace_ucastnici
           (rezervace_id, jmeno, datum_narozeni, vaha_kg, telefon, email,
            doklada_prohlidku, zajisti_souhlas_zastupce, poznamka)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, u.jmeno, u.datum_narozeni ?? null, u.vaha_kg ?? null,
          u.telefon ?? null, u.email ?? null,
          u.doklada_prohlidku ? 1 : 0, u.zajisti_souhlas_zastupce ? 1 : 0,
          u.poznamka ?? null,
        ]
      );
    }

    await prepocitejObsazenost(spojeni, terminId);
    await spojeni.commit();

    return {
      id,
      kod,
      produkt_id: termin.produkt_id,
      termin_id: terminId,
      zakaznik_id: zakaznikId,
      cena_hal: celkem,
      varovani: ucastnici.flatMap((u) => varovaniKUcastnikovi(u, termin, termin.datum)),
    };
  } catch (chyba) {
    await spojeni.rollback();
    throw chyba;
  } finally {
    spojeni.release();
  }
}

/**
 * Přepočítá cache obsazenosti u termínu a přepne plno/otevřeno.
 *
 * Volá se vždy uvnitř transakce volajícího, aby se cache nemohla rozejít
 * se skutečností.
 */
export async function prepocitejObsazenost(spojeni, terminId) {
  const [[{ obsazeno }]] = await spojeni.query(
    `SELECT COALESCE(SUM(pocet_osob), 0) AS obsazeno
       FROM rezervace
      WHERE termin_id = ? AND smazano_at IS NULL AND stav IN (?)`,
    [terminId, STAVY_DRZICI_MISTO]
  );

  // Zrušený ani proběhlý termín se stavem nehýbe - plno/otevřeno dává smysl
  // jen u termínu, který se nabízí.
  await spojeni.query(
    `UPDATE terminy
        SET obsazeno_mist = ?,
            stav = CASE
              WHEN stav IN ('zruseno','probehlo') THEN stav
              WHEN kapacita_mist > 0 AND ? >= kapacita_mist THEN 'plno'
              ELSE 'otevreno'
            END
      WHERE id = ?`,
    [obsazeno, obsazeno, terminId]
  );
  return Number(obsazeno);
}

// ------------------------------------------------------------- čtení

const VYBER_PRIHLASKY = `
  r.id, r.kod, r.verejny_token, r.stav, r.pocet_osob, r.zdroj,
  r.cena_hal, r.sleva_hal, r.k_uhrade_hal, r.uhrazeno_hal, r.splatnost,
  r.souhlas_vop_at, r.souhlas_vop_text,
  r.souhlas_gdpr_at, r.souhlas_gdpr_text,
  r.souhlas_zdravi_at, r.souhlas_zdravi_text,
  r.zprava, r.interni_poznamka, r.storno_duvod, r.storno_at,
  r.smazano_at, r.created_at, r.updated_at,
  r.zakaznik_id, r.termin_id, r.produkt_id,
  z.jmeno AS zakaznik_jmeno, z.email AS zakaznik_email, z.telefon AS zakaznik_telefon,
  z.mesto AS zakaznik_mesto, z.anonymizovano_at,
  t.datum, t.cas_od, t.cas_do, t.popis_casu, t.stav AS termin_stav,
  t.zruseno_duvod AS termin_zruseno_duvod,
  m.nazev AS misto_nazev,
  p.nazev AS produkt_nazev, p.slug AS produkt_slug,
  p.min_vek, p.max_vek, p.max_vaha_kg, p.souhlas_zastupce_do_let`;

const SPOJENI_PRIHLASKY = `
  FROM rezervace r
  JOIN zakaznici z ON z.id = r.zakaznik_id
  JOIN produkty p ON p.id = r.produkt_id
  LEFT JOIN terminy t ON t.id = r.termin_id
  LEFT JOIN mista m ON m.id = t.misto_id`;

/**
 * Celá přihláška i s účastníky. Používá ji administrace, e-maily i veřejné
 * zobrazení - každý si z toho pak vezme jen to své.
 */
export async function nactiPrihlasku(id) {
  const [rows] = await pool.query(
    `SELECT ${VYBER_PRIHLASKY} ${SPOJENI_PRIHLASKY} WHERE r.id = ?`,
    [id]
  );
  if (!rows[0]) return null;
  return { ...rows[0], ucastnici: await nactiUcastniky(id, rows[0]) };
}

export async function nactiPrihlaskuPodleKodu(kod) {
  const [rows] = await pool.query(
    `SELECT ${VYBER_PRIHLASKY} ${SPOJENI_PRIHLASKY} WHERE r.kod = ? AND r.smazano_at IS NULL`,
    [kod]
  );
  if (!rows[0]) return null;
  return { ...rows[0], ucastnici: await nactiUcastniky(rows[0].id, rows[0]) };
}

async function nactiUcastniky(rezervaceId, prihlaska) {
  const [rows] = await pool.query(
    `SELECT id, jmeno, datum_narozeni, vaha_kg, telefon, email,
            doklada_prohlidku, zajisti_souhlas_zastupce, dorazil, poznamka
       FROM rezervace_ucastnici
      WHERE rezervace_id = ?
      ORDER BY id`,
    [rezervaceId]
  );

  // Věk i varování počítáme ke dni termínu, ne k dnešku - na soupisce má
  // svítit to, co bude platit na letišti.
  return rows.map((u) => ({
    ...u,
    vek: vek(u.datum_narozeni, prihlaska.datum),
    varovani: varovaniKUcastnikovi(u, prihlaska, prihlaska.datum),
  }));
}

// --------------------------------------------------------- oznámení

// Jak se termín píše v e-mailu a na soupisce.
export function popisTerminu(prihlaska) {
  if (!prihlaska.datum) return 'termín domluvíme';
  const cas = prihlaska.popis_casu
    ? prihlaska.popis_casu
    : prihlaska.cas_od
      ? `od ${String(prihlaska.cas_od).slice(0, 5).replace(/^0/, '')}`
      : '';
  return `${formatujDatum(prihlaska.datum)}${cas ? ` ${cas}` : ''}`;
}

function koruny(hal) {
  const kc = String(Math.round((hal ?? 0) / 100));
  return `${kc.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Kč`;
}

/**
 * Pošle e-mail k přihlášce ze šablony.
 *
 * @param {string} klic    klíč šablony (email_sablony.klic)
 * @param {object} prihlaska  výsledek nactiPrihlasku()
 * @param {object} [extra] { duvod, prijemce }
 */
export async function posliOznameni(klic, prihlaska, extra = {}) {
  const data = {
    jmeno: prihlaska.zakaznik_jmeno,
    email: prihlaska.zakaznik_email ?? '',
    telefon: prihlaska.zakaznik_telefon ?? '',
    kurz: prihlaska.produkt_nazev,
    termin: popisTerminu(prihlaska),
    misto: prihlaska.misto_nazev ?? '',
    kod: prihlaska.kod,
    pocet_osob: String(prihlaska.pocet_osob),
    cena: prihlaska.cena_hal ? koruny(prihlaska.cena_hal) : 'domluvíme',
    odkaz: config.url(`/prihlaska/${prihlaska.kod}?t=${prihlaska.verejny_token}`),
    duvod: extra.duvod ?? '',
    ucastnici: (prihlaska.ucastnici ?? [])
      .map((u) => {
        const casti = [u.jmeno];
        if (u.vek != null) casti.push(`${u.vek} let`);
        if (u.vaha_kg) casti.push(`${u.vaha_kg} kg`);
        if (u.varovani?.length) casti.push(`POZOR: ${u.varovani.join('; ')}`);
        return `- ${casti.join(', ')}`;
      })
      .join('\n'),
  };

  return posliZeSablony(klic, {
    prijemce: extra.prijemce ?? prihlaska.zakaznik_email,
    data,
    vazby: {
      rezervaceId: prihlaska.id,
      zakaznikId: prihlaska.zakaznik_id,
      terminId: prihlaska.termin_id,
    },
  });
}
