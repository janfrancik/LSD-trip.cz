// Přihlašovací obrazovka: heslo, případně druhý krok s kódem z aplikace,
// a odkaz na zapomenuté heslo.

import { api, ChybaApi } from '../api.js';
import { esc, pole, ukazChybyPoli, hlaska } from '../ui.js';

export function vykresli(koren, poPrihlaseni) {
  let ceka = false;

  koren.innerHTML = `
    <div class="prihlaseni">
      <div class="prihlaseni__box">
        <div class="prihlaseni__znacka">LSD</div>
        <div class="prihlaseni__podznacka">Administrace</div>

        <form class="panel" id="form-prihlaseni" novalidate>
          <h1 class="nadpis-2" style="margin-bottom:16px">Přihlášení</h1>
          ${pole({ klic: 'email', popisek: 'E-mail', typ: 'email', povinne: true })}
          ${pole({ klic: 'heslo', popisek: 'Heslo', typ: 'heslo', povinne: true })}
          <div id="totp-misto" hidden>
            ${pole({
              klic: 'totp',
              popisek: 'Kód z aplikace',
              napoveda: 'Šest čísel z Google Authenticatoru, Authy nebo 1Passwordu.',
            })}
          </div>
          <button type="submit" class="btn btn--hlavni btn--blok" style="margin-top:4px">
            Přihlásit se
          </button>
          <div style="margin-top:14px;text-align:center">
            <button type="button" class="text-faint" data-zapomenute
                    style="text-decoration:underline">Zapomenuté heslo</button>
          </div>
        </form>
      </div>
    </div>`;

  const form = koren.querySelector('#form-prihlaseni');
  const totpMisto = koren.querySelector('#totp-misto');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (ceka) return;
    ceka = true;

    const tlacitko = form.querySelector('button[type="submit"]');
    tlacitko.disabled = true;
    tlacitko.textContent = 'Přihlašuji…';

    const telo = {
      email: form.querySelector('[name="email"]').value,
      heslo: form.querySelector('[name="heslo"]').value,
    };
    const totp = form.querySelector('[name="totp"]').value;
    if (totp) telo.totp = totp;

    try {
      await api.post('/prihlaseni', telo);
      await poPrihlaseni();
    } catch (err) {
      // Účet s dvoufázovým ověřením: server odpoví příznakem potrebaTotp.
      // Není to chyba uživatele, jen druhý krok - odkryjeme pole pro kód.
      if (err instanceof ChybaApi && err.data?.potrebaTotp) {
        totpMisto.hidden = false;
        form.querySelector('[name="totp"]').focus();
        hlaska('Zadej kód z aplikace.', 'ok');
      } else if (err instanceof ChybaApi) {
        if (!ukazChybyPoli(form, err.detaily)) hlaska(err.message, 'chyba');
      } else {
        hlaska('Přihlášení se nepovedlo.', 'chyba');
      }
    } finally {
      ceka = false;
      tlacitko.disabled = false;
      tlacitko.textContent = 'Přihlásit se';
    }
  });

  koren.querySelector('[data-zapomenute]').addEventListener('click', async () => {
    const email = form.querySelector('[name="email"]').value.trim();
    if (!email) {
      hlaska('Napiš nejdřív svůj e-mail, pošleme na něj odkaz.', 'chyba');
      form.querySelector('[name="email"]').focus();
      return;
    }
    try {
      const odpoved = await api.post('/reset-hesla', { email });
      hlaska(odpoved.zprava, 'ok');
    } catch (err) {
      hlaska(err.message, 'chyba');
    }
  });

  form.querySelector('[name="email"]').focus();
}
