// src/web/kurzy.js
//
// Stránky kurzů vykreslené na serveru: /kurzy a /kurz/:slug (SSR pilot,
// etapa E4 v docs/plan-kurzy.md).
//
// Proč zrovna kurzy: je to obsah, který má být k nalezení. Vyhledávače
// dnes JavaScript spustí, ale AI crawlery většinou ne - a kurz za pět tisíc
// si člověk vygooglí dřív, než přijde na letiště. Zbytek webu zůstává
// jednostránkovou aplikací na # adresách; tyhle dvě stránky mají normální
// adresu, obsah v HTML a strukturovaná data.
//
// Žádná doména natvrdo: obrázky jdou přes /media/<kod>, absolutní adresy
// (kanonická, JSON-LD) skládá config.url() z APP_URL.

import express from 'express';
import { asyncHandler } from '../chyby.js';
import { nactiVerejneKurzy, nactiVerejnyKurz } from '../kurzy.js';
import { nactiPrihlaskuPodleKodu } from '../prihlasky.js';
import { hodnota } from '../nastaveni.js';
import { popisTerminu } from '../prihlasky.js';
import config from '../config.js';
import { datum as formatujDatum } from '../cas.js';
import { stranka, escHtml, odstavce } from './layout.js';

const router = express.Router();

const DNY = ['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle'];

function denVTydnu(iso) {
  const den = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).getUTCDay();
  return DNY[den === 0 ? 6 : den - 1];
}

// Čas na letišti se nikam nepřevádí - "08:00:00" je 8:00 (viz migraci 011).
function hodiny(cas) {
  if (!cas) return '';
  const [h, m] = String(cas).split(':');
  return `${Number(h)}:${m}`;
}

function casTerminu(t) {
  if (t.popis_casu) return t.popis_casu;
  if (!t.cas_od) return '';
  return t.cas_do ? `${hodiny(t.cas_od)}–${hodiny(t.cas_do)}` : `od ${hodiny(t.cas_od)}`;
}

// Peníze jsou v haléřích (INT). Oddělovač tisíců se skládá ručně, ne přes
// toLocaleString: v projektu platí, že formátování podle národního prostředí
// má jedno místo (src/cas.js u času), a cena se navíc nesmí zalomit na konci
// řádku - proto pevná mezera.
function koruny(hal) {
  const kc = String(Math.round(hal / 100));
  return `${kc.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Kč`;
}

function cenaPopis(kurz) {
  return kurz.cena_na_dotaz || kurz.cena_hal == null ? 'Cena na dotaz' : koruny(kurz.cena_hal);
}

// --------------------------------------------------------------- přehled

function kartaKurzu(kurz) {
  const obrazek = kurz.foto
    ? `<div class="card__media card__media--3-2" style="background-image:url(${escHtml(kurz.foto.url)})"` +
      ` role="img" aria-label="${escHtml(kurz.foto.alt || kurz.nazev)}"></div>`
    // Kurz bez fotky nemá nechat díru v mřížce - plocha zůstane, jen prázdná.
    : '<div class="card__media card__media--3-2 card__media--prazdna"></div>';

  const meta = [kurz.delka_text, kurz.uroven_text].filter(Boolean);
  const termin = kurz.nejblizsi_termin;

  return `<a class="card card--link" href="/kurz/${escHtml(kurz.slug)}">
      ${obrazek}
      <div class="card__body">
        ${kurz.stitek ? `<div class="card__kicker">${escHtml(kurz.stitek)}</div>` : ''}
        <h2 class="card__title">${escHtml(kurz.nazev)}</h2>
        ${kurz.perex ? `<p class="card__text">${escHtml(kurz.perex)}</p>` : ''}
        ${meta.length ? `<div class="card__meta">${meta.map((m) => `<span>${escHtml(m)}</span>`).join('')}</div>` : ''}
        <div class="card__foot card__foot--plain">
          <span class="card__price card__price--lg">${escHtml(cenaPopis(kurz))}</span>
          <span class="card__cta">Detail →</span>
        </div>
        <div class="card__termin">${
          termin
            ? `Nejbližší termín ${escHtml(formatujDatum(termin.datum))}` +
              (termin.volno ? ` · volno ${termin.volno}` : termin.plno ? ' · plno' : '')
            : 'Termín domluvíme podle tebe'
        }</div>
      </div>
    </a>`;
}

