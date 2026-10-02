// src/email/sablony.js
//
// E-maily, jejichž text upravuje majitelka v administraci (tabulka
// `email_sablony`, migrace 012).
//
// Šablona je **prostý text** s odstavci a proměnnými {{takhle}}. Žádné HTML:
// obálku, barvy a odstavce doplní aplikace. Majitelka tak nemůže rozbít
// vzhled e-mailu ani do něj omylem vložit kód.
//
// Odeslání jde pořád přes src/email/posli.js, takže platí i tady: v režimu
// `test` se příjemce přepíše na EMAIL_TEST_PRIJEMCE ještě před odesláním
// a zákazníkovi z testovacího prostředí nemůže dojít nic.

import pool from '../db.js';
import { posliEmail } from './posli.js';
import { obalka, vyrenderuj, escapujHtml } from './sablona.js';
import { hodnota } from '../nastaveni.js';

export async function nactiSablonu(klic) {
  const [rows] = await pool.query('SELECT * FROM email_sablony WHERE klic = ? LIMIT 1', [klic]);
  return rows[0] ?? null;
}

export async function seznamSablon() {
  const [rows] = await pool.query(
    `SELECT s.id, s.klic, s.nazev, s.popis, s.predmet, s.telo, s.promenne, s.aktivni,
            s.updated_at, u.jmeno AS upravil_jmeno
       FROM email_sablony s
       LEFT JOIN uzivatele u ON u.id = s.upravil_id
      ORDER BY s.id`
  );
  return rows;
}

// Text na HTML: escapuje se všechno, prázdný řádek dělá odstavec a jednoduchý
// zlom <br>. Odkazy se nechávají jako text - klikací je udělá poštovní klient,
// a kdybychom je skládali sami, byla by to cesta, jak do e-mailu dostat HTML.
function htmlZTextu(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => `<p style="margin:0 0 14px">${escapujHtml(o).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

/**
 * Vyrenderuje šablonu. Vrací předmět, HTML i textovou verzi.
 */
export async function vyrenderujSablonu(sablona, data = {}) {
  const podpis = await hodnota('emaily.podpis');
  const predmet = vyrenderuj(sablona.predmet, data, { escapovat: false });
  const text = vyrenderuj(sablona.telo, data, { escapovat: false });

  return {
    predmet,
    text,
    html: obalka({ titulek: predmet, obsahHtml: htmlZTextu(text), podpis }),
  };
}

/**
 * Pošle e-mail ze šablony.
 *
 * Vrací null, když šablona neexistuje nebo je vypnutá - vypnutí šablony je
 * způsob, jak e-mail dočasně zastavit, aniž by se musel měnit kód.
 *
 * @param {string} klic
 * @param {object} p
 * @param {string} p.prijemce
 * @param {object} p.data   proměnné do šablony
 * @param {object} [p.vazby] { rezervaceId, zakaznikId, terminId, uzivatelId }
 */
export async function posliZeSablony(klic, { prijemce, data = {}, vazby = {} }) {
  if (!prijemce) return null;

  const sablona = await nactiSablonu(klic);
  if (!sablona || !sablona.aktivni) {
    console.warn(`[email] šablona "${klic}" chybí nebo je vypnutá - e-mail neodešel`);
    return null;
  }

  const { predmet, text, html } = await vyrenderujSablonu(sablona, data);
  return posliEmail({
    prijemce,
    predmet,
    telo: html,
    textovaVerze: text,
    sablona: klic,
    vazby,
  });
}
