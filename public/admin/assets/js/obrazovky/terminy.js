// Termíny: kdy a kde se letí, kolik je míst a kdo na tom dělá.
//
// Obrazovka má tři podoby podle parametru v adrese:
//   /admin/terminy        seznam termínů
//   /admin/terminy/mista  číselník míst (patří k termínům, ne do nastavení)
//   /admin/terminy/42     karta termínu
//
// Datum a čas jsou hodiny na letišti, ne okamžik na ose času - proto se
// tady nikde nepřevádí na zónu a pracuje se s "YYYY-MM-DD" a "HH:MM" tak,
// jak přijdou z API (viz src/api/admin/terminy.js).

import { api, dotaz } from '../api.js';
import {
  esc, kc, prazdno, strankovani, hlaska, potvrd, pole, ukazChybyPoli, formularModal, sklon,
  isoDatum, denVTydnu, oDniDal,
} from '../ui.js';
import { omezNaTermin, novaPrihlaska } from './prihlasky.js';
import { jdiNa, stav as globalniStav } from '../admin.js';

const filtr = { q: '', strana: 1, produkt: '', stav: '', minule: '', smazane: '' };

// Číselníky se při přepínání obrazovek nestahují znovu - na mobilních datech
// je každý požadavek navíc znát.
let ciselniky = null;

const DNY_KRATCE = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
const DNY = ['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle'];

const STAVY = {
  otevreno: { popis: 'otevřeno', stitek: 'stitek--hotovo' },
  plno: { popis: 'plno', stitek: 'stitek--prubeh' },
  zruseno: { popis: 'zrušeno', stitek: 'stitek--chyba' },
  probehlo: { popis: 'proběhlo', stitek: 'stitek--spam' },
};

const ROLE = {
  aff: 'instruktor AFF',
  tandem: 'tandem pilot',
  kamera: 'kameraman',
  balic: 'balič',
};

export async function vykresli(koren, { parametr }) {
  if (parametr === 'mista') return mista(koren);
  if (parametr) return karta(koren, parametr);
  return seznam(koren);
}

// Z karty kurzu: "ukaž termíny zrovna tohohle kurzu".
export function omezNaKurz(produktId) {
  filtr.produkt = String(produktId);
  filtr.strana = 1;
  filtr.minule = '';
  filtr.smazane = '';
}

function smiMenit() {
  return globalniStav.ja?.prava?.terminy === 'menit';
}

// ------------------------------------------------------------------- čas

// "pátek 17. 5. 2026"
function denAdatum(iso, { sDnem = true } = {}) {
  if (!iso) return '—';
  const [rok, mesic, den] = String(iso).slice(0, 10).split('-');
  const cislo = `${Number(den)}. ${Number(mesic)}. ${rok}`;
  return sDnem ? `${DNY[denVTydnu(iso) - 1]} ${cislo}` : cislo;
}

// "8:00" z "08:00:00" - pro čtení. Čas na letišti se nikam nepřevádí.
function hodiny(cas) {
  if (!cas) return '';
  const [h, m] = String(cas).split(':');
  return `${Number(h)}:${m}`;
}

// "08:00" z "08:00:00" - pro <input type="time">. Nula na začátku tam musí
// zůstat: prohlížeč tvar "8:00" nepřijme a pole zůstane prázdné, takže by
// se uložením času smazal.
function proPoleCasu(cas) {
  return cas ? String(cas).slice(0, 5) : '';
}

function rozsahCasu(t) {
  if (t.popis_casu) return t.popis_casu;
  if (!t.cas_od) return '';
  return t.cas_do ? `${hodiny(t.cas_od)}–${hodiny(t.cas_do)}` : `od ${hodiny(t.cas_od)}`;
}

// Který den je teď v Praze. Přes cas.js, ne přes zónu prohlížeče - kdo se
// dívá z dovolené v Thajsku, má vidět stejné "dnes" jako server.
function dnesIso() {
  return isoDatum(new Date());
}

function obsazenost(t) {
  if (!t.kapacita_mist) return `${t.obsazeno_mist} přihlášených`;
  const volno = t.kapacita_mist - t.obsazeno_mist;
  return `${t.obsazeno_mist}/${t.kapacita_mist} míst` + (volno > 0 ? ` · volno ${volno}` : ' · plno');
}

// ------------------------------------------------------------- číselníky

async function nactiCiselniky(znovu = false) {
  if (ciselniky && !znovu) return ciselniky;
  const [kurzy, mistaData, lide] = await Promise.all([
    api.get('/produkty' + dotaz({ typ: 'kurz', na_strane: 200 })),
    api.get('/mista'),
    api.get('/terminy/instruktori'),
  ]);
  ciselniky = {
    kurzy: kurzy.data,
    mista: mistaData.data.filter((m) => m.aktivni),
    lide: lide.data,
  };
  return ciselniky;
}

// ---------------------------------------------------------------- seznam

