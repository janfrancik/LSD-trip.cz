// public/admin/assets/js/admin.js
//
// Administrace: router nad history API, layout a vykreslování obrazovek.
// Bez build kroku - ES moduly načítá prohlížeč nativně.

import { api, ChybaApi } from './api.js';
import { esc, hlaska } from './ui.js';

import * as prihlaseni from './obrazovky/prihlaseni.js';
import * as noveHeslo from './obrazovky/nove-heslo.js';
import * as dashboard from './obrazovky/dashboard.js';
import * as poptavky from './obrazovky/poptavky.js';
import * as uzivatele from './obrazovky/uzivatele.js';
import * as audit from './obrazovky/audit.js';
import * as nastaveni from './obrazovky/nastaveni.js';
import * as ucet from './obrazovky/ucet.js';

const ZAKLAD = '/admin';

// Obrazovky. `oblast` se páruje s oprávněními ze serveru, takže menu ukazuje
// jen to, na co má člověk právo.
const OBRAZOVKY = [
  { cesta: '', nazev: 'Přehled', ikona: '◆', oblast: 'dashboard', modul: dashboard, vMenu: true },
  { cesta: 'poptavky', nazev: 'Poptávky', ikona: '✉', oblast: 'poptavky', modul: poptavky, vMenu: true },
  { cesta: 'uzivatele', nazev: 'Uživatelé', ikona: '☺', oblast: 'uzivatele', modul: uzivatele, vMenu: true },
  { cesta: 'nastaveni', nazev: 'Nastavení', ikona: '⚙', oblast: 'nastaveni', modul: nastaveni, vMenu: true },
  { cesta: 'audit', nazev: 'Audit', ikona: '⧉', oblast: 'audit', modul: audit, vMenu: true },
  { cesta: 'ucet', nazev: 'Můj účet', ikona: '⚿', oblast: null, modul: ucet, vMenu: false },
];

export const stav = {
  ja: null, // { uzivatel, prava, prostredi }
  cesta: '',
  parametr: null,
  pocty: { poptavky: 0 },
};

// --------------------------------------------------------------------- router

export function jdiNa(cesta, nahradit = false) {
  const cil = ZAKLAD + (cesta ? '/' + cesta.replace(/^\/+/, '') : '');
  if (location.pathname === cil) return vykresli();
  if (nahradit) history.replaceState({}, '', cil);
  else history.pushState({}, '', cil);
  vykresli();
}

function precistCestu() {
  const zbytek = location.pathname.replace(new RegExp('^' + ZAKLAD + '/?'), '');
  const casti = zbytek.split('/').filter(Boolean);
  return { cesta: casti[0] ?? '', parametr: casti[1] ?? null };
}

function najdiObrazovku(cesta) {
  return OBRAZOVKY.find((o) => o.cesta === cesta) ?? null;
}

// ---------------------------------------------------------------- vykreslení

const app = () => document.getElementById('app');

export async function vykresli() {
  const { cesta, parametr } = precistCestu();
  stav.cesta = cesta;
  stav.parametr = parametr;

  // Nastavení hesla z e-mailu je dostupné bez přihlášení.
  if (cesta === 'nove-heslo') {
    app().innerHTML = '';
    return noveHeslo.vykresli(app(), parametr);
  }

  if (!stav.ja) {
    app().innerHTML = '';
    return prihlaseni.vykresli(app(), async () => {
      await nactiJa();
      jdiNa('', true);
    });
  }

  const obrazovka = najdiObrazovku(cesta);
  if (!obrazovka) return jdiNa('', true);

  if (obrazovka.oblast && !stav.ja.prava[obrazovka.oblast]) {
    app().innerHTML = layout(
      `<div class="panel"><h1 class="nadpis">Nemáš oprávnění</h1>
       <p class="text-dim" style="margin-top:8px">Tuhle část administrace nemáš povolenou.
       Kdybys ji potřeboval, ozvi se správci.</p></div>`
    );
    navazNavigaci();
    return;
  }

  app().innerHTML = layout('<div class="nacitani">Načítám…</div>');
  navazNavigaci();

  const obsah = document.getElementById('obsah');
  try {
    await obrazovka.modul.vykresli(obsah, { parametr });
  } catch (err) {
    if (err instanceof ChybaApi && err.status === 401) return odhlasenNaServeru();
    obsah.innerHTML = `<div class="panel">
        <h1 class="nadpis">Nepovedlo se načíst</h1>
        <p class="text-dim" style="margin-top:8px">${esc(err.message)}</p>
        <div style="margin-top:16px"><button type="button" class="btn btn--obrys" data-znovu>Zkusit znovu</button></div>
      </div>`;
    obsah.querySelector('[data-znovu]')?.addEventListener('click', () => vykresli());
  }
}

