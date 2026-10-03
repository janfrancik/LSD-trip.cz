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

// Šablony, které jsou upozornění pro provoz, ne e-mail zákazníkovi. Jediný
// seznam, podle kterého se to pozná - `posliZeSablony` si příznak nastaví
// sám, takže se na volajících nedá zapomenout. Přidání interního e-mailu je
// tím jeden řádek tady.
export const SABLONY_INTERNI = new Set(['prihlaska_provoz', 'poptavka_provoz']);

export function jeInterni(klic) {
  return SABLONY_INTERNI.has(klic);
}

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

// Řádek, jehož všechny proměnné jsou prázdné, se do e-mailu nedává.
//
// Bez toho chodilo provozu holé „Telefon:" u lidí, kteří telefon nevyplnili.
// Řeší to právě tahle cesta, ne podmínky {{#if}} v šabloně: texty upravuje
// majitelka a psát do nich programátorské konstrukce by po ní nikdo chtít
// neměl. Napíše „Telefon: {{telefon}}" a prázdný řádek zmizí sám.
//
// Když má řádek proměnných víc a aspoň jedna hodnotu má, řádek zůstane -
// jen se zahodí čárka nebo dvojtečka, která by zbyla na konci.
function bezPrazdnychRadku(telo, data) {
  return String(telo ?? '')
    .split('\n')
    .map((radek) => {
      const promenne = [...radek.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
      if (!promenne.length) return radek;

      const maHodnotu = promenne.some((klic) => {
        const hodnota = klic.split('.').reduce((akt, k) => (akt == null ? null : akt[k]), data);
        return String(hodnota ?? '').trim() !== '';
      });
      if (!maHodnotu) return null;

      return vyrenderuj(radek, data, { escapovat: false }).replace(/[\s,;:]+$/, '');
    })
    .filter((radek) => radek !== null)
    .join('\n');
}

/**
 * Vyrenderuje šablonu. Vrací předmět, HTML i textovou verzi.
 */
export async function vyrenderujSablonu(sablona, data = {}) {
  const podpis = await hodnota('emaily.podpis');
  const predmet = vyrenderuj(sablona.predmet, data, { escapovat: false });
  const text = bezPrazdnychRadku(sablona.telo, data);

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
export async function posliZeSablony(klic, { prijemce, data = {}, vazby = {}, odpovedetNa = null }) {
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
    interni: jeInterni(klic),
    odpovedetNa,
  });
}
