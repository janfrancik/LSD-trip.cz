// Odeslané e-maily. Na testu je to schránka: nic neodešlo, všechno se uložilo
// a dá se prohlédnout jako v poštovním klientovi. V produkci je to log
// odeslaných e-mailů se stavem doručení.

import { api, dotaz } from '../api.js';
import { esc, datumCas, pred, prazdno, strankovani, hlaska } from '../ui.js';
import { jdiNa } from '../admin.js';

const POPIS_STAVU = {
  ve_fronte: { text: 've frontě', trida: 'stitek--prubeh' },
  ve_schrance: { text: 've schránce', trida: 'stitek--nova' },
  odeslano: { text: 'odesláno', trida: 'stitek--hotovo' },
  doruceno: { text: 'doručeno', trida: 'stitek--hotovo' },
  otevreno: { text: 'otevřeno', trida: 'stitek--hotovo' },
  kliknuto: { text: 'kliknuto', trida: 'stitek--hotovo' },
  bounce: { text: 'nedoručeno', trida: 'stitek--chyba' },
  stiznost: { text: 'stížnost', trida: 'stitek--chyba' },
  chyba: { text: 'chyba', trida: 'stitek--chyba' },
};

const filtr = { q: '', stav: '', strana: 1 };

export async function vykresli(koren, { parametr }) {
  if (parametr) return detail(koren, parametr);
  return seznam(koren);
}

function jeSchranka(rezim) {
  return rezim === 'schranka';
}

// ------------------------------------------------------------------ seznam

async function seznam(koren) {
  const data = await api.get('/emaily' + dotaz(filtr));
  const schranka = jeSchranka(data.rezim);

  const zalozky = [
    { klic: '', popis: 'Vše' },
    { klic: 've_schrance', popis: 'Ve schránce' },
    { klic: 'odeslano', popis: 'Odeslané' },
    { klic: 'chyba', popis: 'Chyby' },
  ];

  koren.innerHTML = `
    <h1 class="nadpis" style="margin-bottom:6px">
      ${schranka ? 'Testovací schránka' : 'Odeslané e-maily'}
    </h1>
    ${schranka
      ? `<div class="panel panel--tesny" style="border-left:3px solid var(--varovani);margin-bottom:14px">
           <strong>Testovací schránka — nic neodešlo.</strong>
           <div class="text-faint" style="margin-top:4px">
             Na testovacím webu se e-maily neodesílají. Ukládají se sem celé,
             včetně odkazů, na které jde kliknout. Zákazníkům odtud nikdy nic nepřijde.
           </div>
         </div>`
      : `<p class="text-faint" style="margin-bottom:14px">
           Co komu odešlo a jak to dopadlo. Stav se doplňuje podle zpráv od odesílací služby.
         </p>`}

    <div class="zalozky" role="tablist">
      ${zalozky
        .map((z) => {
          const pocet = z.klic ? (data.pocty[z.klic] ?? 0) : null;
          return `<button type="button" role="tab"
            class="zalozka${filtr.stav === z.klic ? ' zalozka--aktivni' : ''}"
            data-stav="${z.klic}" aria-selected="${filtr.stav === z.klic}">
            ${esc(z.popis)}${pocet ? ` <span class="zalozka__pocet">${pocet}</span>` : ''}
          </button>`;
        })
        .join('')}
    </div>

    <div class="hledani">
      <input class="pole" type="search" id="hledat" placeholder="Adresát, předmět, šablona…"
             value="${esc(filtr.q)}" aria-label="Hledat v e-mailech" />
      <button type="button" class="btn btn--obrys" data-hledat>Hledat</button>
    </div>

    ${data.data.length === 0
      ? prazdno(
          filtr.q ? 'Nic nenalezeno' : 'Zatím žádné e-maily',
          filtr.q ? 'Zkus hledat jinak.' : 'Jakmile něco odejde, objeví se to tady.'
        )
      : `<div class="seznam">${data.data.map(radek).join('')}</div>
         <table class="tabulka">
           <thead><tr>
             <th>Komu</th><th>Předmět</th><th>Šablona</th><th>Stav</th><th>Kdy</th>
           </tr></thead>
           <tbody>${data.data.map(radekTabulky).join('')}</tbody>
         </table>`}

    ${strankovani(data)}`;

  koren.querySelectorAll('[data-stav]').forEach((b) =>
    b.addEventListener('click', () => {
      filtr.stav = b.dataset.stav;
      filtr.strana = 1;
      seznam(koren);
    })
  );

  const hledat = () => {
    filtr.q = koren.querySelector('#hledat').value.trim();
    filtr.strana = 1;
    seznam(koren);
  };
  koren.querySelector('[data-hledat]').addEventListener('click', hledat);
  koren.querySelector('#hledat').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hledat();
  });

  koren.querySelectorAll('[data-id]').forEach((prvek) =>
    prvek.addEventListener('click', () => jdiNa(`emaily/${prvek.dataset.id}`))
  );
  koren.querySelectorAll('[data-strana]').forEach((b) =>
    b.addEventListener('click', () => {
      filtr.strana = Number(b.dataset.strana);
      seznam(koren);
    })
  );
}

