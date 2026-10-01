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

// -------------------------------------------------------------------- karta

async function karta(koren, id) {
  const kurz = await api.get(`/produkty/${id}`);
  const sazby = (await api.get('/dph-sazby')).data;
  const muze = smiMenit();

  koren.innerHTML = `
    <button type="button" class="btn btn--obrys btn--maly" data-zpet style="margin-bottom:14px">
      ← Zpátky na kurzy
    </button>

    <div class="panel__hlava" style="margin-bottom:6px">
      <h1 class="nadpis">${esc(kurz.nazev)}</h1>
      <span class="stitek ${kurz.aktivni ? 'stitek--hotovo' : 'stitek--nova'}">
        ${kurz.aktivni ? 'zveřejněný' : 'skrytý'}
      </span>
    </div>
    <p class="text-faint" style="margin-bottom:18px">
      Adresa na webu: <span class="mono">/kurz/${esc(kurz.slug)}</span>
      ${kurz.smazano_at ? ' · <strong>smazaný</strong>' : ''}
    </p>

    <form id="formular" novalidate>
      ${sekce('Texty', `
        ${pole({ klic: 'nazev', popisek: 'Název kurzu', hodnota: kurz.nazev, povinne: true })}
        ${pole({ klic: 'stitek', popisek: 'Štítek na kartě', hodnota: kurz.stitek ?? '',
                 napoveda: 'Krátké slovo navíc, například „Základní kurz“. Nechte prázdné, pokud žádný nechcete.' })}
        ${pole({ klic: 'perex', popisek: 'Krátký popis do výpisu', typ: 'textarea', hodnota: kurz.perex ?? '',
                 napoveda: 'Dvě věty, které se ukážou na kartě kurzu ve výpisu.' })}
        ${pole({ klic: 'popis', popisek: 'Podrobný popis', typ: 'textarea', hodnota: kurz.popis ?? '',
                 napoveda: 'Celý text na stránce kurzu. Odstavce oddělte prázdným řádkem.' })}
        ${pole({ klic: 'co_je_v_cene', popisek: 'Co je v ceně', typ: 'textarea', hodnota: kurz.co_je_v_cene ?? '',
                 napoveda: 'Každou položku na vlastní řádek.' })}
        <div class="mrizka mrizka--2">
          ${pole({ klic: 'delka_text', popisek: 'Jak dlouho trvá', hodnota: kurz.delka_text ?? '',
                   napoveda: 'Například „48 hodin“ nebo „5 dní“.' })}
          ${pole({ klic: 'uroven_text', popisek: 'Pro koho je', hodnota: kurz.uroven_text ?? '',
                   napoveda: 'Například „Začátečník“.' })}
        </div>
      `)}

      ${sekce('Cena a DPH', `
        ${pole({ klic: 'cena_na_dotaz', popisek: 'Cena na dotaz', typ: 'prepinac',
                 hodnota: kurz.cena_na_dotaz,
                 napoveda: 'Zaškrtněte u kurzů, kde cena závisí na rozsahu. Na webu se místo částky ukáže „Cena na dotaz“.' })}
        ${pole({ klic: 'cena_kc', popisek: 'Cena v korunách', hodnota: kurz.cena_hal == null ? '' : (kurz.cena_hal / 100),
                 napoveda: 'Jen číslo, bez „Kč“. Haléře oddělte čárkou.' })}
        ${pole({ klic: 'duvod_zmeny_ceny', popisek: 'Proč se cena mění', hodnota: '',
                 napoveda: 'Nepovinné, uloží se do historie cen. Vyplňte, až budete cenu měnit.' })}
        ${pole({ klic: 'dph_sazba_id', popisek: 'Sazba DPH', typ: 'vyber', hodnota: kurz.dph_sazba_id ?? '',
                 moznosti: sazby.filter((s) => s.aktivni).map((s) => ({ hodnota: s.id, popis: s.nazev })),
                 napoveda: 'Mění se jen u nově vystavených dokladů. Už vystavené zůstávají, jak jsou.' })}
      `)}

      ${sekce('Požadavky na účastníka', `
        <div class="mrizka mrizka--2">
          ${pole({ klic: 'min_vek', popisek: 'Nejnižší věk', typ: 'cislo', hodnota: kurz.min_vek ?? '', min: 0, max: 120 })}
          ${pole({ klic: 'max_vek', popisek: 'Nejvyšší věk', typ: 'cislo', hodnota: kurz.max_vek ?? '', min: 0, max: 120,
                   napoveda: 'Nechte prázdné, pokud horní hranice není.' })}
        </div>
        <div class="mrizka mrizka--2">
          ${pole({ klic: 'max_vaha_kg', popisek: 'Nejvyšší hmotnost (kg)', typ: 'cislo',
                   hodnota: kurz.max_vaha_kg ?? '', min: 0, max: 400 })}
          ${pole({ klic: 'souhlas_zastupce_do_let', popisek: 'Souhlas zástupce do kolika let', typ: 'cislo',
                   hodnota: kurz.souhlas_zastupce_do_let ?? '', min: 0, max: 26,
                   napoveda: 'Do tohoto věku si přihláška vyžádá souhlas zákonného zástupce.' })}
        </div>
        ${pole({ klic: 'vyzaduje_lekarskou_prohlidku', popisek: 'Vyžaduje lékařskou prohlídku', typ: 'prepinac',
                 hodnota: kurz.vyzaduje_lekarskou_prohlidku,
                 napoveda: 'Účastník ji doloží papírově na místě. V přihlášce jen potvrdí, že ji přinese.' })}
        ${pole({ klic: 'vyzaduje_zdravotni_prohlaseni', popisek: 'Vyžaduje zdravotní prohlášení', typ: 'prepinac',
                 hodnota: kurz.vyzaduje_zdravotni_prohlaseni })}
      `)}

      ${sekce('Zveřejnění a SEO', `
        ${pole({ klic: 'aktivni', popisek: 'Zveřejnit na webu', typ: 'prepinac', hodnota: kurz.aktivni,
                 napoveda: 'Dokud není zaškrtnuté, kurz na webu nikdo neuvidí.' })}
        ${pole({ klic: 'seo_title', popisek: 'Titulek pro vyhledávače', hodnota: kurz.seo_title ?? '',
                 napoveda: 'Nechte prázdné a použije se název kurzu.' })}
        ${pole({ klic: 'seo_description', popisek: 'Popis pro vyhledávače', typ: 'textarea',
                 hodnota: kurz.seo_description ?? '',
                 napoveda: 'Dvě věty, které se ukážou ve výsledcích vyhledávání.' })}
      `)}

      ${muze ? `<div class="ulozit-lista">
        <button type="submit" class="btn btn--hlavni btn--blok">Uložit změny</button>
      </div>` : '<p class="text-dim">Kurzy můžeš jen prohlížet.</p>'}
    </form>

    ${seznamPolozek({
      id: 'pozadavky',
      nadpis: 'Co si vzít a co doložit',
      popis: 'Odrážky, které se ukážou na stránce kurzu. Každá na vlastním řádku.',
      polozky: kurz.pozadavky,
      muze,
    })}

    ${seznamKroku(kurz.kroky, muze)}

    <div class="panel" style="margin-top:16px">
      <h2 class="nadpis-" style="font-size:16px;margin-bottom:10px">Historie cen</h2>
      <div id="historie" class="text-faint">Načítám…</div>
    </div>

    ${muze && !kurz.smazano_at ? `<div style="margin-top:20px">
      <button type="button" class="btn btn--nebezpecny" data-smazat>Smazat kurz</button>
    </div>` : ''}`;

  koren.querySelector('[data-zpet]').addEventListener('click', () => jdiNa('kurzy'));

  nactiHistorii(koren, id);
  navazFormular(koren, kurz, id);
  navazSeznamy(koren, kurz, id);

  koren.querySelector('[data-smazat]')?.addEventListener('click', async () => {
    const ano = await potvrd({
      nadpis: 'Smazat kurz?',
      text: `Kurz „${kurz.nazev}“ zmizí z webu i ze seznamu. Nic se nemaže natrvalo — ` +
            'najdeš ho pod záložkou Smazané a můžeš ho vrátit zpátky.',
      potvrzeni: 'Smazat kurz',
    });
    if (!ano) return;
    const odpoved = await api.del(`/produkty/${id}`);
    hlaska(odpoved.zprava);
    jdiNa('kurzy');
  });
}

