/* ==========================================================================
   LSD — aplikace (router + stav + renderování)
   ========================================================================== */

// Pražský den má projekt na jednom místě (src/cas.js, server ho servíruje
// i sem). Vlastní výpočet přes new Date().toISOString() by kolem půlnoci
// ukázal včerejšek a web by nabízel termín, který už proběhl.
import { isoDatum } from './cas.js';

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
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function free(t) { return Math.max(0, t.max - t.taken); }

  /* Termíny jsou zatím napevno v data.js, takže postupem času zestárnou.
     Dokud nejdou z databáze (etapa E4), web nesmí nabízet den, který už byl.
     Porovnává se ISO datum termínu s dnešním pražským dnem - oboje řetězec
     YYYY-MM-DD, takže stačí porovnání textů a nikde nevzniká Date z řetězce. */
  function dnesIso() { return isoDatum(new Date()); }

  function jeBudouci(t) { return String(t.iso || '') >= dnesIso(); }

  function budouciTerminy() { return D.TERMINY.filter(jeBudouci); }

  function terminById(id) {
    var found = D.TERMINY.filter(function (t) { return t.id === Number(id); });
    return found[0] || null;
  }

  function priceLabel(t) { return t.price ? czk(t.price) : 'na dotaz'; }

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
    faqOpen: null,
    voucher: 0,
    voucherFor: '',
    contactSent: false,
    contactSending: false,
    contactError: null,
    bookingSending: false,
    bookingError: null
  };

  function selectedTermin() {
    return terminById(state.terminId) || D.TERMINY[4];
  }

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

  /* ------------------------------------------------------------- fragmenty */

  function btn(label, cls, action, data) {
    return '<button type="button" class="btn ' + cls + '" data-action="' + attr(action) + '"' +
      (data ? ' data-arg="' + attr(data) + '"' : '') + '>' + esc(label) + '</button>';
  }

  function sectionHead(title, linkLabel, linkAction) {
    return '<div class="section__head">' +
      '<h2 class="section__title">' + esc(title) + '</h2>' +
      (linkLabel ? '<button type="button" class="section__link" data-action="' + attr(linkAction) + '">' + esc(linkLabel) + '</button>' : '') +
      '</div>';
  }

  function productCard(p) {
    return '<button type="button" class="card card--link" data-action="go" data-arg="' + attr(p.route) + '">' +
      '<div class="card__media" style="background-image:url(' + attr(p.img) + ')">' +
        '<span class="card__tag">' + esc(p.tag) + '</span>' +
      '</div>' +
      '<div class="card__body">' +
        '<h3 class="card__title">' + esc(p.title) + '</h3>' +
        '<p class="card__text">' + esc(p.short) + '</p>' +
        '<div class="card__foot">' +
          '<span class="card__price">' + esc(p.price) + '</span>' +
          '<span class="card__cta">Detail →</span>' +
        '</div>' +
      '</div>' +
    '</button>';
  }

  function terminRow(t) {
    var f = free(t);
    var full = f === 0;
    var tag = full ? 'div' : 'button';
    return '<' + tag + (full ? '' : ' type="button" data-action="termin" data-arg="' + t.id + '"') +
      ' class="termrow' + (full ? ' termrow--full' : '') + '">' +
      '<span class="termrow__date">' + esc(t.date) + '</span>' +
      '<span>' +
        '<span class="termrow__type">' + esc(t.type) + '</span>' +
        '<span class="termrow__place">' + esc(t.place) + '</span>' +
      '</span>' +
      '<span class="termrow__spots">' + t.taken + ' / ' + t.max + ' obsazeno</span>' +
      '<span class="termrow__cta' + (full ? ' termrow__cta--off' : '') + '">' + (full ? 'Obsazeno' : 'Mám zájem →') + '</span>' +
    '</' + tag + '>';
  }

  function tableRow(t) {
    var f = free(t);
    var full = f === 0;
    var pct = Math.round((t.taken / t.max) * 100);
    var tag = full ? 'div' : 'button';
    return '<' + tag + (full ? '' : ' type="button" data-action="termin" data-arg="' + t.id + '"') +
      ' class="table__row' + (full ? ' table__row--full' : '') + '">' +
      '<span>' +
        '<span class="cell__date">' + esc(t.date) + '</span>' +
        '<span class="cell__day">' + esc(t.day) + '</span>' +
      '</span>' +
      '<span>' +
        '<span class="cell__type">' + esc(t.type) + '</span>' +
        '<span class="cell__sub">' + esc(t.place) + ' · ' + esc(t.time) + '</span>' +
      '</span>' +
      '<span>' +
        '<span class="cell__label">Obsazenost</span>' +
        '<span class="progress"><span class="progress__bar" style="width:' + pct + '%"></span></span>' +
        '<span class="progress__text">' + t.taken + ' / ' + t.max + ' obsazeno</span>' +
      '</span>' +
      '<span>' +
        '<span class="cell__label">Cena</span>' +
        '<span class="cell__price">' + esc(priceLabel(t)) + '</span>' +
      '</span>' +
      '<span class="cell__cta' + (full ? ' cell__cta--off' : '') + '">' + (full ? 'Obsazeno' : 'Mám zájem →') + '</span>' +
    '</' + tag + '>';
  }

  /* ------------------------------------------------------------- stránky */

  function viewHome() {
    var nadchazejici = budouciTerminy();
    var spots = nadchazejici.reduce(function (a, t) { return a + free(t); }, 0);

    return '' +
    '<section class="hero">' +
      '<img class="hero__media" src="' + attr(D.IMG.hero) + '" alt="Tandemový seskok nad Vysočinou" fetchpriority="high" />' +
      '<div class="hero__scrim"></div>' +
      '<div class="container hero__content">' +
        '<p class="hero__eyebrow">Letiště Jihlava — Henčov · od roku 2009</p>' +
        '<h1 class="hero__title">Skoč. Zbytek už je jen vzduch.</h1>' +
        '<p class="hero__text">Tandemové seskoky, kurzy pro vlastní licenci, expedice a helitour. Vedeme lidi přes strach už sedmnáct let — a všechny jsme přivedli zpátky na zem.</p>' +
        '<div class="hero__actions">' +
          btn('Vybrat termín', 'btn--primary', 'go', 'kalendar') +
          btn('Jak tandem probíhá', 'btn--outline', 'go', 'tandem') +
        '</div>' +
      '</div>' +
    '</section>' +

    '<div class="stats-wrap"><div class="container"><div class="stats">' +
      '<div class="stat"><div class="stat__num">4 000 m</div><div class="stat__label">Výskoková výška</div></div>' +
      '<div class="stat"><div class="stat__num">50 s</div><div class="stat__label">Volný pád</div></div>' +
      '<div class="stat"><div class="stat__num">17 let</div><div class="stat__label">Provozu bez nehody</div></div>' +
      // Čtvrtá dlaždice má smysl, jen když je co nabídnout. Mimo sezónu by
      // hlásila "0 volných míst", což je horší než nic.
      (nadchazejici.length
        ? '<div class="stat"><div class="stat__num">' + spots + '</div><div class="stat__label">Volných míst v nejbližších termínech</div></div>'
        : '') +
    '</div></div></div>' +

    '<section class="section container">' +
      sectionHead('Co u nás můžeš skočit', 'Všechny termíny →', 'go-kalendar') +
      '<div class="cards">' + D.PRODUCTS.map(productCard).join('') + '</div>' +
    '</section>' +

    // Mimo sezónu (nebo než majitelka vypíše nové termíny) se sekce neukáže
    // vůbec - místo prázdného seznamu nebo proběhlých dat vede odkaz na kontakt.
    (nadchazejici.length
      ? '<section class="section container">' +
          sectionHead('Nejbližší termíny', 'Celý kalendář →', 'go-kalendar') +
          '<div class="termlist">' + nadchazejici.slice(0, 5).map(terminRow).join('') + '</div>' +
        '</section>'
      : '<section class="section container">' +
          '<div class="box" style="text-align:center">' +
            '<h2 class="subhead" style="margin-bottom:10px">Termíny na další sezónu chystáme</h2>' +
            '<p class="prose" style="margin-bottom:22px">Napiš nám a ozveme se, jakmile budou vypsané. Rádi ti termín podržíme dopředu.</p>' +
            btn('Napsat nám', 'btn--primary', 'go', 'kontakt') +
          '</div>' +
        '</section>') +

    '<section class="section container">' +
      '<div class="feature-grid">' +
        '<button type="button" class="feature" data-action="go" data-arg="expedice">' +
          '<img class="feature__media" src="' + attr(D.GAL[0]) + '" alt="Expedice — seskoky v zahraničí" loading="lazy" />' +
          '<span class="feature__scrim"></span>' +
          '<span class="feature__body">' +
            '<span class="feature__kicker">Expedice</span>' +
            '<span class="feature__title">Skákat jinde než doma</span>' +
            '<span class="feature__text">Slovinsko, Alpy, jižní Evropa. Týden mezi lidmi, co mají stejnou závislost.</span>' +
          '</span>' +
        '</button>' +
        '<button type="button" class="feature" data-action="go" data-arg="onas">' +
          '<img class="feature__media" src="' + attr(D.IMG.zv) + '" alt="Náš tým instruktorů" loading="lazy" />' +
          '<span class="feature__scrim"></span>' +
          '<span class="feature__body">' +
            '<span class="feature__kicker">Náš tým</span>' +
            '<span class="feature__title">Lidé, kterým věříš život</span>' +
            '<span class="feature__text">Instruktoři s kategorií D, tisíce seskoků, jeden společný standard: absolutní bezpečí.</span>' +
          '</span>' +
        '</button>' +
      '</div>' +
    '</section>' +

    '<section class="section container">' +
      '<div class="section__head"><h2 class="section__title">Aktuálně z letiště</h2></div>' +
      '<div class="cards cards--news">' +
        D.NEWS.map(function (n) {
          return '<article class="card">' +
            '<div class="card__media card__media--16-10" style="background-image:url(' + attr(n.img) + ')"></div>' +
            '<div class="card__body">' +
              '<h3 class="card__title">' + esc(n.title) + '</h3>' +
              '<p class="card__text">' + esc(n.text) + '</p>' +
            '</div>' +
          '</article>';
        }).join('') +
      '</div>' +
    '</section>' +

    '<section class="section container">' +
      '<div class="banner">' +
        '<div>' +
          '<h2 class="banner__title">Dárek, který si nikdo nezapomene</h2>' +
          '<p class="banner__text">Poukaz na tandem s platností 12 měsíců. Termín si obdarovaný vybere sám.</p>' +
        '</div>' +
        btn('Koupit poukaz', 'btn--primary btn--wide', 'go', 'poukaz') +
      '</div>' +
    '</section>';
  }

  function viewTandem() {
    return '' +
    '<section class="hero hero--sub">' +
      '<img class="hero__media" src="' + attr(D.IMG.tandem) + '" alt="Tandemový seskok" fetchpriority="high" />' +
      '<div class="hero__scrim"></div>' +
      '<div class="container hero__content">' +
        '<p class="hero__eyebrow">Pro každého od 15 let</p>' +
        '<h1 class="hero__title">Tandemový seskok</h1>' +
      '</div>' +
    '</section>' +

    '<div class="container section--first split">' +
      '<div>' +
        '<p class="prose-lg">Nejžádanější letecká aktivita v Čechách. Vyskočíš z 4 000 metrů připoutaný k instruktorovi, padesát sekund volného pádu, pak pět minut ticha pod padákem. Žádná zkušenost, žádný trénink — jen podpis a odvaha.</p>' +
        '<p class="prose">Na letišti jsi cca 2–3 hodiny: instruktáž, oblečení postroje, nástup do letadla, seskok a předání videa. Váhový limit 95 kg, do 15 let se souhlasem zákonného zástupce.</p>' +
        '<h2 class="subhead">Jak to proběhne</h2>' +
        '<div class="steps">' +
          D.TANDEM_STEPS.map(function (s) {
            return '<div class="step">' +
              '<div class="step__n">' + esc(s.n) + '</div>' +
              '<div><div class="step__title">' + esc(s.title) + '</div><div class="step__text">' + esc(s.text) + '</div></div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<aside class="panel panel--sticky">' +
        '<div class="panel__label">Varianty a ceny</div>' +
        D.TANDEM_VARIANTS.map(function (v) {
          return '<div class="variant">' +
            '<div class="variant__row">' +
              '<span class="variant__title">' + esc(v.title) + '</span>' +
              '<span class="variant__price">' + esc(v.price) + '</span>' +
            '</div>' +
            '<div class="variant__note">' + esc(v.note) + '</div>' +
          '</div>';
        }).join('') +
        '<div style="margin-top:22px">' + btn('Vybrat termín', 'btn--primary btn--block', 'go', 'kalendar') + '</div>' +
        '<div style="margin-top:10px">' + btn('Koupit jako dárek', 'btn--outline btn--block', 'go', 'poukaz') + '</div>' +
      '</aside>' +
    '</div>';
  }

  function viewKurzy() {
    return '<div class="container section--first">' +
      '<p class="eyebrow">Vlastní licence</p>' +
      '<h1 class="display">Kurzy a výcvik</h1>' +
      '<p class="lead" style="margin-bottom:44px">Základní kurz trvá 48 hodin a obsahuje standardní, zákonem požadovanou výuku podle platných osnov Úřadu pro civilní letectví (V-PARA 1 a V-PARA 2) — u nás rozšířenou o praxi, kterou předpis nevyžaduje.</p>' +

      '<div class="cards">' +
        D.COURSES.map(function (c) {
          var t = terminById(c.terminId);
          // Proběhlý termín není volné místo - tlačítko by vedlo do minulosti.
          // Rozlišujeme ale "plno" od "zatím žádný termín", ať to sedí.
          var vypsany = t && jeBudouci(t);
          var volno = vypsany && free(t) > 0;
          return '<article class="card">' +
            '<div class="card__media card__media--3-2" style="background-image:url(' + attr(c.img) + ')"></div>' +
            '<div class="card__body">' +
              '<div class="card__kicker">' + esc(c.tag) + '</div>' +
              '<h3 class="card__title">' + esc(c.title) + '</h3>' +
              '<p class="card__text">' + esc(c.text) + '</p>' +
              '<div class="card__meta"><span>' + esc(c.dur) + '</span><span>' + esc(c.level) + '</span></div>' +
              '<div class="card__foot card__foot--plain">' +
                '<span class="card__price card__price--lg">' + esc(c.price) + '</span>' +
                (volno
                  ? '<button type="button" class="btn btn--primary btn--sm" data-action="termin" data-arg="' + c.terminId + '">Mám zájem</button>'
                  : vypsany
                    ? '<span class="card__cta" style="color:var(--ghost)">Obsazeno</span>'
                    : '<button type="button" class="btn btn--outline btn--sm" data-action="go" data-arg="kontakt">Zeptat se na termín</button>') +
              '</div>' +
            '</div>' +
          '</article>';
        }).join('') +
      '</div>' +

      '<div class="box" style="margin-top:56px">' +
        '<h2 class="subhead">Co potřebuješ mít s sebou</h2>' +
        '<div class="checklist">' +
          D.COURSE_CHECKLIST.map(function (i) { return '<div>' + esc(i) + '</div>'; }).join('') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function viewKalendar() {
    // Hlavní tlačítko v heru vede sem, takže proběhlé termíny musí zmizet
    // i tady - jinak by titulka mlčela a kalendář hned vedle nabízel loňsko.
    var visible = budouciTerminy().filter(function (t) {
      if (state.filter === 'Tandem') return t.kind === 'tandem';
      if (state.filter === 'Kurzy') return t.kind === 'kurz';
      if (state.filter === 'Volná místa') return free(t) > 0;
      return true;
    });

    return '<div class="container section--first">' +
      '<p class="eyebrow">Volná místa v reálném čase</p>' +
      '<h1 class="display" style="margin-bottom:28px">Kalendář termínů</h1>' +

      '<div class="filters" role="group" aria-label="Filtr termínů">' +
        D.FILTERS.map(function (f) {
          var on = state.filter === f;
          return '<button type="button" class="filter' + (on ? ' filter--active' : '') + '" data-action="filter" data-arg="' + attr(f) + '"' +
            ' aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(f) + '</button>';
        }).join('') +
      '</div>' +

      '<div class="table">' +
        '<div class="table__head"><div>Datum</div><div>Akce</div><div>Obsazenost</div><div>Cena</div><div></div></div>' +
        (visible.length
          ? visible.map(tableRow).join('')
          : budouciTerminy().length
            ? '<div class="empty">Pro tento filtr nemáme žádný termín</div>'
            : '<div class="empty">Termíny na další sezónu teprve chystáme. ' +
              'Napiš nám a ozveme se, jakmile budou vypsané.</div>') +
      '</div>' +
      '<p class="mono-note" style="margin-top:16px">Provoz závisí na počasí. O startech informujeme den předem SMS.</p>' +
    '</div>';
  }

  function viewTermin() {
    var t = selectedTermin();
    var f = free(t);
    var totalNum = (t.price || 0) * state.people;

    return '<div class="container" style="padding-top:40px">' +
      '<button type="button" class="backlink" data-action="go" data-arg="kalendar">← Zpět na kalendář</button>' +
      '<div class="split split--tight">' +
        '<div>' +
          '<h1 class="detail__title">' + esc(t.type) + '</h1>' +
          '<div class="detail__when">' + esc(t.date) + ' · ' + esc(t.time) + '</div>' +
          '<div class="detail__media" style="background-image:url(' + attr(t.img) + ')" role="img" aria-label="' + attr(t.type) + '"></div>' +
          '<div class="meta-grid">' +
            '<div class="meta"><div class="meta__label">Místo</div><div class="meta__value">' + esc(t.place) + '</div></div>' +
            '<div class="meta"><div class="meta__label">Volná místa</div><div class="meta__value">' + f + ' z ' + t.max + '</div></div>' +
            '<div class="meta"><div class="meta__label">Cena za osobu</div><div class="meta__value">' + esc(priceLabel(t)) + '</div></div>' +
          '</div>' +
          '<p class="detail__desc">' + esc(t.desc) + '</p>' +
        '</div>' +

        '<aside class="panel panel--sticky">' +
          '<h2 class="panel__title">Rezervace</h2>' +
          '<div class="mono-note" style="margin-bottom:22px;letter-spacing:0.1em">' + esc(t.date) + ' · ' + esc(t.type) + '</div>' +

          '<div class="panel__label" style="margin-bottom:10px">Počet osob</div>' +
          '<div class="stepper">' +
            '<button type="button" class="stepper__btn" data-action="people" data-arg="-1" aria-label="Ubrat osobu"' + (state.people <= 1 ? ' disabled' : '') + '>−</button>' +
            '<span class="stepper__value" aria-live="polite">' + state.people + '</span>' +
            '<button type="button" class="stepper__btn" data-action="people" data-arg="1" aria-label="Přidat osobu"' + (state.people >= Math.max(1, f) ? ' disabled' : '') + '>+</button>' +
          '</div>' +

          '<div class="sumline">' +
            '<span>' + state.people + ' × ' + esc(priceLabel(t)) + '</span>' +
            '<span class="sumline__total">' + (totalNum ? esc(czk(totalNum)) : 'Cena na dotaz') + '</span>' +
          '</div>' +

          '<div style="margin-top:22px">' +
            btn('Poslat nezávaznou poptávku', 'btn--primary btn--block', 'start-booking') +
          '</div>' +
          '<p class="fineprint">Poptávka je nezávazná. Místo potvrdíme e-mailem, nic teď neplatíš.</p>' +
        '</aside>' +
      '</div>' +
    '</div>';
  }

  /* Průvodce končí poptávkou, ne rezervací.
     Dokud rezervace nejsou v databázi (etapa E5), nesmí web tvrdit, že je
     místo zamluvené, a nesmí vymýšlet potvrzovací kód. Poslední krok proto
     odešle poptávku na /api/poptavky - to je jediná cesta, která doopravdy
     někde skončí. Krok "Platba" tím odpadl celý: není co platit. */
  function viewBooking() {
    var t = selectedTermin();
    var isVoucher = state.mode === 'voucher';
    var totalNum = (t.price || 0) * state.people;
    var totalLabel = totalNum ? czk(totalNum) : 'Cena na dotaz';
    var html = '<div class="container container--narrow" style="padding-top:44px">';

    var labels = isVoucher ? ['Kontakt', 'Hotovo'] : ['Účastníci', 'Kontakt', 'Hotovo'];
    // Kroky se číslují 0, 1 a 3 (hotovo) - u poukazu se první přeskakuje.
    var poradiKroku = isVoucher ? [1, 3] : [0, 1, 3];
    html += '<div class="progress-steps">' + labels.map(function (l, i) {
      var reached = state.bStep >= poradiKroku[i];
      return '<div class="pstep' + (reached ? ' pstep--on' : '') + '">' +
        '<div class="pstep__bar"></div>' +
        '<div class="pstep__label">' + (i + 1) + '. ' + esc(l) + '</div>' +
      '</div>';
    }).join('') + '</div>';

    /* --- krok 1: účastníci --- */
    if (state.bStep === 0) {
      html += '<div>' +
        '<h1 class="section__title" style="margin-bottom:8px">Kdo skáče</h1>' +
        '<p class="prose" style="margin-bottom:30px">Jméno na každého účastníka potřebujeme kvůli pojištění a váhovému limitu.</p>' +
        '<div style="display:grid;gap:16px">' +
          state.pax.map(function (p, i) {
            return '<div class="pax">' +
              '<div class="pax__label">Účastník ' + (i + 1) + '</div>' +
              '<div class="field-grid field-grid--tri">' +
                '<input class="field" type="text" autocomplete="name" placeholder="Jméno a příjmení" aria-label="Jméno a příjmení účastníka ' + (i + 1) + '" value="' + attr(p.name) + '" data-pax="' + i + '" data-key="name" />' +
                '<input class="field" type="text" inputmode="numeric" placeholder="Hmotnost (kg)" aria-label="Hmotnost účastníka ' + (i + 1) + '" value="' + attr(p.weight) + '" data-pax="' + i + '" data-key="weight" />' +
                '<input class="field" type="text" inputmode="numeric" placeholder="Věk" aria-label="Věk účastníka ' + (i + 1) + '" value="' + attr(p.age) + '" data-pax="' + i + '" data-key="age" />' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
    }

    /* --- krok 2: kontakt --- */
    if (state.bStep === 1) {
      html += '<div>' +
        '<h1 class="section__title" style="margin-bottom:8px">Kontaktní údaje</h1>' +
        '<p class="prose" style="margin-bottom:30px">' +
          (isVoucher
            ? 'Ozveme se ti s domluvou poukazu a způsobem platby.'
            : 'Poptávka je nezávazná. Ozveme se ti s volnými místy a potvrzením termínu.') +
        '</p>' +
        '<div class="field-grid">' +
          '<input class="field field--onpanel" type="text" autocomplete="name" placeholder="Jméno a příjmení" aria-label="Jméno a příjmení" value="' + attr(state.form.name) + '" data-form="name" />' +
          '<input class="field field--onpanel" type="email" autocomplete="email" placeholder="E-mail" aria-label="E-mail" value="' + attr(state.form.email) + '" data-form="email" />' +
          '<input class="field field--onpanel" type="tel" autocomplete="tel" placeholder="Telefon" aria-label="Telefon" value="' + attr(state.form.phone) + '" data-form="phone" />' +
          '<input class="field field--onpanel" type="text" autocomplete="address-level2" placeholder="Město" aria-label="Město" value="' + attr(state.form.city) + '" data-form="city" />' +
        '</div>' +
        '<textarea class="field field--onpanel" style="margin-top:14px" placeholder="Poznámka (skupina, dárkový poukaz, cokoliv)" aria-label="Poznámka" data-form="note">' + esc(state.form.note) + '</textarea>' +
        '<button type="button" class="checkbox" data-action="terms" aria-pressed="' + (state.terms ? 'true' : 'false') + '">' +
          '<span class="checkbox__box" aria-hidden="true">' + (state.terms ? '✓' : '') + '</span>' +
          '<span class="checkbox__text">Souhlasím s provozními podmínkami a zpracováním osobních údajů. Potvrzuji, že jsem zdravotně způsobilý k seskoku.</span>' +
        '</button>' +
        (state.bookingError
          ? '<p role="alert" style="margin-top:14px;color:var(--accent-lite);font-size:14px">' + esc(state.bookingError) + '</p>'
          : '') +
      '</div>';
    }

    /* --- krok 3: hotovo --- */
    if (state.bStep === 3) {
      var vSel = D.VOUCHERS[state.voucher];
      var email = state.form.email || 'tvůj e-mail';

      // Žádné číslo rezervace. Poptávka je poptávka - potvrzení termínu
      // a cenu pošle provoz, až se na ni podívá.
      var souhrn = isVoucher ? [
        ['Poukaz', vSel.title],
        ['Pro koho', state.voucherFor || 'nevyplněno'],
        ['Platnost', '12 měsíců od vystavení'],
        ['Orientační cena', czk(vSel.price)]
      ] : [
        ['Akce', t.type],
        ['Termín', t.date + ' · ' + t.time],
        ['Místo', t.place],
        ['Osoby', String(state.people)],
        ['Orientační cena', totalNum ? czk(totalNum) : 'dle rozsahu']
      ];

      html += '<div class="done">' +
        '<div class="done__check" aria-hidden="true">✓</div>' +
        '<h1 class="done__title">Poptávka odeslána</h1>' +
        '<p class="done__text">Ozveme se na <strong>' + esc(email) + '</strong> do 24 hodin — ' +
          'potvrdíme volné místo' + (isVoucher ? ' a domluvíme poukaz' : ' i cenu') + '. ' +
          'Nic teď neplatíš a nic není závazné.</p>' +
        '<div class="summary">' +
          '<div class="summary__label">Co jsi nám poslal' + (isVoucher ? ' k poukazu' : '') + '</div>' +
          souhrn.map(function (r) {
            return '<div class="summary__row"><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>';
          }).join('') +
        '</div>' +
        '<div style="margin-top:30px">' + btn('Zpátky na web', 'btn--outline', 'go', '') + '</div>' +
      '</div>';
    }

    /* --- spodní lišta --- */
    if (state.bStep < 3) {
      var nextLabel = state.bookingSending
        ? 'Odesílám…'
        : (state.bStep === 1 ? 'Odeslat poptávku' : 'Pokračovat');

      html += '<div class="bookingbar">' +
        '<div>' +
          '<div class="bookingbar__label">' + esc(
            isVoucher
              ? 'Dárkový poukaz · ' + D.VOUCHERS[state.voucher].title
              : t.date + ' · ' + t.type + ' · ' + state.people + ' os.'
          ) + '</div>' +
          '<div class="bookingbar__total">' + esc(isVoucher ? czk(D.VOUCHERS[state.voucher].price) : totalLabel) + '</div>' +
        '</div>' +
        '<div class="bookingbar__actions">' +
          btn('Zpět', 'btn--outline', 'booking-back') +
          btn(nextLabel, 'btn--primary', 'booking-next') +
        '</div>' +
      '</div>';
    }

    return html + '</div>';
  }

  function viewPoukaz() {
    var v = D.VOUCHERS[state.voucher];

    return '<div class="container section--first">' +
      '<div class="split split--tight">' +
        '<div>' +
          '<p class="eyebrow">Platnost 12 měsíců</p>' +
          '<h1 class="display">Dárkový poukaz</h1>' +
          '<p class="lead" style="margin-bottom:26px">Poukaz vystavíme do pěti minut a pošleme e-mailem v PDF — nebo tištěný poštou. Termín si obdarovaný vybere sám v kalendáři, kdykoliv během roku.</p>' +
          '<div class="box" style="background:var(--panel);padding:26px">' +
            '<div class="panel__label" style="margin-bottom:14px">Náhled poukazu</div>' +
            '<div class="voucher-preview">' +
              '<img class="voucher-preview__img" src="' + attr(D.IMG.iaff) + '" alt="Náhled dárkového poukazu" loading="lazy" />' +
              '<div class="voucher-preview__scrim"></div>' +
              '<div class="voucher-preview__body">' +
                '<div class="voucher-preview__logo">LSD</div>' +
                '<div>' +
                  '<div class="voucher-preview__title" id="voucher-title">' + esc(v.title) + '</div>' +
                  '<div class="voucher-preview__for">PRO: <span id="voucher-for">' + esc(state.voucherFor || '————') + '</span></div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<aside class="panel">' +
          '<div class="panel__label" style="margin-bottom:12px">Vyber zážitek</div>' +
          '<div class="voucher-opts" role="radiogroup" aria-label="Typ poukazu">' +
            D.VOUCHERS.map(function (o, i) {
              var on = state.voucher === i;
              return '<button type="button" class="voucher-opt' + (on ? ' voucher-opt--active' : '') + '" data-action="voucher" data-arg="' + i + '" role="radio" aria-checked="' + (on ? 'true' : 'false') + '">' +
                '<span>' +
                  '<span class="voucher-opt__title">' + esc(o.title) + '</span>' +
                  '<span class="voucher-opt__note">' + esc(o.note) + '</span>' +
                '</span>' +
                '<span class="voucher-opt__price">' + esc(czk(o.price)) + '</span>' +
              '</button>';
            }).join('') +
          '</div>' +
          '<div class="field-stack">' +
            '<input class="field" type="text" placeholder="Pro koho (jméno na poukazu)" aria-label="Jméno na poukazu" value="' + attr(state.voucherFor) + '" data-voucher-for />' +
            '<input class="field" type="email" autocomplete="email" placeholder="Tvůj e-mail pro doručení PDF" aria-label="E-mail pro doručení" value="' + attr(state.form.email) + '" data-form="email" />' +
          '</div>' +
          '<div style="margin-top:20px">' +
            btn('Koupit za ' + czk(v.price), 'btn--primary btn--block', 'buy-voucher') +
          '</div>' +
        '</aside>' +
      '</div>' +
    '</div>';
  }

  function viewExpedice() {
    return '<div class="container section--first">' +
      '<p class="eyebrow">Mimo domácí letiště</p>' +
      '<h1 class="display">Expedice &amp; Helitour</h1>' +
      '<p class="lead" style="margin-bottom:40px">Připravujeme kurzy, kulturní akce, expedice a setkání pro členy i širokou veřejnost. Skákání nad Alpami, seskok z vrtulníku, týden v partě, která má stejnou závislost.</p>' +
      '<div class="cards cards--wide">' +
        D.TRIPS.map(function (e) {
          return '<article class="card">' +
            '<div class="card__media" style="background-image:url(' + attr(e.img) + ')">' +
              '<span class="card__tag">' + esc(e.tag) + '</span>' +
            '</div>' +
            '<div class="card__body">' +
              '<h3 class="card__title">' + esc(e.title) + '</h3>' +
              '<p class="card__text">' + esc(e.text) + '</p>' +
              '<div class="card__meta"><span>' + esc(e.meta) + '</span></div>' +
              '<div class="card__foot card__foot--plain">' +
                '<span class="card__price card__price--lg">' + esc(e.price) + '</span>' +
                '<button type="button" class="btn btn--outline btn--sm" data-action="go" data-arg="kontakt">Mám zájem</button>' +
              '</div>' +
            '</div>' +
          '</article>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  function viewGalerie() {
    return '<div class="container section--first">' +
      '<h1 class="display" style="margin-bottom:28px">Galerie</h1>' +
      '<div class="gallery">' +
        D.GAL.map(function (src, i) {
          return '<button type="button" class="gallery__item" data-action="lightbox" data-arg="' + i + '" aria-label="Otevřít fotografii ' + (i + 1) + '">' +
            '<span class="gallery__img" style="background-image:url(' + attr(src) + ')"></span>' +
          '</button>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  function viewOnas() {
    return '<div class="container section--first">' +
      '<p class="eyebrow">Spolek od roku 2009</p>' +
      '<h1 class="display" style="max-width:22ch;margin-bottom:26px">Letecká společnost dobrodruhů</h1>' +
      '<div class="about-grid">' +
        '<p>Jsme spolek zabývající se adrenalinovými sporty, zejména parašutismem. Sdružujeme všechny, co se rádi baví a nebojí se překonávat strach a překážky. Vytváříme prostor, kde se setkávají aktivní lidé realizující si své sny.</p>' +
        '<p>Instruktoři jsou ve svém oboru profesionálové a vždy dbají na naprosté bezpečí klientů. Jsme tu pro lidi, kteří rádi poznávají svět, mají chuť objevovat nové věci a především — poznávají sami sebe.</p>' +
      '</div>' +
      '<h2 class="section__title" style="font-size:clamp(24px,3.4vw,42px);margin-bottom:8px">Naši lidé</h2>' +
      '<p class="prose" style="max-width:60ch;margin-bottom:28px;font-size:15px">Jsme tým. Každý den se na sebe musíme spolehnout. Zodpovědnost a absolutní jistota jsou naším základním nástrojem.</p>' +
      '<div class="team">' +
        D.TEAM.map(function (m) {
          return '<article class="member">' +
            '<div class="member__photo" style="background-image:url(' + attr(m.img) + ')" role="img" aria-label="' + attr(m.name) + '"></div>' +
            '<div class="member__body">' +
              '<h3 class="member__name">' + esc(m.name) + '</h3>' +
              '<div class="member__role">' + esc(m.role) + '</div>' +
              '<p class="member__bio">' + esc(m.bio) + '</p>' +
            '</div>' +
          '</article>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  function viewFaq() {
    return '<div class="container container--narrow section--first">' +
      '<h1 class="display" style="margin-bottom:30px">Časté otázky</h1>' +
      '<div class="faq">' +
        D.FAQ.map(function (item, i) {
          var open = state.faqOpen === i;
          return '<div class="faq__item">' +
            '<button type="button" class="faq__q" data-action="faq" data-arg="' + i + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="faq-a-' + i + '">' +
              '<span class="faq__qtext">' + esc(item.q) + '</span>' +
              '<span class="faq__mark" aria-hidden="true">' + (open ? '−' : '+') + '</span>' +
            '</button>' +
            (open ? '<div class="faq__a" id="faq-a-' + i + '">' + esc(item.a) + '</div>' : '') +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  function viewKontakt() {
    return '<div class="container section--first">' +
      '<h1 class="display" style="margin-bottom:34px">Kontakt</h1>' +
      '<div class="split split--tight">' +
        '<div>' +
          '<div class="contact-list">' +
            '<div><div class="contact__label">Telefon — rezervace tandemů</div><div class="contact__value"><a href="tel:+420777310959">+420 777 310 959</a></div></div>' +
            '<div><div class="contact__label">E-mail</div><div class="contact__value"><a href="mailto:info@lsd-trip.cz">info@lsd-trip.cz</a></div></div>' +
            '<div><div class="contact__label">Sídlo spolku</div><div class="contact__text">Letecká společnost dobrodruhů z.s.<br />Holečkova 49/789, Praha 5, 150 00</div></div>' +
            '<div><div class="contact__label">Kde skáčeme</div><div class="contact__text">Letiště Jihlava — Henčov</div></div>' +
          '</div>' +
        '</div>' +
        '<aside class="panel">' +
          '<h2 class="panel__title" style="margin-bottom:18px">Napiš nám</h2>' +
          '<div class="field-stack">' +
            '<input class="field" type="text" autocomplete="name" placeholder="Jméno" aria-label="Jméno" value="' + attr(state.form.name) + '" data-form="name" />' +
            '<input class="field" type="email" autocomplete="email" placeholder="E-mail" aria-label="E-mail" value="' + attr(state.form.email) + '" data-form="email" />' +
            '<textarea class="field" style="min-height:130px" placeholder="Zpráva" aria-label="Zpráva" data-form="note">' + esc(state.form.note) + '</textarea>' +
          '</div>' +
          '<div style="margin-top:16px">' +
            btn(
            state.contactSent ? 'Odesláno — ozveme se do 24 h'
              : state.contactSending ? 'Odesílám…'
              : 'Odeslat zprávu',
            'btn--primary btn--block', 'send-contact'
          ) +
          (state.contactError
            ? '<p style="margin-top:12px;color:var(--accent-lite);font-size:14px">' + esc(state.contactError) + '</p>'
            : '') +
          '</div>' +
        '</aside>' +
      '</div>' +
    '</div>';
  }

  var VIEWS = {
    home: viewHome, tandem: viewTandem, kurzy: viewKurzy, kalendar: viewKalendar,
    termin: viewTermin, booking: viewBooking, poukaz: viewPoukaz, expedice: viewExpedice,
    galerie: viewGalerie, onas: viewOnas, faq: viewFaq, kontakt: viewKontakt
  };

  var TITLES = {
    home: 'LSD — Letecká společnost dobrodruhů | Tandemové seskoky Jihlava',
    tandem: 'Tandemový seskok — LSD',
    kurzy: 'Kurzy a výcvik — LSD',
    kalendar: 'Kalendář termínů — LSD',
    termin: 'Detail termínu — LSD',
    booking: 'Rezervace — LSD',
    poukaz: 'Dárkový poukaz — LSD',
    expedice: 'Expedice & Helitour — LSD',
    galerie: 'Galerie — LSD',
    onas: 'O nás a tým — LSD',
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
      return '<a class="nav__item' + (on ? ' nav__item--active' : '') + '" href="#/' + n.route + '" data-link' +
        (on ? ' aria-current="page"' : '') + '>' + esc(n.label) + '</a>';
    }).join('');

    mobile.innerHTML = D.NAV.map(function (n) {
      var on = current === n.route;
      return '<a class="mobile-menu__item' + (on ? ' mobile-menu__item--active' : '') + '" href="#/' + n.route + '" data-link' +
        (on ? ' aria-current="page"' : '') + '>' + esc(n.label) + '</a>';
    }).join('') +
    '<a class="mobile-menu__item mobile-menu__item--accent" href="#/poukaz" data-link>Dárkový poukaz</a>';

    mobile.hidden = !state.menuOpen;
    var burger = qs('#burger');
    burger.setAttribute('aria-expanded', state.menuOpen ? 'true' : 'false');
    burger.setAttribute('aria-label', state.menuOpen ? 'Zavřít menu' : 'Otevřít menu');
  }

  function render() {
    var view = VIEWS[state.route] || viewHome;
    qs('#main').innerHTML = view();
    renderNav();
    document.title = TITLES[state.route] || TITLES.home;
    measureHeader();
  }

  function measureHeader() {
    var h = qs('#site-header');
    if (!h) return;
    var inner = qs('.header__inner', h);
    var height = inner ? inner.getBoundingClientRect().height : 71;
    document.documentElement.style.setProperty('--header-h', Math.round(height) + 'px');
  }

  /* ------------------------------------------------------------- lightbox */

  function openLightbox(index) {
    var box = qs('#lightbox');
    qs('#lightbox-img').style.backgroundImage = 'url(' + D.GAL[index] + ')';
    box.hidden = false;
    document.body.style.overflow = 'hidden';
    qs('#lightbox-close').focus();
  }

  function closeLightbox() {
    qs('#lightbox').hidden = true;
    document.body.style.overflow = '';
  }

  /* ------------------------------------------------------------ rezervace */

  /* Jediná cesta, kudy z webu odchází poptávka. */
  function posliPoptavku(telo) {
    return fetch('/api/poptavky', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telo)
    }).then(function (odpoved) {
      return odpoved.json().catch(function () { return {}; }).then(function (data) {
        if (!odpoved.ok) throw new Error(data.chyba || 'Zprávu se nepodařilo odeslat.');
        return data;
      });
    });
  }

  /* Co provoz uvidí u poptávky v administraci. Termín ani účastníci nemají
     zatím vlastní sloupce (přijdou v etapě E5), takže jdou do textu zprávy -
     je to pořád lepší než poptávka bez kontextu. */
  function textPoptavky() {
    var radky = [];

    if (state.mode === 'voucher') {
      var v = D.VOUCHERS[state.voucher];
      radky.push('Dárkový poukaz: ' + v.title + ' (' + czk(v.price) + ')');
      if (state.voucherFor) radky.push('Pro koho: ' + state.voucherFor);
    } else {
      var t = selectedTermin();
      radky.push('Termín: ' + t.date + ' · ' + t.type + ' · ' + t.time);
      radky.push('Místo: ' + t.place);
      radky.push('Počet osob: ' + state.people);
      state.pax.forEach(function (p, i) {
        var popis = [
          (p.name || '').trim(),
          p.weight ? p.weight + ' kg' : '',
          p.age ? p.age + ' let' : ''
        ].filter(Boolean).join(', ');
        if (popis) radky.push('Účastník ' + (i + 1) + ': ' + popis);
      });
    }

    if (state.form.city) radky.push('Město: ' + state.form.city);
    if (state.form.note) radky.push('', 'Poznámka: ' + state.form.note);

    return radky.join('\n');
  }

  function bookingNext() {
    if (state.bStep >= 3 || state.bookingSending) return;

    // Krok 0 (účastníci) jen přepne dál, odesílá se až z kroku 1.
    if (state.bStep === 0) {
      state.bStep = 1;
      state.bookingError = null;
      render();
      window.scrollTo(0, 0);
      return;
    }

    var jmeno = (state.form.name || '').trim();
    var email = (state.form.email || '').trim();

    if (jmeno.length < 2 || email.indexOf('@') === -1) {
      state.bookingError = 'Vyplň prosím jméno a platný e-mail, ať se máme kam ozvat.';
      render();
      return;
    }
    if (!state.terms) {
      state.bookingError = 'Bez souhlasu s podmínkami a zpracováním údajů ti poptávku zpracovat nemůžeme.';
      render();
      return;
    }

    state.bookingSending = true;
    state.bookingError = null;
    render();

    posliPoptavku({
      jmeno: jmeno,
      email: email,
      telefon: (state.form.phone || '').trim(),
      zprava: textPoptavky()
    })
      .then(function () {
        state.bookingSending = false;
        state.bStep = 3;
        render();
        window.scrollTo(0, 0);
      })
      .catch(function (chyba) {
        state.bookingSending = false;
        state.bookingError = chyba.message + ' Zkus to prosím znovu, nebo nám zavolej.';
        render();
      });
  }

  function bookingBack() {
    if (state.bookingSending) return;

    // Z prvního kroku se vrací tam, odkud se přišlo.
    if (state.bStep === 0 || (state.bStep === 1 && state.mode === 'voucher')) {
      navigate(state.mode === 'voucher' ? 'poukaz' : 'termin/' + selectedTermin().id);
      return;
    }

    state.bStep -= 1;
    state.bookingError = null;
    render();
    window.scrollTo(0, 0);
  }

  /* --------------------------------------------------------------- akce */

  var ACTIONS = {
    'go': function (arg) { navigate(arg || ''); },
    'go-kalendar': function () { navigate('kalendar'); },
    'termin': function (arg) { openTermin(arg); },
    'filter': function (arg) { state.filter = arg; render(); },
    'people': function (arg) { setPeople(state.people + Number(arg)); },
    'start-booking': function () {
      state.bStep = 0;
      state.mode = 'booking';
      state.bookingError = null;
      navigate('booking');
    },
    'booking-next': bookingNext,
    'booking-back': bookingBack,
    'terms': function () { state.terms = !state.terms; render(); },
    'voucher': function (arg) { state.voucher = Number(arg); render(); },
    // Poukaz jde stejnou cestou jako termín: vyplnit kontakt a odeslat
    // poptávku. Účastníci u poukazu nejsou, proto se začíná krokem 1.
    'buy-voucher': function () {
      state.mode = 'voucher';
      state.bStep = 1;
      state.bookingError = null;
      navigate('booking');
    },
    'faq': function (arg) {
      var i = Number(arg);
      state.faqOpen = state.faqOpen === i ? null : i;
      render();
    },
    'lightbox': function (arg) { openLightbox(Number(arg)); },
    /* Odeslání kontaktního formuláře na API. Vizuál se nemění - jen přibyl
       průběžný stav a hláška, když se odeslání nepovede. */
    'send-contact': function () {
      if (state.contactSending || state.contactSent) return;

      var jmeno = (state.form.name || '').trim();
      var email = (state.form.email || '').trim();
      var zprava = (state.form.note || '').trim();

      if (!jmeno || email.indexOf('@') === -1) {
        state.contactError = 'Vyplň prosím jméno a platný e-mail.';
        render();
        return;
      }

      state.contactSending = true;
      state.contactError = null;
      render();

      fetch('/api/poptavky', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jmeno: jmeno, email: email, zprava: zprava })
      })
        .then(function (odpoved) {
          return odpoved.json().catch(function () { return {}; }).then(function (data) {
            if (!odpoved.ok) throw new Error(data.chyba || 'Zprávu se nepodařilo odeslat.');
            return data;
          });
        })
        .then(function () {
          state.contactSent = true;
        })
        .catch(function (chyba) {
          state.contactError = chyba.message + ' Zkus to prosím znovu, nebo zavolej.';
        })
        .then(function () {
          state.contactSending = false;
          render();
        });
    }
  };

  /* -------------------------------------------------------------- events */

  document.addEventListener('click', function (e) {
    var lightbox = qs('#lightbox');
    if (lightbox && !lightbox.hidden && lightbox.contains(e.target)) {
      closeLightbox();
      return;
    }

    var burger = e.target.closest('#burger');
    if (burger) {
      state.menuOpen = !state.menuOpen;
      renderNav();
      return;
    }

    var link = e.target.closest('[data-link]');
    if (link) {
      state.menuOpen = false;
      return; // hashchange se postará o zbytek
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
})(window.LSD_DATA);
