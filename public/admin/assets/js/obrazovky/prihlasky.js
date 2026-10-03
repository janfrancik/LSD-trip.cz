// Přihlášky na termín: seznam a karta přihlášky.
//
// Stavy přepíná provoz ručně (nová → potvrzená → zaplacená, kdykoli storno
// s důvodem). U každé změny se ptáme, jestli poslat e-mail - provoz často
// nejdřív zavolá a e-mail by byl navíc.
//
// Účastníci mimo limit věku nebo váhy jsou zvýraznění. Nejde o chybu, kterou
// je potřeba opravit; jde o to, aby si toho provoz všiml dřív než na letišti.

import { api, dotaz } from '../api.js';
import {
  esc, kc, datumCas, datum, prazdno, strankovani, hlaska, potvrd, pole, ukazChybyPoli,
  formularModal, sklon,
} from '../ui.js';
import { jdiNa, stav as globalniStav } from '../admin.js';

const filtr = { q: '', strana: 1, stav: '', produkt: '', termin: '' };

const STAVY = {
  nova: { popis: 'nová', stitek: 'stitek--nova' },
  potvrzena: { popis: 'potvrzená', stitek: 'stitek--prubeh' },
  zaplacena: { popis: 'zaplacená', stitek: 'stitek--hotovo' },
  probehla: { popis: 'proběhla', stitek: 'stitek--spam' },
  storno: { popis: 'storno', stitek: 'stitek--chyba' },
  presunuta: { popis: 'přesunutá', stitek: 'stitek--spam' },
  no_show: { popis: 'nedorazil', stitek: 'stitek--chyba' },
};

export async function vykresli(koren, { parametr }) {
  if (parametr) return karta(koren, parametr);
  return seznam(koren);
}

// Z karty termínu: "ukaž přihlášky na tenhle termín".
export function omezNaTermin(terminId) {
  filtr.termin = String(terminId);
  filtr.strana = 1;
  filtr.stav = '';
  filtr.q = '';
}

function smiMenit() {
  return globalniStav.ja?.prava?.rezervace === 'menit';
}

// Anonymizace je nevratná, proto jen správce (server to kontroluje taky).
function jeSpravce() {
  return globalniStav.ja?.uzivatel?.role === 'admin';
}

function stitekStavu(p) {
  const s = STAVY[p.stav] ?? { popis: p.stav, stitek: 'stitek--spam' };
  return `<span class="stitek ${s.stitek}">${esc(s.popis)}</span>`;
}

function popisTerminu(p) {
  if (!p.datum) return 'bez termínu';
  const cas = p.popis_casu || (p.cas_od ? `od ${String(p.cas_od).slice(0, 5).replace(/^0/, '')}` : '');
  return `${datum(p.datum)}${cas ? ` ${cas}` : ''}`;
}

// ---------------------------------------------------------------- seznam