async function seznam(koren) {
  const c = await nactiCiselniky();
  const data = await api.get('/terminy' + dotaz({ ...filtr, typ: 'kurz' }));

  const kurzNazev = c.kurzy.find((k) => String(k.id) === filtr.produkt)?.nazev;

  koren.innerHTML = `
    <div class="panel__hlava" style="margin-bottom:14px">
      <h1 class="nadpis">Termíny</h1>
      ${smiMenit() ? `<div class="hlava-akce">
        <button type="button" class="btn btn--obrys" data-mista>Místa</button>
        <button type="button" class="btn btn--obrys" data-hromadne>Hromadně</button>
        <button type="button" class="btn btn--hlavni" data-novy>Nový termín</button>
      </div>` : ''}
    </div>

    <div class="zalozky" role="tablist">
      ${zalozka('', 'Příští')}
      ${zalozka('minule', 'Proběhlé')}
      ${zalozka('smazane', 'Smazané')}
    </div>

    <div class="filtr-radek">
      <select class="pole" id="filtr-kurz" aria-label="Kurz">
        <option value="">Všechny kurzy</option>
        ${c.kurzy.map((k) => `<option value="${k.id}"${filtr.produkt === String(k.id) ? ' selected' : ''}>${esc(k.nazev)}</option>`).join('')}
      </select>
      <select class="pole" id="filtr-stav" aria-label="Stav">
        <option value="">Každý stav</option>
        ${Object.entries(STAVY).map(([klic, s]) => `<option value="${klic}"${filtr.stav === klic ? ' selected' : ''}>${esc(s.popis)}</option>`).join('')}
      </select>
      <input class="pole" type="search" id="hledat" placeholder="Kurz nebo místo…"
             value="${esc(filtr.q)}" aria-label="Hledat v termínech" />
      <button type="button" class="btn btn--obrys" data-hledat>Hledat</button>
    </div>

    ${data.data.length === 0
      ? prazdno(
          filtr.smazane ? 'Žádné smazané termíny'
            : filtr.minule ? 'Zatím nic neproběhlo'
            : kurzNazev ? `Kurz ${kurzNazev} zatím nemá termín`
            : 'Zatím žádné termíny',
          filtr.smazane
            ? 'Smazané termíny se sem ukládají a dají se obnovit.'
            : filtr.minule
              ? 'Proběhlé termíny se sem přesunou samy druhý den po termínu.'
              : smiMenit()
                ? 'Založ první termín tlačítkem nahoře. Hromadně se dá zadat třeba „každý pátek a sobotu v květnu“.'
                : 'Termíny zakládá provoz.'
        )
      : `
      <div class="seznam">${data.data.map(radek).join('')}</div>

      <table class="tabulka">
        <thead><tr>
          <th>Datum</th><th>Čas</th><th>Kurz</th><th>Místo</th><th>Místa</th><th>Stav</th><th></th>
        </tr></thead>
        <tbody>${data.data.map(radekTabulky).join('')}</tbody>
      </table>`}

    ${strankovani(data)}`;

  koren.querySelectorAll('[data-zalozka]').forEach((b) =>
    b.addEventListener('click', () => {
      filtr.minule = b.dataset.zalozka === 'minule' ? '1' : '';
      filtr.smazane = b.dataset.zalozka === 'smazane' ? '1' : '';
      filtr.strana = 1;
      seznam(koren);
    })
  );

  const hledat = () => {
    filtr.q = koren.querySelector('#hledat').value.trim();
    filtr.produkt = koren.querySelector('#filtr-kurz').value;
    filtr.stav = koren.querySelector('#filtr-stav').value;
    filtr.strana = 1;
    seznam(koren);
  };
  koren.querySelector('[data-hledat]')?.addEventListener('click', hledat);
  koren.querySelector('#hledat')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hledat();
  });
  koren.querySelector('#filtr-kurz')?.addEventListener('change', hledat);
  koren.querySelector('#filtr-stav')?.addEventListener('change', hledat);

  koren.querySelectorAll('[data-strana]').forEach((b) =>
    b.addEventListener('click', () => {
      filtr.strana = Number(b.dataset.strana);
      seznam(koren);
    })
  );

  koren.querySelector('[data-mista]')?.addEventListener('click', () => jdiNa('terminy/mista'));
  koren.querySelector('[data-novy]')?.addEventListener('click', () => novyTermin(koren));
  koren.querySelector('[data-hromadne]')?.addEventListener('click', () => hromadne(koren));

  koren.querySelectorAll('[data-otevrit]').forEach((b) =>
    b.addEventListener('click', () => jdiNa('terminy/' + b.dataset.otevrit))
  );

  koren.querySelectorAll('[data-obnovit]').forEach((b) =>
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const odpoved = await api.post(`/terminy/${b.dataset.obnovit}/obnovit`);
      hlaska(odpoved.zprava);
      seznam(koren);
    })
  );
}

function zalozka(klic, popis) {
  const aktivni = (klic === 'minule' && filtr.minule) || (klic === 'smazane' && filtr.smazane) ||
    (klic === '' && !filtr.minule && !filtr.smazane);
  return `<button type="button" role="tab" class="zalozka${aktivni ? ' zalozka--aktivni' : ''}"
      data-zalozka="${klic}" aria-selected="${aktivni}">${esc(popis)}</button>`;
}

function stitekStavu(t) {
  const s = STAVY[t.stav] ?? { popis: t.stav, stitek: 'stitek--spam' };
  return `<span class="stitek ${s.stitek}">${esc(s.popis)}</span>`;
}

function radek(t) {
  const dnes = t.datum === dnesIso();
  const akce = filtr.smazane && smiMenit()
    ? `<button type="button" class="btn btn--obrys btn--maly" data-obnovit="${t.id}">Obnovit</button>`
    : '';

  return `<div class="radek" style="display:flex;gap:12px;align-items:flex-start">
      <button type="button" data-otevrit="${t.id}"
              style="flex:1;background:none;border:0;padding:0;text-align:left;color:inherit;cursor:pointer">
        <span class="radek__hlava">
          <span class="radek__nazev">${esc(denAdatum(t.datum))}${dnes ? ' <span class="stitek stitek--nova">dnes</span>' : ''}</span>
          ${stitekStavu(t)}
        </span>
        <span class="radek__meta">
          ${esc([rozsahCasu(t), t.nazev_prepis || t.produkt_nazev, t.misto_nazev].filter(Boolean).join(' · '))}
        </span>
        <span class="radek__ukazka">${esc(obsazenost(t))}${!t.viditelny ? ' · skrytý na webu' : ''}</span>
      </button>
      <div style="display:flex;gap:6px;flex-shrink:0">${akce}</div>
    </div>`;
}

