// Ke schválení: akceptační testování verze na testovacím webu.
//
// Obrazovka má tři podoby: seznam verzí, detail verze s úkoly a seznam
// hlášení. Zadání úkolů se sem nepíše - je v repozitáři (docs/akceptace/*.yml)
// a při nasazení se naimportuje.

import { api } from '../api.js';
import {
  esc, datumCas, pred, prazdno, hlaska, potvrd, formularModal,
} from '../ui.js';
import {
  nahrajObrazek, nahled, pripojPretazeni, pripojVkladani, NAPOVEDA_VLOZENI,
} from '../obrazky.js';
import { otevriHlaseni } from '../hlaseni.js';
import { jdiNa, stav as globalniStav, nactiPocty } from '../admin.js';

const STITEK = {
  funguje: 'stitek--hotovo',
  nefunguje: 'stitek--chyba',
  nerozumim: 'stitek--prubeh',
  k_pretestovani: 'stitek--nova',
  neotestovano: '',
};

const POPIS = {
  funguje: 'funguje',
  nefunguje: 'nefunguje',
  nerozumim: 'nerozumím zadání',
  k_pretestovani: 'k přetestování',
  neotestovano: 'neotestováno',
};

const POPIS_HLASENI = {
  nove: 'nové',
  resi_se: 'řeší se',
  vyreseno: 'vyřešeno',
  zamitnuto: 'zamítnuto',
};

const STITEK_HLASENI = {
  nove: 'stitek--nova',
  resi_se: 'stitek--prubeh',
  vyreseno: 'stitek--hotovo',
  zamitnuto: 'stitek--spam',
};

// Rozepsaný, ale neuložený výsledek. Drží se mezi překreslením seznamu, aby
// tester o komentář nepřišel, když mu mezitím doběhne jiná akce.
const rozepsane = new Map(); // ukolId -> { stav, komentar, prilohy: [] }

function rozepsany(ukol) {
  if (!rozepsane.has(ukol.id)) {
    rozepsane.set(ukol.id, {
      stav: ukol.muj_vysledek?.stav === 'k_pretestovani' ? null : (ukol.muj_vysledek?.stav ?? null),
      komentar: ukol.muj_vysledek?.komentar ?? '',
      prilohy: [],
    });
  }
  return rozepsane.get(ukol.id);
}

export async function vykresli(koren, { parametr }) {
  if (parametr === 'hlaseni') return seznamHlaseni(koren);
  if (parametr) return detailVerze(koren, parametr);
  return seznamVerzi(koren);
}

// ------------------------------------------------------------ seznam verzí

async function seznamVerzi(koren) {
  const data = await api.get('/akceptace');

  koren.innerHTML = `
    <h1 class="nadpis" style="margin-bottom:6px">Ke schválení</h1>
    <p class="text-faint" style="margin-bottom:16px">
      Tady se odzkoušejí nové části administrace, než se pustí na skutečný web.
      U každého úkolu je postup krok za krokem; stačí říct, jestli to funguje.
    </p>

    ${upozorneniNaImport(data)}

    ${data.verze.length === 0
      ? data.import?.ok === false
        ? ''
        : prazdno('Není co testovat', 'Až přijde nová verze, objeví se tady sama.')
      : `<div class="seznam-karty">${data.verze.map(kartaVerze).join('')}</div>`}

    <section class="panel" style="margin-top:16px">
      <div class="panel__hlava">
        <h2 class="nadpis-2">Hlášení problémů</h2>
        <a href="/admin/akceptace/hlaseni" data-odkaz class="text-faint">Všechna →</a>
      </div>
      <p class="text-faint">
        Cokoli podezřelého jde nahlásit z kterékoli obrazovky tlačítkem
        „Nahlásit problém“ v hlavičce. Otevřených hlášení:
        ${Number(data.pocty.hlaseni_otevrena)}.
      </p>
    </section>`;

  koren.querySelectorAll('[data-verze]').forEach((prvek) =>
    prvek.addEventListener('click', () => jdiNa(`akceptace/${prvek.dataset.verze}`))
  );

  koren.querySelector('[data-import-znovu]')?.addEventListener('click', async (e) => {
    const tlacitko = e.currentTarget;
    tlacitko.disabled = true;
    try {
      const vysledek = await api.post('/akceptace/import');
      hlaska(vysledek.zprava, 'ok');
      seznamVerzi(koren);
    } catch (err) {
      hlaska(err.message, 'chyba');
      tlacitko.disabled = false;
    }
  });
}

