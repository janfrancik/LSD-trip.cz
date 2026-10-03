/* ==========================================================================
   LSD — stránka kurzu: přihláška a poptávka
   ==========================================================================

   Stránku vykresluje server (src/web/kurzy.js), takže obsah je v HTML
   i bez JavaScriptu. Tenhle skript přidává dvě věci, které se bez něj
   neobejdou: odeslání formuláře bez opuštění stránky a přidávání dalších
   účastníků.

   Kurz s otevřeným termínem má přihlášku (POST /api/prihlasky), kurz bez
   termínu poptávku (POST /api/poptavky). Obojí končí stejně: ozveme se.
   ========================================================================== */

(function () {
  'use strict';

  function rekni(form, text, chyba) {
    var stav = form.querySelector('[data-stav]');
    if (!stav) return;
    stav.textContent = text;
    stav.className = 'poptavka__stav' + (chyba ? ' poptavka__stav--chyba' : '');
  }

  function hodnota(form, jmeno) {
    var prvek = form.querySelector('[name="' + jmeno + '"]');
    return prvek ? String(prvek.value || '').trim() : '';
  }

  // Do innerHTML nikdy nic nevkládáme syrové, ani text ze své vlastní API.
  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function posli(adresa, telo) {
    return fetch(adresa, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telo)
    }).then(function (odpoved) {
      return odpoved.json().catch(function () { return {}; }).then(function (data) {
        if (!odpoved.ok) {
          var chyba = new Error(data.chyba || 'Nepodařilo se to odeslat.');
          chyba.stav = odpoved.status;
          chyba.detaily = data.detaily || null;
          throw chyba;
        }
        return data;
      });
    });
  }

  /* ------------------------------------------------------------ poptávka */

  var poptavka = document.querySelector('[data-poptavka]');
  if (poptavka) {
    var odesilamPoptavku = false;

    poptavka.addEventListener('submit', function (e) {
      e.preventDefault();
      if (odesilamPoptavku) return;

      var jmeno = hodnota(poptavka, 'jmeno');
      var email = hodnota(poptavka, 'email');
      if (jmeno.length < 2 || email.indexOf('@') === -1) {
        rekni(poptavka, 'Vyplň prosím jméno a platný e-mail, ať se máme kam ozvat.', true);
        return;
      }

      var tlacitko = poptavka.querySelector('[data-odeslat]');
      odesilamPoptavku = true;
      tlacitko.disabled = true;
      tlacitko.textContent = 'Odesílám…';
      rekni(poptavka, '');

      var radky = ['Kurz: ' + poptavka.getAttribute('data-kurz')];
      if (hodnota(poptavka, 'termin')) radky.push('Termín: ' + hodnota(poptavka, 'termin'));
      if (hodnota(poptavka, 'zprava')) radky.push('', hodnota(poptavka, 'zprava'));

      posli('/api/poptavky', {
        jmeno: jmeno,
        email: email,
        telefon: hodnota(poptavka, 'telefon'),
        zprava: radky.join('\n'),
        web: hodnota(poptavka, 'web')
      })
        .then(function () {
          poptavka.querySelector('.field-grid').hidden = true;
          poptavka.querySelector('[name="zprava"]').hidden = true;
          tlacitko.hidden = true;
          rekni(poptavka, 'Poptávka odeslána, ozveme se. Nic teď neplatíš a nic není závazné.');
        })
        .catch(function (chyba) {
          odesilamPoptavku = false;
          tlacitko.disabled = false;
          tlacitko.textContent = 'Odeslat poptávku';
          rekni(poptavka, chyba.message + ' Zkus to prosím znovu, nebo nám zavolej.', true);
        });
    });
  }

  /* ----------------------------------------------------------- přihláška */

  var prihlaska = document.querySelector('[data-prihlaska]');
  if (!prihlaska) return;

  var obalUcastniku = prihlaska.querySelector('[data-ucastnici]');
  var sablonaUcastnika = obalUcastniku.firstElementChild.cloneNode(true);
  var odesilam = false;

  function precisluj() {
    var vsichni = obalUcastniku.querySelectorAll('[data-ucastnik]');
    for (var i = 0; i < vsichni.length; i++) {
      vsichni[i].querySelector('[data-cislo]').textContent = String(i + 1);
      // Prvního účastníka odebrat nejde - bez něj by přihláška neměla smysl.
      var odebrat = vsichni[i].querySelector('[data-odebrat]');
      if (odebrat) odebrat.hidden = vsichni.length < 2;
    }
  }

  prihlaska.querySelector('[data-pridat-ucastnika]').addEventListener('click', function () {
    var vsichni = obalUcastniku.querySelectorAll('[data-ucastnik]');
    if (vsichni.length >= 10) {
      rekni(prihlaska, 'Víc než deset lidí naráz raději domluvíme telefonem.', true);
      return;
    }
    var novy = sablonaUcastnika.cloneNode(true);
    novy.querySelectorAll('input').forEach(function (vstup) {
      if (vstup.type === 'checkbox') vstup.checked = false;
      else vstup.value = '';
    });
    obalUcastniku.appendChild(novy);
    precisluj();
    novy.querySelector('input').focus();
  });

  obalUcastniku.addEventListener('click', function (e) {
    var odebrat = e.target.closest('[data-odebrat]');
    if (!odebrat) return;
    odebrat.closest('[data-ucastnik]').remove();
    precisluj();
  });

  precisluj();

  function ucastniciZFormulare() {
    return Array.prototype.map.call(
      obalUcastniku.querySelectorAll('[data-ucastnik]'),
      function (blok) {
        function pole(klic) {
          var prvek = blok.querySelector('[data-pole="' + klic + '"]');
          if (!prvek) return null;
          return prvek.type === 'checkbox' ? prvek.checked : String(prvek.value || '').trim();
        }
        return {
          jmeno: pole('jmeno') || '',
          datum_narozeni: pole('datum_narozeni') || null,
          vaha_kg: pole('vaha_kg') ? Number(pole('vaha_kg')) : null,
          doklada_prohlidku: pole('doklada_prohlidku') === true,
          zajisti_souhlas_zastupce: pole('zajisti_souhlas_zastupce') === true
        };
      }
    );
  }

  function zaskrtnuto(jmeno) {
    var prvek = prihlaska.querySelector('[name="souhlas_' + jmeno + '"]');
    return Boolean(prvek && prvek.checked);
  }

  /* Plný termín není slepá ulička: server pošle další termíny toho kurzu
     a my je nabídneme ke kliknutí. Čekací listinu nevedeme. */
  function nabidniDalsiTerminy(terminy) {
    if (!terminy || !terminy.length) return '';
    var vyber = prihlaska.querySelector('[name="termin_id"]');
    var volne = terminy.filter(function (t) {
      return Array.prototype.some.call(vyber.options, function (o) {
        return String(o.value) === String(t.id);
      });
    });
    if (!volne.length) return '';
    return ' Zkus jiný termín — vybrali jsme ti nejbližší volný.';
  }

  prihlaska.addEventListener('submit', function (e) {
    e.preventDefault();
    if (odesilam) return;

    var ucastnici = ucastniciZFormulare();
    var prazdny = ucastnici.some(function (u) { return u.jmeno.length < 2; });
    if (prazdny) {
      rekni(prihlaska, 'Vyplň prosím jméno u každého účastníka.', true);
      return;
    }

    var jmeno = hodnota(prihlaska, 'jmeno');
    var email = hodnota(prihlaska, 'email');
    if (jmeno.length < 2 || email.indexOf('@') === -1) {
      rekni(prihlaska, 'Vyplň prosím jméno a platný e-mail, ať se máme kam ozvat.', true);
      return;
    }
    if (!zaskrtnuto('vop') || !zaskrtnuto('gdpr') || !zaskrtnuto('zdravi')) {
      rekni(prihlaska, 'Bez všech tří souhlasů přihlášku zpracovat nemůžeme.', true);
      return;
    }

    var tlacitko = prihlaska.querySelector('[data-odeslat]');
    odesilam = true;
    tlacitko.disabled = true;
    tlacitko.textContent = 'Odesílám…';
    rekni(prihlaska, '');

    posli('/api/prihlasky', {
      termin_id: hodnota(prihlaska, 'termin_id'),
      jmeno: jmeno,
      email: email,
      telefon: hodnota(prihlaska, 'telefon'),
      mesto: hodnota(prihlaska, 'mesto'),
      ucastnici: ucastnici,
      zprava: hodnota(prihlaska, 'zprava'),
      souhlas_vop: zaskrtnuto('vop'),
      souhlas_gdpr: zaskrtnuto('gdpr'),
      souhlas_zdravi: zaskrtnuto('zdravi'),
      web: hodnota(prihlaska, 'web')
    })
      .then(function (data) {
        hotovo(data);
      })
      .catch(function (chyba) {
        odesilam = false;
        tlacitko.disabled = false;
        tlacitko.textContent = 'Odeslat přihlášku';

        if (chyba.stav === 409 && chyba.detaily && chyba.detaily.dalsi_terminy) {
          var dalsi = chyba.detaily.dalsi_terminy;
          rekni(prihlaska, chyba.message + nabidniDalsiTerminy(dalsi), true);
          // Vybereme první volný termín, ať se dá rovnou odeslat znovu.
          var vyber = prihlaska.querySelector('[name="termin_id"]');
          for (var i = 0; i < dalsi.length; i++) {
            var moznost = Array.prototype.find.call(vyber.options, function (o) {
              return String(o.value) === String(dalsi[i].id);
            });
            if (moznost) { vyber.value = moznost.value; break; }
          }
          return;
        }
        rekni(prihlaska, chyba.message + ' Zkus to prosím znovu, nebo nám zavolej.', true);
      });
  });

  /* Po odeslání zůstane na stránce potvrzení s číslem přihlášky - je to
     první věc, na kterou se člověk ptá, když volá. */
  function hotovo(data) {
    var varovani = (data.varovani || []).length
      ? '<p class="poptavka__stav poptavka__stav--chyba">Všimli jsme si: ' +
        data.varovani.join('; ') +
        '. Nevadí to, ale ozveme se a domluvíme se.</p>'
      : '';

    prihlaska.innerHTML =
      '<div class="done" style="padding:0">' +
        '<div class="done__check" aria-hidden="true">✓</div>' +
        '<h3 class="done__title">Přihláška přijata</h3>' +
        /* Co se stalo s e-mailem, ví server - podle režimu odesílání. Dřív
           tu bylo natvrdo „Potvrzení jsme poslali e-mailem“, což v režimu
           bez odesílání zákazníkům nebyla pravda. */
        '<p class="done__text">Číslo přihlášky <strong>' + data.kod + '</strong>. ' +
          esc(data.zprava || 'Přihlášku máme.') + ' ' +
          'Termín ' + (data.termin || '') + ' ti držíme. Nic teď neplatíš.</p>' +
        varovani +
        (data.odkaz
          ? '<p style="margin-top:18px"><a class="btn btn--outline" href="' + data.odkaz +
            '">Zobrazit přihlášku</a></p>'
          : '') +
      '</div>';
    prihlaska.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
})();