// Nad 900 px se karty schovají a ukáže se tabulka (viz admin.css), takže
// obojí musí umět totéž.
function radekTabulky(t) {
  const akce = filtr.smazane && smiMenit()
    ? `<button type="button" class="btn btn--obrys btn--maly" data-obnovit="${t.id}">Obnovit</button>`
    : '';

  return `<tr>
      <td>
        <button type="button" data-otevrit="${t.id}"
                style="background:none;border:0;padding:0;text-align:left;color:inherit;cursor:pointer;font:inherit">
          <strong>${esc(denAdatum(t.datum, { sDnem: false }))}</strong>
          <br /><span class="text-faint">${esc(DNY_KRATCE[denVTydnu(t.datum) - 1])}</span>
        </button>
      </td>
      <td class="tesne text-faint">${esc(rozsahCasu(t)) || '—'}</td>
      <td>${esc(t.nazev_prepis || t.produkt_nazev)}</td>
      <td class="tesne text-faint">${esc(t.misto_nazev ?? '—')}</td>
      <td class="tesne">${esc(obsazenost(t))}</td>
      <td class="tesne">${stitekStavu(t)}${!t.viditelny ? '<br /><span class="text-faint">skrytý</span>' : ''}</td>
      <td class="tesne"><div style="display:flex;gap:6px">${akce}</div></td>
    </tr>`;
}

// ------------------------------------------------------------ nový termín

async function novyTermin(koren) {
  const c = await nactiCiselniky();
  if (!c.kurzy.length) {
    await potvrd({
      nadpis: 'Nejdřív kurz',
      text: 'Termín patří ke kurzu a zatím žádný není. Založ ho v Kurzech.',
      potvrzeni: 'Rozumím', jenPotvrzeni: true, nebezpecne: false,
    });
    return;
  }

  const vysledek = await formularModal({
    nadpis: 'Nový termín',
    text: 'Zbytek doplníš na kartě termínu.',
    polia: [
      {
        klic: 'produkt_id', popisek: 'Kurz', typ: 'vyber',
        moznosti: c.kurzy.map((k) => ({ hodnota: k.id, popis: k.nazev })),
        hodnota: filtr.produkt || c.kurzy[0]?.id,
      },
      { klic: 'datum', popisek: 'Datum', typ: 'datum', hodnota: dnesIso(), povinne: true },
      { klic: 'cas_od', popisek: 'Sraz', typ: 'cas', napoveda: 'Nech prázdné, když čas upřesníš později.' },
      {
        klic: 'misto_id', popisek: 'Místo', typ: 'vyber',
        moznosti: [{ hodnota: '', popis: 'zatím neurčeno' },
          ...c.mista.map((m) => ({ hodnota: m.id, popis: m.nazev }))],
      },
      { klic: 'kapacita_mist', popisek: 'Kolik je míst', typ: 'cislo', hodnota: 6, min: 0,
        napoveda: '0 = bez omezení.' },
    ],
    potvrzeni: 'Založit',
  });
  if (!vysledek) return;

  try {
    const termin = await api.post('/terminy', {
      ...vysledek,
      misto_id: vysledek.misto_id || null,
    });
    hlaska('Termín je založený.');
    jdiNa('terminy/' + termin.id);
  } catch (chyba) {
    hlaska(chyba.message, 'chyba');
  }
}

// ------------------------------------------------------- hromadné zadání

// Vlastní modál, ne formularModal: dny v týdnu se vybírají sedmi velkými
// přepínači v jedné řadě. Sedm zaškrtávátek pod sebou by na mobilu znamenalo
// půl obrazovky scrollování.
async function hromadne(koren) {
  const c = await nactiCiselniky();
  if (!c.kurzy.length) return novyTermin(koren);

  const nadoba = document.getElementById('modal');
  const dnes = dnesIso();

  nadoba.innerHTML = `
    <div class="modal-pozadi" data-zavrit>
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-nadpis">
        <h2 class="modal__nadpis" id="modal-nadpis">Hromadné zadání termínů</h2>
        <p class="modal__text">
          Třeba „každý pátek a sobotu v květnu“. Dny, na kterých už termín je, se přeskočí.
        </p>
        ${pole({
          klic: 'produkt_id', popisek: 'Kurz', typ: 'vyber',
          moznosti: c.kurzy.map((k) => ({ hodnota: k.id, popis: k.nazev })),
          hodnota: filtr.produkt || c.kurzy[0]?.id,
        })}
        <div class="mrizka mrizka--2">
          ${pole({ klic: 'od', popisek: 'Od', typ: 'datum', hodnota: dnes })}
          ${pole({ klic: 'do', popisek: 'Do', typ: 'datum', hodnota: dnes })}
        </div>

        <div class="pole-skupina" data-pole="dny">
          <span class="pole-skupina__popisek">Ve kterých dnech</span>
          <div class="dny-vyber" role="group" aria-label="Dny v týdnu">
            ${DNY_KRATCE.map((d, i) => `
              <button type="button" class="den" data-den="${i + 1}" aria-pressed="false"
                      aria-label="${esc(DNY[i])}">${d}</button>`).join('')}
          </div>
          <div class="pole-skupina__napoveda">Nic nevybráno = každý den v rozsahu.</div>
          <div class="pole-skupina__chyba" hidden></div>
        </div>

        <div class="mrizka mrizka--2">
          ${pole({ klic: 'cas_od', popisek: 'Sraz', typ: 'cas' })}
          ${pole({ klic: 'cas_do', popisek: 'Konec', typ: 'cas' })}
        </div>
        ${pole({
          klic: 'misto_id', popisek: 'Místo', typ: 'vyber',
          moznosti: [{ hodnota: '', popis: 'zatím neurčeno' },
            ...c.mista.map((m) => ({ hodnota: m.id, popis: m.nazev }))],
        })}
        ${pole({ klic: 'kapacita_mist', popisek: 'Kolik je míst', typ: 'cislo', hodnota: 6, min: 0 })}
        ${pole({ klic: 'nazev_serie', popisek: 'Název série', napoveda: 'Jen pro přehled v administraci, na web nejde.' })}

        <div class="modal__akce">
          <button type="button" class="btn btn--obrys" data-ne>Zrušit</button>
          <button type="submit" class="btn btn--hlavni">Založit termíny</button>
        </div>
      </form>
    </div>`;

  const form = nadoba.querySelector('form');
  const zavri = () => {
    nadoba.innerHTML = '';
    document.removeEventListener('keydown', naEsc);
  };
  const naEsc = (e) => { if (e.key === 'Escape') zavri(); };
  document.addEventListener('keydown', naEsc);

  form.querySelectorAll('[data-den]').forEach((b) =>
    b.addEventListener('click', () => {
      const zapnuto = b.getAttribute('aria-pressed') === 'true';
      b.setAttribute('aria-pressed', String(!zapnuto));
      b.classList.toggle('den--vybrany', !zapnuto);
    })
  );

  nadoba.querySelector('[data-ne]').addEventListener('click', zavri);
  nadoba.querySelector('[data-zavrit]').addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-zavrit')) zavri();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const hodnota = (klic) => form.querySelector(`[name="${klic}"]`).value;
    const dny = [...form.querySelectorAll('[data-den][aria-pressed="true"]')]
      .map((b) => Number(b.dataset.den));

    try {
      const odpoved = await api.post('/terminy/hromadne', {
        produkt_id: hodnota('produkt_id'),
        od: hodnota('od'),
        do: hodnota('do'),
        dny,
        cas_od: hodnota('cas_od'),
        cas_do: hodnota('cas_do'),
        misto_id: hodnota('misto_id') || null,
        kapacita_mist: hodnota('kapacita_mist'),
        nazev_serie: hodnota('nazev_serie'),
      });
      zavri();
      hlaska(odpoved.zprava);
      // Když se doplňovalo něco, co už bylo, přepneme rovnou na Proběhlé -
      // jinak by po "Založeno 10 termínů" zůstal na obrazovce prázdný seznam.
      if (odpoved.vytvoreno && hodnota('do') < dnesIso()) filtr.minule = '1';
      seznam(koren);
    } catch (chyba) {
      if (!ukazChybyPoli(form, chyba.detaily)) hlaska(chyba.message, 'chyba');
    }
  });
}