// GET /kurzy
router.get(
  '/kurzy',
  asyncHandler(async (req, res) => {
    const kurzy = await nactiVerejneKurzy();
    // Nadpis a úvodní text spravuje majitelka v nastavení, ne programátor.
    const [nadpis, uvod] = await Promise.all([
      hodnota('web.kurzy_nadpis'),
      hodnota('web.kurzy_uvod'),
    ]);

    const obsah = `
      <div class="container section--first">
        <p class="eyebrow">Vlastní licence</p>
        <h1 class="display">${escHtml(nadpis)}</h1>
        ${uvod ? `<p class="lead" style="margin-bottom:44px">${escHtml(uvod)}</p>` : ''}
        ${
          kurzy.length
            ? `<div class="cards">${kurzy.map(kartaKurzu).join('')}</div>`
            : `<div class="box" style="text-align:center">
                 <h2 class="subhead" style="margin-bottom:10px">Kurzy právě chystáme</h2>
                 <p class="prose" style="margin-bottom:22px">
                   Napiš nám a ozveme se, jakmile budou vypsané.
                 </p>
                 <a class="btn btn--primary" href="/#/kontakt">Napsat nám</a>
               </div>`
        }
      </div>`;

    res.type('html').send(
      await stranka({
        stranka: 'kurzy',
        cesta: '/kurzy',
        titulek: `${nadpis} — LSD`,
        popis: uvod || nadpis,
        obrazek: kurzy.find((k) => k.foto)?.foto
          ? config.url(kurzy.find((k) => k.foto).foto.url)
          : null,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: nadpis,
          itemListElement: kurzy.map((k, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: k.nazev,
            url: config.url(`/kurz/${k.slug}`),
          })),
        },
        obsah,
      })
    );
  })
);

// Stránka pro kurz, který na webu není. Posílá se s kódem 404, ne 200 -
// jinak by si ji vyhledávač zaindexoval jako plnohodnotnou stránku.
async function strankaNenalezeno() {
  return stranka({
    stranka: 'kurz-nenalezen',
    cesta: '/kurzy',
    titulek: 'Kurz nenalezen — LSD',
    popis: 'Takový kurz na webu není.',
    obsah: `
      <div class="container section--first" style="text-align:center">
        <p class="eyebrow">404</p>
        <h1 class="display" style="margin-bottom:18px">Takový kurz tu není</h1>
        <p class="lead" style="margin-bottom:30px">
          Možná se přejmenoval, nebo se zrovna nenabízí. Mrkni na ostatní kurzy.
        </p>
        <a class="btn btn--primary" href="/kurzy">Všechny kurzy</a>
      </div>`,
  });
}

// ---------------------------------------------------------------- detail

function radekTerminu(t) {
  const plno = t.plno;
  const volno = t.volno === null ? 'bez omezení' : plno ? 'obsazeno' : `volno ${t.volno}`;
  return `<div class="termrow${plno ? ' termrow--full' : ''}">
      <span class="termrow__date">${escHtml(formatujDatum(t.datum))}</span>
      <span>
        <span class="termrow__type">${escHtml(denVTydnu(t.datum))}${casTerminu(t) ? ` · ${escHtml(casTerminu(t))}` : ''}</span>
        <span class="termrow__place">${escHtml(t.misto ?? '')}</span>
      </span>
      <span class="termrow__spots">${escHtml(volno)}</span>
      <span class="termrow__cta${plno ? ' termrow__cta--off' : ''}">${
        plno ? 'Obsazeno' : `${escHtml(t.cena_na_dotaz ? 'na dotaz' : koruny(t.cena_hal ?? 0))}`
      }</span>
    </div>`;
}