// Import zadání běží při startu aplikace. Když selže (typicky neproběhlé
// migrace), nesmí modul jen mlčky zůstat prázdný - tohle řekne, co se stalo,
// a administrátorovi nabídne nový pokus bez nasazování.
function upozorneniNaImport(data) {
  const stav = data.import;
  if (!stav || stav.ok !== false) return '';

  return `<section class="panel" style="border-left:3px solid var(--chyba)">
      <h2 class="nadpis-2" style="margin-bottom:8px">Zadání testů se nenačetlo</h2>
      <p class="text-dim">
        Seznam úkolů je v repozitáři a načítá se při nasazení nové verze.
        Poslední pokus (${esc(datumCas(stav.cas))}) skončil chybou:
      </p>
      <p class="mono" style="margin:10px 0;color:var(--chyba);word-break:break-word">
        ${esc(stav.chyba)}
      </p>
      <p class="text-faint" style="margin-bottom:12px">
        Nejčastější příčina je neproběhlá migrace databáze. Dokud se zadání
        nenačte, není co testovat — ozvi se prosím správci.
      </p>
      ${data.muzu_schvalovat
        ? '<button type="button" class="btn btn--hlavni btn--maly" data-import-znovu>Znovu načíst zadání</button>'
        : ''}
    </section>`;
}

function kartaVerze(v) {
  const ukolu = Number(v.ukolu);
  const cekaNaMe = Number(v.ceka_na_me);
  return `<button type="button" class="radek" data-verze="${esc(v.kod)}">
      <div class="radek__hlava">
        <span class="radek__nazev">${esc(v.nazev)}</span>
        <span class="stitek ${v.stav === 'schvalena' ? 'stitek--hotovo' : 'stitek--nova'}">
          ${v.stav === 'schvalena' ? 'schválená' : 'otevřená'}
        </span>
      </div>
      <div class="radek__meta">
        ${ukolu} ${sklonUkoly(ukolu)}
        ${cekaNaMe > 0 ? ` · čeká na tebe ${cekaNaMe}` : ' · máš otestováno vše'}
        ${Number(v.hlaseni_otevrena) > 0
          ? ` · ${v.hlaseni_otevrena} ${sklonHlaseni(Number(v.hlaseni_otevrena))}`
          : ''}
        ${v.stav === 'schvalena' && v.schvaleno_at
          ? ` · schváleno ${esc(datumCas(v.schvaleno_at))}${v.schvalil_jmeno ? `, ${esc(v.schvalil_jmeno)}` : ''}`
          : ''}
      </div>
    </button>`;
}

function sklonUkoly(pocet) {
  if (pocet === 1) return 'úkol';
  if (pocet >= 2 && pocet <= 4) return 'úkoly';
  return 'úkolů';
}

function sklonHlaseni(pocet) {
  if (pocet === 1) return 'otevřené hlášení';
  if (pocet >= 2 && pocet <= 4) return 'otevřená hlášení';
  return 'otevřených hlášení';
}

// ------------------------------------------------------------ detail verze