// ------------------------------------------------------------ karta termínu

// Rozpracovaný stav karty. Instruktoři se ukládají spolu se zbytkem jedním
// tlačítkem - stejně jako odrážky na kartě kurzu.
let prace = { instruktori: [] };

async function karta(koren, id) {
  const c = await nactiCiselniky();
  let t;
  try {
    t = await api.get(`/terminy/${id}`);
  } catch (chyba) {
    koren.innerHTML = prazdno('Termín nenalezen', chyba.message);
    return;
  }

  prace = { instruktori: t.instruktori.map((i) => ({ ...i })) };
  const muze = smiMenit() && !t.smazano_at;

  koren.innerHTML = `
    <button type="button" class="btn btn--obrys btn--maly" data-zpet
            style="margin-bottom:12px">← Termíny</button>

    <form class="karta-termin" data-karta novalidate>
      <div class="karta-hlavicka">
        <div class="karta-hlavicka__text">
          <h1 class="karta-hlavicka__nazev" data-nahled-datum>${esc(denAdatum(t.datum))}</h1>
          <div class="karta-hlavicka__udaje">
            <span data-nahled-kurz>${esc(t.nazev_prepis || t.produkt_nazev)}</span>
            ${stitekStavu(t)}
            ${t.smazano_at ? '<span class="stitek stitek--spam">smazaný</span>' : ''}
            ${!t.viditelny ? '<span class="stitek stitek--prubeh">skrytý na webu</span>' : ''}
          </div>
          ${t.stav === 'zruseno' && t.zruseno_duvod
            ? `<p class="karta-hlavicka__duvod">Důvod zrušení: ${esc(t.zruseno_duvod)}</p>` : ''}
        </div>
        ${muze ? `<div class="karta-hlavicka__akce">
          <button type="button" class="btn btn--obrys btn--maly" data-kopie>Kopie dne</button>
          ${t.stav === 'zruseno'
            ? '<button type="button" class="btn btn--obrys btn--maly" data-otevrit-znovu>Otevřít znovu</button>'
            : '<button type="button" class="btn btn--obrys btn--maly" data-zrusit>Zrušit termín</button>'}
          <button type="button" class="btn btn--obrys btn--maly" data-smazat>Smazat</button>
        </div>` : ''}
      </div>

      <div class="karta-sloupce">
        ${sekce('Kdy a kde', 'Datum a čas jsou hodiny na letišti — tak, jak je uvidí přihlášený.', `
          ${pole({ klic: 'datum', popisek: 'Datum', typ: 'datum', hodnota: t.datum ?? '' })}
          <div class="mrizka mrizka--2">
            ${pole({ klic: 'cas_od', popisek: 'Sraz', typ: 'cas', hodnota: proPoleCasu(t.cas_od) })}
            ${pole({ klic: 'cas_do', popisek: 'Konec', typ: 'cas', hodnota: proPoleCasu(t.cas_do) })}
          </div>
          ${pole({
            klic: 'popis_casu', popisek: 'Čas slovy',
            hodnota: t.popis_casu ?? '',
            napoveda: 'Když přesný čas nedává smysl. Zobrazí se místo času.',
          })}
          ${pole({
            klic: 'misto_id', popisek: 'Místo', typ: 'vyber', hodnota: t.misto_id ?? '',
            moznosti: [{ hodnota: '', popis: 'zatím neurčeno' },
              ...c.mista.map((m) => ({ hodnota: m.id, popis: m.nazev }))],
            napoveda: 'Chybí letiště? Přidáš ho v Termíny → Místa.',
          })}`)}

        ${sekce('Kapacita a cena', 'Kolik lidí se vejde a jestli má termín vlastní cenu.', `
          ${pole({
            klic: 'kapacita_mist', popisek: 'Kolik je míst', typ: 'cislo', min: 0,
            hodnota: t.kapacita_mist ?? 0, napoveda: '0 = bez omezení.',
          })}
          ${pole({
            klic: 'cena_kc', popisek: 'Cena jen pro tenhle termín (Kč)', typ: 'cislo', min: 0,
            hodnota: t.cena_hal_prepis != null ? t.cena_hal_prepis / 100 : '',
            napoveda: `Prázdné = platí cena kurzu${t.produkt_cena_na_dotaz ? ' (na dotaz)' : ` (${kc(t.produkt_cena_hal)})`}.`,
          })}
          <p class="sekce__udaj">Přihlášených: <strong>${t.obsazeno_mist}</strong>${
            t.kapacita_mist ? ` z ${t.kapacita_mist}` : ''}</p>`)}

        ${sekce('Text pro web', 'Nepovinné. Když zůstane prázdné, vezme se název a popis kurzu.', `
          ${pole({
            klic: 'nazev_prepis', popisek: 'Název termínu', hodnota: t.nazev_prepis ?? '',
            napoveda: 'Např. „AFF květen — víkendový běh“.',
          })}
          ${pole({
            klic: 'popis', popisek: 'Poznámka k termínu', typ: 'textarea', hodnota: t.popis ?? '',
          })}
          ${pole({
            klic: 'viditelny', popisek: 'Ukázat termín na webu', typ: 'prepinac',
            hodnota: Boolean(t.viditelny),
            napoveda: 'Vypnuté: termín je jen v administraci, na webu se nenabízí.',
          })}`)}

        ${sekce('Instruktoři', 'Kdo na termínu dělá. Uloží se spolu se zbytkem karty.', `
          <div class="polozky" data-instruktori></div>
          ${muze ? `<button type="button" class="btn btn--obrys btn--blok" data-pridat-instruktora>
            + Přidat člověka
          </button>` : ''}`)}

        ${sekce('Soupiska', 'Papír na letiště: kdo přijede, kolik váží a co má doložit. ' +
          'Kdo je mimo limit věku nebo váhy, je zvýrazněný.', `
          <div class="soupiska-akce">
            ${muze ? '<button type="button" class="btn btn--hlavni btn--maly" data-nova-prihlaska>Nová přihláška</button>' : ''}
            <button type="button" class="btn btn--obrys btn--maly" data-tisk>Vytisknout</button>
            <a class="btn btn--obrys btn--maly" href="/api/admin/terminy/${t.id}/soupiska.csv"
               download>Stáhnout CSV</a>
            <button type="button" class="btn btn--obrys btn--maly" data-prihlasky>Přihlášky</button>
          </div>
          <div data-soupiska class="soupiska">Načítám…</div>`)}
      </div>
    </form>

    ${muze ? `<div class="ulozit-lista">
      <button type="button" class="btn btn--hlavni btn--blok" data-ulozit>Uložit změny</button>
    </div>` : ''}`;

  koren.querySelector('[data-zpet]').addEventListener('click', () => jdiNa('terminy'));
  if (!muze) {
    koren.querySelectorAll('.pole').forEach((p) => {
      p.setAttribute('disabled', 'disabled');
    });
  }

  vykresliInstruktory(koren, muze);
  nactiSoupisku(koren, t.id);

  koren.querySelector('[data-pridat-instruktora]')?.addEventListener('click', () => {
    const volny = c.lide.find((l) => !prace.instruktori.some((i) => i.uzivatel_id === l.id));
    if (!volny) return hlaska('Všichni už na termínu jsou.', 'chyba');
    prace.instruktori.push({ uzivatel_id: volny.id, jmeno: volny.jmeno, role: 'aff' });
    vykresliInstruktory(koren, muze);
  });

  koren.querySelector('[data-tisk]')?.addEventListener('click', () => window.print());
  // Přihláška po telefonu rovnou na tenhle termín - provoz ji zakládá
  // nejčastěji ve chvíli, kdy se na termín někdo ptá.
  koren.querySelector('[data-nova-prihlaska]')?.addEventListener('click', () =>
    novaPrihlaska({ terminId: t.id, poHotovu: () => karta(koren, t.id) })
  );
  koren.querySelector('[data-prihlasky]')?.addEventListener('click', () => {
    omezNaTermin(t.id);
    jdiNa('prihlasky');
  });

  koren.querySelector('[data-ulozit]')?.addEventListener('click', () => uloz(koren, t));
  koren.querySelector('[data-zrusit]')?.addEventListener('click', () => zrus(koren, t));
  koren.querySelector('[data-otevrit-znovu]')?.addEventListener('click', () => otevriZnovu(koren, t));
  koren.querySelector('[data-kopie]')?.addEventListener('click', () => kopieDne(koren, t));
  koren.querySelector('[data-smazat]')?.addEventListener('click', () => smaz(koren, t));

  // Datum a název v hlavičce se mění při psaní, ať je vidět, co se uloží.
  const datumPole = koren.querySelector('[name="datum"]');
  datumPole?.addEventListener('input', () => {
    koren.querySelector('[data-nahled-datum]').textContent = denAdatum(datumPole.value);
  });
  const nazevPole = koren.querySelector('[name="nazev_prepis"]');
  nazevPole?.addEventListener('input', () => {
    koren.querySelector('[data-nahled-kurz]').textContent =
      nazevPole.value.trim() || t.produkt_nazev;
  });
}

