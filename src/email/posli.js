// src/email/posli.js
//
// Jediná cesta, kterou e-mail opouští aplikaci.
//
// Klíčová pojistka: v režimu 'test' se příjemce přepíše na EMAIL_TEST_PRIJEMCE
// JEŠTĚ PŘED voláním Resendu. Do logu se uloží obojí - komu e-mail patří
// (`prijemce`) i kam doopravdy šel (`prijemce_skutecny`). Na testovacím
// prostředí tedy nemůže dojít e-mail skutečnému zákazníkovi, i kdyby se v kódu
// spletl kdokoli.
//
// Režim 'vypnuto' je výchozí: e-mail nikam neodejde a v logu zůstane se stavem
// 'chyba' a důvodem. Tělo se ukládá i tak - záznam do `emaily` (včetně
// `telo_snapshot`, `telo_text` a příloh) vzniká PŘED rozhodnutím, jestli se
// odesílá, takže se v administraci dá otevřít a přečíst, co by bylo odešlo.
// Tlačítko "odeslat znovu" ale neexistuje: co se v tomhle režimu nepošle,
// musí člověk vyřídit sám.
//
// Režim 'schranka' (testovací prostředí, kde není Resend) taky nic neodešle,
// ale e-mail skončí ve stavu 've_schrance', tedy v testovací schránce
// v administraci, kde se dá otevřít jako v poštovním klientovi.

import { Resend } from 'resend';
import config from '../config.js';
import pool from '../db.js';
import { ulozPrilohuEmailu } from './prilohy.js';

let resend = null;
function klient() {
  if (!config.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(config.RESEND_API_KEY);
  return resend;
}

// Kam e-mail doopravdy poslat. Nikdy nevrací adresu zákazníka mimo režim live.
function skutecnyPrijemce(prijemce) {
  if (config.EMAIL_REZIM === 'live') return prijemce;
  if (config.EMAIL_REZIM === 'test') return config.EMAIL_TEST_PRIJEMCE;
  return null; // vypnuto i schranka - ven nejde nic
}

/**
 * Odešle e-mail a zapíše ho do logu.
 *
 * @param {object} p
 * @param {string} p.prijemce      komu e-mail patří (skutečný adresát)
 * @param {string} p.predmet
 * @param {string} p.telo          HTML
 * @param {string} [p.textovaVerze]
 * @param {string} [p.sablona]     klíč šablony do logu
 * @param {object} [p.vazby]       { rezervaceId, zakaznikId, terminId, poptavkaId, uzivatelId }
 * @param {Array}  [p.prilohy]     [{ filename, content }]
 * @returns {Promise<{id:number, odeslano:boolean, prijemceSkutecny:string|null}>}
 */
export async function posliEmail({
  prijemce,
  predmet,
  telo,
  textovaVerze = null,
  sablona = null,
  vazby = {},
  prilohy = [],
}) {
  const kam = skutecnyPrijemce(prijemce);
  const rezim = config.EMAIL_REZIM;
  const doSchranky = rezim === 'schranka';

  // Předmět v testu označíme, aby nebylo pochyb, odkud e-mail přišel.
  const predmetKOdeslani = rezim === 'test' ? `[TEST] ${predmet}` : predmet;

  const [vysledekVlozeni] = await pool.query(
    `INSERT INTO emaily
       (sablona_klic, prijemce, prijemce_skutecny, predmet, telo_snapshot, telo_text,
        rezervace_id, zakaznik_id, termin_id, poptavka_id, uzivatel_id, stav, rezim)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sablona,
      prijemce,
      kam,
      predmetKOdeslani,
      telo,
      textovaVerze,
      vazby.rezervaceId ?? null,
      vazby.zakaznikId ?? null,
      vazby.terminId ?? null,
      vazby.poptavkaId ?? null,
      vazby.uzivatelId ?? null,
      doSchranky ? 've_schrance' : 've_fronte',
      rezim,
    ]
  );
  const id = vysledekVlozeni.insertId;

  // Přílohy se ukládají vždy - ve schránce si je má být možné stáhnout,
  // v produkci slouží jako doklad o tom, co přesně zákazník dostal.
  for (const priloha of prilohy) {
    await ulozPrilohuEmailu(id, priloha).catch((err) =>
      console.error(`[email] přílohu se nepodařilo uložit (log #${id}):`, err.message)
    );
  }

  if (doSchranky) {
    console.log(`[email] schránka - uložen "${predmet}" pro ${prijemce} (schránka #${id})`);
    return { id, odeslano: false, doSchranky: true, prijemceSkutecny: null };
  }

  if (!kam) {
    await pool.query(
      `UPDATE emaily SET stav = 'chyba', chyba = ?, stav_at = NOW() WHERE id = ?`,
      ['Odesílání e-mailů je vypnuté (EMAIL_REZIM=vypnuto).', id]
    );
    console.log(`[email] vypnuto - neodeslán "${predmet}" pro ${prijemce} (log #${id})`);
    return { id, odeslano: false, doSchranky: false, prijemceSkutecny: null };
  }

  const api = klient();
  if (!api) {
    await pool.query(
      `UPDATE emaily SET stav = 'chyba', chyba = ?, stav_at = NOW() WHERE id = ?`,
      ['Chybí RESEND_API_KEY.', id]
    );
    console.error(`[email] chybí RESEND_API_KEY - neodeslán "${predmet}" (log #${id})`);
    return { id, odeslano: false, doSchranky: false, prijemceSkutecny: kam };
  }

  try {
    const { data, error } = await api.emails.send({
      from: config.EMAIL_ODESILATEL,
      to: [kam],
      subject: predmetKOdeslani,
      html: telo,
      ...(textovaVerze ? { text: textovaVerze } : {}),
      ...(prilohy.length ? { attachments: prilohy } : {}),
    });

    if (error) throw new Error(error.message ?? String(error));

    await pool.query(
      `UPDATE emaily SET resend_id = ?, stav = 'odeslano', odeslano_at = NOW(), stav_at = NOW()
        WHERE id = ?`,
      [data?.id ?? null, id]
    );
    return { id, odeslano: true, doSchranky: false, prijemceSkutecny: kam };
  } catch (err) {
    await pool.query(
      `UPDATE emaily SET stav = 'chyba', chyba = ?, stav_at = NOW() WHERE id = ?`,
      [String(err.message ?? err).slice(0, 2000), id]
    );
    console.error(`[email] odeslání selhalo (log #${id}):`, err.message);
    return { id, odeslano: false, doSchranky: false, prijemceSkutecny: kam };
  }
}

// Export pro testy: ověřuje se, že v testovacím režimu nikdy nevznikne
// adresa zákazníka.
export const _skutecnyPrijemce = skutecnyPrijemce;
