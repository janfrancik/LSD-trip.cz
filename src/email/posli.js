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
// Režim 'vypnuto' je výchozí: e-mail se jen zaloguje a nikam neodejde.

import { Resend } from 'resend';
import config from '../config.js';
import pool from '../db.js';

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
  return null; // vypnuto
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

  // Předmět v testu označíme, aby nebylo pochyb, odkud e-mail přišel.
  const predmetKOdeslani = rezim === 'test' ? `[TEST] ${predmet}` : predmet;

  const [vysledekVlozeni] = await pool.query(
    `INSERT INTO emaily
       (sablona_klic, prijemce, prijemce_skutecny, predmet, telo_snapshot,
        rezervace_id, zakaznik_id, termin_id, poptavka_id, uzivatel_id, stav, rezim)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 've_fronte', ?)`,
    [
      sablona,
      prijemce,
      kam,
      predmetKOdeslani,
      telo,
      vazby.rezervaceId ?? null,
      vazby.zakaznikId ?? null,
      vazby.terminId ?? null,
      vazby.poptavkaId ?? null,
      vazby.uzivatelId ?? null,
      rezim,
    ]
  );
  const id = vysledekVlozeni.insertId;

  if (!kam) {
    await pool.query(
      `UPDATE emaily SET stav = 'chyba', chyba = ?, stav_at = NOW() WHERE id = ?`,
      ['Odesílání e-mailů je vypnuté (EMAIL_REZIM=vypnuto).', id]
    );
    console.log(`[email] vypnuto - neodeslán "${predmet}" pro ${prijemce} (log #${id})`);
    return { id, odeslano: false, prijemceSkutecny: null };
  }

  const api = klient();
  if (!api) {
    await pool.query(
      `UPDATE emaily SET stav = 'chyba', chyba = ?, stav_at = NOW() WHERE id = ?`,
      ['Chybí RESEND_API_KEY.', id]
    );
    console.error(`[email] chybí RESEND_API_KEY - neodeslán "${predmet}" (log #${id})`);
    return { id, odeslano: false, prijemceSkutecny: kam };
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
    return { id, odeslano: true, prijemceSkutecny: kam };
  } catch (err) {
    await pool.query(
      `UPDATE emaily SET stav = 'chyba', chyba = ?, stav_at = NOW() WHERE id = ?`,
      [String(err.message ?? err).slice(0, 2000), id]
    );
    console.error(`[email] odeslání selhalo (log #${id}):`, err.message);
    return { id, odeslano: false, prijemceSkutecny: kam };
  }
}

// Export pro testy: ověřuje se, že v testovacím režimu nikdy nevznikne
// adresa zákazníka.
export const _skutecnyPrijemce = skutecnyPrijemce;
