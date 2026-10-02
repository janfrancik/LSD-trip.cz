// src/web/layout.js
//
// Skořápka stránek vykreslených na serveru (SSR pilot pro /kurzy
// a /kurz/:slug, etapa E4 v docs/plan-kurzy.md).
//
// Hlavička, patička a styly se neduplikují: bere se `public/index.html`,
// tedy přesně ten shell, který vidí jednostránková aplikace, a do něj se
// vloží obsah. Kdyby se shell psal podruhé tady, dřív nebo později by se
// rozešel a stránka kurzu by vypadala jako cizí web.
//
// Relativní adresy v shellu (`assets/...`, `#/tandem`) platí jen na kořeni.
// Na `/kurz/aff` by se `assets/css/style.css` hledalo v `/kurz/`, proto se
// přepisují na absolutní. Dělá se to výčtem, ne přes <base href>: základ
// by zároveň rozbil odkaz na kotvu "Přeskočit na obsah".

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.js';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let shell = null;

async function nactiShell() {
  // V produkci se soubor nemění, tak se čte jednou. Ve vývoji se čte pokaždé,
  // ať se úprava indexu projeví bez restartu.
  if (shell && config.jeProdukce) return shell;
  shell = await readFile(path.join(rootDir, 'public', 'index.html'), 'utf8');
  return shell;
}

export function escHtml(hodnota) {
  return String(hodnota ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Text z administrace na odstavce. Majitelka odděluje odstavce prázdným
// řádkem (tak to říká nápověda u pole), žádné HTML se nevkládá - cokoli
// z databáze jde přes escHtml.
export function odstavce(text, trida = 'prose') {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => `<p class="${trida}">${escHtml(o).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function nahradMeta(html, jmeno, hodnota) {
  const vzor = new RegExp(`(<meta name="${jmeno}" content=")[^"]*(")`);
  return html.replace(vzor, `$1${escHtml(hodnota)}$2`);
}

function nahradOg(html, vlastnost, hodnota) {
  const vzor = new RegExp(`(<meta property="${vlastnost}" content=")[^"]*(")`);
  return html.replace(vzor, `$1${escHtml(hodnota)}$2`);
}

/**
 * Celá stránka k odeslání prohlížeči.
 *
 * @param {object} p
 * @param {string} p.stranka  značka pro klienta (data-stranka) - podle ní
 *                            aplikace pozná, že obsah už je vykreslený a
 *                            nemá ho přepsat
 * @param {string} p.cesta    vlastní cesta stránky, kvůli kanonické adrese
 * @param {string} p.titulek  <title>
 * @param {string} p.popis    meta description i og:description
 * @param {string} [p.obrazek] absolutní adresa obrázku pro náhled při sdílení
 * @param {object} [p.jsonLd] strukturovaná data pro vyhledávače a AI
 * @param {string} p.obsah    HTML do <main>
 */
export async function stranka({ stranka: znacka, cesta, titulek, popis, obrazek, jsonLd, obsah }) {
  let html = await nactiShell();

  // Adresy, které v shellu platí jen na kořeni.
  html = html
    .replace(/(src|href)="assets\//g, '$1="/assets/')
    .replace(/href="#\//g, 'href="/#/');

  html = html.replace('<html lang="cs">', `<html lang="cs" data-stranka="${escHtml(znacka)}">`);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(titulek)}</title>`);
  html = nahradMeta(html, 'description', popis);
  html = nahradOg(html, 'og:title', titulek);
  html = nahradOg(html, 'og:description', popis);
  html = nahradOg(html, 'og:type', 'article');
  if (obrazek) html = nahradOg(html, 'og:image', obrazek);

  // Kanonická adresa se skládá z APP_URL - žádná doména v kódu (CLAUDE.md).
  const kanonicka = config.url(cesta);
  const hlava =
    `<link rel="canonical" href="${escHtml(kanonicka)}" />\n` +
    `<meta property="og:url" content="${escHtml(kanonicka)}" />\n` +
    (jsonLd
      // </ uvnitř JSON by předčasně ukončilo <script>. Jiné escapování
      // JSON-LD nepotřebuje, hodnoty jdou z JSON.stringify.
      ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>\n`
      : '') +
    '<script src="/assets/js/kurz.js" defer></script>\n';
  html = html.replace('</head>', `${hlava}</head>`);

  html = html.replace(
    /<main id="main" class="page">\s*<\/main>/,
    `<main id="main" class="page">${obsah}</main>`
  );
  return html;
}