function sekce(nadpis, vnitrek) {
  return `<div class="panel" style="margin-bottom:16px">
      <h2 class="nadpis-" style="font-size:16px;margin-bottom:12px">${esc(nadpis)}</h2>
      ${vnitrek}
    </div>`;
}

// ------------------------------------------------- ukládání karty

function navazFormular(koren, kurz, id) {
  const formular = koren.querySelector('#formular');
  if (!formular || !smiMenit()) return;

  // Cena a „na dotaz“ se vylučují - pole se podle přepínače zamkne, ať není
  // potřeba uhodnout, co platí.
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

    try {
      await api.patch(`/produkty/${id}`, telo);
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

// --------------------------------------------- požadavky a průběh

function seznamPolozek({ id, nadpis, popis, polozky, muze }) {
  return `<div class="panel" style="margin-bottom:16px" data-seznam="${id}">
      <h2 class="nadpis-" style="font-size:16px;margin-bottom:6px">${esc(nadpis)}</h2>
      <p class="text-faint" style="margin-bottom:10px">${esc(popis)}</p>
      <textarea class="pole" rows="6" data-radky
        ${muze ? '' : 'readonly'}>${esc(polozky.map((p) => p.text).join('\n'))}</textarea>
      ${muze ? '<div style="margin-top:10px"><button type="button" class="btn btn--obrys" data-ulozit>Uložit odrážky</button></div>' : ''}
    </div>`;
}

function seznamKroku(kroky, muze) {
  // Průběh je textové pole ve tvaru "Nadpis | text" na řádek. Vlastní formulář
  // s dvěma poli na krok by na telefonu zabral celou obrazovku.
  const text = kroky.map((k) => `${k.nadpis} | ${k.text ?? ''}`.trim().replace(/\s\|\s*$/, '')).join('\n');
  return `<div class="panel" style="margin-bottom:16px" data-seznam="kroky">
      <h2 class="nadpis-" style="font-size:16px;margin-bottom:6px">Jak kurz probíhá</h2>
      <p class="text-faint" style="margin-bottom:10px">
        Jeden krok na řádek. Nadpis a popis oddělte svislou čarou:
        <span class="mono">Teorie | Pátek od 10:00 na hangáru.</span>
        Čísla kroků doplníme sami.
      </p>
      <textarea class="pole" rows="6" data-radky ${muze ? '' : 'readonly'}>${esc(text)}</textarea>
      ${muze ? '<div style="margin-top:10px"><button type="button" class="btn btn--obrys" data-ulozit>Uložit průběh</button></div>' : ''}
    </div>`;
}

function navazSeznamy(koren, kurz, id) {
  koren.querySelectorAll('[data-seznam]').forEach((panel) => {
    const druh = panel.dataset.seznam;
    panel.querySelector('[data-ulozit]')?.addEventListener('click', async () => {
      const radky = panel.querySelector('[data-radky]').value
        .split('\n').map((r) => r.trim()).filter(Boolean);

      const polozky = druh === 'kroky'
        ? radky.map((r) => {
            const [nadpis, ...zbytek] = r.split('|');
            return {
              cislo: null,
              nadpis: nadpis.trim(),
              text: zbytek.join('|').trim() || null,
            };
          })
        : radky.map((text) => ({ text }));

      // Čísla kroků se dopočítají, ať je majitelka nemusí přepisovat,
      // když krok přibude doprostřed.
      if (druh === 'kroky') {
        polozky.forEach((p, i) => { p.cislo = String(i + 1).padStart(2, '0'); });
      }

      const prazdnyNadpis = druh === 'kroky' && polozky.some((p) => !p.nadpis);
      if (prazdnyNadpis) {
        hlaska('Každý krok musí mít nadpis před svislou čarou.', 'chyba');
        return;
      }

      await api.put(`/produkty/${id}/${druh}`, { polozky });
      hlaska('Uloženo.');
      karta(koren, id);
    });
  });
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