async function seznam(koren) {
  const [data, kurzy] = await Promise.all([
    api.get('/rezervace' + dotaz(filtr)),
    api.get('/produkty' + dotaz({ typ: 'kurz', na_strane: 200 })),
  ]);

  koren.innerHTML = `
    <div class="panel__hlava" style="margin-bottom:14px">
      <h1 class="nadpis">Přihlášky</h1>
      <div class="hlava-akce">
        <a class="btn btn--obrys" href="/api/admin/rezervace/export.csv${esc(dotaz(filtr))}"
           download>Export CSV</a>
        ${smiMenit()
          ? '<button type="button" class="btn btn--hlavni" data-nova>Nová přihláška</button>'
          : ''}
      </div>
    </div>

    <div class="filtr-radek">
      <select class="pole" id="filtr-stav" aria-label="Stav přihlášky">
        <option value="">Každý stav</option>
        ${Object.entries(STAVY).map(([klic, s]) =>
          `<option value="${klic}"${filtr.stav === klic ? ' selected' : ''}>${esc(s.popis)}</option>`).join('')}
      </select>
      <select class="pole" id="filtr-kurz" aria-label="Kurz">
        <option value="">Všechny kurzy</option>
        ${kurzy.data.map((k) =>
          `<option value="${k.id}"${filtr.produkt === String(k.id) ? ' selected' : ''}>${esc(k.nazev)}</option>`).join('')}
      </select>
      <input class="pole" type="search" id="hledat" placeholder="Číslo, jméno, e-mail…"
             value="${esc(filtr.q)}" aria-label="Hledat v přihláškách" />
      <button type="button" class="btn btn--obrys" data-hledat>Hledat</button>
    </div>

    ${filtr.termin ? `<p class="sekce__napoveda" style="margin-bottom:12px">
      Jen přihlášky na jeden termín.
      <button type="button" class="odkaz-tlacitko" data-vsechny>Zobrazit všechny</button>
    </p>` : ''}

    ${data.data.length === 0
      ? prazdno(
          filtr.q || filtr.stav || filtr.termin ? 'Nic nenalezeno' : 'Zatím žádné přihlášky',
          filtr.q || filtr.stav || filtr.termin
            ? 'Zkus hledat jinak nebo zruš filtr.'
            : 'Jakmile se někdo přihlásí z webu, objeví se tady.'
        )
      : `
      <div class="seznam">${data.data.map(radek).join('')}</div>

      <table class="tabulka">
        <thead><tr>
          <th>Číslo</th><th>Zákazník</th><th>Kurz</th><th>Termín</th><th>Osob</th><th>Cena</th><th>Stav</th>
        </tr></thead>
        <tbody>${data.data.map(radekTabulky).join('')}</tbody>
      </table>`}

    ${strankovani(data)}`;

  const hledat = () => {
    filtr.q = koren.querySelector('#hledat').value.trim();
    filtr.stav = koren.querySelector('#filtr-stav').value;
    filtr.produkt = koren.querySelector('#filtr-kurz').value;
    filtr.strana = 1;
    seznam(koren);
  };
  koren.querySelector('[data-hledat]')?.addEventListener('click', hledat);
  koren.querySelector('#hledat')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hledat();
  });
  koren.querySelector('#filtr-stav')?.addEventListener('change', hledat);
  koren.querySelector('#filtr-kurz')?.addEventListener('change', hledat);

  koren.querySelector('[data-vsechny]')?.addEventListener('click', () => {
    filtr.termin = '';
    seznam(koren);
  });

  koren.querySelectorAll('[data-strana]').forEach((b) =>
    b.addEventListener('click', () => {
      filtr.strana = Number(b.dataset.strana);
      seznam(koren);
    })
  );

  koren.querySelectorAll('[data-otevrit]').forEach((b) =>
    b.addEventListener('click', () => jdiNa('prihlasky/' + b.dataset.otevrit))
  );

  koren.querySelector('[data-nova]')?.addEventListener('click', () =>
    novaPrihlaska({ poHotovu: () => seznam(koren) })
  );
}

function radek(p) {
  return `<div class="radek">
      <button type="button" data-otevrit="${p.id}"
              style="width:100%;background:none;border:0;padding:0;text-align:left;color:inherit;cursor:pointer">
        <span class="radek__hlava">
          <span class="radek__nazev">${esc(p.zakaznik_jmeno)}</span>
          ${stitekStavu(p)}
        </span>
        <span class="radek__meta">${esc(p.kod)} · ${esc(p.produkt_nazev)} · ${esc(popisTerminu(p))}</span>
        <span class="radek__ukazka">
          ${p.pocet_osob} ${sklon(p.pocet_osob, 'osoba', 'osoby', 'osob')} · ${esc(kc(p.cena_hal))}
        </span>
      </button>
    </div>`;
}

function radekTabulky(p) {
  return `<tr>
      <td class="tesne">
        <button type="button" data-otevrit="${p.id}"
                style="background:none;border:0;padding:0;color:inherit;cursor:pointer;font:inherit">
          <strong class="mono">${esc(p.kod)}</strong>
        </button>
      </td>
      <td>${esc(p.zakaznik_jmeno)}<br /><span class="text-faint">${esc(p.zakaznik_email ?? '')}</span></td>
      <td>${esc(p.produkt_nazev)}</td>
      <td class="tesne">${esc(popisTerminu(p))}</td>
      <td class="tesne">${p.pocet_osob}</td>
      <td class="tesne">${esc(kc(p.cena_hal))}</td>
      <td class="tesne">${stitekStavu(p)}</td>
    </tr>`;
}