// Stejná struktura jako na kartě kurzu - obě karty mají působit jako jedna
// aplikace, ne jako dvě různé stránky.
function sekce(nadpis, napoveda, vnitrek) {
  return `<section class="sekce">
      <div class="sekce__hlava">
        <h2 class="sekce__nadpis">${esc(nadpis)}</h2>
        <p class="sekce__napoveda">${napoveda}</p>
      </div>
      ${vnitrek}
    </section>`;
}

function vykresliInstruktory(koren, muze) {
  const obal = koren.querySelector('[data-instruktori]');
  if (!obal) return;
  const lide = ciselniky?.lide ?? [];

  if (!prace.instruktori.length) {
    obal.innerHTML = '<p class="sekce__udaj text-faint">Zatím nikdo. Dá se doplnit i později.</p>';
    return;
  }

  obal.innerHTML = prace.instruktori.map((i, index) => `
      <div class="polozka polozka--radek">
        <select class="pole" data-kdo="${index}" aria-label="Kdo" ${muze ? '' : 'disabled'}>
          ${lide.map((l) => `<option value="${l.id}"${l.id === i.uzivatel_id ? ' selected' : ''}>${esc(l.jmeno)}</option>`).join('')}
        </select>
        <select class="pole" data-role="${index}" aria-label="Role" ${muze ? '' : 'disabled'}>
          ${Object.entries(ROLE).map(([klic, popis]) => `<option value="${klic}"${klic === i.role ? ' selected' : ''}>${esc(popis)}</option>`).join('')}
        </select>
        ${muze ? `<div class="polozka__akce">
          <button type="button" class="btn btn--obrys btn--maly" data-pryc="${index}"
                  aria-label="Odebrat">✕</button>
        </div>` : ''}
      </div>`).join('');

  obal.querySelectorAll('[data-kdo]').forEach((s) =>
    s.addEventListener('change', () => {
      prace.instruktori[Number(s.dataset.kdo)].uzivatel_id = Number(s.value);
    })
  );
  obal.querySelectorAll('[data-role]').forEach((s) =>
    s.addEventListener('change', () => {
      prace.instruktori[Number(s.dataset.role)].role = s.value;
    })
  );
  obal.querySelectorAll('[data-pryc]').forEach((b) =>
    b.addEventListener('click', () => {
      prace.instruktori.splice(Number(b.dataset.pryc), 1);
      vykresliInstruktory(koren, muze);
    })
  );
}