function stitek(stav) {
  const s = POPIS_STAVU[stav] ?? { text: stav, trida: '' };
  return `<span class="stitek ${s.trida}">${esc(s.text)}</span>`;
}

function radek(e) {
  return `<button type="button" class="radek" data-id="${e.id}">
      <div class="radek__hlava">
        <span class="radek__nazev">${esc(e.predmet)}</span>
        ${stitek(e.stav)}
      </div>
      <div class="radek__meta">
        ${esc(e.prijemce)} · ${esc(pred(e.created_at))}
        ${Number(e.prilohy) > 0 ? ` · ${e.prilohy} příloh` : ''}
      </div>
    </button>`;
}

function radekTabulky(e) {
  return `<tr data-id="${e.id}">
      <td class="tesne">${esc(e.prijemce)}</td>
      <td><strong>${esc(e.predmet)}</strong></td>
      <td class="tesne text-faint">${esc(e.sablona_klic ?? '—')}</td>
      <td class="tesne">${stitek(e.stav)}</td>
      <td class="tesne text-faint">${esc(pred(e.created_at))}</td>
    </tr>`;
}

// ------------------------------------------------------------------ detail

async function detail(koren, id) {
  const e = await api.get(`/emaily/${encodeURIComponent(id)}`);
  const prepsano = e.prijemce_skutecny && e.prijemce_skutecny !== e.prijemce;

  koren.innerHTML = `
    <div style="margin-bottom:14px">
      <a href="/admin/emaily" data-odkaz class="text-faint">← E-maily</a>
    </div>

    <div class="panel__hlava" style="margin-bottom:12px">
      <h1 class="nadpis">${esc(e.predmet)}</h1>
      ${stitek(e.stav)}
    </div>

    <div class="mrizka mrizka--detail">
      <div>
        <section class="panel">
          <div class="prepinac-nahledu" role="tablist">
            <button type="button" role="tab" class="zalozka zalozka--aktivni" data-pohled="html"
              aria-selected="true">HTML</button>
            <button type="button" role="tab" class="zalozka" data-pohled="text"
              aria-selected="false">Text</button>
          </div>

          <div data-nahled="html">
            ${e.ma_html
              ? `<iframe class="nahled-emailu" data-telo sandbox
                   title="Náhled e-mailu"></iframe>
                 <div style="margin-top:8px">
                   <a class="text-faint" href="/api/admin/emaily/${e.id}/telo"
                      target="_blank" rel="noopener">Otevřít e-mail v novém okně →</a>
                 </div>`
              : prazdno('E-mail nemá HTML verzi')}
          </div>

          <div data-nahled="text" hidden>
            ${e.telo_text
              ? `<pre class="telo-text">${esc(e.telo_text)}</pre>`
              : prazdno('E-mail nemá textovou verzi')}
          </div>
        </section>

        ${e.odkazy.length
          ? `<section class="panel">
               <h2 class="nadpis-2" style="margin-bottom:10px">Odkazy v e-mailu</h2>
               <p class="text-faint" style="margin-bottom:10px">
                 Kliknutím se otevřou stejně, jako by na ně klikl příjemce.
               </p>
               <div class="seznam-karty">
                 ${e.odkazy
                   .map(
                     (odkaz) => `<a class="radek mono" href="${esc(odkaz)}"
                        style="word-break:break-all" target="_blank" rel="noopener">${esc(odkaz)}</a>`
                   )
                   .join('')}
               </div>
             </section>`
          : ''}

        ${e.prilohy.length
          ? `<section class="panel">
               <h2 class="nadpis-2" style="margin-bottom:10px">Přílohy</h2>
               <div class="udaje">
                 ${e.prilohy
                   .map(
                     (p) => `<div class="udaj">
                       <span class="udaj__popisek">${esc(p.nazev)}</span>
                       <span class="udaj__hodnota">
                         <a href="/api/admin/emaily/${e.id}/priloha/${p.id}" download>Stáhnout</a>
                         <span class="text-faint"> · ${velikost(p.velikost)}</span>
                       </span>
                     </div>`
                   )
                   .join('')}
               </div>
             </section>`
          : ''}
      </div>

      <div>
        <section class="panel">
          <h2 class="nadpis-2" style="margin-bottom:10px">Údaje</h2>
          <div class="udaje">
            <div class="udaj"><span class="udaj__popisek">Komu</span>
              <span class="udaj__hodnota">${esc(e.prijemce)}</span></div>
            ${prepsano
              ? `<div class="udaj"><span class="udaj__popisek">Doopravdy odesláno na</span>
                 <span class="udaj__hodnota">${esc(e.prijemce_skutecny)}</span></div>`
              : ''}
            <div class="udaj"><span class="udaj__popisek">Vzniklo</span>
              <span class="udaj__hodnota">${esc(datumCas(e.created_at))}</span></div>
            ${e.odeslano_at
              ? `<div class="udaj"><span class="udaj__popisek">Odesláno</span>
                 <span class="udaj__hodnota">${esc(datumCas(e.odeslano_at))}</span></div>`
              : ''}
            <div class="udaj"><span class="udaj__popisek">Šablona</span>
              <span class="udaj__hodnota">${esc(e.sablona_klic ?? '—')}</span></div>
            <div class="udaj"><span class="udaj__popisek">Režim</span>
              <span class="udaj__hodnota">${esc(popisRezimu(e.rezim))}</span></div>
            ${e.chyba
              ? `<div class="udaj"><span class="udaj__popisek">Poznámka</span>
                 <span class="udaj__hodnota">${esc(e.chyba)}</span></div>`
              : ''}
          </div>
        </section>

        ${e.udalosti.length
          ? `<section class="panel">
               <h2 class="nadpis-2" style="margin-bottom:10px">Co se s ním dělo</h2>
               <div class="udaje">
                 ${e.udalosti
                   .map(
                     (u) => `<div class="udaj">
                       <span class="udaj__popisek">${esc(datumCas(u.created_at))}</span>
                       <span class="udaj__hodnota">${esc(u.typ)}</span>
                     </div>`
                   )
                   .join('')}
               </div>
             </section>`
          : ''}
      </div>
    </div>`;

  // Obsah e-mailu se vkládá jako srcdoc, ne odkazem - sandbox zůstává prázdný,
  // takže uvnitř neběží skripty a nemá přístup k naší stránce ani session.
  const ram = koren.querySelector('[data-telo]');
  if (ram && e.telo_html) ram.srcdoc = e.telo_html;

  koren.querySelectorAll('[data-pohled]').forEach((tlacitko) =>
    tlacitko.addEventListener('click', () => {
      const pohled = tlacitko.dataset.pohled;
      koren.querySelectorAll('[data-pohled]').forEach((t) => {
        t.classList.toggle('zalozka--aktivni', t === tlacitko);
        t.setAttribute('aria-selected', String(t === tlacitko));
      });
      koren.querySelector('[data-nahled="html"]').hidden = pohled !== 'html';
      koren.querySelector('[data-nahled="text"]').hidden = pohled !== 'text';
    })
  );
}

function popisRezimu(rezim) {
  return {
    live: 'ostrý provoz',
    test: 'testovací (přesměrováno)',
    schranka: 'testovací schránka (neodesláno)',
    vypnuto: 'odesílání vypnuté',
  }[rezim] ?? rezim;
}

function velikost(bajty) {
  const kb = Number(bajty ?? 0) / 1024;
  return kb < 1024 ? `${Math.max(1, Math.round(kb))} kB` : `${(kb / 1024).toFixed(1)} MB`;
}

// Odkaz „E-mail uložen do testovací schránky → zobrazit" po akci, která
// e-mail posílá. Dialog místo hlášky: hláška zmizí dřív, než se na ni stihne
// kliknout.
export function odkazNaEmail(emailId) {
  return `/admin/emaily/${emailId}`;
}
