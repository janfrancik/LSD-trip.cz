// public/admin/assets/js/ui.js
//
// Pomocné funkce pro skládání obrazovek. Žádný framework - HTML se skládá
// do stringů a připojuje přes innerHTML, události se odchytávají delegovaně
// na kořeni aplikace (stejný přístup jako na webu).

export function esc(hodnota) {
  return String(hodnota == null ? '' : hodnota)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ------------------------------------------------------------ české formáty
//
// Formátování času nemá administrace vlastní - bere ho ze stejného modulu jako
// server (src/cas.js, servíruje se jako /admin/assets/js/cas.js). Kdyby si ho
// každá strana psala po svém, rozejdou se: přesně tak vznikl export, kde čas
// vygenerování byl v UTC a časy testů v pražském čase.
//
// Reexport, aby obrazovky mohly dál psát `import { datumCas } from '../ui.js'`.
export {
  datum, datumSlovy, cas, datumCas, pred, sklon, okamzik,
  isoDatum, denVTydnu, oDniDal,
} from './cas.js';

// Peníze držíme v haléřích, zobrazujeme v korunách.
export function kc(halere) {
  const koruny = Number(halere ?? 0) / 100;
  const cele = Number.isInteger(koruny);
  return (
    koruny.toLocaleString('cs-CZ', {
      minimumFractionDigits: cele ? 0 : 2,
      maximumFractionDigits: 2,
    }) + ' Kč'
  );
}

// ------------------------------------------------------------------- hlášky

export function hlaska(text, typ = 'ok') {
  const nadoba = document.getElementById('hlasky');
  if (!nadoba) return;

  // 'varovani' je pro věci, které nejsou chyba, ale ani úspěch - typicky
  // "e-mail se neodeslal, protože se v tomhle režimu neposílá". Zelená by
  // u toho lhala, červená by strašila.
  const znamy = ['ok', 'chyba', 'varovani'].includes(typ) ? typ : 'ok';

  const prvek = document.createElement('div');
  prvek.className = `hlaska hlaska--${znamy}`;
  prvek.textContent = text;
  nadoba.appendChild(prvek);

  // Co není jen potvrzení, necháme na obrazovce dýl - musí se to stihnout přečíst.
  setTimeout(() => prvek.remove(), znamy === 'ok' ? 4000 : 8000);
}

// --------------------------------------------------------- výsledek e-mailu

/**
 * Co se stalo s e-mailem po akci, která ho posílá. Tři případy:
 *   - odešel: stačí hláška,
 *   - je v testovací schránce: odkaz, kde se dá otevřít (na testu je to
 *     jediná cesta, jak si e-mail přečíst),
 *   - neodešel: dialog, který nezmizí sám - obsluha musí vědět, že to
 *     zákazníkovi musí poslat jinudy.
 *
 * Odkaz je záměrně obyčejný (bez data-odkaz): administrace se na něm načte
 * znovu, zato spolehlivě a se zavřeným dialogem.
 */
export function vysledekEmailu({ zprava, odeslano, email_do_schranky, email_id, zamerne }) {
  if (odeslano) {
    hlaska(zprava, 'ok');
    return Promise.resolve();
  }

  // Neodeslalo se, protože to tak má být (režim jen_provoz nebo vypnuto).
  // Není to chyba a nemá kvůli tomu vyskakovat okno — obsluha o tom ví
  // z pruhu nad formulářem a má tam rovnou tlačítka, jak odpovědět.
  if (zamerne) {
    hlaska(zprava, 'varovani');
    return Promise.resolve();
  }

  if (email_do_schranky) {
    return potvrd({
      nadpis: 'E-mail uložen do testovací schránky',
      text: `${esc(zprava)}<br /><br />
             Na testovacím webu se e-maily neodesílají — uloží se sem i s odkazy,
             na které jde kliknout.
             ${email_id ? `<br /><br /><a href="/admin/emaily/${Number(email_id)}">Zobrazit e-mail →</a>` : ''}`,
      potvrzeni: 'Zavřít',
      nebezpecne: false,
      jenPotvrzeni: true,
    });
  }

  return potvrd({
    nadpis: 'E-mail neodešel',
    text: `${esc(zprava)}<br /><br />
           Zákazníkovi ho zatím pošli jinudy — sám se neodeslal.`,
    potvrzeni: 'Rozumím',
    nebezpecne: false,
    jenPotvrzeni: true,
  });
}

// ------------------------------------------------------- potvrzení a modály

// Potvrzení destruktivní akce. Text musí říct, co se stane - ne "Jsi si jistý?".
export function potvrd({
  nadpis,
  text,
  potvrzeni = 'Potvrdit',
  nebezpecne = true,
  // Informační dialog nemá co rušit - ukáže jen jedno tlačítko.
  jenPotvrzeni = false,
}) {
  return new Promise((vyres) => {
    const nadoba = document.getElementById('modal');
    nadoba.innerHTML = `
      <div class="modal-pozadi" data-zavrit>
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-nadpis">
          <h2 class="modal__nadpis" id="modal-nadpis">${esc(nadpis)}</h2>
          <p class="modal__text">${text}</p>
          <div class="modal__akce">
            ${jenPotvrzeni ? '' : '<button type="button" class="btn btn--obrys" data-ne>Zrušit</button>'}
            <button type="button" class="btn ${nebezpecne ? 'btn--nebezpecny' : 'btn--hlavni'}" data-ano>
              ${esc(potvrzeni)}
            </button>
          </div>
        </div>
      </div>`;

    const zavri = (vysledek) => {
      nadoba.innerHTML = '';
      document.removeEventListener('keydown', naEsc);
      vyres(vysledek);
    };
    const naEsc = (e) => { if (e.key === 'Escape') zavri(false); };
    document.addEventListener('keydown', naEsc);

    nadoba.querySelector('[data-ano]').addEventListener('click', () => zavri(true));
    nadoba.querySelector('[data-ne]')?.addEventListener('click', () => zavri(false));
    nadoba.querySelector('[data-zavrit]').addEventListener('click', (e) => {
      if (e.target.hasAttribute('data-zavrit')) zavri(false);
    });
    nadoba.querySelector('[data-ano]').focus();
  });
}

// Modál s formulářem. `polia` je pole { klic, popisek, typ, hodnota, napoveda, moznosti }.
export function formularModal({ nadpis, text = '', polia, potvrzeni = 'Uložit' }) {
  return new Promise((vyres) => {
    const nadoba = document.getElementById('modal');
    nadoba.innerHTML = `
      <div class="modal-pozadi" data-zavrit>
        <form class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-nadpis">
          <h2 class="modal__nadpis" id="modal-nadpis">${esc(nadpis)}</h2>
          ${text ? `<p class="modal__text">${text}</p>` : ''}
          ${polia.map(pole).join('')}
          <div class="modal__akce">
            <button type="button" class="btn btn--obrys" data-ne>Zrušit</button>
            <button type="submit" class="btn btn--hlavni">${esc(potvrzeni)}</button>
          </div>
        </form>
      </div>`;

    const form = nadoba.querySelector('form');
    const zavri = (vysledek) => {
      nadoba.innerHTML = '';
      document.removeEventListener('keydown', naEsc);
      vyres(vysledek);
    };
    const naEsc = (e) => { if (e.key === 'Escape') zavri(null); };
    document.addEventListener('keydown', naEsc);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = {};
      for (const p of polia) {
        const prvek = form.querySelector(`[name="${p.klic}"]`);
        data[p.klic] = p.typ === 'prepinac' ? prvek.checked : prvek.value;
      }
      zavri(data);
    });
    nadoba.querySelector('[data-ne]').addEventListener('click', () => zavri(null));
    nadoba.querySelector('[data-zavrit]').addEventListener('click', (e) => {
      if (e.target.hasAttribute('data-zavrit')) zavri(null);
    });
    form.querySelector('input, select, textarea')?.focus();
  });
}