function pozadavkyVety(p) {
  const vety = [];
  if (p.min_vek && p.max_vek) vety.push(`Věk ${p.min_vek}–${p.max_vek} let.`);
  else if (p.min_vek) vety.push(`Od ${p.min_vek} let.`);
  else if (p.max_vek) vety.push(`Do ${p.max_vek} let.`);
  if (p.max_vaha_kg) vety.push(`Hmotnost do ${p.max_vaha_kg} kg.`);
  if (p.souhlas_zastupce_do_let) {
    vety.push(`Do ${p.souhlas_zastupce_do_let} let písemný souhlas zákonného zástupce.`);
  }
  if (p.lekarska_prohlidka) vety.push('Lékařská prohlídka o způsobilosti.');
  if (p.zdravotni_prohlaseni) vety.push('Zdravotní prohlášení podepsané na místě.');
  return vety;
}

// GET /kurz/:slug
router.get(
  '/kurz/:slug',
  asyncHandler(async (req, res, next) => {
    const kurz = await nactiVerejnyKurz(String(req.params.slug));
    // Nezveřejněný, smazaný ani neexistující kurz se nesmí ukázat ani přes
    // přímou adresu - a odpověď je u všech tří stejná, aby z ní nešlo poznat,
    // že takový kurz existuje a jen není vidět.
    if (!kurz) return res.status(404).type('html').send(await strankaNenalezeno());

    const pozadavky = pozadavkyVety(kurz.pozadavky);
    const volne = kurz.terminy.filter((t) => !t.plno);
    // Texty souhlasů spravuje majitelka v nastavení. Ke každé přihlášce se
    // pak uloží v tom znění, jaké měl člověk před očima.
    const souhlasy = volne.length ? await nactiTextySouhlasu() : null;
    const meta = [kurz.delka_text, kurz.uroven_text].filter(Boolean);

    const obsah = `
      <section class="hero hero--sub">
        ${
          kurz.foto
            ? `<img class="hero__media" src="${escHtml(kurz.foto.url)}"
                 alt="${escHtml(kurz.foto.alt || kurz.nazev)}" fetchpriority="high" />`
            : ''
        }
        <div class="hero__scrim"></div>
        <div class="container hero__content">
          ${kurz.stitek ? `<p class="hero__eyebrow">${escHtml(kurz.stitek)}</p>` : ''}
          <h1 class="hero__title">${escHtml(kurz.nazev)}</h1>
          ${kurz.podtitul ? `<p class="hero__text">${escHtml(kurz.podtitul)}</p>` : ''}
        </div>
      </section>

      <div class="container section--first split">
        <div>
          ${kurz.perex ? `<p class="prose-lg">${escHtml(kurz.perex)}</p>` : ''}
          ${odstavce(kurz.popis)}

          ${
            kurz.co_je_v_cene
              ? `<h2 class="subhead">Co je v ceně</h2>${odstavce(kurz.co_je_v_cene)}`
              : ''
          }

          ${
            kurz.kroky.length
              ? `<h2 class="subhead">Jak kurz probíhá</h2>
                 <div class="steps">${kurz.kroky
                   .map(
                     (k, i) => `<div class="step">
                       <div class="step__n">${escHtml(k.cislo || String(i + 1).padStart(2, '0'))}</div>
                       <div>
                         <div class="step__title">${escHtml(k.nadpis)}</div>
                         ${k.text ? `<div class="step__text">${escHtml(k.text)}</div>` : ''}
                       </div>
                     </div>`
                   )
                   .join('')}</div>`
              : ''
          }

          ${
            pozadavky.length || kurz.checklist.length
              ? `<h2 class="subhead">Co potřebuješ</h2>
                 ${pozadavky.length ? `<p class="prose">${escHtml(pozadavky.join(' '))}</p>` : ''}
                 ${
                   kurz.checklist.length
                     ? `<div class="box" style="margin-top:22px"><div class="checklist">${kurz.checklist
                         .map((i) => `<div>${escHtml(i)}</div>`)
                         .join('')}</div></div>`
                     : ''
                 }`
              : ''
          }

          ${
            kurz.terminy.length
              ? `<h2 class="subhead" id="terminy">Nejbližší termíny</h2>
                 <div class="termlist">${kurz.terminy.slice(0, 8).map(radekTerminu).join('')}</div>
                 <p class="prose" style="margin-top:16px">
                   Místo se drží až po domluvě — napiš nám a termín potvrdíme.
                 </p>`
              : `<h2 class="subhead" id="terminy">Termíny</h2>
                 <p class="prose">Termín zatím vypsaný není. Napiš nám a domluvíme ho podle tebe.</p>`
          }

          ${
            kurz.fotky.length > 1
              ? `<h2 class="subhead">Fotky z kurzu</h2>
                 <div class="gallery">${kurz.fotky
                   .map(
                     (f) => `<div class="gallery__item gallery__item--staticky">
                       <div class="gallery__img" style="background-image:url(${escHtml(f.url)})"
                            role="img" aria-label="${escHtml(f.alt || kurz.nazev)}"></div>
                     </div>`
                   )
                   .join('')}</div>`
              : ''
          }
        </div>

        <aside class="panel panel--sticky">
          <div class="panel__label">Cena a přihlášení</div>
          <div class="variant">
            <div class="variant__row">
              <span class="variant__title">${escHtml(kurz.nazev)}</span>
              <span class="variant__price">${escHtml(cenaPopis(kurz))}</span>
            </div>
            ${meta.length ? `<div class="variant__note">${escHtml(meta.join(' · '))}</div>` : ''}
          </div>
          <div class="variant">
            <div class="variant__row">
              <span class="variant__title">Volná místa</span>
              <span class="variant__price">${
                volne.length ? escHtml(String(volne.reduce((a, t) => a + (t.volno ?? 0), 0) || '—')) : '—'
              }</span>
            </div>
            <div class="variant__note">${
              volne.length
                ? `v ${volne.length} ${volne.length === 1 ? 'termínu' : 'termínech'}`
                : 'zatím bez vypsaného termínu'
            }</div>
          </div>
          <div style="margin-top:22px">
            <a class="btn btn--primary btn--block" href="${volne.length ? '#prihlaska' : '#poptavka'}">${
              volne.length ? 'Přihlásit se' : 'Mám zájem'
            }</a>
          </div>
          <div style="margin-top:10px">
            <a class="btn btn--outline btn--block" href="/kurzy">Všechny kurzy</a>
          </div>
        </aside>
      </div>

      <div class="container" style="padding-bottom:40px">
        ${volne.length ? formularPrihlasky(kurz, volne, souhlasy) : ''}
        <section class="box" id="poptavka"${volne.length ? ' style="margin-top:22px"' : ''}>
          <h2 class="subhead" style="margin-bottom:10px">${
            volne.length ? 'Nebo se jen zeptej' : 'Mám zájem o kurz'
          }</h2>
          <p class="prose" style="margin-bottom:24px">
            Poptávka je nezávazná. Ozveme se ti s volnými místy, potvrzením termínu i cenou.
          </p>
          <form class="poptavka" data-poptavka data-kurz="${escHtml(kurz.nazev)}" novalidate>
            <div class="field-grid">
              <input class="field" type="text" name="jmeno" autocomplete="name"
                     placeholder="Jméno a příjmení" aria-label="Jméno a příjmení" required />
              <input class="field" type="email" name="email" autocomplete="email"
                     placeholder="E-mail" aria-label="E-mail" required />
              <input class="field" type="tel" name="telefon" autocomplete="tel"
                     placeholder="Telefon" aria-label="Telefon" />
              <select class="field" name="termin" aria-label="Termín">
                <option value="">Termín zatím nevím</option>
                ${kurz.terminy
                  .map(
                    (t) =>
                      `<option value="${escHtml(formatujDatum(t.datum))}${t.plno ? ' (obsazeno)' : ''}">${escHtml(
                        formatujDatum(t.datum)
                      )}${t.misto ? ` · ${escHtml(t.misto)}` : ''}${t.plno ? ' — obsazeno' : ''}</option>`
                  )
                  .join('')}
              </select>
            </div>
            <textarea class="field" name="zprava" style="margin-top:14px;min-height:110px"
                      placeholder="Na co se chceš zeptat?" aria-label="Zpráva"></textarea>
            <!-- Past na roboty: člověk pole nevidí, robot ho vyplní. -->
            <input class="past" type="text" name="web" tabindex="-1" autocomplete="off" aria-hidden="true" />
            <div style="margin-top:18px">
              <button class="btn btn--primary" type="submit" data-odeslat>Odeslat poptávku</button>
            </div>
            <p class="poptavka__stav" data-stav role="status"></p>
          </form>
        </section>
      </div>`;

    res.type('html').send(
      await stranka({
        stranka: 'kurz',
        cesta: `/kurz/${kurz.slug}`,
        titulek: kurz.seo_title || `${kurz.nazev} — LSD`,
        popis: kurz.seo_description || kurz.perex || kurz.nazev,
        obrazek: kurz.foto ? config.url(kurz.foto.url) : null,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'Course',
          name: kurz.nazev,
          description: kurz.perex || kurz.seo_description || kurz.nazev,
          url: config.url(`/kurz/${kurz.slug}`),
          provider: { '@type': 'Organization', name: 'Letecká společnost dobrodruhů z.s.' },
          ...(kurz.foto ? { image: config.url(kurz.foto.url) } : {}),
          ...(kurz.cena_hal != null
            ? {
                offers: {
                  '@type': 'Offer',
                  price: (kurz.cena_hal / 100).toFixed(0),
                  priceCurrency: 'CZK',
                  availability: volne.length
                    ? 'https://schema.org/InStock'
                    : 'https://schema.org/PreOrder',
                },
              }
            : {}),
          ...(kurz.terminy.length
            ? {
                hasCourseInstance: kurz.terminy.slice(0, 10).map((t) => ({
                  '@type': 'CourseInstance',
                  courseMode: 'onsite',
                  startDate: t.datum,
                  ...(t.misto
                    ? { location: { '@type': 'Place', name: t.misto } }
                    : {}),
                })),
              }
            : {}),
        },
        obsah,
      })
    );
  })
);

