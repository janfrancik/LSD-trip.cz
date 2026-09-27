// Nastavení. Formulář se skládá z registru, který posílá server - přidání
// položky je tak jedna řádka v src/nastaveni.js a nic víc.

import { api } from '../api.js';
import { esc, pole, hlaska, ukazChybyPoli } from '../ui.js';
import { stav as globalniStav } from '../admin.js';

export async function vykresli(koren) {
  const [registr, integrace] = await Promise.all([
    api.get('/nastaveni'),
    api.get('/nastaveni/integrace'),
  ]);
  const muzeMenit = globalniStav.ja.prava.nastaveni === 'menit';

  const poSkupinach = registr.skupiny.map((skupina) => ({
    ...skupina,
    polozky: registr.polozky.filter((p) => p.skupina === skupina.klic),
  }));

  koren.innerHTML = `
    <h1 class="nadpis" style="margin-bottom:14px">Nastavení</h1>

    <form id="form-nastaveni">
      ${poSkupinach
        .map(
          (s) => `<section class="panel">
            <div style="margin-bottom:14px">
              <h2 class="nadpis-2">${esc(s.nazev)}</h2>
              <p class="text-faint">${esc(s.popis)}</p>
            </div>
            ${s.polozky
              .map((p) =>
                pole({
                  klic: p.klic,
                  popisek: p.popisek,
                  typ: p.typ,
                  hodnota: p.hodnota,
                  napoveda: p.napoveda ?? '',
                  min: p.min,
                  max: p.max,
                  povinne: p.povinne,
                })
              )
              .join('')}
          </section>`
        )
        .join('')}

      ${muzeMenit
        ? `<div style="position:sticky;bottom:calc(var(--spodni-lista) + 10px);padding-top:6px">
             <button type="submit" class="btn btn--hlavni btn--blok">Uložit nastavení</button>
           </div>`
        : '<p class="text-faint">Nastavení můžeš jen prohlížet.</p>'}
    </form>

    <section class="panel">
      <div style="margin-bottom:12px">
        <h2 class="nadpis-2">Napojené služby</h2>
        <p class="text-faint">
          Klíče k službám jsou v souboru <span class="mono">.env</span> na serveru, ne v databázi.
          Administrace o nich ukazuje jen to, jestli jsou nastavené.
        </p>
      </div>
      <div class="udaje">
        <div class="udaj">
          <span class="udaj__popisek">Prostředí</span>
          <span class="udaj__hodnota">${esc(integrace.prostredi)}</span>
        </div>
        <div class="udaj">
          <span class="udaj__popisek">Adresa webu</span>
          <span class="udaj__hodnota mono">${esc(integrace.app_url)}</span>
        </div>
        <div class="udaj">
          <span class="udaj__popisek">Indexace vyhledávači</span>
          <span class="udaj__hodnota">${integrace.indexace === 'povolit' ? 'povolená' : 'zakázaná'}</span>
        </div>
        ${integrace.sluzby.map(radekSluzby).join('')}
      </div>
    </section>`;

  if (!muzeMenit) return;

  const form = koren.querySelector('#form-nastaveni');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const telo = {};
    for (const p of registr.polozky) {
      const prvek = form.querySelector(`[name="${CSS.escape(p.klic)}"]`);
      if (!prvek) continue;
      telo[p.klic] = p.typ === 'bool' ? prvek.checked : prvek.value;
    }

    const tlacitko = form.querySelector('button[type="submit"]');
    tlacitko.disabled = true;
    tlacitko.textContent = 'Ukládám…';
    try {
      await api.patch('/nastaveni', telo);
      hlaska('Nastavení je uložené.', 'ok');
      vykresli(koren);
    } catch (err) {
      if (!ukazChybyPoli(form, err.detaily)) hlaska(err.message, 'chyba');
      tlacitko.disabled = false;
      tlacitko.textContent = 'Uložit nastavení';
    }
  });
}

function radekSluzby(s) {
  const stitek = s.nastaveno
    ? '<span class="stitek stitek--hotovo">nastaveno</span>'
    : '<span class="stitek stitek--prubeh">nenastaveno</span>';
  return `<div class="udaj">
      <span class="udaj__popisek">${esc(s.nazev)}</span>
      <span class="udaj__hodnota">
        ${stitek} ${s.rezim ? `<span class="text-faint">režim ${esc(s.rezim)}</span>` : ''}
        ${s.poznamka ? `<br /><span class="text-faint">${esc(s.poznamka)}</span>` : ''}
        ${s.testovaci_prijemce ? `<br /><span class="text-faint mono">${esc(s.testovaci_prijemce)}</span>` : ''}
      </span>
    </div>`;
}