async function detailVerze(koren, kod) {
  const data = await api.get(`/akceptace/verze/${encodeURIComponent(kod)}`);
  const { verze, souhrn, ukoly } = data;
  const jeAdmin = data.muzu_schvalovat;
  const schvalena = verze.stav === 'schvalena';
  const hotovoProcent = souhrn.celkem ? Math.round((souhrn.funguje / souhrn.celkem) * 100) : 0;

  koren.innerHTML = `
    <div style="margin-bottom:14px">
      <a href="/admin/akceptace" data-odkaz class="text-faint">← Ke schválení</a>
    </div>

    <div class="panel__hlava" style="margin-bottom:10px">
      <h1 class="nadpis">${esc(verze.nazev)}</h1>
      <span class="stitek ${schvalena ? 'stitek--hotovo' : 'stitek--nova'}">
        ${schvalena ? 'schválená' : 'otevřená'}
      </span>
    </div>

    ${verze.popis
      ? `<p class="text-dim" style="white-space:pre-wrap;margin-bottom:16px">${esc(verze.popis)}</p>`
      : ''}

    ${schvalena
      ? `<div class="panel panel--tesny" style="border-left:3px solid var(--ok)">
           Schváleno ${esc(datumCas(verze.schvaleno_at))}${verze.schvalil_jmeno ? `, ${esc(verze.schvalil_jmeno)}` : ''}.
           ${verze.schvaleni_poznamka ? `<div class="text-faint" style="margin-top:6px">${esc(verze.schvaleni_poznamka)}</div>` : ''}
         </div>`
      : ''}

    <div class="pokrok" role="img"
         aria-label="Otestováno ${souhrn.funguje} z ${souhrn.celkem} úkolů">
      <div class="pokrok__pruh" style="width:${hotovoProcent}%"></div>
    </div>
    <div class="mrizka mrizka--karty" style="margin:12px 0 18px">
      ${karta(souhrn.funguje, 'Funguje')}
      ${karta(souhrn.nefunguje, 'Nefunguje', souhrn.nefunguje > 0)}
      ${karta(souhrn.k_pretestovani + souhrn.nerozumim, 'K přetestování a nejasné')}
      ${karta(souhrn.neotestovano, 'Neotestováno', souhrn.neotestovano > 0)}
      ${karta(souhrn.hlaseni_otevrena, 'Otevřená hlášení', souhrn.hlaseni_otevrena > 0)}
    </div>

    ${akce(data, jeAdmin, schvalena)}

    <h2 class="nadpis-2" style="margin:20px 0 10px">Úkoly</h2>
    <div class="ukoly">
      ${ukoly.map((u, i) => ukolHtml(u, i, data)).join('')}
    </div>`;

  navazAkce(koren, data, kod);
  navazUkoly(koren, data, kod);
}

function karta(cislo, popis, pozor = false) {
  return `<div class="karta-cisla">
      <div class="karta-cisla__cislo${pozor ? ' karta-cisla__cislo--pozor' : ''}">${Number(cislo)}</div>
      <div class="karta-cisla__popis">${esc(popis)}</div>
    </div>`;
}

function akce(data, jeAdmin, schvalena) {
  const duvody = data.duvody_proti_schvaleni ?? [];
  const muzeRidit = globalniStav.ja.uzivatel.role !== 'tester';

  return `<section class="panel">
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${jeAdmin && !schvalena
          ? '<button type="button" class="btn btn--hlavni btn--maly" data-schvalit>Schválit verzi</button>'
          : ''}
        <button type="button" class="btn btn--obrys btn--maly" data-export>Stáhnout souhrn</button>
        ${muzeRidit && !schvalena
          ? '<button type="button" class="btn btn--obrys btn--maly" data-pretestovat>Nefunkční k přetestování</button>'
          : ''}
        ${jeAdmin
          ? `<button type="button" class="btn btn--obrys btn--maly" data-oznamit>Oznámit testerům</button>
             <button type="button" class="btn btn--obrys btn--maly" data-import>Znovu načíst zadání</button>`
          : ''}
      </div>
      ${jeAdmin && !schvalena && duvody.length
        ? `<div class="text-faint" style="margin-top:12px">
             Ke schválení ještě chybí: ${esc(duvody.join(' '))}
           </div>`
        : ''}
    </section>`;
}

