// Poptávky: seznam s filtry a fulltextem, detail s odpovědí e-mailem.

import { api, dotaz } from '../api.js';
import {
  esc, pred, datumCas, prazdno, strankovani, hlaska, potvrd, pole, ukazChybyPoli,
  vysledekEmailu,
} from '../ui.js';
import { jdiNa, stav as globalniStav, nactiPocty } from '../admin.js';
import { rezimEmailu, odesilaSe } from '../rezim-emailu.js';

const STAVY = [
  { klic: '', popis: 'Vše' },
  { klic: 'nova', popis: 'Nové' },
  { klic: 'vyrizuje_se', popis: 'Rozpracované' },
  { klic: 'vyrizeno', popis: 'Vyřízené' },
  { klic: 'spam', popis: 'Spam' },
];

const POPIS_STAVU = {
  nova: { text: 'nová', trida: 'stitek--nova' },
  vyrizuje_se: { text: 'vyřizuje se', trida: 'stitek--prubeh' },
  vyrizeno: { text: 'vyřízeno', trida: 'stitek--hotovo' },
  spam: { text: 'spam', trida: 'stitek--spam' },
};

const filtr = { stav: '', q: '', strana: 1, smazane: '' };

export async function vykresli(koren, { parametr }) {
  if (parametr) return detail(koren, parametr);
  return seznam(koren);
}

// ----------------------------------------------------------------- seznam

async function seznam(koren) {
  const data = await api.get('/poptavky' + dotaz(filtr));

  koren.innerHTML = `
    <h1 class="nadpis" style="margin-bottom:14px">Poptávky</h1>

    <div class="zalozky" role="tablist">
      ${STAVY.map((s) => {
        const pocet = s.klic ? (data.pocty[s.klic] ?? 0) : null;
        const aktivni = !filtr.smazane && filtr.stav === s.klic;
        return `<button type="button" role="tab"
          class="zalozka${aktivni ? ' zalozka--aktivni' : ''}"
          data-stav="${s.klic}" aria-selected="${aktivni}">
          ${esc(s.popis)}${pocet ? ` <span class="zalozka__pocet">${pocet}</span>` : ''}
        </button>`;
      }).join('')}
      <button type="button" role="tab"
        class="zalozka${filtr.smazane ? ' zalozka--aktivni' : ''}"
        data-smazane="1" aria-selected="${Boolean(filtr.smazane)}">Smazané</button>
    </div>

    <div class="hledani">
      <input class="pole" type="search" id="hledat" placeholder="Jméno, e-mail, text zprávy…"
             value="${esc(filtr.q)}" aria-label="Hledat v poptávkách" />
      <button type="button" class="btn btn--obrys" data-hledat>Hledat</button>
    </div>

    ${data.data.length === 0
      ? prazdno(
          filtr.q ? 'Nic nenalezeno' : filtr.smazane ? 'Žádné smazané poptávky' : 'Žádné poptávky',
          filtr.q
            ? 'Zkus hledat jinak.'
            : filtr.smazane
              ? 'Smazané poptávky se sem ukládají a dají se obnovit.'
              : 'Až někdo napíše z webu, objeví se to tady.'
        )
      : `
      <div class="seznam">${data.data.map(radek).join('')}</div>

      <table class="tabulka">
        <thead><tr>
          <th>Kdo</th><th>Kontakt</th><th>Zpráva</th><th>Stav</th><th>Přišlo</th>
        </tr></thead>
        <tbody>${data.data.map(radekTabulky).join('')}</tbody>
      </table>`}

    ${strankovani(data)}`;

  koren.querySelectorAll('[data-stav]').forEach((b) =>
    b.addEventListener('click', () => {
      filtr.stav = b.dataset.stav;
      filtr.smazane = '';
      filtr.strana = 1;
      seznam(koren);
    })
  );

  koren.querySelector('[data-smazane]')?.addEventListener('click', () => {
    filtr.smazane = '1';
    filtr.stav = '';
    filtr.strana = 1;
    seznam(koren);
  });

  const hledat = () => {
    filtr.q = koren.querySelector('#hledat').value.trim();
    filtr.strana = 1;
    seznam(koren);
  };
  koren.querySelector('[data-hledat]').addEventListener('click', hledat);
  koren.querySelector('#hledat').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hledat();
  });

  koren.querySelectorAll('[data-id]').forEach((prvek) =>
    prvek.addEventListener('click', () => jdiNa(`poptavky/${prvek.dataset.id}`))
  );
  koren.querySelectorAll('[data-strana]').forEach((b) =>
    b.addEventListener('click', () => {
      filtr.strana = Number(b.dataset.strana);
      seznam(koren);
    })
  );
}