async function nactiSoupisku(koren, id) {
  const obal = koren.querySelector('[data-soupiska]');
  if (!obal) return;
  try {
    const s = await api.get(`/terminy/${id}/soupiska`);
    obal.innerHTML = s.ucastnici.length ? soupiskaHtml(s) : `
      <p class="sekce__udaj text-faint">Zatím se nikdo nepřihlásil.</p>`;

    obal.querySelectorAll('[data-prihlaska]').forEach((b) =>
      b.addEventListener('click', () => jdiNa('prihlasky/' + b.dataset.prihlaska))
    );
  } catch {
    obal.innerHTML = '<p class="sekce__udaj text-faint">Soupisku se nepodařilo načíst.</p>';
  }
}

// --------------------------------------------------------------- akce karty

function naHalere(hodnota) {
  const text = String(hodnota ?? '').trim().replace(',', '.');
  if (!text) return null;
  return Math.round(Number(text) * 100);
}

async function uloz(koren, t) {
  const form = koren.querySelector('[data-karta]');
  // Pole, které na kartě není, se neposílá. Prázdná hodnota z chybějícího
  // prvku by přepsala, co je v databázi - přesně tak se jednou smazal čas.
  const hodnota = (klic) => form.querySelector(`[name="${klic}"]`)?.value;

  const kapacita = hodnota('kapacita_mist');
  if (kapacita !== undefined && kapacita.trim() === '') {
    ukazChybyPoli(form, {
      kapacita_mist: 'Napiš, kolik je míst. Nula znamená bez omezení.',
    });
    return;
  }

  const telo = {
    datum: hodnota('datum'),
    cas_od: hodnota('cas_od'),
    cas_do: hodnota('cas_do'),
    popis_casu: hodnota('popis_casu'),
    misto_id: hodnota('misto_id') === undefined ? undefined : hodnota('misto_id') || null,
    kapacita_mist: kapacita,
    cena_hal_prepis: hodnota('cena_kc') === undefined ? undefined : naHalere(hodnota('cena_kc')),
    nazev_prepis: hodnota('nazev_prepis'),
    popis: hodnota('popis'),
    viditelny: form.querySelector('[name="viditelny"]')?.checked,
  };
  for (const [klic, h] of Object.entries(telo)) {
    if (h === undefined) delete telo[klic];
  }

  try {
    await api.patch(`/terminy/${t.id}`, telo);
    await api.put(`/terminy/${t.id}/instruktori`, {
      instruktori: prace.instruktori.map((i) => ({ uzivatel_id: i.uzivatel_id, role: i.role })),
    });
    hlaska('Termín je uložený.');
    karta(koren, t.id);
  } catch (chyba) {
    if (!ukazChybyPoli(form, chyba.detaily)) hlaska(chyba.message, 'chyba');
  }
}

async function zrus(koren, t) {
  const vysledek = await formularModal({
    nadpis: 'Zrušit termín',
    text: 'Přihlášky zůstanou a dá se jim napsat. Na webu se termín přestane nabízet.',
    polia: [
      { klic: 'duvod', popisek: 'Důvod zrušení', typ: 'textarea',
        napoveda: 'Přečte si ho i přihlášený — napiš to tak, jak bys to řekla do telefonu.' },
      { klic: 'poslat_email', popisek: 'Dát přihlášeným vědět e-mailem', typ: 'prepinac',
        hodnota: true },
    ],
    potvrzeni: 'Zrušit termín',
  });
  if (!vysledek) return;

  try {
    const odpoved = await api.post(`/terminy/${t.id}/zrusit`, {
      duvod: vysledek.duvod,
      poslat_email: vysledek.poslat_email,
    });
    hlaska(odpoved.zprava ?? 'Termín je zrušený.');
    karta(koren, t.id);
  } catch (chyba) {
    hlaska(chyba.message, 'chyba');
  }
}

