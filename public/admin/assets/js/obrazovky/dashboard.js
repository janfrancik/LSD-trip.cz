// Přehled. Ve fázi 1 jsou skutečné jen poptávky, e-maily a poslední aktivita;
// karty pro termíny, rezervace a platby se ukazují jako připravované, aby bylo
// vidět, co kde bude, a obrazovka nevypadala rozbitě.

import { api } from '../api.js';
import { esc, pred, prazdno, sklon } from '../ui.js';
import { jdiNa } from '../admin.js';

export async function vykresli(koren) {
  const d = await api.get('/dashboard');

  const upozorneni = [];
  if (d.email_rezim === 'test') {
    upozorneni.push(
      'Testovací režim e-mailů: všechno se přepisuje na testovací adresu, zákazníkům nic neodejde.'
    );
  }
  if (d.email_rezim === 'vypnuto') {
    upozorneni.push('Odesílání e-mailů je vypnuté — e-maily se jen zapisují do logu.');
  }
  if (d.emaily.chyby > 0) {
    upozorneni.push(
      `${d.emaily.chyby} ${sklon(d.emaily.chyby, 'e-mail se neodeslal', 'e-maily se neodeslaly', 'e-mailů se neodeslalo')}.`
    );
  }

  koren.innerHTML = `
    <h1 class="nadpis" style="margin-bottom:16px">Přehled</h1>

    ${upozorneni.length
      ? `<div class="panel panel--tesny" style="border-left:3px solid var(--varovani)">
           ${upozorneni.map((t) => `<div class="text-faint">${esc(t)}</div>`).join('')}
         </div>`
      : ''}

    <div class="mrizka mrizka--karty" style="margin-bottom:18px">
      ${karta(d.poptavky.nove, 'Nové poptávky', d.poptavky.nove > 0)}
      ${karta(d.poptavky.vyrizuji_se, 'Rozpracované poptávky')}
      ${karta(d.poptavky.stare, 'Poptávky starší 2 dnů', d.poptavky.stare > 0)}
      ${karta(d.emaily.za_tyden, 'E-mailů za týden')}
    </div>

    <div class="mrizka mrizka--detail">
      <section class="panel">
        <div class="panel__hlava">
          <h2 class="nadpis-2">Poptávky k vyřízení</h2>
          <a href="/admin/poptavky" data-odkaz class="text-faint">Všechny →</a>
        </div>
        ${d.posledni_poptavky.length
          ? `<div class="seznam">
              ${d.posledni_poptavky.map(radekPoptavky).join('')}
             </div>`
          : prazdno('Nic nečeká', 'Všechny poptávky jsou vyřízené.')}
      </section>

      <section class="panel">
        <h2 class="nadpis-2" style="margin-bottom:12px">Poslední aktivita</h2>
        ${d.aktivita.length
          ? `<div class="udaje">
              ${d.aktivita
                .map(
                  (a) => `<div class="udaj">
                    <span class="udaj__popisek">${esc(pred(a.created_at))}</span>
                    <span class="udaj__hodnota">${esc(a.kdo)} — ${esc(popisAkce(a))}</span>
                  </div>`
                )
                .join('')}
             </div>`
          : prazdno('Zatím nic')}
      </section>
    </div>

    <section class="panel" style="margin-top:6px">
      <h2 class="nadpis-2" style="margin-bottom:4px">Co tu bude dál</h2>
      <p class="text-faint" style="margin-bottom:12px">
        Administrace se staví po částech. Tyhle karty se naplní v dalších fázích.
      </p>
      <div class="mrizka mrizka--karty">
        ${d.pripravuje_se
          .map(
            (p) => `<div class="karta-cisla karta-cisla--ceka">
              <div class="karta-cisla__cislo">fáze ${p.faze}</div>
              <div class="karta-cisla__popis">${esc(p.nazev)}</div>
            </div>`
          )
          .join('')}
      </div>
    </section>`;

  koren.querySelectorAll('[data-poptavka]').forEach((prvek) => {
    prvek.addEventListener('click', () => jdiNa(`poptavky/${prvek.dataset.poptavka}`));
  });
}

function karta(cislo, popis, pozor = false) {
  return `<div class="karta-cisla">
      <div class="karta-cisla__cislo${pozor ? ' karta-cisla__cislo--pozor' : ''}">${Number(cislo)}</div>
      <div class="karta-cisla__popis">${esc(popis)}</div>
    </div>`;
}

function radekPoptavky(p) {
  return `<button type="button" class="radek" data-poptavka="${p.id}">
      <div class="radek__hlava">
        <span class="radek__nazev">${esc(p.jmeno)}</span>
        <span class="stitek ${p.stav === 'nova' ? 'stitek--nova' : 'stitek--prubeh'}">
          ${esc(p.stav === 'nova' ? 'nová' : 'vyřizuje se')}
        </span>
      </div>
      <div class="radek__meta">${esc(p.email)} · ${esc(pred(p.created_at))}</div>
      ${p.ukazka ? `<div class="radek__ukazka">${esc(p.ukazka)}</div>` : ''}
    </button>`;
}

// Popis akce je záměrně podstatné jméno, ne sloveso: "změna poptávky", ne
// "změnil poptávku". Čeština by u sloves vyžadovala rod, a jména v týmu jsou
// ženská i mužská - tohle funguje pro kohokoli.
const AKCE = {
  prihlaseni: 'přihlášení',
  odhlaseni: 'odhlášení',
  prihlaseni_selhalo: 'neúspěšné přihlášení',
  vytvoreni: 'vytvoření',
  zmena: 'úprava',
  smazani: 'smazání',
  obnoveni: 'obnovení',
  odpoved: 'odpověď na poptávku',
  zmena_hesla: 'změna hesla',
  heslo_nastaveno: 'nastavení hesla',
  pozvanka_odeslana: 'odeslání pozvánky',
  reset_hesla_odeslan: 'odeslání odkazu na heslo',
  '2fa_zapnuto': 'zapnutí dvoufázového ověření',
  '2fa_vypnuto': 'vypnutí dvoufázového ověření',
};

// 2. pád, protože se skládá do "úprava uživatele Jan Novák".
const ENTITY = {
  uzivatel: 'uživatele',
  poptavka: 'poptávky',
  nastaveni: 'nastavení',
};

function popisAkce(a) {
  const akce = AKCE[a.akce] ?? a.akce;
  const potrebaEntita = ['vytvoreni', 'zmena', 'smazani', 'obnoveni'].includes(a.akce);
  if (!potrebaEntita) return a.popis ? `${akce} (${a.popis})` : akce;
  const entita = ENTITY[a.entita] ?? a.entita;
  return `${akce} ${entita}${a.popis ? ` ${a.popis}` : ''}`;
}
