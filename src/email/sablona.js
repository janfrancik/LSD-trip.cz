// src/email/sablona.js
//
// Minimální šablonovací engine. Plnohodnotné editovatelné šablony přijdou
// ve fázi 3; tady jde jen o to, aby reset hesla vypadal jako od nás a aby
// se proměnné vždycky escapovaly.
//
// Podporuje {{promenna}} a {{#if promenna}}…{{/if}}.

import config from '../config.js';

export function escapujHtml(hodnota) {
  return String(hodnota == null ? '' : hodnota)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {string} sablona
 * @param {object} data
 * @param {object} [moznosti]
 * @param {boolean} [moznosti.escapovat] true (výchozí) pro HTML šablony,
 *        false pro textové - u textové verze e-mailu by `&amp;` byl chybou.
 */
export function vyrenderuj(sablona, data = {}, { escapovat = true } = {}) {
  let vysledek = String(sablona);

  // Podmíněné bloky (bez zanořování - víc teď nepotřebujeme).
  vysledek = vysledek.replace(
    /\{\{#if\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, klic, obsah) => (hodnotaZ(data, klic) ? obsah : '')
  );

  // Proměnné. V HTML se escapuje vždy - HTML smí být jen v samotné šabloně.
  vysledek = vysledek.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, klic) => {
    const hodnota = hodnotaZ(data, klic);
    return escapovat ? escapujHtml(hodnota) : String(hodnota ?? '');
  });

  return vysledek;
}

function hodnotaZ(data, cesta) {
  return cesta.split('.').reduce((akt, k) => (akt == null ? null : akt[k]), data);
}

// Obálka e-mailu v barvách webu. Inline styly, protože e-mailoví klienti
// externí CSS ani <style> spolehlivě nepodporují.
export function obalka({ titulek, obsahHtml, podpis = '' }) {
  return `<!DOCTYPE html>
<html lang="cs">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" />
<title>${escapujHtml(titulek)}</title></head>
<body style="margin:0;padding:0;background:#0B0B0C;color:#F4F3F1;font-family:Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0B0C">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#101012;border:1px solid rgba(255,255,255,.12)">
        <tr><td style="padding:28px 28px 0">
          <div style="font-size:26px;font-weight:700;letter-spacing:.04em;color:#FF3B12">LSD</div>
          <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#9A9895;margin-top:4px">
            Letecká společnost dobrodruhů
          </div>
        </td></tr>
        <tr><td style="padding:24px 28px 8px">
          <h1 style="margin:0 0 14px;font-size:24px;line-height:1.2;color:#F4F3F1">${escapujHtml(titulek)}</h1>
          <div style="font-size:15px;line-height:1.6;color:#DAD8D5">${obsahHtml}</div>
        </td></tr>
        <tr><td style="padding:20px 28px 28px;border-top:1px solid rgba(255,255,255,.08);color:#8B8987;font-size:13px;line-height:1.6">
          ${escapujHtml(podpis)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Tlačítko jako odkaz - v e-mailu musí být vidět i bez obrázků.
export function tlacitko(text, url) {
  return `<a href="${escapujHtml(url)}"
     style="display:inline-block;background:#FF3B12;color:#fff;text-decoration:none;
            padding:13px 22px;font-weight:600;font-size:15px">${escapujHtml(text)}</a>`;
}

export function odkazNaApp(cesta) {
  return config.url(cesta);
}