async function otevriZnovu(koren, t) {
  if (!(await potvrd({
    nadpis: 'Otevřít termín znovu',
    text: 'Termín se zase začne nabízet a důvod zrušení zmizí.',
    potvrzeni: 'Otevřít', nebezpecne: false,
  }))) return;

  try {
    await api.patch(`/terminy/${t.id}`, { stav: 'otevreno' });
    hlaska('Termín je zase otevřený.');
    karta(koren, t.id);
  } catch (chyba) {
    hlaska(chyba.message, 'chyba');
  }
}

async function kopieDne(koren, t) {
  const vysledek = await formularModal({
    nadpis: 'Kopie dne',
    text: `Udělá další termíny podle ${esc(denAdatum(t.datum))} — stejný čas, místo, kapacita i lidé.`,
    polia: [
      { klic: 'datum', popisek: 'První nový termín', typ: 'datum', hodnota: oDniDal(t.datum, 7) },
      {
        klic: 'opakovani', popisek: 'A kolikrát to zopakovat po týdnu', typ: 'cislo',
        hodnota: 0, min: 0, max: 20,
        napoveda: '0 = jen ten jeden den. 3 = ještě tři další týdny po něm.',
      },
    ],
    potvrzeni: 'Zkopírovat',
  });
  if (!vysledek) return;

  const datumy = [];
  for (let i = 0; i <= Number(vysledek.opakovani || 0); i++) {
    datumy.push(oDniDal(vysledek.datum, i * 7));
  }

  try {
    const odpoved = await api.post(`/terminy/${t.id}/kopie`, { datumy });
    hlaska(odpoved.zprava);
    jdiNa('terminy');
  } catch (chyba) {
    hlaska(chyba.message, 'chyba');
  }
}

async function smaz(koren, t) {
  if (!(await potvrd({
    nadpis: 'Smazat termín',
    text: 'Termín zmizí z výpisů. Najdeš ho v Smazaných a dá se vrátit.',
    potvrzeni: 'Smazat',
  }))) return;

  try {
    const odpoved = await api.del(`/terminy/${t.id}`);
    hlaska(odpoved.zprava);
    jdiNa('terminy');
  } catch (chyba) {
    hlaska(chyba.message, 'chyba');
  }
}

// ------------------------------------------------------------------- místa

async function mista(koren) {
  const data = await api.get('/mista' + dotaz({ smazane: filtr.smazaneMista ? '1' : '' }));
  const muze = smiMenit();

  koren.innerHTML = `
    <button type="button" class="btn btn--obrys btn--maly" data-zpet
            style="margin-bottom:12px">← Termíny</button>

    <div class="panel__hlava" style="margin-bottom:14px">
      <h1 class="nadpis">Místa</h1>
      ${muze ? '<button type="button" class="btn btn--hlavni" data-nove>Nové místo</button>' : ''}
    </div>

    <p class="sekce__napoveda" style="margin-bottom:14px">
      Letiště a další místa, kam se dá termín umístit. Vypnuté místo zůstane
      u starých termínů, ale u nových se nenabídne.
    </p>

    <div class="zalozky" role="tablist">
      <button type="button" role="tab" class="zalozka${filtr.smazaneMista ? '' : ' zalozka--aktivni'}"
        data-prepnout="" aria-selected="${!filtr.smazaneMista}">Místa</button>
      <button type="button" role="tab" class="zalozka${filtr.smazaneMista ? ' zalozka--aktivni' : ''}"
        data-prepnout="1" aria-selected="${Boolean(filtr.smazaneMista)}">Smazaná</button>
    </div>

    ${data.data.length === 0
      ? prazdno('Zatím žádné místo', 'Bez místa se termín obejde, ale na webu pak není kam přijet.')
      : `<div class="seznam">${data.data.map((m) => `
        <div class="radek" style="display:flex;gap:12px;align-items:flex-start">
          <div style="flex:1">
            <span class="radek__hlava">
              <span class="radek__nazev">${esc(m.nazev)}</span>
              ${m.aktivni ? '' : '<span class="stitek stitek--spam">vypnuté</span>'}
            </span>
            <span class="radek__meta">${esc(m.adresa ?? 'bez adresy')}</span>
            <span class="radek__ukazka">${m.pocet_terminu} ${sklon(m.pocet_terminu, 'termín', 'termíny', 'termínů')}</span>
          </div>
          ${muze ? `<div style="display:flex;gap:6px;flex-shrink:0">
            ${filtr.smazaneMista
              ? `<button type="button" class="btn btn--obrys btn--maly" data-obnovit="${m.id}">Obnovit</button>`
              : `<button type="button" class="btn btn--obrys btn--maly" data-upravit="${m.id}">Upravit</button>
                 <button type="button" class="btn btn--obrys btn--maly" data-smazat="${m.id}"
                         aria-label="Smazat ${esc(m.nazev)}">✕</button>`}
          </div>` : ''}
        </div>`).join('')}</div>`}`;

  koren.querySelector('[data-zpet]').addEventListener('click', () => jdiNa('terminy'));
  koren.querySelectorAll('[data-prepnout]').forEach((b) =>
    b.addEventListener('click', () => {
      filtr.smazaneMista = b.dataset.prepnout === '1';
      mista(koren);
    })
  );

  koren.querySelector('[data-nove]')?.addEventListener('click', () => upravMisto(koren, null));
  koren.querySelectorAll('[data-upravit]').forEach((b) =>
    b.addEventListener('click', () =>
      upravMisto(koren, data.data.find((m) => m.id === Number(b.dataset.upravit)))
    )
  );

  koren.querySelectorAll('[data-smazat]').forEach((b) =>
    b.addEventListener('click', async () => {
      const misto = data.data.find((m) => m.id === Number(b.dataset.smazat));
      if (!(await potvrd({
        nadpis: `Smazat ${misto.nazev}?`,
        text: 'Místo zmizí z nabídky. U starých termínů zůstane a dá se vrátit.',
        potvrzeni: 'Smazat',
      }))) return;
      try {
        hlaska((await api.del(`/mista/${misto.id}`)).zprava);
        ciselniky = null;
        mista(koren);
      } catch (chyba) {
        hlaska(chyba.message, 'chyba');
      }
    })
  );

  koren.querySelectorAll('[data-obnovit]').forEach((b) =>
    b.addEventListener('click', async () => {
      hlaska((await api.post(`/mista/${b.dataset.obnovit}/obnovit`)).zprava);
      ciselniky = null;
      mista(koren);
    })
  );
}

