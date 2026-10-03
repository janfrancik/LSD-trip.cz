// Ke schválení: akceptační testování verze na testovacím webu.
//
// Obrazovka má tři podoby: seznam verzí, detail verze s úkoly a seznam
// hlášení. Zadání úkolů se sem nepíše - je v repozitáři (docs/akceptace/*.yml)
// a při nasazení se naimportuje.

import { api } from '../api.js';
import {
  esc, datum, datumCas, pred, prazdno, hlaska, potvrd, formularModal,
} from '../ui.js';
import {
  nahrajObrazek, nahled, pripojPretazeni, pripojVkladani, NAPOVEDA_VLOZENI,
} from '../obrazky.js';
import { otevriHlaseni } from '../hlaseni.js';
import { jdiNa, stav as globalniStav, nactiPocty } from '../admin.js';

// Stavy vydání. „V produkci" je víc než „schválená": mezi odsouhlasením
// testery a tím, že to opravdu běží zákazníkům, bývá i týden.
const POPIS_STAVU_VERZE = {
  otevrena: 'otevřená',
  schvalena: 'schválená',
  v_produkci: 'v produkci',
};

const TRIDA_STAVU_VERZE = {
  otevrena: 'stitek--nova',
  schvalena: 'stitek--hotovo',
  v_produkci: 'stitek--hotovo',
};

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
        <span class="stitek ${TRIDA_STAVU_VERZE[v.stav] ?? 'stitek--nova'}">
          ${v.stav === 'v_produkci' ? '✓ v produkci' : POPIS_STAVU_VERZE[v.stav] ?? 'otevřená'}
        </span>
      </div>
      <div class="radek__meta">
        ${ukolu} ${sklonUkoly(ukolu)}
        ${cekaNaMe > 0 ? ` · čeká na tebe ${cekaNaMe}` : ' · máš otestováno vše'}
        ${Number(v.hlaseni_otevrena) > 0
          ? ` · ${v.hlaseni_otevrena} ${sklonHlaseni(Number(v.hlaseni_otevrena))}`
          : ''}
        ${v.stav === 'v_produkci' && v.nasazeno_at
          ? ` · nasazeno ${esc(datum(v.nasazeno_at))}`
          : v.stav === 'schvalena' && v.schvaleno_at
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
//
// Dva pohledy: "Moje úkoly" (co mám otestovat já) a "Přehled testerů"
// (tabulka úkoly × testeři, jen pro provoz a admina). Výsledek jednoho testera
// nikomu jinému úkol nesplní, proto se stav u úkolu ukazuje vždycky můj.

let pohled = 'ukoly';
const filtrMatice = { tester: '', jenProblemy: false };

async function detailVerze(koren, kod) {
  const data = await api.get(`/akceptace/verze/${encodeURIComponent(kod)}`);
  const { verze, souhrn, ukoly } = data;
  const jeAdmin = data.muzu_schvalovat;
  const vidiVse = Array.isArray(data.po_testerech);
  const vProdukci = verze.stav === 'v_produkci';
  // „Uzavřená" = schválená i nasazená. Na většině míst jde o to, že se do ní
  // už nepíšou výsledky; nasazení je navíc.
  const schvalena = verze.stav === 'schvalena' || vProdukci;
  const moje = data.muj_souhrn;
  const hotovoProcent = moje?.celkem ? Math.round((moje.hotovo / moje.celkem) * 100) : 0;

  koren.innerHTML = `
    <div style="margin-bottom:14px">
      <a href="/admin/akceptace" data-odkaz class="text-faint">← Ke schválení</a>
    </div>

    <div class="panel__hlava" style="margin-bottom:10px">
      <h1 class="nadpis">${esc(verze.nazev)}</h1>
      <span class="stitek ${TRIDA_STAVU_VERZE[verze.stav] ?? 'stitek--nova'}">
        ${vProdukci ? '✓ v produkci' : POPIS_STAVU_VERZE[verze.stav] ?? 'otevřená'}
      </span>
    </div>

    ${verze.popis
      ? `<p class="text-dim" style="white-space:pre-wrap;margin-bottom:16px">${esc(verze.popis)}</p>`
      : ''}

    ${schvalena
      ? `<div class="panel panel--tesny" style="border-left:3px solid var(--ok)">
           ${verze.schvaleno_at
             ? `Schváleno ${esc(datumCas(verze.schvaleno_at))}${verze.schvalil_jmeno ? `, ${esc(verze.schvalil_jmeno)}` : ''}.`
             : ''}
           ${vProdukci
             ? `<div style="margin-top:6px">
                  <strong>✓ Nasazeno v produkci</strong>
                  ${verze.nasazeno_at ? ` ${esc(datum(verze.nasazeno_at))}` : ''}${verze.nasadil_jmeno ? `, zapsal ${esc(verze.nasadil_jmeno)}` : ''}.
                  ${verze.nasazeni_odkaz
                    ? ` <a href="${esc(verze.nasazeni_odkaz)}" target="_blank" rel="noopener">commit / nasazení →</a>`
                    : ''}
                </div>`
             : ''}
           ${verze.schvaleni_poznamka ? `<div class="text-faint" style="margin-top:6px">${esc(verze.schvaleni_poznamka)}</div>` : ''}
         </div>`
      : ''}

    ${moje && moje.celkem
      ? `<div class="panel panel--tesny" style="margin-bottom:14px">
           <div class="panel__hlava" style="margin-bottom:8px">
             <strong>Moje testování</strong>
             <span class="text-faint">${moje.hotovo}/${moje.celkem} hotovo</span>
           </div>
           <div class="pokrok" role="img"
                aria-label="Mám otestováno ${moje.hotovo} z ${moje.celkem} úkolů">
             <div class="pokrok__pruh" style="width:${hotovoProcent}%"></div>
           </div>
           ${moje.neotestovano + moje.k_pretestovani > 0
             ? `<div class="text-faint" style="margin-top:8px">
                  Zbývá ti ${moje.neotestovano + moje.k_pretestovani}
                  ${sklonUkoly(moje.neotestovano + moje.k_pretestovani)}.
                </div>`
             : '<div class="text-faint" style="margin-top:8px">Máš hotovo všechno, díky.</div>'}
         </div>`
      : ''}

    ${vidiVse
      ? `<div class="mrizka mrizka--karty" style="margin:0 0 18px">
           ${karta(souhrn.funguje, 'Funguje (tým)')}
           ${karta(souhrn.nefunguje, 'Nefunguje', souhrn.nefunguje > 0)}
           ${karta(souhrn.k_pretestovani + souhrn.nerozumim, 'K přetestování a nejasné')}
           ${karta(souhrn.neotestovano, 'Nikdo netestoval', souhrn.neotestovano > 0)}
           ${karta(souhrn.hlaseni_otevrena, 'Otevřená hlášení', souhrn.hlaseni_otevrena > 0)}
         </div>`
      : ''}

    ${akce(data, jeAdmin, schvalena, vidiVse, vProdukci)}

    ${vidiVse
      ? `<div class="zalozky" role="tablist" style="margin-top:18px">
           <button type="button" role="tab" class="zalozka${pohled === 'ukoly' ? ' zalozka--aktivni' : ''}"
             data-pohled="ukoly" aria-selected="${pohled === 'ukoly'}">Moje úkoly</button>
           <button type="button" role="tab" class="zalozka${pohled === 'matice' ? ' zalozka--aktivni' : ''}"
             data-pohled="matice" aria-selected="${pohled === 'matice'}">Přehled testerů</button>
         </div>`
      : '<h2 class="nadpis-2" style="margin:20px 0 10px">Moje úkoly</h2>'}

    <div data-obsah>
      ${vidiVse && pohled === 'matice'
        ? matice(data)
        : `<div class="ukoly">${ukoly.map((u, i) => ukolHtml(u, i, data)).join('')}</div>`}
    </div>`;

  koren.querySelectorAll('[data-pohled]').forEach((tlacitko) =>
    tlacitko.addEventListener('click', () => {
      pohled = tlacitko.dataset.pohled;
      detailVerze(koren, kod);
    })
  );

  navazAkce(koren, data, kod);
  if (vidiVse && pohled === 'matice') navazMatici(koren, data, kod);
  else navazUkoly(koren, data, kod);
}

function karta(cislo, popis, pozor = false) {
  return `<div class="karta-cisla">
      <div class="karta-cisla__cislo${pozor ? ' karta-cisla__cislo--pozor' : ''}">${Number(cislo)}</div>
      <div class="karta-cisla__popis">${esc(popis)}</div>
    </div>`;
}

function akce(data, jeAdmin, schvalena, vidiVse, vProdukci) {
  const duvody = data.duvody_proti_schvaleni ?? [];

  return `<section class="panel">
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${jeAdmin && !schvalena
          ? '<button type="button" class="btn btn--hlavni btn--maly" data-schvalit>Schválit verzi</button>'
          : ''}
        ${jeAdmin && schvalena && !vProdukci
          ? '<button type="button" class="btn btn--hlavni btn--maly" data-do-produkce>Označit jako nasazené</button>'
          : ''}
        <button type="button" class="btn btn--obrys btn--maly" data-export>Stáhnout souhrn</button>
        ${vidiVse && !schvalena
          ? '<button type="button" class="btn btn--obrys btn--maly" data-pretestovat>Nefunkční k přetestování</button>'
          : ''}
        ${jeAdmin
          ? `<button type="button" class="btn btn--obrys btn--maly" data-testeri>Kdo testuje</button>
             <button type="button" class="btn btn--obrys btn--maly" data-oznamit>Oznámit testerům</button>
             <button type="button" class="btn btn--obrys btn--maly" data-import>Znovu načíst zadání</button>`
          : ''}
      </div>
      ${vidiVse && data.testeri
        ? `<div class="text-faint" style="margin-top:12px">
             Testuje: ${data.testeri.map((t) => esc(t.jmeno)).join(', ') || '(nikdo)'}
             ${data.testeri_vychozi ? ' (výchozí výběr — všichni, kdo na to mají právo)' : ''}
           </div>`
        : ''}
      ${jeAdmin && !schvalena && duvody.length
        ? `<div style="margin-top:12px">
             <div class="popisek">Ke schválení ještě chybí</div>
             <ul class="duvody">${duvody.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
           </div>`
        : ''}
    </section>`;
}

function ukolHtml(u, index, data) {
  const muj = u.muj_vysledek;
  const stav = u.muj_stav;
  const draft = rozepsany(u);
  const schvalena = data.verze.stav === 'schvalena';
  const vidiVse = Array.isArray(data.po_testerech);
  const ciziVysledky = (u.vysledky ?? []).filter((v) => v.uzivatel_id !== globalniStav.ja.uzivatel.id);

  return `<details class="ukol${u.aktivni ? '' : ' ukol--vyrazeny'}" data-ukol="${u.id}">
      <summary class="ukol__hlava">
        <span class="ukol__cislo">${index + 1}</span>
        <span class="ukol__nazev">
          ${esc(u.nazev)}
          ${u.jen_admin ? '<span class="stitek" style="margin-left:6px">jen admin</span>' : ''}
          ${u.role_filtr && !u.jen_admin
            ? `<span class="stitek" style="margin-left:6px">${esc(u.role_filtr)}</span>`
            : ''}
        </span>
        <span class="stitek ${STITEK[stav]}">${esc(POPIS[stav])}</span>
        ${vidiVse && u.stav_tymu && u.stav_tymu !== stav
          ? `<span class="text-faint jen-siroke" title="Souhrn za celý tým">tým: ${esc(POPIS[u.stav_tymu])}</span>`
          : ''}
      </summary>

      <div class="ukol__telo">
        ${u.aktivni ? '' : '<p class="text-faint">Tenhle úkol už není součástí zadání, zůstává tu kvůli historii.</p>'}
        ${u.patri_mi ? '' : '<p class="text-faint">Tenhle úkol testuje někdo jiný — vidíš ho, protože máš přehled za celý tým.</p>'}

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

        ${schvalena || !u.aktivni || !u.patri_mi
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
               ${vidiVse
                 ? '<button type="button" class="btn btn--obrys btn--maly" data-ukol-pretestovat>Poslat k přetestování</button>'
                 : ''}
             </div>
             <div class="pole-skupina__napoveda">${NAPOVEDA_VLOZENI}</div>
             <div class="nahledy" data-nahledy>${draft.prilohy.map(nahled).join('')}</div>`}

        ${ciziVysledky.length
          ? `<div class="ukol__cast">
               <div class="popisek">Jak dopadli ostatní</div>
               <div class="udaje">${ciziVysledky.map(radekVysledku).join('')}</div>
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
        ${v.prilohy?.length ? `<div class="text-faint">příloh: ${v.prilohy.length}</div>` : ''}
      </span>
    </div>`;
}

// ------------------------------------------------- tabulka úkoly × testeři

function matice(data) {
  const testeri = data.testeri ?? [];
  const vybrany = filtrMatice.tester
    ? testeri.filter((t) => String(t.id) === filtrMatice.tester)
    : testeri;

  let ukoly = data.ukoly.filter((u) => u.aktivni);
  if (filtrMatice.jenProblemy) {
    ukoly = ukoly.filter((u) =>
      vybrany.some((t) => ['nefunguje', 'nerozumim', 'k_pretestovani', 'neotestovano']
        .includes(stavBunky(u, t)))
    );
  }

  if (testeri.length === 0) {
    return prazdno('Verzi nikdo netestuje', 'Vyber testery tlačítkem „Kdo testuje“.');
  }

  return `
    <div class="souhrn-testeru">
      ${(data.po_testerech ?? [])
        .map(
          (t) => `<div class="souhrn-testeru__polozka">
            <span class="souhrn-testeru__jmeno">${esc(t.uzivatel.jmeno)}</span>
            <span class="souhrn-testeru__cislo${t.hotovo < t.celkem ? ' souhrn-testeru__cislo--ceka' : ''}">
              ${t.hotovo}/${t.celkem}
            </span>
          </div>`
        )
        .join('')}
    </div>

    <div class="hledani" style="margin-top:12px">
      <select class="pole" data-filtr-tester aria-label="Filtrovat podle testera">
        <option value="">Všichni testeři</option>
        ${testeri
          .map(
            (t) => `<option value="${t.id}"${filtrMatice.tester === String(t.id) ? ' selected' : ''}>
              ${esc(t.jmeno)}</option>`
          )
          .join('')}
      </select>
      <label class="prepinac" style="white-space:nowrap">
        <input type="checkbox" data-filtr-problemy ${filtrMatice.jenProblemy ? 'checked' : ''}
               style="width:22px;height:22px;accent-color:var(--accent)" />
        <span class="prepinac__text">Jen problémové</span>
      </label>
    </div>

    ${ukoly.length === 0
      ? prazdno('Nic k zobrazení', 'Při tomhle filtru není co ukázat.')
      : `
      <table class="matice">
        <thead>
          <tr>
            <th>Úkol</th>
            ${vybrany.map((t) => `<th class="matice__tester">${esc(t.jmeno)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${ukoly
            .map(
              (u) => `<tr>
                <td class="matice__ukol">${esc(u.nazev)}</td>
                ${vybrany.map((t) => bunka(u, t)).join('')}
              </tr>`
            )
            .join('')}
        </tbody>
      </table>

      <div class="matice-seznam">
        ${ukoly
          .map(
            (u) => `<div class="panel panel--tesny">
              <div style="font-weight:600;margin-bottom:8px">${esc(u.nazev)}</div>
              <div class="matice-seznam__testeri">
                ${vybrany.map((t) => chip(u, t)).join('')}
              </div>
            </div>`
          )
          .join('')}
      </div>`}

    <p class="text-faint" style="margin-top:10px">
      ${Object.entries(ZNACKY).map(([stav, znacka]) => `${znacka} ${POPIS[stav]}`).join(' · ')}
      · – netýká se
    </p>`;
}

const ZNACKY = {
  funguje: '✓',
  nefunguje: '✕',
  nerozumim: '?',
  k_pretestovani: '↻',
  neotestovano: '·',
};

function stavBunky(ukol, tester) {
  if (!patriTesterovi(ukol, tester)) return null;
  return ukol.vysledky?.find((v) => v.uzivatel_id === tester.id)?.stav ?? 'neotestovano';
}

// Stejné pravidlo jako na serveru: jen_admin patří adminovi, role_filtr
// vyjmenovaným rolím, jinak úkol platí pro všechny.
function patriTesterovi(ukol, tester) {
  if (ukol.jen_admin) return tester.role === 'admin';
  if (!ukol.role_filtr) return true;
  return ukol.role_filtr.split(',').map((r) => r.trim()).includes(tester.role);
}

function bunka(ukol, tester) {
  const stav = stavBunky(ukol, tester);
  if (!stav) return '<td class="matice__bunka matice__bunka--netyka">–</td>';
  return `<td class="matice__bunka">
      <button type="button" class="bunka bunka--${stav}"
        data-bunka="${ukol.id}:${tester.id}"
        title="${esc(tester.jmeno)}: ${esc(POPIS[stav])}"
        aria-label="${esc(tester.jmeno)}: ${esc(POPIS[stav])}">${ZNACKY[stav]}</button>
    </td>`;
}

function chip(ukol, tester) {
  const stav = stavBunky(ukol, tester);
  if (!stav) {
    return `<span class="chip chip--netyka">${esc(tester.jmeno)} · netýká se</span>`;
  }
  return `<button type="button" class="chip chip--${stav}" data-bunka="${ukol.id}:${tester.id}">
      ${ZNACKY[stav]} ${esc(tester.jmeno)}
    </button>`;
}

function navazMatici(koren, data, kod) {
  koren.querySelector('[data-filtr-tester]')?.addEventListener('change', (e) => {
    filtrMatice.tester = e.currentTarget.value;
    detailVerze(koren, kod);
  });
  koren.querySelector('[data-filtr-problemy]')?.addEventListener('change', (e) => {
    filtrMatice.jenProblemy = e.currentTarget.checked;
    detailVerze(koren, kod);
  });

  koren.querySelectorAll('[data-bunka]').forEach((prvek) =>
    prvek.addEventListener('click', () => {
      const [ukolId, testerId] = prvek.dataset.bunka.split(':').map(Number);
      const ukol = data.ukoly.find((u) => u.id === ukolId);
      const tester = data.testeri.find((t) => t.id === testerId);
      detailBunky(ukol, tester);
    })
  );
}

// Co přesně tester u úkolu napsal. Bez tohohle je tabulka jen barevná mřížka.
function detailBunky(ukol, tester) {
  const vysledek = ukol.vysledky?.find((v) => v.uzivatel_id === tester.id) ?? null;
  const stav = vysledek?.stav ?? 'neotestovano';

  const nadoba = document.getElementById('modal');
  nadoba.innerHTML = `
    <div class="modal-pozadi" data-zavrit>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="bunka-nadpis">
        <h2 class="modal__nadpis" id="bunka-nadpis">${esc(tester.jmeno)}</h2>
        <p class="modal__text">${esc(ukol.nazev)}</p>

        <div class="udaje" style="margin-bottom:16px">
          <div class="udaj"><span class="udaj__popisek">Výsledek</span>
            <span class="udaj__hodnota"><span class="stitek ${STITEK[stav]}">${esc(POPIS[stav])}</span></span></div>
          ${vysledek
            ? `<div class="udaj"><span class="udaj__popisek">Kdy</span>
                 <span class="udaj__hodnota">${esc(datumCas(vysledek.updated_at))}</span></div>
               ${vysledek.predchozi_stav
                 ? `<div class="udaj"><span class="udaj__popisek">Předtím</span>
                    <span class="udaj__hodnota">${esc(POPIS[vysledek.predchozi_stav])}</span></div>`
                 : ''}
               <div class="udaj"><span class="udaj__popisek">Zařízení</span>
                 <span class="udaj__hodnota text-faint">${esc(zarizeniSlovy(vysledek.zarizeni))}</span></div>`
            : ''}
        </div>

        ${vysledek?.komentar
          ? `<div class="ukol__cast" style="margin-bottom:14px">
               <div class="popisek">Komentář</div>
               <div class="ukol__text">${esc(vysledek.komentar)}</div>
             </div>`
          : '<p class="text-faint" style="margin-bottom:14px">Bez komentáře.</p>'}

        ${vysledek?.prilohy?.length
          ? `<div class="nahledy" style="margin-bottom:14px">
               ${vysledek.prilohy.map(nahled).join('')}
             </div>`
          : ''}

        <div class="modal__akce">
          <button type="button" class="btn btn--hlavni" data-ne>Zavřít</button>
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
}

// Z user agenta jen to, co člověku něco řekne.
function zarizeniSlovy(ua) {
  if (!ua) return 'neznámé';
  const zarizeni = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : 'počítač';
  const prohlizec = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua) && !/Chromium/.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'prohlížeč';
  return `${prohlizec}, ${zarizeni}`;
}

// --------------------------------------------------------------- obsluha

function navazAkce(koren, data, kod) {
  koren.querySelector('[data-do-produkce]')?.addEventListener('click', async () => {
    const dnes = new Date().toISOString().slice(0, 10);
    const vstup = await formularModal({
      nadpis: 'Označit verzi jako nasazenou',
      text:
        'Tohle jen zapisuje skutečnost — že tahle verze už běží zákazníkům. ' +
        'Nic se tím nenasazuje.',
      polia: [
        { klic: 'nasazeno', popisek: 'Datum nasazení', typ: 'datum', hodnota: dnes },
        {
          klic: 'odkaz',
          popisek: 'Odkaz na commit nebo nasazení (nepovinný)',
          napoveda: 'Například adresa commitu na GitHubu nebo běhu workflow.',
        },
        {
          klic: 'poznamka',
          popisek: 'Poznámka k vydání (nepovinná)',
          typ: 'textarea',
          napoveda: 'Připíše se k verzi — třeba kdo schvaloval a za jakých okolností.',
        },
      ],
      potvrzeni: 'Označit jako nasazené',
    });
    if (!vstup) return;

    try {
      const vysledek = await api.post(`/akceptace/verze/${encodeURIComponent(kod)}/do-produkce`, {
        nasazeno: vstup.nasazeno || undefined,
        odkaz: vstup.odkaz.trim() || undefined,
        poznamka: vstup.poznamka.trim() || undefined,
      });
      hlaska(vysledek.zprava, 'ok');
      detailVerze(koren, kod);
    } catch (err) {
      hlaska(err.message, 'chyba');
    }
  });

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
    const volba = await formularModal({
      nadpis: 'Poslat k přetestování',
      text: `Dělá se to po nasazení opravy. Ve výchozím stavu se úkol vrátí jen těm,
             komu nefungoval — komu fungoval, nemá co zkoušet znovu.`,
      polia: [
        {
          klic: 'vsem',
          popisek: 'Poslat všem, i těm, komu to fungovalo',
          typ: 'prepinac',
          hodnota: false,
          napoveda: 'Hodí se, když oprava změnila chování pro všechny.',
        },
      ],
      potvrzeni: 'Poslat',
    });
    if (!volba) return;
    try {
      const vysledek = await api.post(
        `/akceptace/verze/${encodeURIComponent(kod)}/k-pretestovani`,
        { vsem: volba.vsem }
      );
      hlaska(vysledek.zprava, 'ok');
      await nactiPocty();
      detailVerze(koren, kod);
    } catch (err) {
      hlaska(err.message, 'chyba');
    }
  });

  koren.querySelector('[data-testeri]')?.addEventListener('click', async () => {
    try {
      const seznam = await api.get(`/akceptace/verze/${encodeURIComponent(kod)}/testeri`);
      const vybrani = new Set(seznam.testeri.map((t) => t.id));

      const volba = await formularModal({
        nadpis: 'Kdo verzi testuje',
        text: seznam.vychozi
          ? 'Zatím platí výchozí výběr: všichni, kdo mají právo testovat. Jakmile někoho vybereš, počítá se verze jen jim.'
          : 'Schválit verzi půjde, až budou mít všichni vybraní hotovo.',
        polia: seznam.moznosti.map((m) => ({
          klic: `u${m.id}`,
          popisek: `${m.jmeno} (${m.role})`,
          typ: 'prepinac',
          hodnota: vybrani.has(m.id),
        })),
        potvrzeni: 'Uložit',
      });
      if (!volba) return;

      const uzivatele = seznam.moznosti.filter((m) => volba[`u${m.id}`]).map((m) => m.id);
      const vysledek = await api.put(`/akceptace/verze/${encodeURIComponent(kod)}/testeri`, {
        uzivatele,
      });
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
      const volba = await formularModal({
        nadpis: 'Poslat úkol k přetestování',
        text: 'Vrátí se těm, komu nefungoval. Nebo všem, kdo ho testovali.',
        polia: [
          {
            klic: 'vsem',
            popisek: 'Poslat všem, i těm, komu to fungovalo',
            typ: 'prepinac',
            hodnota: false,
          },
        ],
        potvrzeni: 'Poslat',
      });
      if (!volba) return;
      try {
        const vysledek = await api.post(`/akceptace/ukoly/${ukolId}/k-pretestovani`, {
          vsem: volba.vsem,
        });
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