// ----------------------------------------------------------------- karta

// Rozpracovaní účastníci. Ukládají se spolu se zbytkem karty, stejně jako
// odrážky u kurzu.
let prace = { ucastnici: [] };

async function karta(koren, id) {
  let p;
  try {
    p = await api.get(`/rezervace/${id}`);
  } catch (chyba) {
    koren.innerHTML = prazdno('Přihláška nenalezena', chyba.message);
    return;
  }

  prace = { ucastnici: p.ucastnici.map((u) => ({ ...u })) };
  const muze = smiMenit() && !p.smazano_at;
  const mimoLimit = p.ucastnici.filter((u) => u.varovani.length).length;

  koren.innerHTML = `
    <button type="button" class="btn btn--obrys btn--maly" data-zpet
            style="margin-bottom:12px">← Přihlášky</button>

    <form class="karta-termin" data-karta novalidate>
      <div class="karta-hlavicka">
        <div class="karta-hlavicka__text">
          <h1 class="karta-hlavicka__nazev">${esc(p.zakaznik_jmeno)}</h1>
          <div class="karta-hlavicka__udaje">
            <span class="mono">${esc(p.kod)}</span>
            ${stitekStavu(p)}
            <span>${esc(p.produkt_nazev)}</span>
            <span>${esc(popisTerminu(p))}</span>
            <span>${p.pocet_osob} ${sklon(p.pocet_osob, 'osoba', 'osoby', 'osob')}</span>
            <span><strong>${esc(kc(p.cena_hal))}</strong></span>
          </div>
          ${p.stav === 'storno' && p.storno_duvod
            ? `<p class="karta-hlavicka__duvod">Důvod storna: ${esc(p.storno_duvod)}</p>` : ''}
          ${mimoLimit
            ? `<p class="karta-hlavicka__duvod" style="color:var(--varovani)">
                 ${mimoLimit} ${sklon(mimoLimit, 'účastník je', 'účastníci jsou', 'účastníků je')} mimo limit kurzu — viz níž.
               </p>` : ''}
        </div>
        ${muze ? `<div class="karta-hlavicka__akce">
          ${p.stav !== 'potvrzena' && p.stav !== 'storno'
            ? '<button type="button" class="btn btn--obrys btn--maly" data-stav="potvrzena">Potvrdit</button>' : ''}
          ${p.stav !== 'zaplacena' && p.stav !== 'storno'
            ? '<button type="button" class="btn btn--obrys btn--maly" data-stav="zaplacena">Zaplaceno</button>' : ''}
          ${p.stav !== 'storno'
            ? '<button type="button" class="btn btn--obrys btn--maly" data-storno>Storno</button>'
            : '<button type="button" class="btn btn--obrys btn--maly" data-stav="nova">Vrátit mezi živé</button>'}
        </div>` : ''}
      </div>

      <div class="karta-sloupce">
        ${sekce('Účastníci', 'Kdo opravdu skáče. Věk se počítá ke dni termínu.', `
          <div class="polozky" data-ucastnici></div>
        `)}

        ${sekce('Zákazník', 'Kontakt na toho, kdo přihlášku podal.', `
          <p class="sekce__udaj">
            <strong>${esc(p.zakaznik_jmeno)}</strong><br />
            ${p.zakaznik_email ? `<a href="mailto:${esc(p.zakaznik_email)}">${esc(p.zakaznik_email)}</a><br />` : ''}
            ${p.zakaznik_telefon ? `<a href="tel:${esc(p.zakaznik_telefon)}">${esc(p.zakaznik_telefon)}</a><br />` : ''}
            ${p.zakaznik_mesto ? esc(p.zakaznik_mesto) : ''}
          </p>
          ${p.anonymizovano_at
            ? '<p class="sekce__udaj text-faint">Zákazník je anonymizovaný.</p>'
            : muze && jeSpravce()
              ? `<button type="button" class="btn btn--obrys btn--blok" data-anonymizovat
                         style="margin-top:12px">Anonymizovat zákazníka</button>
                 <p class="sekce__napoveda">Smaže osobní údaje, přihlášky zůstanou kvůli účetnictví. Nedá se vrátit.</p>`
              : ''}
          ${p.zprava ? `<p class="sekce__udaj" style="margin-top:14px">
            <span class="text-faint">Vzkaz od zákazníka:</span><br />${esc(p.zprava)}</p>` : ''}
        `)}

        ${sekce('Peníze', 'Platby zatím vede provoz ručně — brána přijde ve fázi 4.', `
          <p class="sekce__udaj">Cena <strong>${esc(kc(p.cena_hal))}</strong></p>
          ${pole({ klic: 'uhrazeno_kc', popisek: 'Zaplaceno (Kč)', typ: 'cislo', min: 0,
                   hodnota: p.uhrazeno_hal ? p.uhrazeno_hal / 100 : '' })}
          ${pole({ klic: 'splatnost', popisek: 'Splatnost', typ: 'datum',
                   hodnota: p.splatnost ? String(p.splatnost).slice(0, 10) : '' })}
        `)}

        ${sekce('Souhlasy', 'Co a kdy odsouhlasil — v tom znění, jaké měl před očima.', `
          ${p.zdroj === 'telefon' && !p.souhlas_vop_at
            ? `<p class="sekce__udaj">
                 <span class="stitek stitek--prubeh">po telefonu</span>
                 Souhlasy se podepisují na místě. Na soupisce je to vidět.
               </p>`
            : `${souhlas('Provozní podmínky', p.souhlas_vop_at, p.souhlas_vop_text)}
               ${souhlas('Zpracování osobních údajů', p.souhlas_gdpr_at, p.souhlas_gdpr_text)}
               ${souhlas('Zdravotní prohlášení', p.souhlas_zdravi_at, p.souhlas_zdravi_text)}`}
        `)}

        ${sekce('Poznámka provozu', 'Vidíte jen vy. Na webu ani v e-mailu se neukáže.', `
          ${pole({ klic: 'interni_poznamka', popisek: 'Poznámka', typ: 'textarea',
                   hodnota: p.interni_poznamka ?? '' })}
        `)}

        ${sekce('Odeslané e-maily', 'Co už zákazníkovi odešlo.', `
          ${p.neodeslane_zakaznikovi
            ? `<div class="panel panel--tesny"
                    style="border-left:3px solid var(--varovani);margin-bottom:10px">
                 <strong>Zákazník nedostal potvrzení.</strong>
                 <div class="text-faint" style="margin-top:4px">
                   ${p.neodeslane_zakaznikovi === 1
                     ? 'Jeden e-mail'
                     : `${p.neodeslane_zakaznikovi} e-maily`} se neodeslal${p.neodeslane_zakaznikovi === 1 ? '' : 'y'},
                   protože odesílání zákazníkům je vypnuté. Ozvěte se telefonem.
                   ${p.muze_zakaznikovi
                     ? 'Odeslat dodatečně jde v sekci E-maily.'
                     : ''}
                 </div>
               </div>`
            : ''}
          ${p.emaily.length
            ? `<div class="polozky">${p.emaily.map((e) => `
                <div class="polozka">
                  <div class="sekce__udaj">${esc(e.predmet)}</div>
                  <div class="sekce__napoveda">
                    ${esc(datumCas(e.created_at))} ·
                    ${e.stav === 'neodeslano'
                      ? '<strong style="color:var(--varovani)">neodesláno</strong>'
                      : esc(e.stav)}
                  </div>
                </div>`).join('')}</div>`
            : '<p class="sekce__udaj text-faint">Zatím nic neodešlo.</p>'}
        `)}
      </div>
    </form>

    ${muze ? `<div class="ulozit-lista">
      <button type="button" class="btn btn--hlavni btn--blok" data-ulozit>Uložit změny</button>
    </div>` : ''}`;

  koren.querySelector('[data-zpet]').addEventListener('click', () => jdiNa('prihlasky'));
  vykresliUcastniky(koren, muze);

  koren.querySelector('[data-ulozit]')?.addEventListener('click', () => uloz(koren, p));
  koren.querySelectorAll('[data-stav]').forEach((b) =>
    b.addEventListener('click', () => zmenStav(koren, p, b.dataset.stav))
  );
  koren.querySelector('[data-storno]')?.addEventListener('click', () => storno(koren, p));
  koren.querySelector('[data-anonymizovat]')?.addEventListener('click', () => anonymizuj(koren, p));
}

