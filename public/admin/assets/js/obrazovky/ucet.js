// Můj účet: změna hesla a dvoufázové ověření.

import { api } from '../api.js';
import { esc, pole, hlaska, ukazChybyPoli, potvrd, formularModal } from '../ui.js';
import { stav as globalniStav, vykresli as vykresliAdmin } from '../admin.js';

const POPIS_ROLE = {
  admin: 'Admin — vidíš a měníš všechno',
  provoz: 'Provoz — rezervace, termíny, obsah',
  instruktor: 'Instruktor — soupiska termínu',
  ucetni: 'Účetní — platby a faktury',
};

export async function vykresli(koren) {
  const { uzivatel } = globalniStav.ja;

  koren.innerHTML = `
    <h1 class="nadpis" style="margin-bottom:14px">Můj účet</h1>

    <div class="mrizka mrizka--detail">
      <div>
        <section class="panel">
          <h2 class="nadpis-2" style="margin-bottom:12px">Změna hesla</h2>
          <form id="form-heslo" novalidate>
            ${pole({ klic: 'stare', popisek: 'Stávající heslo', typ: 'heslo', povinne: true })}
            ${pole({
              klic: 'nove',
              popisek: 'Nové heslo',
              typ: 'heslo',
              napoveda: 'Alespoň 10 znaků. Po změně se odhlásí všechna ostatní zařízení.',
              povinne: true,
            })}
            ${pole({ klic: 'nove2', popisek: 'Nové heslo znovu', typ: 'heslo', povinne: true })}
            <button type="submit" class="btn btn--hlavni">Změnit heslo</button>
          </form>
        </section>

        <section class="panel">
          <div class="panel__hlava">
            <h2 class="nadpis-2">Dvoufázové ověření</h2>
            ${uzivatel.maTotp
              ? '<span class="stitek stitek--hotovo">zapnuté</span>'
              : '<span class="stitek">vypnuté</span>'}
          </div>
          <p class="text-faint" style="margin-bottom:14px">
            Kromě hesla budeš při přihlášení zadávat šestimístný kód z aplikace v telefonu.
            Doporučujeme to u účtů, které mají přístup k platbám a osobním údajům.
          </p>
          ${uzivatel.maTotp
            ? '<button type="button" class="btn btn--nebezpecny" data-2fa-vypnout>Vypnout dvoufázové ověření</button>'
            : '<button type="button" class="btn btn--obrys" data-2fa-zapnout>Zapnout dvoufázové ověření</button>'}
        </section>
      </div>

      <section class="panel">
        <h2 class="nadpis-2" style="margin-bottom:10px">Kdo jsem</h2>
        <div class="udaje">
          <div class="udaj"><span class="udaj__popisek">Jméno</span>
            <span class="udaj__hodnota">${esc(uzivatel.jmeno)}</span></div>
          <div class="udaj"><span class="udaj__popisek">E-mail</span>
            <span class="udaj__hodnota">${esc(uzivatel.email)}</span></div>
          <div class="udaj"><span class="udaj__popisek">Role</span>
            <span class="udaj__hodnota">${esc(POPIS_ROLE[uzivatel.role] ?? uzivatel.role)}</span></div>
        </div>
        <p class="text-faint" style="margin-top:12px">
          Jméno, e-mail nebo roli ti může změnit správce v sekci Uživatelé.
        </p>
      </section>
    </div>`;

  const form = koren.querySelector('#form-heslo');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const stare = form.querySelector('[name="stare"]').value;
    const nove = form.querySelector('[name="nove"]').value;
    const nove2 = form.querySelector('[name="nove2"]').value;

    if (nove !== nove2) {
      ukazChybyPoli(form, { nove2: 'Hesla se neshodují.' });
      return;
    }

    const tlacitko = form.querySelector('button[type="submit"]');
    tlacitko.disabled = true;
    try {
      const odpoved = await api.post('/zmena-hesla', { stare, nove });
      hlaska(odpoved.zprava, 'ok');
      form.reset();
    } catch (err) {
      if (!ukazChybyPoli(form, err.detaily)) hlaska(err.message, 'chyba');
    } finally {
      tlacitko.disabled = false;
    }
  });

  koren.querySelector('[data-2fa-zapnout]')?.addEventListener('click', async () => {
    let priprava;
    try {
      priprava = await api.post('/2fa/zapnout');
    } catch (err) {
      return hlaska(err.message, 'chyba');
    }

    const vstup = await formularModal({
      nadpis: 'Zapnout dvoufázové ověření',
      text: `Načti tenhle kód v aplikaci (Google Authenticator, Authy, 1Password) a opiš,
             co ti zobrazí.<br /><br />
             <span class="mono" style="word-break:break-all;color:var(--muted)">${esc(priprava.secret)}</span>`,
      potvrzeni: 'Potvrdit a zapnout',
      polia: [{ klic: 'kod', popisek: 'Kód z aplikace', napoveda: 'Šest čísel.' }],
    });
    if (!vstup) return;

    try {
      const odpoved = await api.post('/2fa/potvrdit', { kod: vstup.kod });
      hlaska(odpoved.zprava, 'ok');
      globalniStav.ja = await api.get('/ja');
      vykresliAdmin();
    } catch (err) {
      hlaska(err.message, 'chyba');
    }
  });

  koren.querySelector('[data-2fa-vypnout]')?.addEventListener('click', async () => {
    const vstup = await formularModal({
      nadpis: 'Vypnout dvoufázové ověření',
      text: 'Pro kontrolu zadej svoje heslo. Přihlášení pak bude jen na heslo.',
      potvrzeni: 'Vypnout',
      polia: [{ klic: 'heslo', popisek: 'Tvoje heslo', typ: 'heslo' }],
    });
    if (!vstup) return;

    try {
      const odpoved = await api.post('/2fa/vypnout', { heslo: vstup.heslo });
      hlaska(odpoved.zprava, 'ok');
      globalniStav.ja = await api.get('/ja');
      vykresliAdmin();
    } catch (err) {
      hlaska(err.message, 'chyba');
    }
  });
}