// --------------------------------------------------------------- formuláře

export function pole({ klic, popisek, typ = 'text', hodnota = '', napoveda = '', moznosti = [], min, max, povinne = false }) {
  const id = `pole-${klic.replace(/\./g, '-')}`;
  const napovedaHtml = napoveda
    ? `<div class="pole-skupina__napoveda" id="${id}-napoveda">${esc(napoveda)}</div>`
    : '';
  const popis = napoveda ? ` aria-describedby="${id}-napoveda"` : '';

  let vstup;
  if (typ === 'textarea') {
    vstup = `<textarea class="pole" id="${id}" name="${esc(klic)}"${popis}>${esc(hodnota)}</textarea>`;
  } else if (typ === 'vyber') {
    vstup =
      `<select class="pole" id="${id}" name="${esc(klic)}"${popis}>` +
      moznosti
        .map(
          (m) =>
            `<option value="${esc(m.hodnota)}"${String(m.hodnota) === String(hodnota) ? ' selected' : ''}>${esc(m.popis)}</option>`
        )
        .join('') +
      '</select>';
  } else if (typ === 'prepinac' || typ === 'bool') {
    return `<div class="pole-skupina">
        <label class="prepinac">
          <input type="checkbox" id="${id}" name="${esc(klic)}" ${hodnota ? 'checked' : ''}
                 style="width:22px;height:22px;accent-color:var(--accent)" />
          <span class="prepinac__text">${esc(popisek)}</span>
        </label>
        ${napovedaHtml}
      </div>`;
  } else {
    // Datum a čas schválně nativní: na mobilu se tím dostane kolečko
    // s velkými plochami, které zná z telefonu, a formát řeší systém.
    const typAtr =
      typ === 'cislo' ? 'number' : typ === 'email' ? 'email' : typ === 'telefon' ? 'tel'
      : typ === 'heslo' ? 'password' : typ === 'datum' ? 'date' : typ === 'cas' ? 'time'
      : 'text';
    const rozsah =
      (min != null ? ` min="${esc(min)}"` : '') + (max != null && typ === 'cislo' ? ` max="${esc(max)}"` : '');
    vstup = `<input class="pole" type="${typAtr}" id="${id}" name="${esc(klic)}"
               value="${esc(hodnota)}"${rozsah}${povinne ? ' required' : ''}${popis}
               ${typ === 'cislo' ? 'inputmode="numeric"' : ''} />`;
  }

  return `<div class="pole-skupina" data-pole="${esc(klic)}">
      <label class="pole-skupina__popisek" for="${id}">${esc(popisek)}</label>
      ${vstup}
      ${napovedaHtml}
      <div class="pole-skupina__chyba" hidden></div>
    </div>`;
}