function ukolHtml(u, index, data) {
  const stav = u.stav;
  const muj = u.muj_vysledek;
  const draft = rozepsany(u);
  const schvalena = data.verze.stav === 'schvalena';
  const muzeRidit = globalniStav.ja.uzivatel.role !== 'tester';

  return `<details class="ukol${u.aktivni ? '' : ' ukol--vyrazeny'}" data-ukol="${u.id}">
      <summary class="ukol__hlava">
        <span class="ukol__cislo">${index + 1}</span>
        <span class="ukol__nazev">${esc(u.nazev)}</span>
        <span class="stitek ${STITEK[stav]}">${esc(POPIS[stav])}</span>
      </summary>

      <div class="ukol__telo">
        ${u.aktivni ? '' : '<p class="text-faint">Tenhle úkol už není součástí zadání, zůstává tu kvůli historii.</p>'}

        <div class="ukol__cast">
          <div class="popisek">Postup</div>
          <div class="ukol__text">${esc(u.postup)}</div>
        </div>

        <div class="ukol__cast">
          <div class="popisek">Co se má stát</div>
          <div class="ukol__text">${esc(u.ocekavany_vysledek)}</div>
        </div>

        ${u.odkaz
          ? `<div class="ukol__cast">
               <a class="btn btn--obrys btn--maly" href="${esc(u.odkaz)}" data-odkaz>
                 Otevřít obrazovku
               </a>
             </div>`
          : ''}

        ${u.zadani_zmeneno_po_testu
          ? `<p class="text-faint" style="color:var(--varovani)">
               Zadání se od tvého testu změnilo (${esc(datumCas(u.zmeneno_at))}). Projdi to prosím znovu.
             </p>`
          : ''}

        ${muj
          ? `<p class="text-faint">
               Tvůj výsledek: <strong>${esc(POPIS[muj.stav])}</strong>, ${esc(pred(muj.updated_at))}${
                 muj.predchozi_stav ? ` (předtím ${esc(POPIS[muj.predchozi_stav])})` : ''
               }
             </p>`
          : ''}

        ${schvalena || !u.aktivni
          ? ''
          : `<div class="volby" role="group" aria-label="Výsledek testu">
               ${['funguje', 'nefunguje', 'nerozumim']
                 .map(
                   (s) => `<button type="button" class="volba volba--${s}${draft.stav === s ? ' volba--aktivni' : ''}"
                       data-vybrat="${s}">${esc(POPIS[s])}</button>`
                 )
                 .join('')}
             </div>

             <div class="pole-skupina" data-pole="komentar" style="margin-top:12px">
               <label class="pole-skupina__popisek" for="komentar-${u.id}">
                 Komentář${draft.stav === 'nefunguje' ? ' (u „nefunguje“ povinný)' : ''}
               </label>
               <textarea class="pole" id="komentar-${u.id}" name="komentar"
                 placeholder="Co se stalo, co jste čekala…">${esc(draft.komentar)}</textarea>
               <div class="pole-skupina__chyba" hidden></div>
             </div>

             <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
               <label class="btn btn--obrys btn--maly" for="soubor-${u.id}" style="cursor:pointer">
                 Přidat snímek
                 <input type="file" id="soubor-${u.id}" accept="image/png,image/jpeg,image/webp" hidden />
               </label>
               <button type="button" class="btn btn--hlavni btn--maly" data-ulozit>Uložit výsledek</button>
               <button type="button" class="btn btn--obrys btn--maly" data-nahlasit>Nahlásit problém</button>
               ${muzeRidit
                 ? '<button type="button" class="btn btn--obrys btn--maly" data-ukol-pretestovat>Poslat k přetestování</button>'
                 : ''}
             </div>
             <div class="pole-skupina__napoveda">${NAPOVEDA_VLOZENI}</div>
             <div class="nahledy" data-nahledy>${draft.prilohy.map(nahled).join('')}</div>`}

        ${u.vysledky.length
          ? `<div class="ukol__cast">
               <div class="popisek">Výsledky testerů</div>
               <div class="udaje">${u.vysledky.map(radekVysledku).join('')}</div>
             </div>`
          : ''}
      </div>
    </details>`;
}

