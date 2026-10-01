// Kurzy: seznam a karta kurzu.
//
// Kurz je produkt s typ='kurz' (docs/plan-kurzy.md). Obrazovka proto pracuje
// s /produkty?typ=kurz a stejný kód půjde později použít i pro tandem.
//
// Pořadí se přehazuje šipkami, ne přetahováním. Na letišti se administrace
// ovládá z telefonu jednou rukou a drag & drop je tam nespolehlivý.

import { api, dotaz } from '../api.js';
import {
  esc, kc, datumCas, prazdno, strankovani, hlaska, potvrd, pole, ukazChybyPoli,
  formularModal,
} from '../ui.js';
import { nahrajFotku, MAX_BAJTU_FOTKA } from '../obrazky.js';
import { omezNaKurz } from './terminy.js';
import { jdiNa, stav as globalniStav } from '../admin.js';

const filtr = { q: '', strana: 1, smazane: '' };

export async function vykresli(koren, { parametr }) {
  if (parametr) return karta(koren, parametr);
  return seznam(koren);
}

function smiMenit() {
  return globalniStav.ja?.prava?.produkty === 'menit';
}

// ------------------------------------------------------------------ seznam

async function seznam(koren) {
  const data = await api.get('/produkty' + dotaz({ ...filtr, typ: 'kurz' }));

  koren.innerHTML = `
    <div class="panel__hlava" style="margin-bottom:14px">
      <h1 class="nadpis">Kurzy</h1>
      ${smiMenit() ? '<button type="button" class="btn btn--hlavni" data-novy>Nový kurz</button>' : ''}
    </div>

    <div class="zalozky" role="tablist">
      <button type="button" role="tab" class="zalozka${filtr.smazane ? '' : ' zalozka--aktivni'}"
        data-smazane="" aria-selected="${!filtr.smazane}">Kurzy</button>
      <button type="button" role="tab" class="zalozka${filtr.smazane ? ' zalozka--aktivni' : ''}"
        data-smazane="1" aria-selected="${Boolean(filtr.smazane)}">Smazané</button>
    </div>

    <div class="hledani">
      <input class="pole" type="search" id="hledat" placeholder="Název kurzu…"
             value="${esc(filtr.q)}" aria-label="Hledat v kurzech" />
      <button type="button" class="btn btn--obrys" data-hledat>Hledat</button>
    </div>

    ${data.data.length === 0
      ? prazdno(
          filtr.q ? 'Nic nenalezeno' : filtr.smazane ? 'Žádné smazané kurzy' : 'Zatím žádné kurzy',
          filtr.q
            ? 'Zkus hledat jinak.'
            : filtr.smazane
              ? 'Smazané kurzy se sem ukládají a dají se obnovit.'
              : 'Založ první kurz tlačítkem nahoře. Dokud ho nezveřejníš, na webu se neukáže.'
        )
      : `
      <div class="seznam">${data.data.map((k, i) => radek(k, i, data.data.length)).join('')}</div>

      <table class="tabulka">
        <thead><tr>
          <th>Kurz</th><th>Cena</th><th>Parametry</th><th>DPH</th><th>Stav</th><th></th>
        </tr></thead>
        <tbody>${data.data.map((k, i) => radekTabulky(k, i, data.data.length)).join('')}</tbody>
      </table>`}

    ${strankovani(data)}`;

  koren.querySelectorAll('[data-smazane]').forEach((b) =>
    b.addEventListener('click', () => {
      filtr.smazane = b.dataset.smazane;
      filtr.strana = 1;
      seznam(koren);
    })
  );

  const hledat = () => {
    filtr.q = koren.querySelector('#hledat').value.trim();
    filtr.strana = 1;
    seznam(koren);
  };
  koren.querySelector('[data-hledat]')?.addEventListener('click', hledat);
  koren.querySelector('#hledat')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hledat();
  });

  koren.querySelectorAll('[data-strana]').forEach((b) =>
    b.addEventListener('click', () => {
      filtr.strana = Number(b.dataset.strana);
      seznam(koren);
    })
  );

  koren.querySelector('[data-novy]')?.addEventListener('click', () => novyKurz(koren));

  koren.querySelectorAll('[data-otevrit]').forEach((b) =>
    b.addEventListener('click', () => jdiNa('kurzy/' + b.dataset.otevrit))
  );

  koren.querySelectorAll('[data-posun]').forEach((b) =>
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const poradi = data.data.map((k) => k.id);
      const odkud = poradi.indexOf(Number(b.dataset.posun));
      const kam = odkud + Number(b.dataset.smer);
      if (kam < 0 || kam >= poradi.length) return;
      poradi.splice(kam, 0, poradi.splice(odkud, 1)[0]);
      await api.post('/produkty/poradi', { poradi });
      seznam(koren);
    })
  );

  koren.querySelectorAll('[data-obnovit]').forEach((b) =>
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const odpoved = await api.post(`/produkty/${b.dataset.obnovit}/obnovit`);
      hlaska(odpoved.zprava);
      seznam(koren);
    })
  );
}