// Vypíše chyby z API k jednotlivým polím a vrátí true, pokud nějaké byly.
export function ukazChybyPoli(korenovyPrvek, detaily) {
  let bylo = false;
  korenovyPrvek.querySelectorAll('.pole-skupina__chyba').forEach((prvek) => {
    prvek.hidden = true;
    prvek.textContent = '';
  });
  korenovyPrvek.querySelectorAll('.pole--chyba').forEach((p) => p.classList.remove('pole--chyba'));

  for (const [klic, zprava] of Object.entries(detaily ?? {})) {
    const skupina = korenovyPrvek.querySelector(`[data-pole="${klic}"]`);
    if (!skupina) continue;
    const chyba = skupina.querySelector('.pole-skupina__chyba');
    if (chyba) {
      chyba.textContent = zprava;
      chyba.hidden = false;
      bylo = true;
    }
    skupina.querySelector('.pole')?.classList.add('pole--chyba');
  }
  return bylo;
}

export function prazdno(nadpis, text = '') {
  return `<div class="prazdno">
      <div class="prazdno__nadpis">${esc(nadpis)}</div>
      ${text ? `<div>${esc(text)}</div>` : ''}
    </div>`;
}

export function strankovani({ strana, na_strane, celkem }) {
  const stran = Math.max(1, Math.ceil(celkem / na_strane));
  if (stran <= 1) return '';
  return `<div class="strankovani">
      <button type="button" class="btn btn--obrys btn--maly" data-strana="${strana - 1}"
        ${strana <= 1 ? 'disabled' : ''}>← Předchozí</button>
      <span>Strana ${strana} z ${stran} · ${celkem} ${sklon(celkem, 'záznam', 'záznamy', 'záznamů')}</span>
      <button type="button" class="btn btn--obrys btn--maly" data-strana="${strana + 1}"
        ${strana >= stran ? 'disabled' : ''}>Další →</button>
    </div>`;
}
