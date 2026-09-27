// public/admin/assets/js/hlaseni.js
//
// Tlačítko „Nahlásit problém“, které je na testu na každé obrazovce
// administrace. Kontext (adresa, prohlížeč, rozlišení, čas, kdo je přihlášený)
// se sbírá sám - tester ho nemá opisovat a my ho potřebujeme, protože „nejde to“
// bez adresy a prohlížeče nejde opravit.

import { api } from './api.js';
import { esc, hlaska } from './ui.js';
import { nahrajObrazek, nahled } from './obrazky.js';

function kontext() {
  return {
    url: location.href,
    prohlizec: navigator.userAgent,
    rozliseni: `${window.innerWidth}×${window.innerHeight} px`,
  };
}

// Z dlouhého user agenta vytáhneme to, co člověku něco řekne. Do hlášení se
// posílá celý řetězec, tohle je jen pro zobrazení v okně.
function prohlizecSlovy(ua) {
  const zarizeni = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : 'počítač';
  const jmeno = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua) && !/Chromium/.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'prohlížeč';
  return `${jmeno}, ${zarizeni}`;
}

export function otevriHlaseni({ ukolId = null, nazevUkolu = null } = {}) {
  const nadoba = document.getElementById('modal');
  const data = kontext();
  const prilohy = [];

  nadoba.innerHTML = `
    <div class="modal-pozadi" data-zavrit>
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="hlaseni-nadpis">
        <h2 class="modal__nadpis" id="hlaseni-nadpis">Nahlásit problém</h2>
        <p class="modal__text">
          Napište vlastními slovy, co se stalo a co jste čekala.
          ${ukolId ? `Hlášení se připojí k úkolu <strong>${esc(nazevUkolu ?? '')}</strong>.` : ''}
        </p>

        <div class="pole-skupina" data-pole="text">
          <label class="pole-skupina__popisek" for="hlaseni-text">Co se stalo</label>
          <textarea class="pole" id="hlaseni-text" name="text"
            placeholder="Například: Po uložení poptávky se stránka vrátila na začátek a poznámka tam nebyla."></textarea>
          <div class="pole-skupina__chyba" hidden></div>
        </div>

        <div class="pole-skupina">
          <span class="pole-skupina__popisek">Snímek obrazovky (nepovinné)</span>
          <label class="btn btn--obrys btn--maly" for="hlaseni-soubor" style="cursor:pointer;justify-self:start">
            Přidat snímek
            <input type="file" id="hlaseni-soubor" accept="image/png,image/jpeg,image/webp" hidden />
          </label>
          <div class="nahledy" data-nahledy></div>
          <div class="pole-skupina__napoveda">
            Z telefonu se dá vybrat i fotka. Maximálně 6 MB.
          </div>
        </div>

        <div class="kontext">
          <div class="kontext__nadpis">Přiloží se samo</div>
          <div class="kontext__radek"><span>Obrazovka</span><span>${esc(data.url)}</span></div>
          <div class="kontext__radek"><span>Prohlížeč</span><span>${esc(prohlizecSlovy(data.prohlizec))}</span></div>
          <div class="kontext__radek"><span>Velikost okna</span><span>${esc(data.rozliseni)}</span></div>
          <div class="kontext__radek"><span>Kdo hlásí</span><span>vy, s časem odeslání</span></div>
        </div>

        <div class="modal__akce">
          <button type="button" class="btn btn--obrys" data-ne>Zrušit</button>
          <button type="submit" class="btn btn--hlavni">Odeslat hlášení</button>
        </div>
      </form>
    </div>`;

  const form = nadoba.querySelector('form');
  const zavri = () => {
    nadoba.innerHTML = '';
    document.removeEventListener('keydown', naEsc);
  };
  const naEsc = (e) => {
    if (e.key === 'Escape') zavri();
  };
  document.addEventListener('keydown', naEsc);

  nadoba.querySelector('[data-ne]').addEventListener('click', zavri);
  nadoba.querySelector('[data-zavrit]').addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-zavrit')) zavri();
  });

  const vstupSoubor = nadoba.querySelector('#hlaseni-soubor');
  vstupSoubor.addEventListener('change', async () => {
    const soubor = vstupSoubor.files?.[0];
    if (!soubor) return;
    try {
      const priloha = await nahrajObrazek(soubor);
      prilohy.push(priloha);
      nadoba.querySelector('[data-nahledy]').innerHTML = prilohy.map(nahled).join('');
    } catch (err) {
      hlaska(err.message, 'chyba');
    } finally {
      vstupSoubor.value = '';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = form.querySelector('[name="text"]').value.trim();
    const tlacitko = form.querySelector('button[type="submit"]');
    tlacitko.disabled = true;
    tlacitko.textContent = 'Odesílám…';
    try {
      const vysledek = await api.post('/akceptace/hlaseni', {
        text,
        ...data,
        ...(ukolId ? { ukol_id: ukolId } : {}),
        prilohy: prilohy.map((p) => p.id),
      });
      zavri();
      hlaska(vysledek.zprava, 'ok');
    } catch (err) {
      const chyba = form.querySelector('.pole-skupina__chyba');
      chyba.textContent = err.detaily?.text ?? err.message;
      chyba.hidden = false;
      tlacitko.disabled = false;
      tlacitko.textContent = 'Odeslat hlášení';
    }
  });

  form.querySelector('#hlaseni-text').focus();
}