// ------------------------------------------------------------- přihláška

async function nactiTextySouhlasu() {
  const [vop, vopOdkaz, gdpr, zdravi] = await Promise.all([
    hodnota('souhlasy.vop_text'),
    hodnota('souhlasy.vop_odkaz'),
    hodnota('souhlasy.gdpr_text'),
    hodnota('souhlasy.zdravi_text'),
  ]);
  return { vop, vopOdkaz, gdpr, zdravi };
}

function souhlas(klic, text, odkaz) {
  return `<label class="souhlas">
      <input type="checkbox" name="souhlas_${klic}" />
      <span>${escHtml(text)}${
        odkaz ? ` <a href="${escHtml(odkaz)}" target="_blank" rel="noopener">přečíst</a>` : ''
      }</span>
    </label>`;
}

// Řádek účastníka. Zaškrtnutí o prohlídce a souhlasu zástupce se ukazují
// jen tam, kde je kurz vyžaduje - jinak by to byl formulář plný otázek,
// které se daného kurzu netýkají.
function ucastnik(kurz, poradi) {
  const p = kurz.pozadavky;
  return `<fieldset class="ucastnik" data-ucastnik>
      <legend class="ucastnik__legenda">Účastník <span data-cislo>${poradi}</span></legend>
      <div class="field-grid field-grid--tri">
        <input class="field" type="text" data-pole="jmeno" autocomplete="name"
               placeholder="Jméno a příjmení" aria-label="Jméno a příjmení účastníka" />
        <input class="field" type="date" data-pole="datum_narozeni"
               aria-label="Datum narození účastníka" title="Datum narození" />
        <input class="field" type="number" data-pole="vaha_kg" inputmode="numeric" min="20" max="300"
               placeholder="Hmotnost (kg)" aria-label="Hmotnost účastníka v kilogramech" />
      </div>
      <p class="ucastnik__napoveda">
        Datum narození potřebujeme kvůli věkovému limitu${
          p.souhlas_zastupce_do_let ? ' a souhlasu zákonného zástupce' : ''
        }, hmotnost kvůli vybavení. Nic dalšího z nich nepočítáme.
      </p>
      ${p.lekarska_prohlidka
        ? `<label class="souhlas souhlas--maly">
             <input type="checkbox" data-pole="doklada_prohlidku" />
             <span>Lékařskou prohlídku doložím na místě.</span>
           </label>`
        : ''}
      ${p.souhlas_zastupce_do_let
        ? `<label class="souhlas souhlas--maly">
             <input type="checkbox" data-pole="zajisti_souhlas_zastupce" />
             <span>Je mi méně než ${p.souhlas_zastupce_do_let} let — zajistím písemný souhlas zákonného zástupce.</span>
           </label>`
        : ''}
      <div class="ucastnik__akce">
        <button type="button" class="btn btn--outline btn--sm" data-odebrat hidden>Odebrat účastníka</button>
      </div>
    </fieldset>`;
}