function stitek(stav) {
  const s = POPIS_STAVU[stav] ?? { text: stav, trida: '' };
  return `<span class="stitek ${s.trida}">${esc(s.text)}</span>`;
}

function radek(p) {
  return `<button type="button" class="radek" data-id="${p.id}">
      <div class="radek__hlava">
        <span class="radek__nazev">${esc(p.jmeno)}</span>
        ${stitek(p.stav)}
      </div>
      <div class="radek__meta">
        ${esc(p.email)}${p.telefon ? ` · ${esc(p.telefon)}` : ''} · ${esc(pred(p.created_at))}
      </div>
      ${p.zprava ? `<div class="radek__ukazka">${esc(p.zprava)}</div>` : ''}
    </button>`;
}

function radekTabulky(p) {
  return `<tr data-id="${p.id}">
      <td><strong>${esc(p.jmeno)}</strong></td>
      <td class="tesne">${esc(p.email)}${p.telefon ? `<br /><span class="text-faint">${esc(p.telefon)}</span>` : ''}</td>
      <td>${esc((p.zprava ?? '').slice(0, 120))}${(p.zprava ?? '').length > 120 ? '…' : ''}</td>
      <td class="tesne">${stitek(p.stav)}</td>
      <td class="tesne text-faint">${esc(pred(p.created_at))}</td>
    </tr>`;
}

// ------------------------------------------------------------------ detail