function layout(vnitrek) {
  const { uzivatel, prostredi } = stav.ja;
  const menu = OBRAZOVKY.filter((o) => o.vMenu && (!o.oblast || stav.ja.prava[o.oblast]));
  const aktivni = stav.cesta;

  const odznak =
    prostredi === 'produkce'
      ? ''
      : `<span class="odznak-prostredi odznak-prostredi--${prostredi === 'test' ? 'test' : 'vyvoj'}">${esc(prostredi)}</span>`;

  return `
  <div class="layout">
    <nav class="bocni" aria-label="Hlavní navigace">
      <div class="bocni__znacka">LSD</div>
      <div class="bocni__podznacka">Administrace</div>
      ${menu.map((o) => bocniPolozka(o, aktivni)).join('')}
      <div class="bocni__odsazeni"></div>
      <a class="bocni__polozka${aktivni === 'ucet' ? ' bocni__polozka--aktivni' : ''}"
         href="${ZAKLAD}/ucet" data-odkaz>
        <span aria-hidden="true">⚿</span><span>${esc(uzivatel.jmeno)}</span>
      </a>
      <button type="button" class="bocni__polozka" data-odhlasit>
        <span aria-hidden="true">⏻</span><span>Odhlásit se</span>
      </button>
      ${odznak ? `<div style="padding:12px 11px 0">${odznak}</div>` : ''}
    </nav>

    <div style="flex:1;min-width:0;display:flex;flex-direction:column">
      <header class="hlavicka">
        <span class="hlavicka__znacka">LSD</span>
        <span class="hlavicka__kde">${esc(nazevObrazovky())}</span>
        <div class="hlavicka__akce">
          ${odznak}
          <a class="btn btn--obrys btn--maly" href="${ZAKLAD}/ucet" data-odkaz
             aria-label="Můj účet">⚿</a>
        </div>
      </header>

      <main class="obsah" id="obsah" tabindex="-1">${vnitrek}</main>
    </div>

    <nav class="spodni-lista" aria-label="Hlavní navigace">
      ${menu.slice(0, 5).map((o) => spodniPolozka(o, aktivni)).join('')}
    </nav>
  </div>`;
}

function nazevObrazovky() {
  return najdiObrazovku(stav.cesta)?.nazev ?? 'Administrace';
}

function pocetProOblast(oblast) {
  if (oblast === 'poptavky' && stav.pocty.poptavky > 0) return stav.pocty.poptavky;
  return 0;
}

function bocniPolozka(o, aktivni) {
  const pocet = pocetProOblast(o.oblast);
  return `<a class="bocni__polozka${o.cesta === aktivni ? ' bocni__polozka--aktivni' : ''}"
     href="${ZAKLAD}${o.cesta ? '/' + o.cesta : ''}" data-odkaz>
     <span aria-hidden="true">${o.ikona}</span><span>${esc(o.nazev)}</span>
     ${pocet ? `<span class="bocni__pocet">${pocet}</span>` : ''}
   </a>`;
}

function spodniPolozka(o, aktivni) {
  const pocet = pocetProOblast(o.oblast);
  return `<a class="spodni-lista__polozka${o.cesta === aktivni ? ' spodni-lista__polozka--aktivni' : ''}"
     href="${ZAKLAD}${o.cesta ? '/' + o.cesta : ''}" data-odkaz>
     <span class="spodni-lista__ikona" aria-hidden="true">${o.ikona}</span>
     <span>${esc(o.nazev)}</span>
     ${pocet ? `<span class="spodni-lista__pocet">${pocet}</span>` : ''}
   </a>`;
}

function navazNavigaci() {
  document.querySelector('[data-odhlasit]')?.addEventListener('click', async () => {
    try {
      await api.post('/odhlaseni');
    } catch {
      // I když se odhlášení na serveru nepovede, klienta odhlásíme.
    }
    stav.ja = null;
    jdiNa('', true);
  });
}

function odhlasenNaServeru() {
  stav.ja = null;
  hlaska('Přihlášení vypršelo, přihlas se znovu.', 'chyba');
  jdiNa('', true);
}

// ------------------------------------------------------------------- data

async function nactiJa() {
  stav.ja = await api.get('/ja');
  await nactiPocty();
}

// Počty pro odznaky v menu. Chyba tady nesmí shodit celou administraci.
export async function nactiPocty() {
  if (!stav.ja?.prava?.poptavky) return;
  try {
    const data = await api.get('/poptavky?na_strane=1&stav=nova');
    stav.pocty.poptavky = data.pocty?.nova ?? 0;
  } catch {
    stav.pocty.poptavky = 0;
  }
  obnovOdznaky();
}

// Odznaky se překreslují samostatně - po vyřízení poptávky nemá smysl
// překreslovat celou obrazovku jen kvůli číslu v menu.
function obnovOdznaky() {
  const pocet = stav.pocty.poptavky;
  for (const [vyber, trida] of [
    ['.bocni__polozka[href$="/poptavky"]', 'bocni__pocet'],
    ['.spodni-lista__polozka[href$="/poptavky"]', 'spodni-lista__pocet'],
  ]) {
    const polozka = document.querySelector(vyber);
    if (!polozka) continue;
    let odznak = polozka.querySelector('.' + trida);
    if (pocet > 0) {
      if (!odznak) {
        odznak = document.createElement('span');
        odznak.className = trida;
        polozka.appendChild(odznak);
      }
      odznak.textContent = String(pocet);
    } else if (odznak) {
      odznak.remove();
    }
  }
}

// ------------------------------------------------------------------- start

// Odkazy uvnitř administrace obsluhuje router, ne prohlížeč.
document.addEventListener('click', (e) => {
  const odkaz = e.target.closest('a[data-odkaz]');
  if (!odkaz) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  jdiNa(odkaz.getAttribute('href').replace(ZAKLAD, ''));
});

window.addEventListener('popstate', () => vykresli());

try {
  stav.ja = await api.get('/ja');
  await nactiPocty();
} catch (err) {
  if (!(err instanceof ChybaApi) || err.status !== 401) {
    console.error('Nepodařilo se zjistit přihlášení:', err);
  }
  stav.ja = null;
}

await vykresli();