function formularPrihlasky(kurz, volne, souhlasy) {
  return `<section class="box" id="prihlaska">
      <h2 class="subhead" style="margin-bottom:10px">Přihláška na kurz</h2>
      <p class="prose" style="margin-bottom:24px">
        Místo ti podržíme a ozveme se s potvrzením. Nic teď neplatíš.
      </p>

      <form class="poptavka" data-prihlaska data-kurz="${escHtml(kurz.nazev)}" novalidate>
        <label class="pole-popisek" for="prihlaska-termin">Termín</label>
        <select class="field" id="prihlaska-termin" name="termin_id" aria-label="Termín">
          ${volne
            .map(
              (t) =>
                `<option value="${t.id}">${escHtml(formatujDatum(t.datum))}${
                  t.misto ? ` · ${escHtml(t.misto)}` : ''
                }${t.volno !== null ? ` — volno ${t.volno}` : ''}</option>`
            )
            .join('')}
        </select>

        <div data-ucastnici>${ucastnik(kurz, 1)}</div>
        <button type="button" class="btn btn--outline btn--sm" data-pridat-ucastnika
                style="margin-bottom:22px">+ Další účastník</button>

        <h3 class="pole-popisek">Kontakt na toho, kdo přihlášku podává</h3>
        <div class="field-grid">
          <input class="field" type="text" name="jmeno" autocomplete="name"
                 placeholder="Jméno a příjmení" aria-label="Vaše jméno a příjmení" required />
          <input class="field" type="email" name="email" autocomplete="email"
                 placeholder="E-mail" aria-label="Váš e-mail" required />
          <input class="field" type="tel" name="telefon" autocomplete="tel"
                 placeholder="Telefon" aria-label="Váš telefon" />
          <input class="field" type="text" name="mesto" autocomplete="address-level2"
                 placeholder="Město" aria-label="Město" />
        </div>
        <textarea class="field" name="zprava" style="margin-top:14px;min-height:90px"
                  placeholder="Poznámka (skupina, dárkový poukaz, cokoliv)" aria-label="Poznámka"></textarea>

        <div class="souhlasy">
          ${souhlas('vop', souhlasy.vop, souhlasy.vopOdkaz)}
          ${souhlas('gdpr', souhlasy.gdpr, null)}
          ${souhlas('zdravi', souhlasy.zdravi, null)}
        </div>

        <!-- Past na roboty: člověk pole nevidí, robot ho vyplní. -->
        <input class="past" type="text" name="web" tabindex="-1" autocomplete="off" aria-hidden="true" />

        <div style="margin-top:20px">
          <button class="btn btn--primary" type="submit" data-odeslat>Odeslat přihlášku</button>
        </div>
        <p class="poptavka__stav" data-stav role="status"></p>
      </form>
    </section>`;
}