function sekce(nadpis, napoveda, vnitrek) {
  return `<section class="sekce">
      <div class="sekce__hlava">
        <h2 class="sekce__nadpis">${esc(nadpis)}</h2>
        <p class="sekce__napoveda">${napoveda}</p>
      </div>
      ${vnitrek}
    </section>`;
}

function souhlas(nazev, kdy, text) {
  if (!kdy) {
    return `<p class="sekce__udaj"><span class="stitek stitek--chyba">chybí</span> ${esc(nazev)}</p>`;
  }
  return `<div class="polozka">
      <div class="sekce__udaj">
        <span class="stitek stitek--hotovo">ano</span> ${esc(nazev)}
        <span class="text-faint">· ${esc(datumCas(kdy))}</span>
      </div>
      ${text ? `<div class="sekce__napoveda">„${esc(text)}"</div>` : ''}
    </div>`;
}

function vykresliUcastniky(koren, muze) {
  const obal = koren.querySelector('[data-ucastnici]');
  if (!obal) return;

  obal.innerHTML = prace.ucastnici.map((u, i) => `
      <div class="polozka${u.varovani.length ? ' polozka--pozor' : ''}">
        ${u.varovani.length
          ? `<p class="fotka__chybi-popis">Mimo limit: ${esc(u.varovani.join('; '))}</p>` : ''}
        <input class="pole" type="text" data-u="${i}" data-klic="jmeno" value="${esc(u.jmeno)}"
               placeholder="Jméno a příjmení" aria-label="Jméno účastníka ${i + 1}" ${muze ? '' : 'readonly'} />
        <div class="mrizka mrizka--2">
          <input class="pole" type="date" data-u="${i}" data-klic="datum_narozeni"
                 value="${esc(u.datum_narozeni ? String(u.datum_narozeni).slice(0, 10) : '')}"
                 aria-label="Datum narození účastníka ${i + 1}" ${muze ? '' : 'readonly'} />
          <input class="pole" type="number" data-u="${i}" data-klic="vaha_kg" min="20" max="300"
                 value="${esc(u.vaha_kg ?? '')}" placeholder="kg"
                 aria-label="Hmotnost účastníka ${i + 1}" ${muze ? '' : 'readonly'} />
        </div>
        <div class="sekce__napoveda">
          ${u.vek != null ? `${u.vek} let ke dni termínu` : 'věk neznámý'}
          ${u.telefon ? ` · ${esc(u.telefon)}` : ''}
        </div>
        <label class="prepinac">
          <input type="checkbox" data-u="${i}" data-klic="doklada_prohlidku"
                 ${u.doklada_prohlidku ? 'checked' : ''} ${muze ? '' : 'disabled'}
                 style="width:22px;height:22px;accent-color:var(--accent)" />
          <span class="prepinac__text">Doloží lékařskou prohlídku</span>
        </label>
        <label class="prepinac">
          <input type="checkbox" data-u="${i}" data-klic="zajisti_souhlas_zastupce"
                 ${u.zajisti_souhlas_zastupce ? 'checked' : ''} ${muze ? '' : 'disabled'}
                 style="width:22px;height:22px;accent-color:var(--accent)" />
          <span class="prepinac__text">Zajistí souhlas zákonného zástupce</span>
        </label>
      </div>`).join('');

  obal.querySelectorAll('[data-u]').forEach((prvek) =>
    prvek.addEventListener('change', () => {
      const u = prace.ucastnici[Number(prvek.dataset.u)];
      const klic = prvek.dataset.klic;
      u[klic] = prvek.type === 'checkbox' ? prvek.checked : prvek.value;
    })
  );
}

// ------------------------------------------------------------------ akce

async function uloz(koren, p) {
  const form = koren.querySelector('[data-karta]');
  const hodnota = (klic) => form.querySelector(`[name="${klic}"]`)?.value;

  try {
    await api.patch(`/rezervace/${p.id}`, {
      interni_poznamka: hodnota('interni_poznamka') ?? '',
      uhrazeno_kc: hodnota('uhrazeno_kc') === '' ? 0 : Number(hodnota('uhrazeno_kc')),
      splatnost: hodnota('splatnost') ?? '',
    });
    await api.put(`/rezervace/${p.id}/ucastnici`, {
      ucastnici: prace.ucastnici.map((u) => ({
        jmeno: u.jmeno,
        datum_narozeni: u.datum_narozeni ? String(u.datum_narozeni).slice(0, 10) : '',
        vaha_kg: u.vaha_kg === '' || u.vaha_kg == null ? null : Number(u.vaha_kg),
        telefon: u.telefon ?? '',
        email: u.email ?? '',
        doklada_prohlidku: Boolean(u.doklada_prohlidku),
        zajisti_souhlas_zastupce: Boolean(u.zajisti_souhlas_zastupce),
        dorazil: Boolean(u.dorazil),
        poznamka: u.poznamka ?? '',
      })),
    });
    hlaska('Přihláška je uložená.');
    karta(koren, p.id);
  } catch (chyba) {
    if (!ukazChybyPoli(form, chyba.detaily)) hlaska(chyba.message, 'chyba');
  }
}

// Změna stavu se vždycky ptá, jestli poslat e-mail. Výchozí je "ano"
// u potvrzení a zaplacení, protože na to zákazník čeká.
async function zmenStav(koren, p, novyStav) {
  const popis = STAVY[novyStav]?.popis ?? novyStav;
  const posle = novyStav === 'potvrzena' || novyStav === 'zaplacena';

  const vysledek = await formularModal({
    nadpis: `Přepnout na „${popis}"`,
    text: posle
      ? 'Zákazníkovi můžeme dát vědět e-mailem. Text se dá upravit v Nastavení → E-maily.'
      : 'Stav se změní. E-mail k tomuhle stavu posílat nemusíme.',
    polia: [{
      klic: 'poslat_email', popisek: 'Poslat zákazníkovi e-mail', typ: 'prepinac',
      hodnota: posle,
    }],
    potvrzeni: 'Přepnout',
  });
  if (!vysledek) return;

  try {
    const odpoved = await api.post(`/rezervace/${p.id}/stav`, {
      stav: novyStav,
      poslat_email: vysledek.poslat_email,
    });
    hlaska(
      odpoved.email_odeslan
        ? odpoved.email_do_schranky
          ? `Stav je „${popis}". E-mail je v testovací schránce.`
          : `Stav je „${popis}" a e-mail odešel.`
        : `Stav je „${popis}".`
    );
    karta(koren, p.id);
  } catch (chyba) {
    hlaska(chyba.message, 'chyba');
  }
}

