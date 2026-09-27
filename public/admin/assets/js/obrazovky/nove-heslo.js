// Nastavení hesla z jednorázového odkazu (pozvánka nebo reset).

import { api } from '../api.js';
import { esc, pole, ukazChybyPoli, hlaska } from '../ui.js';

export async function vykresli(koren, token) {
  koren.innerHTML = `<div class="prihlaseni"><div class="prihlaseni__box">
      <div class="nacitani">Kontroluji odkaz…</div></div></div>`;

  let stav;
  try {
    stav = await api.get(`/reset-hesla/${encodeURIComponent(token ?? '')}`);
  } catch {
    stav = { platny: false };
  }

  if (!stav.platny) {
    koren.innerHTML = `
      <div class="prihlaseni"><div class="prihlaseni__box">
        <div class="prihlaseni__znacka">LSD</div>
        <div class="prihlaseni__podznacka">Administrace</div>
        <div class="panel">
          <h1 class="nadpis-2" style="margin-bottom:10px">Odkaz už neplatí</h1>
          <p class="text-dim">Odkaz na nastavení hesla je jednorázový a časově omezený.
             Požádej o nový na přihlašovací obrazovce nebo se ozvi správci.</p>
          <div style="margin-top:16px">
            <a class="btn btn--obrys btn--blok" href="/admin" data-odkaz>Na přihlášení</a>
          </div>
        </div>
      </div></div>`;
    return;
  }

  const jePozvanka = stav.ucel === 'pozvanka';

  koren.innerHTML = `
    <div class="prihlaseni"><div class="prihlaseni__box">
      <div class="prihlaseni__znacka">LSD</div>
      <div class="prihlaseni__podznacka">Administrace</div>
      <form class="panel" id="form-heslo" novalidate>
        <h1 class="nadpis-2" style="margin-bottom:6px">
          ${jePozvanka ? 'Vítej v administraci' : 'Nové heslo'}
        </h1>
        <p class="text-faint" style="margin-bottom:16px">
          ${jePozvanka
            ? `Ahoj ${esc(stav.jmeno ?? '')}, zvol si heslo a můžeš začít.`
            : 'Zvol si nové heslo. Ostatní zařízení se odhlásí.'}
        </p>
        ${pole({
          klic: 'heslo',
          popisek: 'Nové heslo',
          typ: 'heslo',
          napoveda: 'Alespoň 10 znaků. Klidně celá věta — dlouhé heslo je bezpečnější než složité.',
          povinne: true,
        })}
        ${pole({ klic: 'heslo2', popisek: 'Heslo znovu', typ: 'heslo', povinne: true })}
        <button type="submit" class="btn btn--hlavni btn--blok">Nastavit heslo</button>
      </form>
    </div></div>`;

  const form = koren.querySelector('#form-heslo');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const heslo = form.querySelector('[name="heslo"]').value;
    const heslo2 = form.querySelector('[name="heslo2"]').value;

    if (heslo !== heslo2) {
      ukazChybyPoli(form, { heslo2: 'Hesla se neshodují.' });
      return;
    }

    const tlacitko = form.querySelector('button[type="submit"]');
    tlacitko.disabled = true;
    try {
      const odpoved = await api.post(`/reset-hesla/${encodeURIComponent(token)}`, { heslo });
      hlaska(odpoved.zprava, 'ok');
      location.href = '/admin';
    } catch (err) {
      if (!ukazChybyPoli(form, err.detaily)) hlaska(err.message, 'chyba');
      tlacitko.disabled = false;
    }
  });

  form.querySelector('[name="heslo"]').focus();
}
