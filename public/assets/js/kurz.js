/* ==========================================================================
   LSD — stránka kurzu (poptávka)
   ==========================================================================

   Stránky /kurzy a /kurz/:slug vykresluje server (src/web/kurzy.js), takže
   obsah je v HTML i bez JavaScriptu. Tenhle skript přidává jedinou věc,
   která se bez něj neobejde: odeslání poptávky bez opuštění stránky.

   Jde do toho samého endpointu jako průvodce rezervací na titulce
   (POST /api/poptavky) a končí stejnou větou — poptávka je poptávka,
   přihlášky přijdou s etapou E5.
   ========================================================================== */

(function () {
  'use strict';

  var form = document.querySelector('[data-poptavka]');
  if (!form) return;

  var stav = form.querySelector('[data-stav]');
  var tlacitko = form.querySelector('[data-odeslat]');
  var odesilam = false;

  function rekni(text, chyba) {
    stav.textContent = text;
    stav.className = 'poptavka__stav' + (chyba ? ' poptavka__stav--chyba' : '');
  }

  function hodnota(jmeno) {
    var prvek = form.querySelector('[name="' + jmeno + '"]');
    return prvek ? String(prvek.value || '').trim() : '';
  }

  /* Co provoz uvidí u poptávky v administraci. Kurz a termín nemají zatím
     vlastní sloupce (přijdou v E5), takže jdou do textu zprávy - pořád je to
     lepší než poptávka bez kontextu. */
  function textPoptavky() {
    var radky = ['Kurz: ' + form.getAttribute('data-kurz')];
    var termin = hodnota('termin');
    if (termin) radky.push('Termín: ' + termin);
    if (hodnota('zprava')) radky.push('', hodnota('zprava'));
    return radky.join('\n');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (odesilam) return;

    var jmeno = hodnota('jmeno');
    var email = hodnota('email');
    if (jmeno.length < 2 || email.indexOf('@') === -1) {
      rekni('Vyplň prosím jméno a platný e-mail, ať se máme kam ozvat.', true);
      return;
    }

    odesilam = true;
    tlacitko.disabled = true;
    tlacitko.textContent = 'Odesílám…';
    rekni('');

    fetch('/api/poptavky', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jmeno: jmeno,
        email: email,
        telefon: hodnota('telefon'),
        zprava: textPoptavky(),
        web: hodnota('web')
      })
    })
      .then(function (odpoved) {
        return odpoved.json().catch(function () { return {}; }).then(function (data) {
          if (!odpoved.ok) throw new Error(data.chyba || 'Zprávu se nepodařilo odeslat.');
          return data;
        });
      })
      .then(function () {
        form.querySelector('.field-grid').hidden = true;
        form.querySelector('[name="zprava"]').hidden = true;
        tlacitko.hidden = true;
        rekni('Poptávka odeslána, ozveme se. Nic teď neplatíš a nic není závazné.');
      })
      .catch(function (chyba) {
        odesilam = false;
        tlacitko.disabled = false;
        tlacitko.textContent = 'Odeslat poptávku';
        rekni(chyba.message + ' Zkus to prosím znovu, nebo nám zavolej.', true);
      });
  });
})();