async function storno(koren, p) {
  const vysledek = await formularModal({
    nadpis: 'Storno přihlášky',
    text: 'Místo na termínu se hned uvolní. Důvod si přečte i zákazník, pokud pošleme e-mail.',
    polia: [
      { klic: 'duvod', popisek: 'Důvod storna', typ: 'textarea',
        napoveda: 'Napiš to tak, jak bys to řekla do telefonu.' },
      { klic: 'poslat_email', popisek: 'Poslat zákazníkovi e-mail', typ: 'prepinac', hodnota: true },
    ],
    potvrzeni: 'Stornovat',
  });
  if (!vysledek) return;

  try {
    const odpoved = await api.post(`/rezervace/${p.id}/storno`, {
      duvod: vysledek.duvod,
      poslat_email: vysledek.poslat_email,
    });
    hlaska(odpoved.zprava);
    karta(koren, p.id);
  } catch (chyba) {
    hlaska(chyba.message, 'chyba');
  }
}

async function anonymizuj(koren, p) {
  if (!(await potvrd({
    nadpis: 'Anonymizovat zákazníka?',
    text:
      'Smažeme jméno, e-mail, telefon, adresu i jména účastníků. Přihlášky a doklady ' +
      'zůstanou kvůli účetnictví, ale nepůjde z nich poznat, kdo to byl. ' +
      '<strong>Nedá se to vrátit.</strong>',
    potvrzeni: 'Anonymizovat',
  }))) return;

  try {
    const odpoved = await api.post(`/zakaznici/${p.zakaznik_id}/anonymizovat`);
    hlaska(odpoved.zprava);
    karta(koren, p.id);
  } catch (chyba) {
    hlaska(chyba.message, 'chyba');
  }
}

