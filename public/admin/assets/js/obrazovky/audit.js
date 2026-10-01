// Audit log. Jen čtení, s filtry podle entity, člověka a období.

import { api, dotaz } from '../api.js';
import { esc, datumCas, prazdno, strankovani, pole } from '../ui.js';

const ENTITY = [
  { hodnota: '', popis: 'Všechno' },
  { hodnota: 'uzivatel', popis: 'Uživatelé' },
  { hodnota: 'poptavka', popis: 'Poptávky' },
  { hodnota: 'produkt', popis: 'Kurzy a produkty' },
  { hodnota: 'dph_sazba', popis: 'Sazby DPH' },
  { hodnota: 'nastaveni', popis: 'Nastavení' },
];

const AKCE = {
  prihlaseni: 'přihlášení',
  odhlaseni: 'odhlášení',
  prihlaseni_selhalo: 'neúspěšné přihlášení',
  vytvoreni: 'vytvoření',
  zmena: 'změna',
  smazani: 'smazání',
  obnoveni: 'obnovení',
  odpoved: 'odpověď',
  zmena_hesla: 'změna hesla',
  heslo_nastaveno: 'nastavení hesla',
  pozvanka_odeslana: 'odeslání pozvánky',
  reset_hesla_odeslan: 'odeslání resetu hesla',
  '2fa_zapnuto': 'zapnutí 2FA',
  '2fa_vypnuto': 'vypnutí 2FA',
};

const filtr = { entita: '', q: '', od: '', do: '', strana: 1 };

export async function vykresli(koren) {
  const data = await api.get('/audit' + dotaz(filtr));

  koren.innerHTML = `
    <h1 class="nadpis" style="margin-bottom:6px">Audit</h1>
    <p class="text-faint" style="margin-bottom:16px">
      Každá změna v administraci: kdo, kdy, co a jak to vypadalo předtím.
    </p>

    <div class="panel panel--tesny">
      <div class="mrizka mrizka--2">
        ${pole({ klic: 'entita', popisek: 'Čeho se týká', typ: 'vyber', hodnota: filtr.entita, moznosti: ENTITY })}
        ${pole({ klic: 'q', popisek: 'Hledat', hodnota: filtr.q, napoveda: 'Popis, akce nebo e-mail.' })}
        ${pole({ klic: 'od', popisek: 'Od data', hodnota: filtr.od })}
        ${pole({ klic: 'do', popisek: 'Do data', hodnota: filtr.do })}
      </div>
      <button type="button" class="btn btn--obrys btn--blok" data-filtrovat>Použít filtr</button>
    </div>

    ${data.data.length === 0
      ? prazdno('Nic k zobrazení', 'Pro zvolený filtr není žádný záznam.')
      : `<div class="seznam">${data.data.map(radek).join('')}</div>
         <table class="tabulka">
           <thead><tr><th>Kdy</th><th>Kdo</th><th>Akce</th><th>Detail</th><th>Změna</th></tr></thead>
           <tbody>${data.data.map(radekTabulky).join('')}</tbody>
         </table>`}

    ${strankovani(data)}`;

  koren.querySelector('[data-filtrovat]').addEventListener('click', () => {
    const panel = koren.querySelector('.panel');
    filtr.entita = panel.querySelector('[name="entita"]').value;
    filtr.q = panel.querySelector('[name="q"]').value.trim();
    filtr.od = panel.querySelector('[name="od"]').value.trim();
    filtr.do = panel.querySelector('[name="do"]').value.trim();
    filtr.strana = 1;
    vykresli(koren);
  });

  koren.querySelectorAll('[data-strana]').forEach((b) =>
    b.addEventListener('click', () => {
      filtr.strana = Number(b.dataset.strana);
      vykresli(koren);
    })
  );
}

// Změněná pole vypisujeme jako "před → po", ať je vidět, co se stalo.
function zmena(z) {
  if (!z.pred && !z.po) return '';
  const klice = new Set([...Object.keys(z.pred ?? {}), ...Object.keys(z.po ?? {})]);
  return `<div class="rozdil">
      ${[...klice]
        .map(
          (k) => `<div>
            <span class="text-faint">${esc(k)}:</span>
            <span class="rozdil__pred">${esc(formatuj(z.pred?.[k]))}</span> →
            <span class="rozdil__po">${esc(formatuj(z.po?.[k]))}</span>
          </div>`
        )
        .join('')}
    </div>`;
}

function formatuj(hodnota) {
  if (hodnota === null || hodnota === undefined || hodnota === '') return '(prázdné)';
  if (hodnota === true || hodnota === 1) return 'ano';
  if (hodnota === false || hodnota === 0) return 'ne';
  return String(hodnota);
}

function radek(a) {
  return `<div class="radek">
      <div class="radek__hlava">
        <span class="radek__nazev">${esc(AKCE[a.akce] ?? a.akce)}</span>
        <span class="text-faint">${esc(datumCas(a.created_at))}</span>
      </div>
      <div class="radek__meta">${esc(a.kdo)}${a.popis ? ` · ${esc(a.popis)}` : ''}</div>
      ${zmena(a)}
    </div>`;
}

function radekTabulky(a) {
  return `<tr>
      <td class="tesne text-faint">${esc(datumCas(a.created_at))}</td>
      <td class="tesne">${esc(a.kdo)}</td>
      <td class="tesne">${esc(AKCE[a.akce] ?? a.akce)}</td>
      <td>${esc(a.popis ?? '')}<br /><span class="text-faint">${esc(a.entita)}${a.entita_id ? ` #${esc(a.entita_id)}` : ''}</span></td>
      <td>${zmena(a)}</td>
    </tr>`;
}