function radekVysledku(v) {
  return `<div class="udaj">
      <span class="udaj__popisek">${esc(v.kdo)}</span>
      <span class="udaj__hodnota">
        <span class="stitek ${STITEK[v.stav]}">${esc(POPIS[v.stav])}</span>
        <span class="text-faint"> ${esc(datumCas(v.updated_at))}</span>
        ${v.komentar ? `<div style="margin-top:4px;white-space:pre-wrap">${esc(v.komentar)}</div>` : ''}
        ${Number(v.prilohy) > 0 ? `<div class="text-faint">příloh: ${Number(v.prilohy)}</div>` : ''}
      </span>
    </div>`;
}

// --------------------------------------------------------------- obsluha

function navazAkce(koren, data, kod) {
  koren.querySelector('[data-schvalit]')?.addEventListener('click', async () => {
    const vstup = await formularModal({
      nadpis: 'Schválit verzi',
      text: 'Schválením říkáš, že tahle část administrace může jít na skutečný web. Zapíše se to do auditu.',
      polia: [
        {
          klic: 'poznamka',
          popisek: 'Poznámka (nepovinná)',
          typ: 'textarea',
          napoveda: 'Například na čem jsi to zkoušela nebo co zůstalo na později.',
        },
      ],
      potvrzeni: 'Schválit verzi',
    });
    if (!vstup) return;
    try {
      const vysledek = await api.post(`/akceptace/verze/${encodeURIComponent(kod)}/schvalit`, {
        poznamka: vstup.poznamka.trim() || undefined,
      });
      hlaska(vysledek.zprava, 'ok');
      detailVerze(koren, kod);
    } catch (err) {
      const duvody = err.data?.detaily?.duvody;
      await potvrd({
        nadpis: 'Verzi ještě nejde schválit',
        text: duvody
          ? `<ul style="margin:0;padding-left:18px">${duvody.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`
          : esc(err.message),
        potvrzeni: 'Rozumím',
        nebezpecne: false,
        jenPotvrzeni: true,
      });
    }
  });

  koren.querySelector('[data-export]')?.addEventListener('click', async () => {
    try {
      const vysledek = await api.get(`/akceptace/verze/${encodeURIComponent(kod)}/export`);
      ukazExport(vysledek);
    } catch (err) {
      hlaska(err.message, 'chyba');
    }
  });

  koren.querySelector('[data-pretestovat]')?.addEventListener('click', async () => {
    const ano = await potvrd({
      nadpis: 'Poslat nefunkční úkoly k přetestování?',
      text: 'Všechny úkoly označené „nefunguje“ nebo „nerozumím zadání“ se vrátí testerům. Dělá se to po nasazení opravy.',
      potvrzeni: 'Poslat',
      nebezpecne: false,
    });
    if (!ano) return;
    try {
      const vysledek = await api.post(`/akceptace/verze/${encodeURIComponent(kod)}/k-pretestovani`);
      hlaska(vysledek.zprava, 'ok');
      await nactiPocty();
      detailVerze(koren, kod);
    } catch (err) {
      hlaska(err.message, 'chyba');
    }
  });

  koren.querySelector('[data-oznamit]')?.addEventListener('click', async () => {
    try {
      const vysledek = await api.post(`/akceptace/verze/${encodeURIComponent(kod)}/oznamit`);
      hlaska(vysledek.zprava, vysledek.odeslano > 0 ? 'ok' : 'chyba');
    } catch (err) {
      hlaska(err.message, 'chyba');
    }
  });

  koren.querySelector('[data-import]')?.addEventListener('click', async () => {
    try {
      const vysledek = await api.post('/akceptace/import');
      hlaska(vysledek.zprava, 'ok');
      detailVerze(koren, kod);
    } catch (err) {
      hlaska(err.message, 'chyba');
    }
  });
}

// Vložený obrázek patří úkolu, ve kterém má člověk kurzor; když nikde, tak
// tomu jedinému rozbalenému. Posluchač se před každým překreslením odpojí,
// jinak by se na dokumentu vrstvily.
let odpojVkladaniDoUkolu = null;

function cilovyUkol(koren) {
  const zaostreny = document.activeElement?.closest?.('[data-ukol]');
  if (zaostreny && koren.contains(zaostreny)) return zaostreny;

  const rozbalene = koren.querySelectorAll('.ukol[open]');
  return rozbalene.length === 1 ? rozbalene[0] : null;
}

