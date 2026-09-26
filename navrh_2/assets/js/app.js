/* ==========================================================================
   LSD — návrh 2 — aplikace (router + stav + renderování)
   ========================================================================== */

(function (D) {
  'use strict';

  /* ---------------------------------------------------------------- utils */

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function attr(v) { return esc(v); }

  function czk(n) {
    return Number(n).toLocaleString('cs-CZ').replace(/ /g, ' ') + ' Kč';
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }

  function free(t) { return Math.max(0, t.max - t.taken); }

  function terminById(id) {
    var found = D.TERMINY.filter(function (t) { return t.id === Number(id); });
    return found[0] || null;
  }

  function priceLabel(t) { return t.price ? czk(t.price) : 'na dotaz'; }

  function bg(url) { return 'background-image: url(' + attr(url) + ')'; }

  /* ---------------------------------------------------------------- state */

  var state = {
    route: 'home',
    param: null,
    menuOpen: false,
    terminId: null,
    people: 1,
    filter: 'Vše',
    bStep: 0,
    mode: 'booking',
    pax: [{ name: '', weight: '', age: '' }],
    form: { name: '', email: '', phone: '', city: '', note: '' },
    terms: false,
    pay: 'card',
    faqOpen: null,
    voucher: 0,
    voucherFor: '',
    contactSent: false,
    code: null
  };

  function selectedTermin() {
    return terminById(state.terminId) || D.TERMINY[4];
  }

  function isEnquiry() { return !selectedTermin().price; }

  function isVoucherDone() { return state.mode === 'voucher' && state.bStep === 3; }

  function setPeople(n) {
    var t = selectedTermin();
    var cap = Math.max(1, free(t));
    var v = Math.max(1, Math.min(n, cap));
    var pax = [];
    for (var i = 0; i < v; i++) pax.push(state.pax[i] || { name: '', weight: '', age: '' });
    state.people = v;
    state.pax = pax;
    render();
  }

  /* --------------------------------------------------------------- router */

  var ROUTES = {
    'home': 1, 'tandem': 1, 'kurzy': 1, 'kalendar': 1, 'termin': 1, 'booking': 1,
    'poukaz': 1, 'expedice': 1, 'galerie': 1, 'onas': 1, 'faq': 1, 'kontakt': 1
  };

  function parseHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    var route = parts[0] || 'home';
    if (!ROUTES[route]) route = 'home';
    return { route: route, param: parts[1] || null };
  }

  function navigate(path, replace) {
    var target = '#/' + String(path).replace(/^\/+/, '');
    if (location.hash === target) { applyRoute(true); return; }
    if (replace) location.replace(target);
    else location.hash = target;
  }

  function applyRoute(forceScroll) {
    var parsed = parseHash();

    if (parsed.route === 'termin') {
      var t = terminById(parsed.param);
      if (!t) { navigate('kalendar', true); return; }
      if (state.terminId !== t.id) {
        state.terminId = t.id;
        state.people = 1;
        state.pax = [{ name: '', weight: '', age: '' }];
        state.bStep = 0;
      }
    }

    if (parsed.route === 'booking' && state.mode !== 'voucher' && !state.terminId) {
      navigate('kalendar', true);
      return;
    }

    state.route = parsed.route;
    state.param = parsed.param;
    state.menuOpen = false;

    render();
    if (forceScroll !== false) window.scrollTo(0, 0);

    var main = qs('#main');
    if (main) {
      main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
    }
  }

  function openTermin(id) {
    var t = terminById(id);
    if (!t || free(t) === 0) return;
    navigate('termin/' + t.id);
  }

  /* ------------------------------------------------------------ fragmenty */

  function pageHead(route) {
    var head = D.PAGE_HEAD[route];
    if (!head) return '';
    return '<div class="page-head">' +
      '<div class="container page-head__inner">' +
        '<p class="breadcrumb"><a href="#/" data-link>Domů</a><span aria-hidden="true">/</span>' +
        '<span class="breadcrumb__current">' + esc(head.title) + '</span></p>' +
        '<h1 class="page-head__title">' + esc(head.title) + '</h1>' +
        (head.lead ? '<p class="page-head__lead">' + esc(head.lead) + '</p>' : '') +
      '</div>' +
    '</div>';
  }

  function sectionHead(eyebrow, title, lead) {
    return '<div class="section-head' + (lead ? '' : ' section-head--plain') + '">' +
      '<p class="eyebrow">' + esc(eyebrow) + '</p>' +
      '<h2 class="section-head__title">' + esc(title) + '</h2>' +
      (lead ? '<p class="section-head__lead">' + esc(lead) + '</p>' : '') +
    '</div>';
  }

  /* Řádek termínu — na domovské stránce kompaktní, v kalendáři s obsazeností. */
  function terminRow(t, full) {
    var taken = free(t) === 0;
    var tag = taken ? 'div' : 'button';
    var cls = 'termin' + (full ? ' termin--lg' : '') + (taken ? ' termin--full' : '');

    return '<' + tag + ' class="' + cls + '"' +
      (taken ? '' : ' type="button" data-action="termin" data-arg="' + t.id + '"') + '>' +
      '<div class="termin__date">' + esc(t.date) +
        (full ? '<div class="termin__day">' + esc(t.day) + '</div>' : '') +
      '</div>' +
      '<div class="termin__main">' +
        '<div class="termin__type">' + esc(t.type) + '</div>' +
        '<div class="termin__meta">' + esc(t.place) + ' · ' + esc(t.time) + '</div>' +
      '</div>' +
      (full
        ? '<div class="termin__gauge">' +
            '<div class="termin__bar"><span style="width: ' +
              Math.round((t.taken / t.max) * 100) + '%"></span></div>' +
            '<div class="termin__spots">' + t.taken + ' / ' + t.max + ' obsazeno</div>' +
          '</div>' +
          '<div class="termin__price">' + esc(priceLabel(t)) + '</div>'
        : '<div class="termin__spots">' + t.taken + ' / ' + t.max + ' obsazeno</div>') +
      '<div class="termin__cta">' + (taken ? 'Obsazeno' : 'Rezervovat →') + '</div>' +
      '</' + tag + '>';
  }

  /* ----------------------------------------------------------------- home */

  function viewHome() {
    var spots = D.TERMINY.reduce(function (a, t) { return a + free(t); }, 0);

    return '<div class="hero">' +
      '<div class="container hero__inner">' +
        '<div>' +
          '<p class="hero__badge">Tandemy · Kurzy · Expedice · od roku 2009</p>' +
          '<h1 class="hero__title">Skoč. Zbytek už je jen vzduch.</h1>' +
          '<p class="hero__lead">Tandemové seskoky z 4 000 metrů, kurzy pro vlastní licenci, expedice a helitour. ' +
            'Vedeme lidi přes strach už sedmnáct let — a všechny jsme přivedli zpátky na zem.</p>' +
          '<div class="btn-row">' +
            '<a class="btn btn--primary btn--lg" href="#/kalendar" data-link>Vybrat termín</a>' +
            '<a class="btn btn--ghost btn--lg" href="#/tandem" data-link>Jak tandem probíhá</a>' +
          '</div>' +
        '</div>' +
        '<div class="hero__figure">' +
          '<div class="hero__blob" aria-hidden="true"></div>' +
          '<img class="hero__img" src="' + attr(D.IMG.tandemCam) + '" alt="Tandemový seskok nad Vysočinou" loading="eager" />' +
          '<div class="hero__badge-card">' +
            '<div class="hero__badge-num">' + spots + '</div>' +
            '<div class="hero__badge-text">' +
              '<div class="hero__badge-title">volných míst v září</div>' +
              '<div class="hero__badge-sub">Jihlava — Henčov</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    /* produkty */
    '<section class="container section--tight">' +
      sectionHead('Naše zážitky', 'Vyber si, jak vysoko chceš jít',
        'Od prvního tandemu po vlastní licenci. Každý zážitek si rezervuješ online s aktuální obsazeností.') +
      '<div class="grid grid--auto-260">' +
        D.PRODUCTS.map(function (p) {
          return '<a class="product" href="#/' + attr(p.route) + '" data-link>' +
            '<div class="product__media media" style="' + bg(p.img) + '">' +
              '<span class="tag tag--float">' + esc(p.tag) + '</span>' +
            '</div>' +
            '<div class="product__body">' +
              '<h3 class="product__title">' + esc(p.title) + '</h3>' +
              '<p class="product__text">' + esc(p.short) + '</p>' +
              '<div class="product__foot">' +
                '<span class="product__price">' + esc(p.price) + '</span>' +
                '<span class="product__arrow" aria-hidden="true">→</span>' +
              '</div>' +
            '</div>' +
          '</a>';
        }).join('') +
      '</div>' +
    '</section>' +

    /* tandem */
    '<section class="container section split">' +
      '<div>' +
        '<p class="eyebrow">Tandemový seskok</p>' +
        '<h2 class="split__title">Bez tréninku. Bez zkušeností. Jen ty a 4 000 metrů.</h2>' +
        '<p class="split__text">Připoutaný k instruktorovi prožiješ padesát sekund volného pádu rychlostí 200 km/h ' +
          'a pak pět minut ticha pod padákem nad Vysočinou.</p>' +
        '<p class="split__text" style="margin-bottom: 28px">Na letišti jsi dvě až tři hodiny včetně instruktáže a předání videa.</p>' +
        '<div class="btn-row">' +
          '<a class="btn btn--ink" href="#/tandem" data-link>Více o tandemu</a>' +
          '<a class="btn btn--ghost" href="#/poukaz" data-link>Koupit jako dárek</a>' +
        '</div>' +
      '</div>' +
      '<div class="collage collage--tandem">' +
        '<img class="collage__a" src="' + attr(D.NEWS[0].img) + '" alt="Seskok" loading="lazy" />' +
        '<img class="collage__b" src="' + attr(D.GAL[1]) + '" alt="Volný pád" loading="lazy" />' +
        '<img class="collage__c" src="' + attr(D.GAL[4]) + '" alt="Přistání" loading="lazy" />' +
      '</div>' +
    '</section>' +

    /* kurzy */
    '<section class="container section split">' +
      '<div class="collage collage--kurzy">' +
        '<img class="collage__a" src="' + attr(D.IMG.vycvik) + '" alt="Výcvik" loading="lazy" />' +
        '<img class="collage__b" src="' + attr(D.IMG.zv) + '" alt="Kurz" loading="lazy" />' +
      '</div>' +
      '<div>' +
        '<p class="eyebrow">Kurzy a výcvik</p>' +
        '<h2 class="split__title">Chceš skákat sám? Udělej si licenci.</h2>' +
        '<p class="split__text" style="margin-bottom: 24px">Základní kurz trvá 48 hodin a obsahuje výuku podle osnov ' +
          'Úřadu pro civilní letectví, rozšířenou o praxi navíc.</p>' +
        '<ul class="checklist">' +
          D.COURSE_CHECKLIST.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') +
        '</ul>' +
        '<a class="btn btn--ink" href="#/kurzy" data-link>Zobrazit kurzy</a>' +
      '</div>' +
    '</section>' +

    /* nejbližší termíny */
    '<section class="container section">' +
      '<div class="list-head">' +
        '<div>' +
          '<p class="eyebrow">Kalendář</p>' +
          '<h2 class="list-head__title">Nejbližší termíny</h2>' +
        '</div>' +
        '<a class="list-head__more" href="#/kalendar" data-link>Celý kalendář →</a>' +
      '</div>' +
      '<div class="termin-list">' +
        D.TERMINY.slice(0, 5).map(function (t) { return terminRow(t, false); }).join('') +
      '</div>' +
    '</section>' +

    /* proč s námi */
    '<section class="container section">' +
      sectionHead('Proč s námi', 'Důvody, proč nám lidé svěřují život') +
      '<div class="stats">' +
        D.STATS.map(function (s) {
          return '<div class="stat">' +
            '<div class="stat__value">' + esc(s.value) + '</div>' +
            '<div class="stat__label">' + esc(s.label) + '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="grid grid--auto-300">' +
        D.REASONS.map(function (r) {
          return '<div class="reason">' +
            '<div class="reason__num">' + esc(r.n) + '</div>' +
            '<h3 class="reason__title">' + esc(r.title) + '</h3>' +
            '<p class="reason__text">' + esc(r.text) + '</p>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</section>' +

    /* aktuality */
    '<section class="container section">' +
      sectionHead('Aktuality', 'Z provozu letiště') +
      '<div class="grid grid--auto-280">' +
        D.NEWS.map(function (n) {
          return '<article class="news">' +
            '<div class="news__media media" style="' + bg(n.img) + '"></div>' +
            '<div class="news__body">' +
              '<h3 class="news__title">' + esc(n.title) + '</h3>' +
              '<p class="news__text">' + esc(n.text) + '</p>' +
            '</div>' +
          '</article>';
        }).join('') +
      '</div>' +
    '</section>' +

    /* CTA poukaz */
    '<section class="container section">' +
      '<div class="cta-banner">' +
        '<div class="cta-banner__blob" aria-hidden="true"></div>' +
        '<div class="cta-banner__text">' +
          '<h2 class="cta-banner__title">Dárek, který si nikdo nezapomene</h2>' +
          '<p class="cta-banner__lead">Poukaz na tandem s platností 12 měsíců. Termín si obdarovaný vybere sám.</p>' +
        '</div>' +
        '<a class="btn btn--light btn--lg" href="#/poukaz" data-link>Koupit poukaz</a>' +
      '</div>' +
    '</section>';
  }

  /* --------------------------------------------------------------- tandem */

  function viewTandem() {
    return pageHead('tandem') +
    '<div class="container section--first layout-aside">' +
      '<div>' +
        '<img class="tandem__hero" src="' + attr(D.IMG.tandem) + '" alt="Tandemový seskok" loading="lazy" />' +
        '<h2 class="tandem__h2">Jak to proběhne</h2>' +
        '<div class="steps">' +
          D.TANDEM_STEPS.map(function (s) {
            return '<div class="step">' +
              '<div class="step__num">' + esc(s.n) + '</div>' +
              '<div>' +
                '<div class="step__title">' + esc(s.title) + '</div>' +
                '<div class="step__text">' + esc(s.text) + '</div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="panel panel--sticky">' +
        '<h2 class="panel__title">Varianty a ceny</h2>' +
        D.TANDEM_VARIANTS.map(function (v) {
          return '<div class="variant">' +
            '<div class="variant__row">' +
              '<div class="variant__title">' + esc(v.title) + '</div>' +
              '<div class="variant__price">' + esc(v.price) + '</div>' +
            '</div>' +
            '<div class="variant__note">' + esc(v.note) + '</div>' +
          '</div>';
        }).join('') +
        '<a class="btn btn--primary btn--block" href="#/kalendar" data-link>Vybrat termín</a>' +
        '<a class="btn btn--ghost btn--block" href="#/poukaz" data-link>Koupit jako dárek</a>' +
      '</div>' +
    '</div>';
  }

  /* ---------------------------------------------------------------- kurzy */

  function viewKurzy() {
    return pageHead('kurzy') +
    '<div class="container section--first">' +
      '<div class="grid grid--auto-300">' +
        D.COURSES.map(function (c) {
          var t = terminById(c.terminId);
          var soldOut = !t || free(t) === 0;
          return '<article class="course">' +
            '<div class="course__media media" style="' + bg(c.img) + '"></div>' +
            '<div class="course__body">' +
              '<span class="tag">' + esc(c.tag) + '</span>' +
              '<h2 class="course__title">' + esc(c.title) + '</h2>' +
              '<p class="course__text">' + esc(c.text) + '</p>' +
              '<div class="course__chips">' +
                '<span class="chip">' + esc(c.dur) + '</span>' +
                '<span class="chip">' + esc(c.level) + '</span>' +
              '</div>' +
              '<div class="course__foot">' +
                '<div class="course__price">' + esc(c.price) + '</div>' +
                (soldOut
                  ? '<a class="btn btn--ghost btn--xs" href="#/kalendar" data-link>Další termíny</a>'
                  : '<button class="btn btn--primary btn--xs" type="button" data-action="termin" data-arg="' +
                    c.terminId + '">Rezervovat</button>') +
              '</div>' +
            '</div>' +
          '</article>';
        }).join('') +
      '</div>' +
      '<div class="dark-box">' +
        '<h2 class="dark-box__title">Co potřebuješ mít s sebou</h2>' +
        '<div class="dark-box__grid">' +
          D.COURSE_BRING.map(function (b) { return '<div>' + esc(b) + '</div>'; }).join('') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------- kalendář */

  function viewKalendar() {
    var visible = D.TERMINY.filter(function (t) {
      if (state.filter === 'Tandem') return t.kind === 'tandem';
      if (state.filter === 'Kurzy') return t.kind === 'kurz';
      if (state.filter === 'Volná místa') return free(t) > 0;
      return true;
    });

    return pageHead('kalendar') +
    '<div class="container section--first">' +
      '<div class="filters" role="group" aria-label="Filtr termínů">' +
        D.FILTERS.map(function (f) {
          return '<button class="filter" type="button" data-action="filter" data-arg="' + attr(f) + '"' +
            ' aria-pressed="' + (state.filter === f ? 'true' : 'false') + '">' + esc(f) + '</button>';
        }).join('') +
      '</div>' +
      (visible.length
        ? '<div class="termin-list">' +
            visible.map(function (t) { return terminRow(t, true); }).join('') +
          '</div>'
        : '<p class="note">Pro tento filtr teď nemáme žádný termín. Zkus jiný filtr nebo nám napiš.</p>') +
      '<p class="note">Provoz závisí na počasí. O startech informujeme den předem SMS.</p>' +
    '</div>';
  }

  /* -------------------------------------------------------- detail termínu */

  function viewTermin() {
    var t = selectedTermin();
    var f = free(t);
    var total = t.price ? czk(t.price * state.people) : 'Cena na dotaz';

    return '<div class="container section--first">' +
      '<a class="back-link" href="#/kalendar" data-link>← Zpět na kalendář</a>' +
      '<div class="layout-aside">' +
        '<div>' +
          '<p class="detail__badge">' + esc(t.date) + ' · ' + esc(t.time) + '</p>' +
          '<h1 class="detail__title">' + esc(t.type) + '</h1>' +
          '<div class="detail__media media" style="' + bg(t.img) + '" role="img" aria-label="' + attr(t.type) + '"></div>' +
          '<div class="facts">' +
            '<div class="fact"><div class="fact__label">Místo</div><div class="fact__value">' + esc(t.place) + '</div></div>' +
            '<div class="fact"><div class="fact__label">Volná místa</div><div class="fact__value">' + f + ' z ' + t.max + '</div></div>' +
            '<div class="fact"><div class="fact__label">Cena za osobu</div><div class="fact__value">' + esc(priceLabel(t)) + '</div></div>' +
          '</div>' +
          '<p class="detail__desc">' + esc(t.desc) + '</p>' +
        '</div>' +
        '<div class="panel panel--sticky">' +
          '<h2 class="booking-panel__title">Rezervace</h2>' +
          '<p class="booking-panel__sub">' + esc(t.date) + ' · ' + esc(t.type) + '</p>' +
          '<p class="field-label" id="people-label">Počet osob</p>' +
          '<div class="stepper">' +
            '<button class="stepper__btn" type="button" data-action="people" data-arg="-1" aria-label="Ubrat osobu"' +
              (state.people <= 1 ? ' disabled' : '') + '>−</button>' +
            '<div class="stepper__value" aria-live="polite">' + state.people + '</div>' +
            '<button class="stepper__btn" type="button" data-action="people" data-arg="1" aria-label="Přidat osobu"' +
              (state.people >= Math.max(1, f) ? ' disabled' : '') + '>+</button>' +
          '</div>' +
          '<div class="total-row">' +
            '<span>' + state.people + ' × ' + esc(priceLabel(t)) + '</span>' +
            '<span class="total-row__value">' + esc(total) + '</span>' +
          '</div>' +
          '<button class="btn btn--primary btn--block" type="button" data-action="start-booking">' +
            (t.price ? 'Pokračovat k rezervaci' : 'Poslat nezávaznou poptávku') +
          '</button>' +
          '<p class="panel__fineprint">Zrušení zdarma 48 h před termínem.</p>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------- rezervační tok */

  function bookingSteps() {
    var enquiry = isEnquiry();
    var labels = enquiry
      ? ['Účastníci', 'Kontakt', 'Hotovo']
      : ['Účastníci', 'Kontakt', 'Platba', 'Hotovo'];

    return '<ol class="bsteps">' +
      labels.map(function (l, i) {
        var reached = enquiry ? (i === 2 ? state.bStep === 3 : i <= state.bStep) : i <= state.bStep;
        return '<li class="bstep' + (reached ? ' bstep--done' : '') + '">' +
          '<span class="bstep__num">' + (i + 1) + '</span>' +
          '<span class="bstep__name">' + esc(l) + '</span>' +
        '</li>';
      }).join('') +
    '</ol>';
  }

  function bookingStep1() {
    return '<div>' +
      '<h1 class="booking__title">Kdo skáče</h1>' +
      '<p class="booking__lead">Jméno na každého účastníka potřebujeme kvůli pojištění a váhovému limitu.</p>' +
      '<div class="pax-list">' +
        state.pax.map(function (p, i) {
          return '<div class="pax" role="group" aria-labelledby="pax-' + i + '">' +
            '<p class="pax__legend" id="pax-' + i + '">Účastník ' + (i + 1) + '</p>' +
            '<div class="pax__grid">' +
              '<input class="field field--on-grey" value="' + attr(p.name) + '" data-pax="' + i + '" data-key="name" placeholder="Jméno a příjmení" aria-label="Jméno a příjmení účastníka ' + (i + 1) + '" />' +
              '<input class="field field--on-grey" value="' + attr(p.weight) + '" data-pax="' + i + '" data-key="weight" inputmode="numeric" placeholder="Hmotnost (kg)" aria-label="Hmotnost účastníka ' + (i + 1) + '" />' +
              '<input class="field field--on-grey" value="' + attr(p.age) + '" data-pax="' + i + '" data-key="age" inputmode="numeric" placeholder="Věk" aria-label="Věk účastníka ' + (i + 1) + '" />' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  function bookingStep2() {
    var f = state.form;
    return '<div>' +
      '<h1 class="booking__title">Kontaktní údaje</h1>' +
      '<p class="booking__lead">Na telefon posíláme potvrzení startu den předem.</p>' +
      '<div class="field-grid">' +
        '<input class="field" value="' + attr(f.name) + '" data-form="name" placeholder="Jméno a příjmení" autocomplete="name" aria-label="Jméno a příjmení" />' +
        '<input class="field" value="' + attr(f.email) + '" data-form="email" type="email" placeholder="E-mail" autocomplete="email" aria-label="E-mail" />' +
        '<input class="field" value="' + attr(f.phone) + '" data-form="phone" type="tel" placeholder="Telefon" autocomplete="tel" aria-label="Telefon" />' +
        '<input class="field" value="' + attr(f.city) + '" data-form="city" placeholder="Město" autocomplete="address-level2" aria-label="Město" />' +
      '</div>' +
      '<textarea class="field field--area" data-form="note" placeholder="Poznámka (skupina, dárkový poukaz, cokoliv)" aria-label="Poznámka">' + esc(f.note) + '</textarea>' +
      '<button class="check" type="button" data-action="terms" aria-pressed="' + (state.terms ? 'true' : 'false') + '">' +
        '<span class="check__box" aria-hidden="true">' + (state.terms ? '✓' : '') + '</span>' +
        '<span class="check__text">Souhlasím s provozními podmínkami a zpracováním osobních údajů. ' +
          'Potvrzuji, že jsem zdravotně způsobilý k seskoku.</span>' +
      '</button>' +
    '</div>';
  }

  function bookingStep3() {
    return '<div>' +
      '<h1 class="booking__title">Platba</h1>' +
      '<p class="booking__lead">Prototyp — žádná skutečná platba se neodešle.</p>' +
      '<div class="pay-list" role="radiogroup" aria-label="Způsob platby">' +
        D.PAY_METHODS.map(function (m) {
          var on = state.pay === m.key;
          return '<button class="pay" type="button" data-action="pay" data-arg="' + attr(m.key) + '"' +
            ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
            '<span class="pay__radio" aria-hidden="true"></span>' +
            '<span class="pay__body">' +
              '<span class="pay__label">' + esc(m.label) + '</span>' +
              '<span class="pay__note">' + esc(m.note) + '</span>' +
            '</span>' +
          '</button>';
        }).join('') +
      '</div>' +
      (state.pay === 'card'
        ? '<div class="card-fields">' +
            '<input class="field field--on-grey field--wide" placeholder="Číslo karty" inputmode="numeric" aria-label="Číslo karty" />' +
            '<input class="field field--on-grey" placeholder="MM / RR" aria-label="Platnost karty" />' +
            '<input class="field field--on-grey" placeholder="CVC" inputmode="numeric" aria-label="CVC" />' +
          '</div>'
        : '') +
    '</div>';
  }

  function bookingDone() {
    var t = selectedTermin();
    var voucher = isVoucherDone();
    var enquiry = isEnquiry();
    var v = D.VOUCHERS[state.voucher];
    var email = state.form.email || 'tvůj e-mail';
    var total = t.price ? czk(t.price * state.people) : 'dle rozsahu';

    var rows = voucher
      ? [
          { k: 'Poukaz', v: v.title },
          { k: 'Pro koho', v: state.voucherFor || 'nevyplněno' },
          { k: 'Platnost', v: '12 měsíců od vystavení' },
          { k: 'Cena', v: czk(v.price) }
        ]
      : [
          { k: 'Akce', v: t.type },
          { k: 'Termín', v: t.date + ' · ' + t.time },
          { k: 'Místo', v: t.place },
          { k: 'Osoby', v: String(state.people) },
          { k: 'Celkem', v: total }
        ];

    var lead;
    if (voucher) {
      lead = 'PDF poukazu posíláme na <strong>' + esc(email) + '</strong> do pěti minut. ' +
        'Platí 12 měsíců a termín si obdarovaný vybere sám.';
    } else if (enquiry) {
      lead = 'Ozveme se na <strong>' + esc(email) + '</strong> s cenou a potvrzením termínu do 24 hodin. Nic teď neplatíš.';
    } else {
      lead = 'Potvrzení letí na <strong>' + esc(email) + '</strong>. Den před termínem ti přijde SMS s časem startu.';
    }

    return '<div class="done">' +
      '<div class="done__icon" aria-hidden="true">✓</div>' +
      '<h1 class="done__title">' +
        (voucher ? 'Poukaz je na cestě' : (enquiry ? 'Poptávka odeslána' : 'Máš to')) +
      '</h1>' +
      '<p class="done__lead">' + lead + '</p>' +
      '<dl class="summary">' +
        '<p class="summary__code">' +
          (voucher ? 'Poukaz' : (enquiry ? 'Poptávka' : 'Rezervace')) + ' ' +
          esc(state.code || 'LSD-000000') +
        '</p>' +
        rows.map(function (r) {
          return '<div class="summary__row"><dt>' + esc(r.k) + '</dt><dd>' + esc(r.v) + '</dd></div>';
        }).join('') +
      '</dl>' +
      '<a class="btn btn--ghost" href="#/" data-link>Zpátky na web</a>' +
    '</div>';
  }

  function viewBooking() {
    var t = selectedTermin();
    var enquiry = isEnquiry();
    var voucher = isVoucherDone();
    var total = t.price ? czk(t.price * state.people) : 'Cena na dotaz';

    var body;
    if (state.bStep === 3) body = bookingDone();
    else if (state.bStep === 0) body = bookingStep1();
    else if (state.bStep === 1) body = bookingStep2();
    else body = bookingStep3();

    var nextLabel = enquiry
      ? (state.bStep === 1 ? 'Odeslat poptávku' : 'Pokračovat')
      : (state.bStep === 2 ? 'Zaplatit a potvrdit' : 'Pokračovat');

    return '<div class="booking">' +
      '<div class="booking__card">' +
        (voucher ? '' : bookingSteps()) +
        body +
        (state.bStep < 3
          ? '<div class="booking-bar">' +
              '<div>' +
                '<div class="booking-bar__label">' +
                  esc(t.date) + ' · ' + esc(t.type) + ' · ' + state.people + ' os.' +
                '</div>' +
                '<div class="booking-bar__total">' + esc(total) + '</div>' +
              '</div>' +
              '<div class="booking-bar__actions">' +
                '<button class="btn btn--ghost" type="button" data-action="booking-back">Zpět</button>' +
                '<button class="btn btn--primary" type="button" data-action="booking-next">' + esc(nextLabel) + '</button>' +
              '</div>' +
            '</div>'
          : '') +
      '</div>' +
    '</div>';
  }

  /* --------------------------------------------------------------- poukaz */

  function viewPoukaz() {
    var v = D.VOUCHERS[state.voucher];

    return pageHead('poukaz') +
    '<div class="container section--first layout-aside">' +
      '<div>' +
        '<div class="voucher-card">' +
          '<img src="' + attr(D.IMG.iaff) + '" alt="" loading="lazy" />' +
          '<div class="voucher-card__veil" aria-hidden="true"></div>' +
          '<div class="voucher-card__body">' +
            '<div class="voucher-card__mark" aria-hidden="true">LSD</div>' +
            '<div>' +
              '<div class="voucher-card__kicker">Dárkový poukaz</div>' +
              '<div class="voucher-card__title">' + esc(v.title) + '</div>' +
              '<div class="voucher-card__for">Pro: <span id="voucher-for">' +
                esc(state.voucherFor || '————') + '</span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="perks">' +
          D.VOUCHER_PERKS.map(function (p) {
            return '<div class="perk"><strong>' + esc(p.value) + '</strong>' + esc(p.label) + '</div>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="panel">' +
        '<h2 class="panel__title">Vyber zážitek</h2>' +
        '<div class="voucher-opts" role="radiogroup" aria-label="Varianta poukazu">' +
          D.VOUCHERS.map(function (o, i) {
            return '<button class="voucher-opt" type="button" data-action="voucher" data-arg="' + i + '"' +
              ' aria-pressed="' + (state.voucher === i ? 'true' : 'false') + '">' +
              '<span>' +
                '<span class="voucher-opt__title">' + esc(o.title) + '</span>' +
                '<span class="voucher-opt__note">' + esc(o.note) + '</span>' +
              '</span>' +
              '<span class="voucher-opt__price">' + esc(czk(o.price)) + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
        '<div class="field-grid field-grid--stack">' +
          '<input class="field" value="' + attr(state.voucherFor) + '" data-voucher-for placeholder="Pro koho (jméno na poukazu)" aria-label="Jméno na poukazu" />' +
          '<input class="field" value="' + attr(state.form.email) + '" data-form="email" type="email" placeholder="Tvůj e-mail pro doručení PDF" autocomplete="email" aria-label="E-mail pro doručení poukazu" />' +
        '</div>' +
        '<button class="btn btn--primary btn--block" type="button" data-action="buy-voucher">Koupit za ' + esc(czk(v.price)) + '</button>' +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------- expedice */

  function viewExpedice() {
    return pageHead('expedice') +
    '<div class="container section--first">' +
      '<div class="grid grid--auto-300">' +
        D.TRIPS.map(function (e) {
          return '<article class="trip">' +
            '<div class="trip__media media" style="' + bg(e.img) + '">' +
              '<span class="tag tag--float">' + esc(e.tag) + '</span>' +
            '</div>' +
            '<div class="trip__body">' +
              '<h2 class="trip__title">' + esc(e.title) + '</h2>' +
              '<p class="trip__text">' + esc(e.text) + '</p>' +
              '<p class="trip__meta">' + esc(e.meta) + '</p>' +
              '<div class="trip__foot">' +
                '<div class="trip__price">' + esc(e.price) + '</div>' +
                '<a class="btn btn--ink btn--xs" href="#/kontakt" data-link>Mám zájem</a>' +
              '</div>' +
            '</div>' +
          '</article>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  /* -------------------------------------------------------------- galerie */

  function viewGalerie() {
    return pageHead('galerie') +
    '<div class="container section--first">' +
      '<div class="gallery">' +
        D.GAL.map(function (src, i) {
          return '<button class="gallery__item media" type="button" data-action="lightbox" data-arg="' + i + '"' +
            ' style="' + bg(src) + '" aria-label="Otevřít fotografii ' + (i + 1) + '"></button>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  /* ---------------------------------------------------------------- o nás */

  function viewOnas() {
    return pageHead('onas') +
    '<div class="container section--first">' +
      '<div class="about">' +
        '<img class="about__img" src="' + attr(D.IMG.zv) + '" alt="Spolek na letišti" loading="lazy" />' +
        '<div>' +
          '<p class="eyebrow">Spolek od roku 2009</p>' +
          '<p class="about__claim">Jsme spolek zabývající se adrenalinovými sporty, zejména parašutismem. ' +
            'Sdružujeme všechny, co se rádi baví a nebojí se překonávat strach a překážky.</p>' +
          '<p class="about__text">Instruktoři jsou ve svém oboru profesionálové a vždy dbají na naprosté bezpečí ' +
            'klientů. Jsme tu pro lidi, kteří rádi poznávají svět — a především sami sebe.</p>' +
        '</div>' +
      '</div>' +
      sectionHead('Náš tým', 'Lidé, na které se spolehneš') +
      '<div class="grid grid--fill-240">' +
        D.TEAM.map(function (m) {
          return '<article class="member">' +
            '<div class="member__photo media" style="' + bg(m.img) + '" role="img" aria-label="' + attr(m.name) + '"></div>' +
            '<div class="member__body">' +
              '<h3 class="member__name">' + esc(m.name) + '</h3>' +
              '<p class="member__role">' + esc(m.role) + '</p>' +
              '<p class="member__bio">' + esc(m.bio) + '</p>' +
            '</div>' +
          '</article>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------------ FAQ */

  function viewFaq() {
    return pageHead('faq') +
    '<div class="container section--first">' +
      '<div class="faq">' +
        D.FAQ.map(function (q, i) {
          var open = state.faqOpen === i;
          return '<div class="faq__item">' +
            '<button class="faq__q" type="button" data-action="faq" data-arg="' + i + '"' +
              ' aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="faq-a-' + i + '">' +
              '<span class="faq__label">' + esc(q.q) + '</span>' +
              '<span class="faq__mark" aria-hidden="true">' + (open ? '−' : '+') + '</span>' +
            '</button>' +
            '<p class="faq__a" id="faq-a-' + i + '"' + (open ? '' : ' hidden') + '>' + esc(q.a) + '</p>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  /* -------------------------------------------------------------- kontakt */

  function viewKontakt() {
    var f = state.form;
    return pageHead('kontakt') +
    '<div class="container section--first contact">' +
      '<div class="contact__list">' +
        '<div class="contact__card">' +
          '<div class="contact__label">Telefon — rezervace tandemů</div>' +
          '<div class="contact__value"><a href="tel:+420777310959">+420 777 310 959</a></div>' +
        '</div>' +
        '<div class="contact__card">' +
          '<div class="contact__label">E-mail</div>' +
          '<div class="contact__value"><a href="mailto:info@lsd-trip.cz">info@lsd-trip.cz</a></div>' +
        '</div>' +
        '<div class="contact__card">' +
          '<div class="contact__label">Sídlo spolku</div>' +
          '<div class="contact__value contact__value--sm">Letecká společnost dobrodruhů z.s.<br />Holečkova 49/789, Praha 5, 150 00</div>' +
        '</div>' +
        '<div class="contact__card">' +
          '<div class="contact__label">Kde skáčeme</div>' +
          '<div class="contact__value contact__value--sm">Letiště Jihlava — Henčov</div>' +
        '</div>' +
      '</div>' +
      '<div class="panel">' +
        '<h2 class="panel__title">Napiš nám</h2>' +
        '<div class="field-grid field-grid--stack">' +
          '<input class="field" value="' + attr(f.name) + '" data-form="name" placeholder="Jméno" autocomplete="name" aria-label="Jméno" />' +
          '<input class="field" value="' + attr(f.email) + '" data-form="email" type="email" placeholder="E-mail" autocomplete="email" aria-label="E-mail" />' +
          '<textarea class="field field--area" data-form="note" placeholder="Zpráva" aria-label="Zpráva">' + esc(f.note) + '</textarea>' +
        '</div>' +
        '<button class="btn btn--primary btn--block" type="button" data-action="send-contact"' +
          (state.contactSent ? ' disabled' : '') + '>' +
          (state.contactSent ? 'Odesláno — ozveme se do 24 h' : 'Odeslat zprávu') +
        '</button>' +
      '</div>' +
    '</div>';
  }

  /* --------------------------------------------------------------- pohledy */

  var VIEWS = {
    home: viewHome,
    tandem: viewTandem,
    kurzy: viewKurzy,
    kalendar: viewKalendar,
    termin: viewTermin,
    booking: viewBooking,
    poukaz: viewPoukaz,
    expedice: viewExpedice,
    galerie: viewGalerie,
    onas: viewOnas,
    faq: viewFaq,
    kontakt: viewKontakt
  };

  var TITLES = {
    home: 'LSD — Letecká společnost dobrodruhů | Tandemové seskoky Jihlava',
    tandem: 'Tandemový seskok — LSD',
    kurzy: 'Kurzy a výcvik — LSD',
    kalendar: 'Kalendář termínů — LSD',
    termin: 'Detail termínu — LSD',
    booking: 'Rezervace — LSD',
    poukaz: 'Dárkový poukaz — LSD',
    expedice: 'Expedice a helitour — LSD',
    galerie: 'Galerie — LSD',
    onas: 'O nás — LSD',
    faq: 'Časté otázky — LSD',
    kontakt: 'Kontakt — LSD'
  };

  /* -------------------------------------------------------------- render */

  function renderNav() {
    var current = state.route;
    var desktop = qs('#nav-desktop');
    var mobile = qs('#mobile-menu');

    desktop.innerHTML = D.NAV.map(function (n) {
      var on = current === n.route;
      return '<a class="nav__link" href="#/' + attr(n.route) + '" data-link' +
        (on ? ' aria-current="page"' : '') + '>' + esc(n.label) + '</a>';
    }).join('');

    mobile.innerHTML = D.NAV.map(function (n) {
      var on = current === n.route;
      return '<a class="mobile-menu__link" href="#/' + attr(n.route) + '" data-link' +
        (on ? ' aria-current="page"' : '') + '>' + esc(n.label) + '</a>';
    }).join('') +
    '<a class="mobile-menu__link mobile-menu__link--accent" href="#/poukaz" data-link>Dárkový poukaz</a>';

    mobile.hidden = !state.menuOpen;
    var burger = qs('#burger');
    burger.setAttribute('aria-expanded', state.menuOpen ? 'true' : 'false');
    burger.setAttribute('aria-label', state.menuOpen ? 'Zavřít menu' : 'Otevřít menu');
  }

  function measureHeader() {
    var inner = qs('.header__inner');
    if (!inner) return;
    var height = inner.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--header-h', Math.round(height) + 'px');
  }

  function render() {
    var view = VIEWS[state.route] || viewHome;
    qs('#main').innerHTML = view();
    renderNav();
    document.title = TITLES[state.route] || TITLES.home;
    measureHeader();
  }

  /* ------------------------------------------------------------- lightbox */

  function openLightbox(index) {
    qs('#lightbox-img').style.backgroundImage = 'url(' + D.GAL[index] + ')';
    qs('#lightbox').hidden = false;
    document.body.style.overflow = 'hidden';
    qs('#lightbox-close').focus();
  }

  function closeLightbox() {
    qs('#lightbox').hidden = true;
    document.body.style.overflow = '';
  }

  /* ---------------------------------------------------------- členská sekce */

  function openLogin() {
    qs('#login-modal').hidden = false;
    document.body.style.overflow = 'hidden';
    qs('#login-email').focus();
  }

  function closeLogin() {
    qs('#login-modal').hidden = true;
    document.body.style.overflow = '';
    qs('#login-open').focus();
  }

  /* ------------------------------------------------------------ rezervace */

  function bookingNext() {
    var enquiry = isEnquiry();
    var last = enquiry ? 1 : 2;
    if (state.bStep >= 3) return;
    if (state.bStep >= last) {
      state.bStep = 3;
      state.code = (enquiry ? 'LSD-D' : 'LSD-') + Math.floor(10000 + Math.random() * 89999);
    } else {
      state.bStep += 1;
    }
    render();
    window.scrollTo(0, 0);
  }

  function bookingBack() {
    if (state.bStep === 0) {
      navigate('termin/' + selectedTermin().id);
      return;
    }
    state.bStep = (state.bStep === 3 && isEnquiry()) ? 1 : state.bStep - 1;
    render();
    window.scrollTo(0, 0);
  }

  /* ----------------------------------------------------------------- akce */

  var ACTIONS = {
    'termin': function (arg) { openTermin(arg); },
    'filter': function (arg) { state.filter = arg; render(); },
    'people': function (arg) { setPeople(state.people + Number(arg)); },
    'start-booking': function () {
      state.bStep = 0;
      state.mode = 'booking';
      navigate('booking');
    },
    'booking-next': bookingNext,
    'booking-back': bookingBack,
    'terms': function () { state.terms = !state.terms; render(); },
    'pay': function (arg) { state.pay = arg; render(); },
    'voucher': function (arg) { state.voucher = Number(arg); render(); },
    'buy-voucher': function () {
      state.mode = 'voucher';
      state.bStep = 3;
      state.code = 'LSD-P' + Math.floor(10000 + Math.random() * 89999);
      navigate('booking');
    },
    'faq': function (arg) {
      var i = Number(arg);
      state.faqOpen = state.faqOpen === i ? null : i;
      render();
    },
    'lightbox': function (arg) { openLightbox(Number(arg)); },
    'send-contact': function () { state.contactSent = true; render(); }
  };

  /* --------------------------------------------------------------- events */

  document.addEventListener('click', function (e) {
    var lightbox = qs('#lightbox');
    if (lightbox && !lightbox.hidden && lightbox.contains(e.target)) {
      closeLightbox();
      return;
    }

    var modal = qs('#login-modal');
    if (modal && !modal.hidden) {
      if (e.target.closest('#login-close') || e.target.closest('#login-submit') ||
          !e.target.closest('#login-dialog')) {
        closeLogin();
        if (!e.target.closest('[data-link]')) return;
      }
    }

    if (e.target.closest('#login-open')) { openLogin(); return; }

    if (e.target.closest('#burger')) {
      state.menuOpen = !state.menuOpen;
      renderNav();
      return;
    }

    var link = e.target.closest('[data-link]');
    if (link) {
      state.menuOpen = false;
      return; // zbytek obstará hashchange
    }

    var el = e.target.closest('[data-action]');
    if (!el) return;
    var fn = ACTIONS[el.getAttribute('data-action')];
    if (fn) {
      e.preventDefault();
      fn(el.getAttribute('data-arg'));
    }
  });

  /* Vstupy — stav aktualizujeme bez překreslení, aby nezmizel fokus. */
  document.addEventListener('input', function (e) {
    var el = e.target;

    if (el.hasAttribute('data-form')) {
      state.form[el.getAttribute('data-form')] = el.value;
      return;
    }

    if (el.hasAttribute('data-pax')) {
      var i = Number(el.getAttribute('data-pax'));
      if (state.pax[i]) state.pax[i][el.getAttribute('data-key')] = el.value;
      return;
    }

    if (el.hasAttribute('data-voucher-for')) {
      state.voucherFor = el.value;
      var out = qs('#voucher-for');
      if (out) out.textContent = el.value || '————';
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var lightbox = qs('#lightbox');
    if (lightbox && !lightbox.hidden) { closeLightbox(); return; }
    var modal = qs('#login-modal');
    if (modal && !modal.hidden) { closeLogin(); return; }
    if (state.menuOpen) { state.menuOpen = false; renderNav(); }
  });

  window.addEventListener('hashchange', function () { applyRoute(); });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      measureHeader();
      if (window.innerWidth >= 1080 && state.menuOpen) {
        state.menuOpen = false;
        renderNav();
      }
    }, 120);
  });

  /* ---------------------------------------------------------------- start */

  if (!location.hash) location.replace('#/');
  applyRoute(false);
}(window.LSD_DATA));