function radek(kurz, index, celkem) {
  const cena = kurz.cena_na_dotaz ? 'cena na dotaz' : kc(kurz.cena_hal);
  const meta = [
    kurz.delka_text,
    kurz.uroven_text,
    kurz.dph_procento != null ? `DPH ${Number(kurz.dph_procento)} %` : null,
  ].filter(Boolean).join(' · ');

  // Smazané mají místo šipek tlačítko Obnovit - přehazovat pořadí u něčeho,
  // co není vidět, nedává smysl.
  const akce = filtr.smazane
    ? `<button type="button" class="btn btn--obrys btn--maly" data-obnovit="${kurz.id}">Obnovit</button>`
    : smiMenit()
      ? `<button type="button" class="btn btn--obrys btn--maly" data-posun="${kurz.id}" data-smer="-1"
                 ${index === 0 ? 'disabled' : ''} aria-label="Posunout nahoru">↑</button>
         <button type="button" class="btn btn--obrys btn--maly" data-posun="${kurz.id}" data-smer="1"
                 ${index === celkem - 1 ? 'disabled' : ''} aria-label="Posunout dolů">↓</button>`
      : '';

  return `<div class="radek" style="display:flex;gap:12px;align-items:flex-start">
      <button type="button" data-otevrit="${kurz.id}"
              style="flex:1;background:none;border:0;padding:0;text-align:left;color:inherit;cursor:pointer">
        <span class="radek__hlava">
          <span class="radek__nazev">${esc(kurz.nazev)}</span>
          <span class="stitek ${kurz.aktivni ? 'stitek--hotovo' : 'stitek--nova'}">
            ${kurz.aktivni ? 'zveřejněný' : 'skrytý'}
          </span>
        </span>
        <span class="radek__meta">${esc(cena)}${meta ? ' · ' + esc(meta) : ''}</span>
        ${kurz.perex ? `<span class="radek__ukazka">${esc(kurz.perex)}</span>` : ''}
      </button>
      <div style="display:flex;gap:6px;flex-shrink:0">${akce}</div>
    </div>`;
}

// Nad 900 px se karty schovají a ukáže se tabulka (viz admin.css). Obojí musí
// umět totéž, proto i tady šipky na pořadí a tlačítko Obnovit u smazaných.
function radekTabulky(kurz, index, celkem) {
  const akce = filtr.smazane
    ? `<button type="button" class="btn btn--obrys btn--maly" data-obnovit="${kurz.id}">Obnovit</button>`
    : smiMenit()
      ? `<button type="button" class="btn btn--obrys btn--maly" data-posun="${kurz.id}" data-smer="-1"
                 ${index === 0 ? 'disabled' : ''} aria-label="Posunout nahoru">↑</button>
         <button type="button" class="btn btn--obrys btn--maly" data-posun="${kurz.id}" data-smer="1"
                 ${index === celkem - 1 ? 'disabled' : ''} aria-label="Posunout dolů">↓</button>`
      : '';

  return `<tr>
      <td>
        <button type="button" data-otevrit="${kurz.id}"
                style="background:none;border:0;padding:0;text-align:left;color:inherit;cursor:pointer;font:inherit">
          <strong>${esc(kurz.nazev)}</strong>
          ${kurz.stitek ? `<br /><span class="text-faint">${esc(kurz.stitek)}</span>` : ''}
        </button>
      </td>
      <td class="tesne">${kurz.cena_na_dotaz ? '<span class="text-faint">na dotaz</span>' : esc(kc(kurz.cena_hal))}</td>
      <td class="tesne text-faint">${esc([kurz.delka_text, kurz.uroven_text].filter(Boolean).join(' · '))}</td>
      <td class="tesne text-faint">${kurz.dph_procento != null ? esc(Number(kurz.dph_procento)) + ' %' : '—'}</td>
      <td class="tesne">
        <span class="stitek ${kurz.aktivni ? 'stitek--hotovo' : 'stitek--nova'}">
          ${kurz.aktivni ? 'zveřejněný' : 'skrytý'}
        </span>
      </td>
      <td class="tesne"><div style="display:flex;gap:6px">${akce}</div></td>
    </tr>`;
}

async function novyKurz(koren) {
  const vysledek = await formularModal({
    nadpis: 'Nový kurz',
    text: 'Stačí název, zbytek doplníš na kartě kurzu.',
    polia: [{ klic: 'nazev', popisek: 'Název kurzu', povinne: true }],
    potvrzeni: 'Založit',
  });
  if (!vysledek) return;
  const nazev = String(vysledek.nazev ?? '').trim();
  if (!nazev) return;

  // Nový kurz vzniká skrytý a s cenou na dotaz. Zbytek se doplní na kartě,
  // ať majitelka nemusí vyplnit deset polí, než vůbec něco uvidí.
  const kurz = await api.post('/produkty', {
    typ: 'kurz',
    nazev,
    cena_na_dotaz: true,
  });
  hlaska('Kurz je založený, zatím skrytý.');
  jdiNa('kurzy/' + kurz.id);
}

// ==========================================================================
// Karta kurzu
//
// Ne formulář, ale stránka: nahoře to podstatné, pod tím bloky podle témat
// a vedle nich živý náhled, jak kurz uvidí návštěvník webu. Náhled se
// překresluje při psaní, takže je hned vidět, co která věta udělá.
//
// Všechno ukládá jedno tlačítko - kurz, odrážky i průběh. Majitelka nemá
// přemýšlet nad tím, který blok má vlastní "uložit".
// ==========================================================================

// Rozepsaný stav seznamů. Drží se mimo DOM, aby se při překreslení nepřišlo
// o rozdělanou práci a aby šlo poznat, co se opravdu změnilo.
let praceNaKurzu = null;

// Oddělovače pro otisk seznamu. Znaky, které se do textu nedají napsat,
// takže se otisk nerozbije na odrážce s čárkou nebo svislou čarou.
const ODDELOVAC_POLOZEK = '\u0000';
const ODDELOVAC_POLI = '\u0001';