async function pridejSnimek(prvekUkolu, soubor) {
  const draft = rozepsane.get(Number(prvekUkolu.dataset.ukol));
  if (!draft) return;
  try {
    draft.prilohy.push(await nahrajObrazek(soubor));
    prvekUkolu.querySelector('[data-nahledy]').innerHTML = draft.prilohy.map(nahled).join('');
    hlaska('Snímek přidaný. Nezapomeň uložit výsledek.', 'ok');
  } catch (err) {
    hlaska(err.message, 'chyba');
  }
}

function navazUkoly(koren, data, kod) {
  odpojVkladaniDoUkolu?.();
  odpojVkladaniDoUkolu = pripojVkladani(
    () => cilovyUkol(koren),
    (soubor, prvekUkolu) => pridejSnimek(prvekUkolu, soubor)
  );

  koren.querySelectorAll('[data-ukol]').forEach((prvek) => {
    const ukolId = Number(prvek.dataset.ukol);
    const ukol = data.ukoly.find((u) => u.id === ukolId);
    const draft = rozepsany(ukol);

    const zapisKomentar = () => {
      draft.komentar = prvek.querySelector('[name="komentar"]')?.value ?? draft.komentar;
    };

    prvek.querySelectorAll('[data-vybrat]').forEach((tlacitko) =>
      tlacitko.addEventListener('click', () => {
        zapisKomentar();
        draft.stav = tlacitko.dataset.vybrat;
        prvek.querySelectorAll('[data-vybrat]').forEach((t) =>
          t.classList.toggle('volba--aktivni', t === tlacitko)
        );
      })
    );

    prvek.querySelector('[name="komentar"]')?.addEventListener('input', zapisKomentar);

    const vstupSoubor = prvek.querySelector(`#soubor-${ukolId}`);
    vstupSoubor?.addEventListener('change', async () => {
      const soubor = vstupSoubor.files?.[0];
      if (!soubor) return;
      await pridejSnimek(prvek, soubor);
      vstupSoubor.value = '';
    });

    // Přetáhnout obrázek jde rovnou na úkol. Vkládání ze schránky řeší jeden
    // posluchač na dokumentu (níž), protože Cmd+V nemíří na konkrétní prvek.
    if (prvek.querySelector('[data-nahledy]')) pripojPretazeni(prvek, (s) => pridejSnimek(prvek, s));

    prvek.querySelector('[data-ulozit]')?.addEventListener('click', async (e) => {
      zapisKomentar();
      if (!draft.stav) {
        hlaska('Nejdřív vyber, jestli to funguje, nebo ne.', 'chyba');
        return;
      }
      const tlacitko = e.currentTarget;
      tlacitko.disabled = true;
      try {
        const vysledek = await api.put(`/akceptace/ukoly/${ukolId}/vysledek`, {
          stav: draft.stav,
          komentar: draft.komentar || undefined,
          prilohy: draft.prilohy.map((p) => p.id),
        });
        rozepsane.delete(ukolId);
        hlaska(vysledek.zprava, 'ok');
        await nactiPocty();
        detailVerze(koren, kod);
      } catch (err) {
        const chyba = prvek.querySelector('.pole-skupina__chyba');
        if (err.detaily?.komentar && chyba) {
          chyba.textContent = err.detaily.komentar;
          chyba.hidden = false;
        } else {
          hlaska(err.message, 'chyba');
        }
        tlacitko.disabled = false;
      }
    });

    prvek.querySelector('[data-nahlasit]')?.addEventListener('click', () => {
      otevriHlaseni({ ukolId, nazevUkolu: ukol.nazev });
    });

    prvek.querySelector('[data-ukol-pretestovat]')?.addEventListener('click', async () => {
      try {
        const vysledek = await api.post(`/akceptace/ukoly/${ukolId}/k-pretestovani`);
        hlaska(vysledek.zprava, 'ok');
        await nactiPocty();
        detailVerze(koren, kod);
      } catch (err) {
        hlaska(err.message, 'chyba');
      }
    });
  });
}

