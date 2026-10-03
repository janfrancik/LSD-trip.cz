// Odeslané e-maily. Na testu je to schránka: nic neodešlo, všechno se uložilo
// a dá se prohlédnout jako v poštovním klientovi. V produkci je to log
// odeslaných e-mailů se stavem doručení.

import { api, dotaz } from '../api.js';
import {
  esc, datumCas, pred, prazdno, strankovani, hlaska, potvrd, formularModal, sklon,
} from '../ui.js';
import { jdiNa } from '../admin.js';

const POPIS_STAVU = {
  ve_fronte: { text: 've frontě', trida: 'stitek--prubeh' },
  ve_schrance: { text: 've schránce', trida: 'stitek--nova' },
  // Neodesláno není chyba, ale ani hotovo - vlastní barva, ať se to nepletlo
  // ani s jedním. U zákaznického e-maila to znamená "člověk neví nic".
  neodeslano: { text: 'neodesláno', trida: 'stitek--neodeslano' },
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

// Pruh nad seznamem, když zákazníkům nic nechodí. Bez něj vypadá obrazovka
// jako obyčejný log a "neodesláno" u jednoho e-mailu se dá přehlédnout -
// přitom je to stav, kdy lidem nedochází potvrzení přihlášky.
function upozorneniNaRezim(data) {
  const neodeslane = data.pocty?.neodeslano ?? 0;

  if (data.rezim === 'jen_provoz') {
    return `
      <div class="panel panel--tesny" style="border-left:3px solid var(--varovani);margin-bottom:14px">
        <strong>Zákazníkům se neposílá — jen upozornění provozu.</strong>
        <div class="text-faint" style="margin-top:4px">
          Odesílací služba zatím nemá ověřenou doménu, takže z webu odejde jen
          upozornění vám. Zákazníci potvrzení <strong>nedostávají</strong> —
          ${neodeslane
            ? `${sklon(neodeslane, 'čeká tu jedno', `čekají tu ${neodeslane}`, `čeká tu ${neodeslane}`)}.`
            : 'zatím žádné nečeká.'}
          Ozvěte se jim telefonem. Až bude doména ověřená a přepne se režim,
          dají se neodeslané rozeslat hromadně.
        </div>
      </div>`;
  }

  if (data.rezim === 'vypnuto') {
    return `
      <div class="panel panel--tesny" style="border-left:3px solid var(--chyba);margin-bottom:14px">
        <strong>Odesílání e-mailů je vypnuté — nechodí nic.</strong>
        <div class="text-faint" style="margin-top:4px">
          Ani zákazníkům, ani vám. O nových přihláškách a poptávkách se dozvíte
          jen tady v administraci.${neodeslane ? ` Neodeslaných čeká ${neodeslane}.` : ''}
        </div>
      </div>`;
  }

  // Režim umí odeslat a něco tu leží z dřívějška - tohle je ta chvíle, kdy
  // se to má rozeslat.
  if (data.muze_zakaznikovi && neodeslane) {
    return `
      <div class="panel panel--tesny" style="border-left:3px solid var(--varovani);margin-bottom:14px">
        <strong>${neodeslane} ${sklon(
          neodeslane,
          'e-mail zákazníkovi nikdy neodešel',
          'e-maily zákazníkům nikdy neodešly',
          'e-mailů zákazníkům nikdy neodešlo'
        )}.</strong>
        <div class="text-faint" style="margin-top:4px;margin-bottom:10px">
          Vznikly v době, kdy bylo odesílání vypnuté. Teď už odesílat jde,
          takže se dají poslat dodatečně.
        </div>
        <button type="button" class="btn btn--obrys btn--maly" data-hromadne>
          Rozeslat neodeslané…
        </button>
      </div>`;
  }

  return '';
}

// ------------------------------------------------------------------ seznam

async function seznam(koren) {
  const data = await api.get('/emaily' + dotaz(filtr));
  const schranka = jeSchranka(data.rezim);

  const zalozky = [
    { klic: '', popis: 'Vše' },
    { klic: 've_schrance', popis: 'Ve schránce' },
    { klic: 'neodeslano', popis: 'Neodeslané' },
    { klic: 'odeslano', popis: 'Odeslané' },
    { klic: 'chyba', popis: 'Chyby' },
  ];

  koren.innerHTML = `
    <div class="panel__hlava" style="margin-bottom:6px">
      <h1 class="nadpis">${schranka ? 'Testovací schránka' : 'Odeslané e-maily'}</h1>
      <button type="button" class="btn btn--obrys" data-sablony>Šablony e-mailů</button>
    </div>
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

    ${upozorneniNaRezim(data)}

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
  koren.querySelector('[data-sablony]')?.addEventListener('click', () => jdiNa('sablony'));
  koren.querySelector('[data-hromadne]')?.addEventListener('click', () => hromadne(koren));

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

    ${['neodeslano', 'chyba'].includes(e.stav) ? pruhNeodeslano(e) : ''}

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

  koren.querySelector('[data-znovu]')?.addEventListener('click', async () => {
    const souhlas = await potvrd({
      nadpis: 'Odeslat e-mail znovu?',
      text:
        `Odejde na <strong>${esc(e.prijemce)}</strong> v tom znění, jaké je tady
         v náhledu. Pokud jste se s ním spojila jinak, bude to druhá zpráva.`,
      potvrzeni: 'Odeslat',
    });
    if (!souhlas) return;

    const vysledek = await api.post(`/emaily/${encodeURIComponent(id)}/odeslat-znovu`, {});
    hlaska(vysledek.zprava);
    detail(koren, id);
  });
}

function popisRezimu(rezim) {
  return {
    live: 'ostrý provoz',
    jen_provoz: 'jen upozornění provozu (zákazníkům se neposílá)',
    test: 'testovací (přesměrováno)',
    schranka: 'testovací schránka (neodesláno)',
    vypnuto: 'odesílání vypnuté',
  }[rezim] ?? rezim;
}

// Pruh na detailu neodeslaného e-mailu. Říká tři věci: že to nedošlo, proč,
// a co se s tím dá dělat teď.
function pruhNeodeslano(e) {
  const komu = e.interni ? 'provozu' : 'zákazníkovi';
  // Dvě různé věci: "režim to zakázal" a "odeslání se nepovedlo". Pro toho,
  // kdo to čte, je rozdíl podstatný — u chyby je potřeba zjistit proč.
  const jeChyba = e.stav === 'chyba';

  return `
    <div class="panel panel--tesny"
         style="border-left:3px solid var(--${jeChyba ? 'chyba' : 'varovani'});margin-bottom:14px">
      <strong>${jeChyba
        ? `Odeslání selhalo — ${komu} nepřišel.`
        : `Tenhle e-mail nikdy neodešel — ${komu} nepřišel.`}</strong>
      ${e.chyba ? `<div class="text-faint" style="margin-top:4px">${esc(e.chyba)}</div>` : ''}
      ${e.lze_odeslat_znovu
        ? `<div style="margin-top:10px">
             <button type="button" class="btn btn--obrys btn--maly" data-znovu>
               Odeslat znovu
             </button>
             <span class="text-faint" style="margin-left:8px">
               Odejde v tomhle znění na ${esc(e.prijemce)}.
             </span>
           </div>`
        : e.interni
          ? `<div class="text-faint" style="margin-top:6px">
               Upozornění provozu se nedoposílá — mělo cenu ve chvíli, kdy přišlo.
             </div>`
          : `<div class="text-faint" style="margin-top:6px">
               Odeslat znovu teď nejde — zákazníkům se v tomhle nastavení neposílá.
               Až se přepne na ostrý provoz, tlačítko se tu objeví.
             </div>`}
    </div>`;
}

// ------------------------------------------------- hromadné rozeslání

// Dva kroky schválně: nejdřív období, pak přesný počet k odeslání. Rozesílání
// e-mailů zákazníkům se nemá spustit jedním kliknutím bez toho, aby bylo
// vidět, kolika lidem to odejde.
async function hromadne(koren) {
  const obdobi = await formularModal({
    nadpis: 'Rozeslat neodeslané e-maily',
    text:
      'Pošle se to, co zákazníkům nikdy neodešlo — v tom znění, v jakém to ' +
      'tehdy vzniklo. Období můžete nechat prázdné, pak se vezme všechno. ' +
      'Upozornění provozu se nedoposílají.',
    polia: [
      { klic: 'od', popisek: 'Od data', typ: 'datum', napoveda: 'Nechte prázdné pro vše.' },
      { klic: 'do', popisek: 'Do data', typ: 'datum', napoveda: 'Včetně tohohle dne.' },
    ],
    potvrzeni: 'Zobrazit počet',
  });
  if (!obdobi) return;

  const filtrObdobi = {};
  if (obdobi.od) filtrObdobi.od = obdobi.od;
  if (obdobi.do) filtrObdobi.do = obdobi.do;

  const nahled = await api.get('/emaily/neodeslane' + dotaz(filtrObdobi));

  if (!nahled.celkem) {
    await potvrd({
      nadpis: 'Není co odeslat',
      text: 'V tomhle období nezůstal žádný neodeslaný e-mail pro zákazníka.',
      potvrzeni: 'Zavřít',
      jenPotvrzeni: true,
      nebezpecne: false,
    });
    return;
  }

  const vice = nahled.celkem > nahled.max_v_davce;
  const kusy = sklon(nahled.davka, 'e-mail', 'e-maily', 'e-mailů');
  const souhlas = await potvrd({
    nadpis: `Odeslat ${nahled.davka} ${kusy}?`,
    text:
      `<strong>Odejde ${nahled.davka} ${kusy}</strong> skutečným zákazníkům.` +
      (vice
        ? ` Celkem jich čeká ${nahled.celkem}; v jedné dávce se posílá nejvýš
           ${nahled.max_v_davce}, takže akci spusťte víckrát.`
        : '') +
      `<br><br>Nejstarší je z ${esc(datumCas(nahled.nejstarsi))}.
       Pokud už jste se s lidmi spojila jinak, bude to pro ně druhá zpráva.`,
    potvrzeni: `Odeslat ${nahled.davka}`,
  });
  if (!souhlas) return;

  const vysledek = await api.post('/emaily/neodeslane/odeslat', filtrObdobi);
  hlaska(
    vysledek.chyby
      ? `${vysledek.zprava} ${vysledek.chyby} se nepodařilo — podívejte se na jejich stav.`
      : vysledek.zprava,
    vysledek.chyby ? 'chyba' : 'ok'
  );
  seznam(koren);
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