async function karta(koren, id) {
  const kurz = await api.get(`/produkty/${id}`);
  const sazby = (await api.get('/dph-sazby')).data;
  const muze = smiMenit();

  praceNaKurzu = {
    id,
    fotky: kurz.fotky.map((f) => ({ ...f })),
    pozadavky: kurz.pozadavky.map((p) => p.text),
    kroky: kurz.kroky.map((k) => ({ nadpis: k.nadpis, text: k.text ?? '' })),
    pozadavkyPuvodni: otiskPozadavku(kurz.pozadavky.map((p) => p.text)),
    krokyPuvodni: otiskKroku(kurz.kroky.map((k) => ({ nadpis: k.nadpis, text: k.text ?? '' }))),
  };

  koren.innerHTML = `
    <button type="button" class="btn btn--obrys btn--maly" data-zpet style="margin-bottom:14px">
      ← Zpátky na kurzy
    </button>

    ${hlavicka(kurz, muze)}

    <div class="karta-rozvrzeni">
      <div class="karta-rozvrzeni__nahled">
        ${nahledObal(kurz)}
      </div>

      <form class="karta-rozvrzeni__editace" id="formular" novalidate>
        ${sekceTexty(kurz)}
        ${sekceCena(kurz, sazby)}
        ${sekcePozadavky(kurz)}
        ${sekceSeznam('pozadavky')}
        ${sekceSeznam('kroky')}
        ${sekceFotky()}
        ${sekceZverejneni(kurz)}

        ${muze ? `<div class="ulozit-lista">
          <button type="submit" class="btn btn--hlavni btn--blok">Uložit změny</button>
        </div>` : '<p class="text-dim">Kurzy můžeš jen prohlížet, ne měnit.</p>'}

        <div class="sekce" style="margin-top:16px">
          <div class="sekce__hlava">
            <h2 class="sekce__nadpis">Historie cen</h2>
            <p class="sekce__napoveda">Každá změna ceny i s tím, kdo ji udělal a proč.</p>
          </div>
          <div id="historie" class="text-faint">Načítám…</div>
        </div>

        ${muze && !kurz.smazano_at ? `<div style="margin-top:18px">
          <button type="button" class="btn btn--nebezpecny" data-smazat>Smazat kurz</button>
        </div>` : ''}
      </form>
    </div>`;

  koren.querySelector('[data-zpet]').addEventListener('click', () => jdiNa('kurzy'));

  nactiHistorii(koren, id);
  navazFormular(koren, kurz, id);
  navazSeznamy(koren);
  navazFotky(koren, id);
  navazNahled(koren);

  // Náhled je na telefonu nad formulářem, takže "Náhled" k němu jen vyjede.
  // Až bude v E4 veřejná stránka kurzu, povede tlačítko rovnou na ni.
  koren.querySelector('[data-nahled]')?.addEventListener('click', () => {
    koren.querySelector('.karta-rozvrzeni__nahled')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Termíny jsou vlastní obrazovka, ale otevírají se rovnou předfiltrované
  // na tenhle kurz - jinak by se v nich musel znovu hledat.
  koren.querySelector('[data-terminy]')?.addEventListener('click', () => {
    omezNaKurz(kurz.id);
    jdiNa('terminy');
  });

  koren.querySelector('[data-ulozit-nahore]')?.addEventListener('click', () => {
    koren.querySelector('#formular')?.requestSubmit();
  });

  koren.querySelector('[data-smazat]')?.addEventListener('click', async () => {
    const ano = await potvrd({
      nadpis: 'Smazat kurz?',
      text: `Kurz „${esc(kurz.nazev)}“ zmizí z webu i ze seznamu. Nic se nemaže natrvalo — ` +
            'najdeš ho pod záložkou Smazané a můžeš ho vrátit zpátky.',
      potvrzeni: 'Smazat kurz',
    });
    if (!ano) return;
    const odpoved = await api.del(`/produkty/${id}`);
    hlaska(odpoved.zprava);
    jdiNa('kurzy');
  });
}

function otiskPozadavku(polozky) {
  return polozky.map((t) => t.trim()).filter(Boolean).join(ODDELOVAC_POLOZEK);
}

function otiskKroku(polozky) {
  return polozky
    .map((k) => ({ nadpis: k.nadpis.trim(), text: k.text.trim() }))
    .filter((k) => k.nadpis || k.text)
    .map((k) => k.nadpis + ODDELOVAC_POLI + k.text)
    .join(ODDELOVAC_POLOZEK);
}

// ------------------------------------------------------------------ hlavička

function hlavicka(kurz, muze) {
  return `<div class="karta-hlavicka">
      <div class="karta-hlavicka__vrch">
        <h1 class="karta-hlavicka__nazev" data-zrcadlo="nazev">${esc(kurz.nazev)}</h1>
        <span class="stitek ${kurz.aktivni ? 'stitek--hotovo' : 'stitek--nova'}" data-stav-stitek>
          ${kurz.aktivni ? 'zveřejněný' : 'skrytý'}
        </span>
      </div>

      <div class="karta-hlavicka__udaje">
        <span>Cena <strong data-zrcadlo="cena">${esc(cenaPopis(kurz))}</strong></span>
        <span>DPH <strong>${kurz.dph_procento != null ? esc(Number(kurz.dph_procento)) + ' %' : '—'}</strong></span>
        <span>Na webu <strong class="mono">/kurz/${esc(kurz.slug)}</strong></span>
        ${kurz.smazano_at ? '<span style="color:var(--varovani)">smazaný</span>' : ''}
      </div>

      <div class="karta-hlavicka__akce">
        ${muze ? '<button type="button" class="btn btn--hlavni" data-ulozit-nahore>Uložit</button>' : ''}
        <button type="button" class="btn btn--obrys" data-nahled>Náhled</button>
        <button type="button" class="btn btn--obrys" data-terminy>Termíny</button>
      </div>
    </div>`;
}

function cenaPopis(kurz) {
  if (kurz.cena_na_dotaz) return 'na dotaz';
  return kurz.cena_hal == null ? '—' : kc(kurz.cena_hal);
}

// -------------------------------------------------------------------- sekce

function sekce(nadpis, napoveda, vnitrek) {
  return `<section class="sekce">
      <div class="sekce__hlava">
        <h2 class="sekce__nadpis">${esc(nadpis)}</h2>
        ${napoveda ? `<p class="sekce__napoveda">${napoveda}</p>` : ''}
      </div>
      ${vnitrek}
    </section>`;
}

function sekceTexty(kurz) {
  return sekce(
    'Texty',
    'Název a krátký popis se ukážou na kartě kurzu ve výpisu. Podrobný popis a „co je v ceně“ jsou až na stránce kurzu.',
    `
      ${pole({ klic: 'nazev', popisek: 'Název kurzu', hodnota: kurz.nazev, povinne: true,
               napoveda: 'Podle názvu se vytvoří i adresa na webu.' })}
      ${pole({ klic: 'stitek', popisek: 'Štítek v rohu fotky', hodnota: kurz.stitek ?? '',
               napoveda: 'Krátké slovo navíc. Nechte prázdné, pokud žádný nechcete.' })}
      ${pole({ klic: 'perex', popisek: 'Krátký popis do výpisu', typ: 'textarea', hodnota: kurz.perex ?? '',
               napoveda: 'Dvě až tři věty. Tohle si člověk přečte, než se rozhodne kliknout.' })}
      ${pole({ klic: 'popis', popisek: 'Podrobný popis', typ: 'textarea', hodnota: kurz.popis ?? '',
               napoveda: 'Celý text na stránce kurzu. Odstavce oddělte prázdným řádkem.' })}
      ${pole({ klic: 'co_je_v_cene', popisek: 'Co je v ceně', typ: 'textarea', hodnota: kurz.co_je_v_cene ?? '',
               napoveda: 'Každou položku na vlastní řádek.' })}
      <div class="mrizka mrizka--2">
        ${pole({ klic: 'delka_text', popisek: 'Jak dlouho trvá', hodnota: kurz.delka_text ?? '' })}
        ${pole({ klic: 'uroven_text', popisek: 'Pro koho je', hodnota: kurz.uroven_text ?? '' })}
      </div>
      <p class="sekce__napoveda">Délka a úroveň se na kartě ukážou jako dvojice drobných údajů nad cenou.</p>
    `
  );
}

function sekceCena(kurz, sazby) {
  return sekce(
    'Cena a DPH',
    'Cena se ukáže velkým písmem na kartě i na stránce kurzu. Sazba DPH se projeví jen na nově vystavených dokladech — ty už vystavené zůstanou, jak jsou.',
    `
      ${pole({ klic: 'cena_na_dotaz', popisek: 'Cena na dotaz', typ: 'prepinac',
               hodnota: kurz.cena_na_dotaz,
               napoveda: 'Pro kurzy, kde cena závisí na rozsahu. Místo částky se na webu ukáže „Cena na dotaz“.' })}
      ${pole({ klic: 'cena_kc', popisek: 'Cena v korunách',
               hodnota: kurz.cena_hal == null ? '' : (kurz.cena_hal / 100),
               napoveda: 'Jen číslo, bez „Kč“. Haléře oddělte čárkou.' })}
      ${pole({ klic: 'duvod_zmeny_ceny', popisek: 'Proč se cena mění', hodnota: '',
               napoveda: 'Nepovinné. Uloží se do historie cen dole, ať je za rok jasné, co se tehdy stalo.' })}
      ${pole({ klic: 'dph_sazba_id', popisek: 'Sazba DPH', typ: 'vyber', hodnota: kurz.dph_sazba_id ?? '',
               moznosti: sazby.filter((s) => s.aktivni).map((s) => ({ hodnota: s.id, popis: s.nazev })) })}
    `
  );
}

function sekcePozadavky(kurz) {
  return sekce(
    'Požadavky na účastníka',
    'Podle těchhle údajů se přihláška zeptá na věk a váhu a soupiska zvýrazní toho, kdo je mimo limit. Nevyplněné pole znamená „neřešíme“.',
    `
      <div class="mrizka mrizka--2">
        ${pole({ klic: 'min_vek', popisek: 'Nejnižší věk', typ: 'cislo', hodnota: kurz.min_vek ?? '', min: 0, max: 120 })}
        ${pole({ klic: 'max_vek', popisek: 'Nejvyšší věk', typ: 'cislo', hodnota: kurz.max_vek ?? '', min: 0, max: 120 })}
      </div>
      <div class="mrizka mrizka--2">
        ${pole({ klic: 'max_vaha_kg', popisek: 'Nejvyšší hmotnost (kg)', typ: 'cislo',
                 hodnota: kurz.max_vaha_kg ?? '', min: 0, max: 400 })}
        ${pole({ klic: 'souhlas_zastupce_do_let', popisek: 'Souhlas zástupce do kolika let', typ: 'cislo',
                 hodnota: kurz.souhlas_zastupce_do_let ?? '', min: 0, max: 26 })}
      </div>
      ${pole({ klic: 'vyzaduje_lekarskou_prohlidku', popisek: 'Vyžaduje lékařskou prohlídku', typ: 'prepinac',
               hodnota: kurz.vyzaduje_lekarskou_prohlidku,
               napoveda: 'Účastník ji doloží papírově na místě. V přihlášce jen potvrdí, že ji přinese.' })}
      ${pole({ klic: 'vyzaduje_zdravotni_prohlaseni', popisek: 'Vyžaduje zdravotní prohlášení', typ: 'prepinac',
               hodnota: kurz.vyzaduje_zdravotni_prohlaseni })}
    `
  );
}

function sekceFotky() {
  return sekce(
    'Fotky',
    'První fotka je <strong>titulní</strong> — ta velká na kartě kurzu. Ostatní se ukážou ' +
      'v galerii na stránce kurzu. Nejlépe vypadají fotky na šířku v poměru 3:2. ' +
      'Popis fotky vidí čtečka pro nevidomé a objeví se i tehdy, když se obrázek nenačte.',
    `<div data-fotky>
        <div class="fotky" data-fotky-seznam></div>
        ${smiMenit() ? `
          <div class="fotky__pridat">
            <input type="file" id="fotka-vstup" accept="image/jpeg,image/png,image/webp"
                   multiple hidden />
            <button type="button" class="btn btn--obrys btn--blok" data-vybrat-fotku>
              + Přidat fotku
            </button>
            <p class="sekce__napoveda" style="margin-top:8px">
              Z telefonu můžeš fotit rovnou. Maximum ${MAX_BAJTU_FOTKA / 1024 / 1024} MB na fotku.
              Pro web se fotka zmenší sama, originál zůstane uložený.
            </p>
          </div>` : ''}
      </div>`
  );
}

// Co se opravdu posílá na web, a u zmenšené fotky i kolik se tím ušetřilo.
// Není to ozdoba: majitelka tak vidí, že se s fotkou z mobilu něco stalo,
// a nemusí se bát, že web stahuje pětimegový originál.
function popisVelikosti(f) {
  const velikost = (b) =>
    b >= 1024 * 1024
      ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` // česky s desetinnou čárkou
      : `${Math.round(b / 1024)} kB`;
  const rozmer = f.sirka && f.vyska ? `${f.sirka} × ${f.vyska} px, ` : '';
  const zmensena = f.puvodni_velikost_b && f.puvodni_velikost_b > f.velikost_b;
  return esc(
    rozmer +
      velikost(f.velikost_b ?? 0) +
      (zmensena ? ` (zmenšeno z ${velikost(f.puvodni_velikost_b)})` : '')
  );
}

function vykresliFotky(koren) {
  const obal = koren.querySelector('[data-fotky-seznam]');
  if (!obal) return;

  const fotky = praceNaKurzu.fotky;
  const muze = smiMenit();

  if (!fotky.length) {
    obal.innerHTML = `<div class="fotky-misto">
        <div class="fotky-misto__ram fotky-misto__ram--titulni">Zatím žádná fotka</div>
      </div>`;
    return;
  }

  obal.innerHTML = fotky.map((f, i) => `
      <div class="fotka${i === 0 ? ' fotka--titulni' : ''}">
        <div class="fotka__obrazek">
          <img src="${esc(f.url)}" alt="${esc(f.alt ?? '')}" loading="lazy" />
          ${i === 0 ? '<span class="fotka__odznak">Titulní</span>' : ''}
        </div>
        <input class="pole" type="text" data-alt="${f.id}" value="${esc(f.alt ?? '')}"
               placeholder="Co je na fotce — např. „Instruktor s účastníkem po přistání“"
               aria-label="Popis fotky ${i + 1}" ${muze ? '' : 'readonly'} />
        ${!f.alt ? '<p class="fotka__chybi-popis">Bez popisu. Doplň ho, ať fotce rozumí i čtečka.</p>' : ''}
        <p class="fotka__rozmery">${popisVelikosti(f)}</p>
        ${muze ? `<div class="polozka__akce">
          <button type="button" class="btn btn--obrys btn--maly" data-fotka-posun="${i}" data-smer="-1"
                  ${i === 0 ? 'disabled' : ''} aria-label="Posunout dopředu">↑</button>
          <button type="button" class="btn btn--obrys btn--maly" data-fotka-posun="${i}" data-smer="1"
                  ${i === fotky.length - 1 ? 'disabled' : ''} aria-label="Posunout dozadu">↓</button>
          <button type="button" class="btn btn--obrys btn--maly" data-fotka-smazat="${f.id}"
                  aria-label="Odebrat fotku">✕</button>
        </div>` : ''}
      </div>`).join('');
}

function navazFotky(koren, id) {
  const blok = koren.querySelector('[data-fotky]');
  if (!blok) return;

  vykresliFotky(koren);

  const vstup = blok.querySelector('#fotka-vstup');
  blok.querySelector('[data-vybrat-fotku]')?.addEventListener('click', () => vstup?.click());

  vstup?.addEventListener('change', async () => {
    const soubory = [...(vstup.files ?? [])];
    vstup.value = ''; // ať jde tutéž fotku vybrat znovu po smazání

    for (const soubor of soubory) {
      try {
        const fotka = await nahrajFotku(soubor);
        // Tatáž fotka už u kurzu být nemusí podruhé.
        if (praceNaKurzu.fotky.some((f) => f.id === fotka.id)) {
          hlaska('Tuhle fotku už kurz má.', 'chyba');
          continue;
        }
        praceNaKurzu.fotky.push(fotka);
        vykresliFotky(koren);
        await ulozFotky(koren, id);
      } catch (chyba) {
        hlaska(chyba.message, 'chyba');
      }
    }
  });

  blok.addEventListener('click', async (e) => {
    const posun = e.target.closest('[data-fotka-posun]');
    const smazat = e.target.closest('[data-fotka-smazat]');

    if (posun) {
      const odkud = Number(posun.dataset.fotkaPosun);
      const kam = odkud + Number(posun.dataset.smer);
      if (kam < 0 || kam >= praceNaKurzu.fotky.length) return;
      praceNaKurzu.fotky.splice(kam, 0, praceNaKurzu.fotky.splice(odkud, 1)[0]);
      vykresliFotky(koren);
      await ulozFotky(koren, id);
      return;
    }

    if (smazat) {
      const soubororId = Number(smazat.dataset.fotkaSmazat);
      praceNaKurzu.fotky = praceNaKurzu.fotky.filter((f) => f.id !== soubororId);
      vykresliFotky(koren);
      await ulozFotky(koren, id);
    }
  });

  // Popis fotky se ukládá rovnou k souboru, ne přes formulář kurzu -
  // tatáž fotka může být později i jinde a popis patří k ní.
  blok.addEventListener('change', async (e) => {
    const pole = e.target.closest('[data-alt]');
    if (!pole) return;
    const souborId = Number(pole.dataset.alt);
    try {
      const novy = await api.patch(`/soubory/${souborId}`, { alt: pole.value.trim() });
      const fotka = praceNaKurzu.fotky.find((f) => f.id === souborId);
      if (fotka) fotka.alt = novy.alt;
      vykresliFotky(koren);
      obnovNahled(koren);
    } catch (chyba) {
      hlaska(chyba.message, 'chyba');
    }
  });
}

// Pořadí a složení fotek se ukládá hned, ne až s formulářem. Nahrát fotku
// a pak o ni přijít, protože se zapomnělo kliknout na Uložit, by byla škoda.
async function ulozFotky(koren, id) {
  try {
    await api.put(`/produkty/${id}/fotky`, { fotky: praceNaKurzu.fotky.map((f) => f.id) });
    obnovNahled(koren);
  } catch (chyba) {
    hlaska(chyba.message, 'chyba');
  }
}

function sekceZverejneni(kurz) {
  return sekce(
    'Zveřejnění a vyhledávače',
    'Dokud není kurz zveřejněný, na webu ho nikdo neuvidí — ani přes přímou adresu. Texty pro vyhledávače se ukážou ve výsledcích na Googlu.',
    `
      ${pole({ klic: 'aktivni', popisek: 'Zveřejnit kurz na webu', typ: 'prepinac', hodnota: kurz.aktivni })}
      ${pole({ klic: 'seo_title', popisek: 'Titulek pro vyhledávače', hodnota: kurz.seo_title ?? '',
               napoveda: 'Nechte prázdné a použije se název kurzu.' })}
      ${pole({ klic: 'seo_description', popisek: 'Popis pro vyhledávače', typ: 'textarea',
               hodnota: kurz.seo_description ?? '',
               napoveda: 'Dvě věty, které se ukážou pod odkazem ve výsledcích vyhledávání.' })}
    `
  );
}

// ------------------------------------------------- seznamy (odrážky a kroky)

// Dva seznamy se stejným chováním: přidat, upravit, přesunout šipkami, smazat.
// Šipky schválně místo přetahování - stejně jako pořadí kurzů v seznamu.
const SEZNAMY = {
  pozadavky: {
    nadpis: 'Co si vzít a co doložit',
    napoveda: 'Odrážky na stránce kurzu. Jedna věc na řádek, ať se to dá přelétnout očima.',
    prazdno: 'Zatím žádná odrážka.',
    pridat: 'Přidat odrážku',
    priklad: 'Lékařské potvrzení o způsobilosti (stačí praktický lékař).',
    prazdnaPolozka: () => '',
  },
  kroky: {
    nadpis: 'Jak kurz probíhá',
    napoveda: 'Kroky za sebou, jak jdou po sobě. Čísla doplníme sami, takže když krok přibude doprostřed, nemusíte nic přepisovat.',
    prazdno: 'Zatím žádný krok.',
    pridat: 'Přidat krok',
    priklad: 'Teorie na hangáru',
    prikladText: 'Pátek od 10:00, výuka podle osnov V-PARA 1.',
    prazdnaPolozka: () => ({ nadpis: '', text: '' }),
  },
};

function sekceSeznam(druh) {
  const popis = SEZNAMY[druh];
  return sekce(
    popis.nadpis,
    popis.napoveda,
    `<div data-seznam="${druh}">
        <div class="polozky" data-polozky></div>
        ${smiMenit() ? `<div class="polozky__pridat">
          <button type="button" class="btn btn--obrys btn--blok" data-pridat>+ ${esc(popis.pridat)}</button>
        </div>` : ''}
      </div>`
  );
}

function vykresliSeznam(koren, druh) {
  const obal = koren.querySelector(`[data-seznam="${druh}"] [data-polozky]`);
  if (!obal) return;

  const polozky = praceNaKurzu[druh];
  const muze = smiMenit();
  const popis = SEZNAMY[druh];

  if (!polozky.length) {
    obal.innerHTML = `<p class="polozky__prazdno">${esc(popis.prazdno)}</p>`;
    return;
  }

  obal.innerHTML = polozky.map((p, i) => {
    const akce = muze ? `<div class="polozka__akce">
        <button type="button" class="btn btn--obrys btn--maly" data-posun="${i}" data-smer="-1"
                ${i === 0 ? 'disabled' : ''} aria-label="Posunout nahoru">↑</button>
        <button type="button" class="btn btn--obrys btn--maly" data-posun="${i}" data-smer="1"
                ${i === polozky.length - 1 ? 'disabled' : ''} aria-label="Posunout dolů">↓</button>
        <button type="button" class="btn btn--obrys btn--maly" data-smazat-polozku="${i}"
                aria-label="Smazat řádek">✕</button>
      </div>` : '';

    if (druh === 'kroky') {
      return `<div class="polozka">
          <div class="polozka__cislo">Krok ${String(i + 1).padStart(2, '0')}</div>
          <input class="pole" type="text" data-polozka="${i}" data-klic="nadpis"
                 value="${esc(p.nadpis)}" placeholder="${esc(popis.priklad)}"
                 aria-label="Nadpis kroku ${i + 1}" ${muze ? '' : 'readonly'} />
          <textarea class="pole" rows="2" data-polozka="${i}" data-klic="text"
                    placeholder="${esc(popis.prikladText)}"
                    aria-label="Popis kroku ${i + 1}" ${muze ? '' : 'readonly'}>${esc(p.text)}</textarea>
          ${akce}
        </div>`;
    }

    return `<div class="polozka polozka--radek">
        <input class="pole" type="text" data-polozka="${i}"
               value="${esc(p)}" placeholder="${esc(popis.priklad)}"
               aria-label="Odrážka ${i + 1}" ${muze ? '' : 'readonly'} />
        ${akce}
      </div>`;
  }).join('');
}

function navazSeznamy(koren) {
  for (const druh of Object.keys(SEZNAMY)) {
    vykresliSeznam(koren, druh);

    const blok = koren.querySelector(`[data-seznam="${druh}"]`);
    if (!blok) continue;

    blok.addEventListener('click', (e) => {
      const posun = e.target.closest('[data-posun]');
      const smazat = e.target.closest('[data-smazat-polozku]');
      const pridat = e.target.closest('[data-pridat]');
      const polozky = praceNaKurzu[druh];

      if (posun) {
        const odkud = Number(posun.dataset.posun);
        const kam = odkud + Number(posun.dataset.smer);
        if (kam < 0 || kam >= polozky.length) return;
        polozky.splice(kam, 0, polozky.splice(odkud, 1)[0]);
      } else if (smazat) {
        polozky.splice(Number(smazat.dataset.smazatPolozku), 1);
      } else if (pridat) {
        polozky.push(SEZNAMY[druh].prazdnaPolozka());
      } else {
        return;
      }

      vykresliSeznam(koren, druh);

      // Po přidání rovnou kurzor do nového řádku, ať se neklikalo dvakrát.
      if (pridat) {
        const vstupy = blok.querySelectorAll('input[data-polozka]');
        vstupy[vstupy.length - 1]?.focus();
      }
    });

    // Psaní se rovnou promítá do stavu, překreslovat se kvůli tomu nemusí.
    blok.addEventListener('input', (e) => {
      const vstup = e.target.closest('[data-polozka]');
      if (!vstup) return;
      const index = Number(vstup.dataset.polozka);
      if (druh === 'kroky') praceNaKurzu.kroky[index][vstup.dataset.klic] = vstup.value;
      else praceNaKurzu.pozadavky[index] = vstup.value;
    });
  }
}

// ------------------------------------------------------------------- náhled

function nahledObal(kurz) {
  return `<div class="nahled-obal${kurz.aktivni ? '' : ' nahled-obal--skryty'}" data-nahled-obal>
      <div class="nahled-obal__popisek">Takhle kurz uvidí návštěvník</div>
      ${nahledKarty(kurz)}
      <div class="nahled-obal__skryto" data-skryto ${kurz.aktivni ? 'hidden' : ''}>
        Kurz je skrytý — na webu se zatím neukáže.
      </div>
    </div>`;
}

function nahledKarty(k) {
  const cena = k.cena_na_dotaz ? 'Cena na dotaz' : (k.cena_hal == null ? '—' : kc(k.cena_hal));
  const meta = [k.delka_text, k.uroven_text].filter(Boolean);

  // Titulní fotka je vždycky první v seznamu (viz ulozFotky).
  const titulni = praceNaKurzu?.fotky?.[0] ?? null;

  return `<article class="nk" data-nk>
      <div class="nk__media"${titulni ? ` style="background-image:url(${esc(titulni.url)})"` : ''}>
        ${k.stitek ? `<span class="nk__stitek">${esc(k.stitek)}</span>` : ''}
        ${titulni ? '' : 'Zatím bez fotky'}
      </div>
      <div class="nk__telo">
        <h3 class="nk__nazev">${esc(k.nazev || 'Název kurzu')}</h3>
        <p class="nk__text">${esc(k.perex || 'Krátký popis se ukáže tady.')}</p>
        ${meta.length ? `<div class="nk__meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
        <div class="nk__pata">
          <span class="nk__cena">${esc(cena)}</span>
          <span class="nk__cta">Mám zájem →</span>
        </div>
      </div>
    </article>`;
}

// Náhled se překresluje při psaní. Čte se rovnou z formuláře, ne ze serveru -
// smysl má právě to, co ještě není uložené.
function navazNahled(koren) {
  const formular = koren.querySelector('#formular');
  const obal = koren.querySelector('[data-nahled-obal]');
  if (!formular || !obal) return;

  const prekresli = () => {
    const hod = (klic) => formular.querySelector(`[name="${klic}"]`)?.value.trim() ?? '';
    const zaskrtnuto = (klic) => Boolean(formular.querySelector(`[name="${klic}"]`)?.checked);

    const naDotaz = zaskrtnuto('cena_na_dotaz');
    const kurz = {
      nazev: hod('nazev'),
      stitek: hod('stitek'),
      perex: hod('perex'),
      delka_text: hod('delka_text'),
      uroven_text: hod('uroven_text'),
      cena_na_dotaz: naDotaz,
      cena_hal: naDotaz ? null : naHalere(hod('cena_kc')),
      aktivni: zaskrtnuto('aktivni'),
    };

    obal.querySelector('[data-nk]').outerHTML = nahledKarty(kurz);
    obal.classList.toggle('nahled-obal--skryty', !kurz.aktivni);
    obal.querySelector('[data-skryto]').hidden = kurz.aktivni;

    // Hlavička drží tytéž údaje, ať nesvítí stará cena nad novým náhledem.
    const zrcadloNazev = koren.querySelector('[data-zrcadlo="nazev"]');
    if (zrcadloNazev) zrcadloNazev.textContent = kurz.nazev || 'Název kurzu';

    const zrcadloCena = koren.querySelector('[data-zrcadlo="cena"]');
    if (zrcadloCena) zrcadloCena.textContent = cenaPopis(kurz);

    const stitek = koren.querySelector('[data-stav-stitek]');
    if (stitek) {
      stitek.textContent = kurz.aktivni ? 'zveřejněný' : 'skrytý';
      stitek.className = 'stitek ' + (kurz.aktivni ? 'stitek--hotovo' : 'stitek--nova');
    }
  };

  formular.addEventListener('input', prekresli);
  formular.addEventListener('change', prekresli);
  prekresliNahled = prekresli;
  prekresli();
}

// Náhled se překresluje sám při psaní do formuláře. Fotky ale leží mimo něj,
// takže po jejich změně je potřeba o překreslení říct.
let prekresliNahled = null;

function obnovNahled() {
  prekresliNahled?.();
}

// ------------------------------------------------------------ ukládání karty

function navazFormular(koren, kurz, id) {
  const formular = koren.querySelector('#formular');
  if (!formular || !smiMenit()) return;

  // Cena a "na dotaz" se vylučují - pole se podle přepínače zamkne, ať není
  // potřeba hádat, co platí.
  const naDotaz = formular.querySelector('[name="cena_na_dotaz"]');
  const cenaPole = formular.querySelector('[name="cena_kc"]');
  const srovnejCenu = () => {
    cenaPole.disabled = naDotaz.checked;
    cenaPole.closest('.pole-skupina').style.opacity = naDotaz.checked ? '0.45' : '';
  };
  naDotaz.addEventListener('change', srovnejCenu);
  srovnejCenu();

  formular.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = new FormData(formular);
    const hodnota = (klic) => String(data.get(klic) ?? '').trim();
    const prepinac = (klic) => formular.querySelector(`[name="${klic}"]`).checked;
    const cislo = (klic) => (hodnota(klic) === '' ? null : Number(hodnota(klic)));

    const telo = {
      nazev: hodnota('nazev'),
      stitek: hodnota('stitek'),
      perex: hodnota('perex'),
      popis: hodnota('popis'),
      co_je_v_cene: hodnota('co_je_v_cene'),
      delka_text: hodnota('delka_text'),
      uroven_text: hodnota('uroven_text'),
      cena_na_dotaz: prepinac('cena_na_dotaz'),
      cena_hal: prepinac('cena_na_dotaz') ? null : naHalere(hodnota('cena_kc')),
      dph_sazba_id: cislo('dph_sazba_id'),
      min_vek: cislo('min_vek'),
      max_vek: cislo('max_vek'),
      max_vaha_kg: cislo('max_vaha_kg'),
      souhlas_zastupce_do_let: cislo('souhlas_zastupce_do_let'),
      vyzaduje_lekarskou_prohlidku: prepinac('vyzaduje_lekarskou_prohlidku'),
      vyzaduje_zdravotni_prohlaseni: prepinac('vyzaduje_zdravotni_prohlaseni'),
      aktivni: prepinac('aktivni'),
      seo_title: hodnota('seo_title'),
      seo_description: hodnota('seo_description'),
    };
    const duvod = hodnota('duvod_zmeny_ceny');
    if (duvod) telo.duvod_zmeny_ceny = duvod;

    // Prázdné řádky v seznamech jsou překlep, ne obsah.
    const pozadavky = praceNaKurzu.pozadavky.map((t) => t.trim()).filter(Boolean);
    const kroky = praceNaKurzu.kroky
      .map((k) => ({ nadpis: k.nadpis.trim(), text: k.text.trim() }))
      .filter((k) => k.nadpis || k.text);

    const bezNadpisu = kroky.findIndex((k) => !k.nadpis);
    if (bezNadpisu >= 0) {
      hlaska(`Krok ${bezNadpisu + 1} nemá nadpis. Doplň ho, nebo celý krok smaž.`, 'chyba');
      return;
    }

    try {
      await api.patch(`/produkty/${id}`, telo);

      // Odrážky a kroky se posílají jen když se s nimi opravdu hýbalo.
      if (otiskPozadavku(pozadavky) !== praceNaKurzu.pozadavkyPuvodni) {
        await api.put(`/produkty/${id}/pozadavky`, {
          polozky: pozadavky.map((text) => ({ text })),
        });
      }
      if (otiskKroku(kroky) !== praceNaKurzu.krokyPuvodni) {
        await api.put(`/produkty/${id}/kroky`, {
          polozky: kroky.map((k, i) => ({
            cislo: String(i + 1).padStart(2, '0'),
            nadpis: k.nadpis,
            text: k.text || null,
          })),
        });
      }

      hlaska('Uloženo.');
      karta(koren, id);
    } catch (chyba) {
      if (!ukazChybyPoli(formular, prelozDetaily(chyba.detaily))) throw chyba;
      hlaska('Zkontroluj prosím označená pole.', 'chyba');
    }
  });
}

// Server mluví o `cena_hal`, formulář má pole `cena_kc` - chybu je potřeba
// ukázat u toho pole, které majitelka vidí.
function prelozDetaily(detaily) {
  if (!detaily) return detaily;
  const prelozeno = { ...detaily };
  if (prelozeno.cena_hal) {
    prelozeno.cena_kc = prelozeno.cena_hal;
    delete prelozeno.cena_hal;
  }
  return prelozeno;
}

// "4 600,50" → 460050. Přes řetězec, ne přes násobení desetinného čísla.
export function naHalere(text) {
  const cisty = String(text).replace(/\s/g, '').replace(',', '.');
  if (cisty === '') return null;
  const cislo = Number(cisty);
  if (!Number.isFinite(cislo)) return null;
  return Math.round(cislo * 100);
}

// ------------------------------------------------------------- historie cen

async function nactiHistorii(koren, id) {
  const cil = koren.querySelector('#historie');
  if (!cil) return;

  const { data } = await api.get(`/produkty/${id}/cenik-historie`);
  if (!data.length) {
    cil.textContent = 'Zatím žádná změna ceny.';
    return;
  }

  cil.innerHTML = `<div class="udaje">${data.map((z) => `
      <div class="udaj">
        <div class="udaj__popisek">${esc(datumCas(z.created_at))}${z.uzivatel_jmeno ? ' · ' + esc(z.uzivatel_jmeno) : ''}</div>
        <div class="udaj__hodnota">
          ${z.cena_hal_pred == null ? 'nově' : esc(kc(z.cena_hal_pred))}
          → ${z.cena_hal_po == null ? 'na dotaz' : esc(kc(z.cena_hal_po))}
          ${z.duvod ? `<span class="text-faint"> — ${esc(z.duvod)}</span>` : ''}
        </div>
      </div>`).join('')}</div>`;
}