// Souhrn se ukáže v okně: jde ho zkopírovat i stáhnout jako soubor.
function ukazExport({ soubor, obsah }) {
  const nadoba = document.getElementById('modal');
  nadoba.innerHTML = `
    <div class="modal-pozadi" data-zavrit>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="export-nadpis">
        <h2 class="modal__nadpis" id="export-nadpis">Souhrn verze</h2>
        <p class="modal__text">
          Tenhle text patří do repozitáře jako zápis o akceptaci
          (docs/akceptace/${esc(soubor)}).
        </p>
        <textarea class="pole mono" readonly rows="14"
          style="min-height:240px">${esc(obsah)}</textarea>
        <div class="modal__akce">
          <button type="button" class="btn btn--obrys" data-ne>Zavřít</button>
          <button type="button" class="btn btn--obrys" data-kopirovat>Kopírovat</button>
          <button type="button" class="btn btn--hlavni" data-stahnout>Stáhnout</button>
        </div>
      </div>
    </div>`;

  const zavri = () => {
    nadoba.innerHTML = '';
  };
  nadoba.querySelector('[data-ne]').addEventListener('click', zavri);
  nadoba.querySelector('[data-zavrit]').addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-zavrit')) zavri();
  });

  nadoba.querySelector('[data-kopirovat]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(obsah);
      hlaska('Zkopírováno.', 'ok');
    } catch {
      nadoba.querySelector('textarea').select();
      hlaska('Zkopíruj to prosím ručně (text je označený).', 'chyba');
    }
  });

  nadoba.querySelector('[data-stahnout]').addEventListener('click', () => {
    const odkaz = document.createElement('a');
    odkaz.href = URL.createObjectURL(new Blob([obsah], { type: 'text/markdown;charset=utf-8' }));
    odkaz.download = soubor;
    odkaz.click();
    URL.revokeObjectURL(odkaz.href);
  });
}

// ----------------------------------------------------------- seznam hlášení

const filtrHlaseni = { stav: '' };

async function seznamHlaseni(koren) {
  const data = await api.get('/akceptace/hlaseni' + (filtrHlaseni.stav ? `?stav=${filtrHlaseni.stav}` : ''));
  const muzeRidit = globalniStav.ja.uzivatel.role !== 'tester';

  const zalozky = [
    { klic: '', popis: 'Vše' },
    { klic: 'nove', popis: 'Nová' },
    { klic: 'resi_se', popis: 'Řeší se' },
    { klic: 'vyreseno', popis: 'Vyřešená' },
    { klic: 'zamitnuto', popis: 'Zamítnutá' },
  ];

  koren.innerHTML = `
    <div style="margin-bottom:14px">
      <a href="/admin/akceptace" data-odkaz class="text-faint">← Ke schválení</a>
    </div>
    <h1 class="nadpis" style="margin-bottom:14px">Hlášení problémů</h1>

    <div class="zalozky" role="tablist">
      ${zalozky
        .map(
          (z) => `<button type="button" role="tab"
            class="zalozka${filtrHlaseni.stav === z.klic ? ' zalozka--aktivni' : ''}"
            data-stav="${z.klic}" aria-selected="${filtrHlaseni.stav === z.klic}">
            ${esc(z.popis)}${z.klic && data.pocty[z.klic] ? ` <span class="zalozka__pocet">${data.pocty[z.klic]}</span>` : ''}
          </button>`
        )
        .join('')}
    </div>

    ${data.data.length === 0
      ? prazdno('Žádná hlášení', 'Tlačítko „Nahlásit problém“ je v hlavičce na každé obrazovce.')
      : `<div class="seznam-karty">${data.data.map((h) => kartaHlaseni(h, muzeRidit)).join('')}</div>`}`;

  koren.querySelectorAll('[data-stav]').forEach((b) =>
    b.addEventListener('click', () => {
      filtrHlaseni.stav = b.dataset.stav;
      seznamHlaseni(koren);
    })
  );

  koren.querySelectorAll('[data-hlaseni]').forEach((prvek) => {
    const id = Number(prvek.dataset.hlaseni);
    prvek.querySelector('[data-prilohy]')?.addEventListener('click', async (e) => {
      // Tlačítko si držíme v proměnné: po await už e.currentTarget neplatí.
      const tlacitko = e.currentTarget;
      try {
        const detail = await api.get(`/akceptace/hlaseni/${id}`);
        prvek.querySelector('[data-nahledy-hlaseni]').innerHTML = detail.prilohy.map(nahled).join('');
        tlacitko.remove();
      } catch (err) {
        hlaska(err.message, 'chyba');
      }
    });

    prvek.querySelectorAll('[data-novy-stav]').forEach((tlacitko) =>
      tlacitko.addEventListener('click', async () => {
        try {
          await api.patch(`/akceptace/hlaseni/${id}`, {
            stav: tlacitko.dataset.novyStav,
            odpoved: prvek.querySelector('[name="odpoved"]')?.value || undefined,
          });
          hlaska('Uloženo.', 'ok');
          await nactiPocty();
          seznamHlaseni(koren);
        } catch (err) {
          hlaska(err.message, 'chyba');
        }
      })
    );
  });
}