// ------------------------------------------------- přihláška po telefonu

// Vlastní modál, ne formularModal: účastníků je proměnlivý počet a termín
// se vybírá ze seznamu seskupeného po kurzech. Zavolá si ho i karta termínu,
// proto je exportovaný a bere si termín jako předvyplněný.
export async function novaPrihlaska({ terminId = null, poHotovu = null } = {}) {
  let terminy;
  try {
    const data = await api.get('/terminy' + dotaz({ typ: 'kurz', na_strane: 200 }));
    terminy = data.data.filter(
      (t) => t.stav === 'otevreno' && (!t.kapacita_mist || t.obsazeno_mist < t.kapacita_mist)
    );
  } catch (chyba) {
    hlaska(chyba.message, 'chyba');
    return;
  }

  if (!terminy.length) {
    await potvrd({
      nadpis: 'Není kam přihlásit',
      text: 'Žádný kurz nemá volný termín. Vypiš nejdřív termín v Termínech.',
      potvrzeni: 'Rozumím', jenPotvrzeni: true, nebezpecne: false,
    });
    return;
  }

  // Termíny seskupené po kurzech, ať se v nich dá na telefonu vyznat.
  const podleKurzu = new Map();
  for (const t of terminy) {
    const seznamTerminu = podleKurzu.get(t.produkt_nazev) ?? [];
    seznamTerminu.push(t);
    podleKurzu.set(t.produkt_nazev, seznamTerminu);
  }

  const nadoba = document.getElementById('modal');
  nadoba.innerHTML = `
    <div class="modal-pozadi" data-zavrit>
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-nadpis">
        <h2 class="modal__nadpis" id="modal-nadpis">Nová přihláška</h2>
        <p class="modal__text">
          Pro přihlášky po telefonu. Souhlasy se tudy nezaznamenávají —
          papír se podepisuje na místě a soupiska na to upozorní.
        </p>

        <div class="pole-skupina" data-pole="termin_id">
          <label class="pole-skupina__popisek" for="pole-termin">Termín</label>
          <select class="pole" id="pole-termin" name="termin_id">
            ${[...podleKurzu.entries()].map(([kurz, seznamTerminu]) => `
              <optgroup label="${esc(kurz)}">
                ${seznamTerminu.map((t) => `
                  <option value="${t.id}"${String(t.id) === String(terminId) ? ' selected' : ''}>
                    ${esc(datum(t.datum))}${t.misto_nazev ? ' · ' + esc(t.misto_nazev) : ''}${
                      t.kapacita_mist ? ` — volno ${t.kapacita_mist - t.obsazeno_mist}` : ''
                    }
                  </option>`).join('')}
              </optgroup>`).join('')}
          </select>
          <div class="pole-skupina__chyba" hidden></div>
        </div>

        <h3 class="pole-popisek">Kdo volá</h3>
        ${pole({ klic: 'jmeno', popisek: 'Jméno a příjmení', povinne: true })}
        ${pole({ klic: 'email', popisek: 'E-mail', typ: 'email', povinne: true,
                 napoveda: 'Na tuhle adresu může odejít potvrzení.' })}
        ${pole({ klic: 'telefon', popisek: 'Telefon', typ: 'telefon' })}

        <h3 class="pole-popisek">Účastníci</h3>
        <div class="polozky" data-ucastnici></div>
        <button type="button" class="btn btn--obrys btn--blok" data-pridat
                style="margin-top:10px">+ Další účastník</button>

        ${pole({ klic: 'zprava', popisek: 'Poznámka', typ: 'textarea',
                 napoveda: 'Co padlo po telefonu. Uvidíte to na kartě přihlášky.' })}
        ${pole({ klic: 'poslat_email', popisek: 'Poslat potvrzení e-mailem', typ: 'prepinac',
                 hodnota: false,
                 napoveda: 'Nechte vypnuté, pokud jste se domluvili po telefonu.' })}

        <div class="modal__akce">
          <button type="button" class="btn btn--obrys" data-ne>Zrušit</button>
          <button type="submit" class="btn btn--hlavni">Založit přihlášku</button>
        </div>
      </form>
    </div>`;

  const form = nadoba.querySelector('form');
  const obalUcastniku = form.querySelector('[data-ucastnici]');
  let ucastnici = [{ jmeno: '', datum_narozeni: '', vaha_kg: '' }];

  const zavri = () => {
    nadoba.innerHTML = '';
    document.removeEventListener('keydown', naEsc);
  };
  const naEsc = (e) => { if (e.key === 'Escape') zavri(); };
  document.addEventListener('keydown', naEsc);

  function vykresli() {
    obalUcastniku.innerHTML = ucastnici.map((u, i) => `
        <div class="polozka">
          <input class="pole" type="text" data-u="${i}" data-klic="jmeno" value="${esc(u.jmeno)}"
                 placeholder="Jméno a příjmení" aria-label="Jméno účastníka ${i + 1}" />
          <div class="mrizka mrizka--2">
            <input class="pole" type="date" data-u="${i}" data-klic="datum_narozeni"
                   value="${esc(u.datum_narozeni)}" aria-label="Datum narození účastníka ${i + 1}" />
            <input class="pole" type="number" data-u="${i}" data-klic="vaha_kg" min="20" max="300"
                   value="${esc(u.vaha_kg)}" placeholder="kg"
                   aria-label="Hmotnost účastníka ${i + 1}" />
          </div>
          ${ucastnici.length > 1
            ? `<div class="polozka__akce">
                 <button type="button" class="btn btn--obrys btn--maly" data-pryc="${i}"
                         aria-label="Odebrat účastníka">✕</button>
               </div>`
            : ''}
        </div>`).join('');

    obalUcastniku.querySelectorAll('[data-u]').forEach((prvek) =>
      prvek.addEventListener('input', () => {
        ucastnici[Number(prvek.dataset.u)][prvek.dataset.klic] = prvek.value;
      })
    );
    obalUcastniku.querySelectorAll('[data-pryc]').forEach((b) =>
      b.addEventListener('click', () => {
        ucastnici.splice(Number(b.dataset.pryc), 1);
        vykresli();
      })
    );
  }
  vykresli();

  form.querySelector('[data-pridat]').addEventListener('click', () => {
    if (ucastnici.length >= 10) {
      hlaska('Víc než deset lidí naráz raději rozděl do dvou přihlášek.', 'chyba');
      return;
    }
    ucastnici.push({ jmeno: '', datum_narozeni: '', vaha_kg: '' });
    vykresli();
  });

  form.querySelector('[data-ne]').addEventListener('click', zavri);
  nadoba.querySelector('[data-zavrit]').addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-zavrit')) zavri();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const hodnota = (klic) => form.querySelector(`[name="${klic}"]`).value.trim();

    // Jméno prvního účastníka se často shoduje s volajícím - když zůstane
    // prázdné, doplní se, ať provoz nemusí psát totéž dvakrát.
    if (!ucastnici[0].jmeno.trim()) ucastnici[0].jmeno = hodnota('jmeno');

    try {
      const odpoved = await api.post('/rezervace', {
        termin_id: hodnota('termin_id'),
        jmeno: hodnota('jmeno'),
        email: hodnota('email'),
        telefon: hodnota('telefon'),
        ucastnici: ucastnici.map((u) => ({
          jmeno: u.jmeno,
          datum_narozeni: u.datum_narozeni || '',
          vaha_kg: u.vaha_kg === '' ? null : Number(u.vaha_kg),
        })),
        zprava: hodnota('zprava'),
        poslat_email: form.querySelector('[name="poslat_email"]').checked,
      });

      zavri();
      hlaska(odpoved.zprava ?? 'Přihláška je zapsaná.');
      if (odpoved.varovani?.length) {
        hlaska(`Pozor: ${odpoved.varovani.join('; ')}`, 'chyba');
      }
      if (poHotovu) poHotovu();
      else jdiNa('prihlasky/' + odpoved.id);
    } catch (chyba) {
      if (!ukazChybyPoli(form, chyba.detaily)) hlaska(chyba.message, 'chyba');
    }
  });

  form.querySelector('[name="jmeno"]')?.focus();
}