async function upravMisto(koren, misto) {
  const vysledek = await formularModal({
    nadpis: misto ? `Úprava místa ${misto.nazev}` : 'Nové místo',
    polia: [
      { klic: 'nazev', popisek: 'Název', hodnota: misto?.nazev ?? '', povinne: true,
        napoveda: 'Jak se to jmenuje na webu — např. „Letiště Jihlava“.' },
      { klic: 'adresa', popisek: 'Adresa', hodnota: misto?.adresa ?? '' },
      { klic: 'gps_lat', popisek: 'GPS šířka', hodnota: misto?.gps_lat ?? '',
        napoveda: 'Nepovinné. Z mapy, např. 49.4061.' },
      { klic: 'gps_lon', popisek: 'GPS délka', hodnota: misto?.gps_lon ?? '' },
      { klic: 'poznamka', popisek: 'Poznámka', typ: 'textarea', hodnota: misto?.poznamka ?? '',
        napoveda: 'Jen pro vás — kde je brána, komu volat.' },
      { klic: 'aktivni', popisek: 'Nabízet u nových termínů', typ: 'prepinac',
        hodnota: misto ? Boolean(misto.aktivni) : true },
    ],
    potvrzeni: misto ? 'Uložit' : 'Založit',
  });
  if (!vysledek) return;

  const telo = {
    ...vysledek,
    gps_lat: vysledek.gps_lat === '' ? null : vysledek.gps_lat,
    gps_lon: vysledek.gps_lon === '' ? null : vysledek.gps_lon,
  };

  try {
    if (misto) await api.patch(`/mista/${misto.id}`, telo);
    else await api.post('/mista', telo);
    hlaska(misto ? 'Místo je uložené.' : 'Místo je založené.');
    ciselniky = null;
    mista(koren);
  } catch (chyba) {
    hlaska(chyba.message, 'chyba');
  }
}

// Tabulka soupisky. Tiskne se jako jediná věc na stránce (viz @media print
// v admin.css), proto má vlastní třídu a ne jen .tabulka - na papíře má
// vypadat jako formulář na podpis, ne jako obrazovka.
function soupiskaHtml(s) {
  const t = s.termin;
  const limity = [
    t.limity.min_vek ? `od ${t.limity.min_vek} let` : '',
    t.limity.max_vek ? `do ${t.limity.max_vek} let` : '',
    t.limity.max_vaha_kg ? `do ${t.limity.max_vaha_kg} kg` : '',
  ].filter(Boolean).join(' · ');

  return `
    <div class="soupiska-list">
      <div class="soupiska-hlavicka">
        <h2>${esc(t.produkt_nazev)}</h2>
        <p>
          ${esc(denAdatum(t.datum))}${rozsahCasu(t) ? ` · ${esc(rozsahCasu(t))}` : ''}
          ${t.misto ? ` · ${esc(t.misto)}` : ''}
        </p>
        <p class="soupiska-hlavicka__meta">
          Přihlášeno ${s.pocty.prihlaseno}${t.kapacita_mist ? ` z ${t.kapacita_mist}` : ''} ·
          zaplaceno ${s.pocty.zaplaceno}${
            s.pocty.bez_souhlasu ? ` · souhlasy na místě: ${s.pocty.bez_souhlasu}` : ''
          }${limity ? ` · limity kurzu: ${esc(limity)}` : ''}
          ${s.instruktori.length
            ? ` · instruktoři: ${esc(s.instruktori.map((i) => i.jmeno).join(', '))}`
            : ''}
        </p>
      </div>

      <table class="soupiska-tabulka">
        <thead><tr>
          <th>Jméno</th><th>Věk</th><th>Váha</th><th>Telefon</th><th>Stav</th>
          <th>Zapl.</th><th>Prohlídka</th><th>Zástupce</th><th>Souhlasy</th><th>Poznámka</th>
        </tr></thead>
        <tbody>
          ${s.ucastnici.map((u) => `
            <tr class="${u.varovani.length ? 'soupiska-tabulka__pozor' : ''}">
              <td>
                <button type="button" class="odkaz-tlacitko" data-prihlaska="${u.rezervace_id}">
                  ${esc(u.jmeno)}
                </button>
                <span class="soupiska-kod">${esc(u.kod)}</span>
                ${u.varovani.length ? `<div class="soupiska-pozor">${esc(u.varovani.join('; '))}</div>` : ''}
              </td>
              <td>${u.vek ?? '—'}</td>
              <td>${u.vaha_kg ? u.vaha_kg + ' kg' : '—'}</td>
              <td>${esc(u.telefon ?? '—')}</td>
              <td>${esc(u.stav_popis)}</td>
              <td>${u.zaplaceno ? 'ano' : 'ne'}</td>
              <td>${u.doklada_prohlidku ? 'ano' : 'ne'}</td>
              <td>${u.zajisti_souhlas_zastupce ? 'ano' : '—'}</td>
              <td>${u.souhlasy_online ? 'online' : '<strong>na místě</strong>'}</td>
              <td>${esc(u.poznamka ?? '')}</td>
            </tr>`).join('')}
        </tbody>
      </table>

      ${s.pocty.mimo_limit
        ? `<p class="soupiska-pozor soupiska-pozor--souhrn">
             ${s.pocty.mimo_limit} ${s.pocty.mimo_limit === 1 ? 'účastník je' : 'účastníků je'} mimo limit kurzu.
             Rozhodnutí je na provozu — nezamítá se to samo.
           </p>`
        : ''}
    </div>`;
}