function kartaHlaseni(h, muzeRidit) {
  return `<article class="panel" data-hlaseni="${h.id}">
      <div class="panel__hlava">
        <h2 class="nadpis-2">#${h.id}${h.ukol_nazev ? ` · ${esc(h.ukol_nazev)}` : ''}</h2>
        <span class="stitek ${STITEK_HLASENI[h.stav]}">${esc(POPIS_HLASENI[h.stav])}</span>
      </div>
      <p style="white-space:pre-wrap;color:var(--text-2)">${esc(h.text)}</p>
      <div class="udaje" style="margin-top:12px">
        <div class="udaj"><span class="udaj__popisek">Nahlásil</span>
          <span class="udaj__hodnota">${esc(h.kdo ?? 'neznámý')} · ${esc(datumCas(h.created_at))}</span></div>
        <div class="udaj"><span class="udaj__popisek">Obrazovka</span>
          <span class="udaj__hodnota mono" style="word-break:break-all">${esc(h.url ?? '—')}</span></div>
        <div class="udaj"><span class="udaj__popisek">Prohlížeč</span>
          <span class="udaj__hodnota text-faint">${esc(h.prohlizec ?? '—')}${h.rozliseni ? ` · ${esc(h.rozliseni)}` : ''}</span></div>
        ${h.odpoved
          ? `<div class="udaj"><span class="udaj__popisek">Vyřešení</span>
             <span class="udaj__hodnota">${esc(h.odpoved)}${h.vyresil_jmeno ? ` · ${esc(h.vyresil_jmeno)}` : ''}</span></div>`
          : ''}
      </div>
      ${Number(h.prilohy) > 0
        ? `<div style="margin-top:10px">
             <button type="button" class="btn btn--obrys btn--maly" data-prilohy>
               Zobrazit přílohy (${Number(h.prilohy)})
             </button>
             <div class="nahledy" data-nahledy-hlaseni></div>
           </div>`
        : ''}
      ${muzeRidit
        ? `<div class="pole-skupina" style="margin-top:12px">
             <label class="pole-skupina__popisek" for="odpoved-${h.id}">Co se s tím stalo</label>
             <textarea class="pole" id="odpoved-${h.id}" name="odpoved"
               placeholder="Opraveno, nasazeno na test.">${esc(h.odpoved ?? '')}</textarea>
           </div>
           <div style="display:flex;flex-wrap:wrap;gap:8px">
             <button type="button" class="btn btn--obrys btn--maly" data-novy-stav="resi_se">Řeší se</button>
             <button type="button" class="btn btn--hlavni btn--maly" data-novy-stav="vyreseno">Vyřešeno</button>
             <button type="button" class="btn btn--obrys btn--maly" data-novy-stav="zamitnuto">Zamítnout</button>
           </div>`
        : ''}
    </article>`;
}