async function detail(koren, id) {
  const p = await api.get(`/poptavky/${encodeURIComponent(id)}`);
  const muzeMenit = globalniStav.ja.prava.poptavky === 'menit';

  koren.innerHTML = `
    <div style="margin-bottom:14px">
      <a href="/admin/poptavky" data-odkaz class="text-faint">← Poptávky</a>
    </div>

    <div class="panel__hlava" style="margin-bottom:14px">
      <h1 class="nadpis">${esc(p.jmeno)}</h1>
      ${stitek(p.stav)}
    </div>

    <div class="mrizka mrizka--detail">
      <div>
        <section class="panel">
          <h2 class="nadpis-2" style="margin-bottom:10px">Zpráva</h2>
          <p style="white-space:pre-wrap;color:var(--text-2)">${esc(p.zprava ?? '(bez textu)')}</p>
        </section>

        ${p.odpoved
          ? `<section class="panel">
              <div class="panel__hlava">
                <h2 class="nadpis-2">Naše odpověď</h2>
                <span class="text-faint">${esc(datumCas(p.odpovezeno_at))}${p.odpovedel_jmeno ? ` · ${esc(p.odpovedel_jmeno)}` : ''}</span>
              </div>
              <p style="white-space:pre-wrap;color:var(--text-2)">${esc(p.odpoved)}</p>
            </section>`
          : ''}

        ${muzeMenit
          ? `<section class="panel">
              <h2 class="nadpis-2" style="margin-bottom:10px">
                ${p.odpoved ? 'Odpovědět znovu' : 'Odpovědět e-mailem'}
              </h2>
              ${varovaniOdesilani()}
              <form id="form-odpoved" novalidate>
                ${pole({
                  klic: 'odpoved',
                  popisek: 'Text odpovědi',
                  typ: 'textarea',
                  // Nápověda nesmí slibovat odeslání, když se neodesílá.
                  napoveda: odesilaniVypnute()
                    ? 'Uloží se k poptávce. Odeslat ji zákazníkovi můžete tlačítky níž.'
                    : 'Pošle se e-mailem na ' + p.email + '. Původní zpráva se přiloží pod odpověď.',
                })}
                <label class="prepinac" style="margin-bottom:14px">
                  <input type="checkbox" name="oznacit" checked
                         style="width:22px;height:22px;accent-color:var(--accent)" />
                  <span class="prepinac__text">Označit poptávku jako vyřízenou</span>
                </label>
                <button type="submit" class="btn btn--hlavni">
                  ${popisekTlacitka()}
                </button>
                ${odesilaniVypnute()
                  ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line-soft)">
                       <p class="text-faint" style="margin-bottom:10px">
                         Uložením se odpověď zapíše do historie poptávky. Zákazníkovi ji
                         pošlete odsud ze své pošty:
                       </p>
                       <div data-nastroje></div>
                     </div>`
                  : ''}
              </form>
            </section>`
          : ''}

        ${p.emaily.length
          ? `<section class="panel">
              <h2 class="nadpis-2" style="margin-bottom:10px">Odeslané e-maily</h2>
              <div class="udaje">
                ${p.emaily.map(radekEmailu).join('')}
              </div>
            </section>`
          : ''}
      </div>

      <div>
        <section class="panel">
          <h2 class="nadpis-2" style="margin-bottom:10px">Kontakt</h2>
          <div class="udaje">
            <div class="udaj"><span class="udaj__popisek">E-mail</span>
              <span class="udaj__hodnota"><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></span></div>
            ${p.telefon
              ? `<div class="udaj"><span class="udaj__popisek">Telefon</span>
                 <span class="udaj__hodnota"><a href="tel:${esc(p.telefon)}">${esc(p.telefon)}</a></span></div>`
              : ''}
            <div class="udaj"><span class="udaj__popisek">Přišlo</span>
              <span class="udaj__hodnota">${esc(datumCas(p.created_at))}</span></div>
            ${p.zdroj ? `<div class="udaj"><span class="udaj__popisek">Odkud</span>
              <span class="udaj__hodnota">${esc(p.zdroj)}</span></div>` : ''}
          </div>
        </section>

        ${p.smazano_at && muzeMenit
          ? `<section class="panel" style="border-left:3px solid var(--varovani)">
              <h2 class="nadpis-2" style="margin-bottom:8px">Smazaná poptávka</h2>
              <p class="text-faint" style="margin-bottom:12px">
                Smazáno ${esc(datumCas(p.smazano_at))}. V seznamu je jen v záložce Smazané.
              </p>
              <button type="button" class="btn btn--hlavni btn--blok" data-obnovit>Obnovit poptávku</button>
            </section>`
          : ''}

        ${muzeMenit && !p.smazano_at
          ? `<section class="panel">
              <h2 class="nadpis-2" style="margin-bottom:10px">Stav a poznámka</h2>
              ${pole({
                klic: 'stav',
                popisek: 'Stav',
                typ: 'vyber',
                hodnota: p.stav,
                moznosti: STAVY.filter((s) => s.klic).map((s) => ({ hodnota: s.klic, popis: s.popis })),
              })}
              ${pole({
                klic: 'interni_poznamka',
                popisek: 'Interní poznámka',
                typ: 'textarea',
                hodnota: p.interni_poznamka ?? '',
                napoveda: 'Vidí jen obsluha, zákazníkovi se neposílá.',
              })}
              <button type="button" class="btn btn--obrys btn--blok" data-ulozit>Uložit</button>
              <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line-soft)">
                <button type="button" class="btn btn--nebezpecny btn--blok" data-smazat>
                  Smazat poptávku
                </button>
                <p class="text-faint" style="margin-top:8px">
                  Smazaná poptávka zmizí ze seznamu, ale zůstane uložená a dá se obnovit.
                </p>
              </div>
            </section>`
          : ''}
      </div>
    </div>`;

  if (!muzeMenit) return;

  koren.querySelector('#form-odpoved')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const odpoved = form.querySelector('[name="odpoved"]').value.trim();
    const oznacit = form.querySelector('[name="oznacit"]').checked;

    const tlacitko = form.querySelector('button[type="submit"]');
    tlacitko.disabled = true;
    tlacitko.textContent = odesilaniVypnute() ? 'Ukládám…' : 'Odesílám…';
    try {
      const vysledek = await api.post(`/poptavky/${p.id}/odpovedet`, {
        odpoved,
        oznacit_vyrizene: oznacit,
      });
      await vysledekEmailu(vysledek);
      await nactiPocty();
      detail(koren, id);
    } catch (err) {
      if (!ukazChybyPoli(form, err.detaily)) hlaska(err.message, 'chyba');
    } finally {
      // Vrátit tlačítko do výchozího stavu po KAŽDÉM výsledku. Dřív se to
      // dělalo jen ve větvi s chybou, takže po zavření okna zůstalo viset
      // na „Odesílám…“, kdykoli se obrazovka nepřekreslila.
      // Když se detail mezitím překreslil, tlačítko už v DOM není.
      if (tlacitko.isConnected) {
        tlacitko.disabled = false;
        tlacitko.textContent = popisekTlacitka();
      }
    }
  });

  // mailto a „Zkopírovat text“ se plní z toho, co je zrovna napsané
  // v poli — ne z prázdné šablony při vykreslení.
  const nastroje = koren.querySelector('[data-nastroje]');
  if (nastroje) {
    const polePoodpovedi = koren.querySelector('#form-odpoved [name="odpoved"]');
    const prekresli = () => {
      nastroje.innerHTML = nastrojeMimoOdesilani(p, polePoodpovedi.value.trim());
      nastroje.querySelector('[data-kopirovat]').addEventListener('click', async () => {
        const text = polePoodpovedi.value.trim();
        if (!text) return hlaska('Napište nejdřív text odpovědi.', 'varovani');
        try {
          await navigator.clipboard.writeText(text);
          hlaska('Text je ve schránce.');
        } catch {
          // Schránka nemusí být povolená (starší prohlížeč, http). Označit
          // text je pořád lepší než nic - zkopíruje se pak Ctrl+C.
          polePoodpovedi.focus();
          polePoodpovedi.select();
          hlaska('Zkopírujte text klávesami Ctrl+C.', 'varovani');
        }
      });
    };
    prekresli();
    polePoodpovedi.addEventListener('input', prekresli);
  }

  koren.querySelector('[data-ulozit]')?.addEventListener('click', async (e) => {
    const panel = e.currentTarget.closest('.panel');
    try {
      await api.patch(`/poptavky/${p.id}`, {
        stav: panel.querySelector('[name="stav"]').value,
        interni_poznamka: panel.querySelector('[name="interni_poznamka"]').value,
      });
      hlaska('Uloženo.', 'ok');
      await nactiPocty();
      detail(koren, id);
    } catch (err) {
      hlaska(err.message, 'chyba');
    }
  });

  koren.querySelector('[data-obnovit]')?.addEventListener('click', async () => {
    try {
      await api.post(`/poptavky/${p.id}/obnovit`);
      hlaska('Poptávka je zpátky v seznamu.', 'ok');
      await nactiPocty();
      detail(koren, id);
    } catch (err) {
      hlaska(err.message, 'chyba');
    }
  });

  koren.querySelector('[data-smazat]')?.addEventListener('click', async () => {
    const ano = await potvrd({
      nadpis: 'Smazat poptávku?',
      text: `Poptávka od <strong>${esc(p.jmeno)}</strong> zmizí ze seznamu.
             Zůstane uložená a dá se obnovit ve filtru smazaných.`,
      potvrzeni: 'Smazat',
    });
    if (!ano) return;
    try {
      await api.del(`/poptavky/${p.id}`);
      hlaska('Poptávka je smazaná.', 'ok');
      await nactiPocty();
      jdiNa('poptavky');
    } catch (err) {
      hlaska(err.message, 'chyba');
    }
  });
}

const STAV_EMAILU = {
  odeslano: 'odesláno',
  doruceno: 'doručeno',
  otevreno: 'otevřeno',
  kliknuto: 'kliknuto',
  bounce: 'nedoručeno',
  stiznost: 'stížnost',
  chyba: 'chyba',
  ve_fronte: 've frontě',
};

function radekEmailu(e) {
  const prepsano = e.prijemce_skutecny && e.prijemce_skutecny !== e.prijemce;
  return `<div class="udaj">
      <span class="udaj__popisek">${esc(datumCas(e.created_at))}</span>
      <span class="udaj__hodnota">
        ${esc(e.predmet)}<br />
        <span class="${e.stav === 'chyba' ? 'stitek stitek--chyba' : 'text-faint'}">
          ${esc(STAV_EMAILU[e.stav] ?? e.stav)}
        </span>
        ${prepsano ? `<span class="text-faint"> · v testu přesměrováno na ${esc(e.prijemce_skutecny)}</span>` : ''}
        ${e.chyba ? `<div class="text-faint">${esc(e.chyba)}</div>` : ''}
      </span>
    </div>`;
}

// Režim odesílání hlásí server v /ja. Vypnuté odesílání není chyba, ale
// obsluha o něm musí vědět dřív, než odpověď napíše - ne až potom.
// Texty jsou v rezim-emailu.js, ať se nerozejdou mezi obrazovkami.
function odesilaniVypnute() {
  return !odesilaSe(globalniStav.ja?.email_rezim);
}

function popisekTlacitka() {
  return rezimEmailu(globalniStav.ja?.email_rezim).tlacitko;
}

function varovaniOdesilani() {
  const { varovani } = rezimEmailu(globalniStav.ja?.email_rezim);
  if (!varovani) return '';

  return `<p class="panel--tesny" style="margin-bottom:12px;border-left:3px solid var(--varovani);
            background:var(--panel-2);padding:10px 12px;color:var(--muted);font-size:14px">
            ${esc(varovani)}
          </p>`;
}

// Když e-mail stejně neodejde, je lepší dát obsluze do ruky nástroj než
// tlačítko, které "uloží" a mlčí. mailto otevře její vlastní poštu
// s předvyplněným příjemcem, předmětem i textem - zákazník tak dostane
// odpověď hned a z adresy, na kterou může odpovědět.
function nastrojeMimoOdesilani(p, text) {
  const predmet = 'Odpověď na vaši zprávu — LSD';
  // Adresa se v mailto nekóduje - zakódované @ některým poštovním klientům
  // vadí. Předmět a tělo zakódované být musí, jsou to parametry v dotazu.
  const odkaz =
    `mailto:${p.email}` +
    `?subject=${encodeURIComponent(predmet)}` +
    `&body=${encodeURIComponent(text)}`;

  return `
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn btn--hlavni" href="${esc(odkaz)}" data-mailto>Odpovědět ze svého e-mailu</a>
      <button type="button" class="btn btn--obrys" data-kopirovat>Zkopírovat text</button>
    </div>`;
}