// ---------------------------------------------- přihláška pro účastníka

// GET /prihlaska/:kod?t=token
//
// Odkaz z potvrzovacího e-mailu. Bez tokenu 404 - z odpovědi nemá jít
// poznat, jestli takové číslo přihlášky existuje.
router.get(
  '/prihlaska/:kod',
  asyncHandler(async (req, res) => {
    const p = await nactiPrihlaskuPodleKodu(String(req.params.kod));
    if (!p || p.verejny_token !== String(req.query.t ?? '')) {
      return res.status(404).type('html').send(await strankaNenalezeno());
    }

    const radek = (popisek, hodnota) =>
      `<div class="variant"><div class="variant__row">
         <span class="variant__title">${escHtml(popisek)}</span>
         <span class="variant__price">${escHtml(hodnota)}</span>
       </div></div>`;

    const obsah = `
      <div class="container container--narrow section--first">
        <p class="eyebrow">Přihláška ${escHtml(p.kod)}</p>
        <h1 class="display" style="margin-bottom:18px">${escHtml(p.produkt_nazev)}</h1>
        ${p.stav === 'storno'
          ? `<p class="lead">Tahle přihláška je stornovaná.${
              p.storno_duvod ? ` Důvod: ${escHtml(p.storno_duvod)}` : ''
            }</p>`
          : `<p class="lead">${
              p.stav === 'nova'
                ? 'Přihlášku máme. Ozveme se vám s potvrzením.'
                : 'Přihláška je potvrzená. Těšíme se na vás.'
            }</p>`}

        <div class="panel" style="margin-top:28px">
          ${radek('Termín', popisTerminu(p))}
          ${p.misto_nazev ? radek('Místo', p.misto_nazev) : ''}
          ${radek('Počet osob', String(p.pocet_osob))}
          ${radek('Cena', p.cena_hal ? koruny(p.cena_hal) : 'domluvíme')}
          ${radek('Stav', STAV_PRIHLASKY[p.stav] ?? p.stav)}
        </div>

        <h2 class="subhead">Účastníci</h2>
        <div class="termlist">
          ${p.ucastnici
            .map(
              (u) => `<div class="termrow">
                <span class="termrow__date">${escHtml(u.jmeno)}</span>
                <span><span class="termrow__type">${
                  [u.vek != null ? `${u.vek} let` : '', u.vaha_kg ? `${u.vaha_kg} kg` : '']
                    .filter(Boolean).map(escHtml).join(' · ')
                }</span></span>
                <span class="termrow__spots">${
                  u.varovani.length ? escHtml(u.varovani.join('; ')) : ''
                }</span>
                <span class="termrow__cta"></span>
              </div>`
            )
            .join('')}
        </div>

        <p class="prose" style="margin-top:26px">
          Potřebujete něco změnit? Napište nám a uveďte číslo přihlášky ${escHtml(p.kod)}.
        </p>
        <a class="btn btn--outline" href="/kurz/${escHtml(p.produkt_slug)}">Zpátky na kurz</a>
      </div>`;

    res.type('html').send(
      await stranka({
        stranka: 'prihlaska',
        cesta: `/prihlaska/${p.kod}`,
        titulek: `Přihláška ${p.kod} — LSD`,
        popis: 'Stav vaší přihlášky na kurz.',
        obsah,
      })
    );
  })
);

const STAV_PRIHLASKY = {
  nova: 'přijatá, čeká na potvrzení',
  potvrzena: 'potvrzená',
  zaplacena: 'zaplacená',
  probehla: 'proběhla',
  storno: 'stornovaná',
  presunuta: 'přesunutá na jiný termín',
  no_show: 'nedorazil',
};

export default router;
