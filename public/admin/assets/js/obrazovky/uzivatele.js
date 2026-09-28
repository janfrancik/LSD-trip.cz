// Uživatelé administrace a jejich role. Heslo nenastavuje správce - nový člověk
// dostane e-mailem odkaz a heslo si zvolí sám.

import { api, dotaz } from '../api.js';
import {
  esc, pred, prazdno, hlaska, potvrd, formularModal, okamzik, vysledekEmailu,
} from '../ui.js';
import { stav as globalniStav } from '../admin.js';

const ROLE = [
  { hodnota: 'admin', popis: 'Admin — vidí a mění všechno' },
  { hodnota: 'provoz', popis: 'Provoz — rezervace, termíny, obsah' },
  { hodnota: 'instruktor', popis: 'Instruktor — jen soupiska termínu' },
  { hodnota: 'ucetni', popis: 'Účetní — platby a faktury' },
  { hodnota: 'tester', popis: 'Tester — jen akceptační testování na testu' },
];

const POPIS_ROLE = Object.fromEntries(
  ROLE.map((r) => [r.hodnota, r.popis.split(' — ')[0]])
);

const filtr = { q: '', smazane: '' };

export async function vykresli(koren) {
  const muzeMenit = globalniStav.ja.prava.uzivatele === 'menit';
  const data = await api.get('/uzivatele' + dotaz(filtr));

  koren.innerHTML = `
    <div class="panel__hlava" style="margin-bottom:14px">
      <h1 class="nadpis">Uživatelé</h1>
      ${muzeMenit ? '<button type="button" class="btn btn--hlavni btn--maly" data-novy>Přidat člověka</button>' : ''}
    </div>

    <div class="zalozky">
      <button type="button" class="zalozka${filtr.smazane ? '' : ' zalozka--aktivni'}" data-smazane="">Aktivní</button>
      <button type="button" class="zalozka${filtr.smazane ? ' zalozka--aktivni' : ''}" data-smazane="1">Smazaní</button>
    </div>

    ${data.data.length === 0
      ? prazdno(filtr.smazane ? 'Nikdo smazaný' : 'Zatím nikdo')
      : `
      <div class="seznam">${data.data.map((u) => radek(u, muzeMenit)).join('')}</div>
      <table class="tabulka">
        <thead><tr>
          <th>Jméno</th><th>E-mail</th><th>Role</th><th>Stav</th><th>Naposledy</th><th></th>
        </tr></thead>
        <tbody>${data.data.map((u) => radekTabulky(u, muzeMenit)).join('')}</tbody>
      </table>`}

    <p class="text-faint" style="margin-top:18px">
      Nový člověk dostane e-mailem odkaz, kterým si nastaví heslo. Odkaz platí tři dny
      a jde použít jednou — heslo nikdy neposíláme e-mailem ani ho nikde nezapisujeme.
    </p>`;

  koren.querySelectorAll('[data-smazane]').forEach((b) =>
    b.addEventListener('click', () => {
      filtr.smazane = b.dataset.smazane;
      vykresli(koren);
    })
  );

  koren.querySelector('[data-novy]')?.addEventListener('click', () => novyUzivatel(koren));

  koren.querySelectorAll('[data-upravit]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      upravUzivatele(koren, JSON.parse(b.dataset.upravit));
    })
  );
  koren.querySelectorAll('[data-akce-heslo]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      posliOdkaz(koren, JSON.parse(b.dataset.akceHeslo));
    })
  );
  koren.querySelectorAll('[data-smazat]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      smazUzivatele(koren, JSON.parse(b.dataset.smazat));
    })
  );
  koren.querySelectorAll('[data-obnovit]').forEach((b) =>
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const odpoved = await api.post(`/uzivatele/${b.dataset.obnovit}/obnovit`);
        hlaska(odpoved.zprava, 'ok');
        vykresli(koren);
      } catch (err) {
        hlaska(err.message, 'chyba');
      }
    })
  );
}

function stavUzivatele(u) {
  if (u.smazano_at) return '<span class="stitek stitek--spam">smazaný</span>';
  if (!u.aktivni) return '<span class="stitek">deaktivovaný</span>';
  if (!u.ma_heslo) return '<span class="stitek stitek--prubeh">čeká na heslo</span>';
  if (u.zamceno_do && okamzik(u.zamceno_do) > new Date()) {
    return '<span class="stitek stitek--chyba">zamčený</span>';
  }
  return '<span class="stitek stitek--hotovo">aktivní</span>';
}

function data(u) {
  return esc(JSON.stringify({ id: u.id, jmeno: u.jmeno, email: u.email, role: u.role, aktivni: Boolean(u.aktivni), ma_heslo: Boolean(u.ma_heslo) }));
}

function akce(u, muzeMenit) {
  if (!muzeMenit) return '';
  if (u.smazano_at) {
    return `<button type="button" class="btn btn--obrys btn--maly" data-obnovit="${u.id}">Obnovit</button>`;
  }
  return `
    <button type="button" class="btn btn--obrys btn--maly" data-upravit="${data(u)}">Upravit</button>
    <button type="button" class="btn btn--obrys btn--maly" data-akce-heslo="${data(u)}">
      ${u.ma_heslo ? 'Reset hesla' : 'Poslat pozvánku'}
    </button>
    <button type="button" class="btn btn--nebezpecny btn--maly" data-smazat="${data(u)}">Smazat</button>`;
}

function radek(u, muzeMenit) {
  return `<div class="radek">
      <div class="radek__hlava">
        <span class="radek__nazev">${esc(u.jmeno)}</span>
        ${stavUzivatele(u)}
      </div>
      <div class="radek__meta">
        ${esc(u.email)} · ${esc(POPIS_ROLE[u.role] ?? u.role)}
        ${u.ma_totp ? ' · 2FA' : ''}
        ${u.posledni_prihlaseni_at ? ` · naposledy ${esc(pred(u.posledni_prihlaseni_at))}` : ' · zatím nepřihlášen'}
      </div>
      ${muzeMenit ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">${akce(u, muzeMenit)}</div>` : ''}
    </div>`;
}

function radekTabulky(u, muzeMenit) {
  return `<tr>
      <td><strong>${esc(u.jmeno)}</strong>${u.ma_totp ? ' <span class="text-faint">2FA</span>' : ''}</td>
      <td class="tesne">${esc(u.email)}</td>
      <td class="tesne">${esc(POPIS_ROLE[u.role] ?? u.role)}</td>
      <td class="tesne">${stavUzivatele(u)}</td>
      <td class="tesne text-faint">${u.posledni_prihlaseni_at ? esc(pred(u.posledni_prihlaseni_at)) : 'nikdy'}</td>
      <td class="tesne" style="display:flex;gap:6px;flex-wrap:wrap">${akce(u, muzeMenit)}</td>
    </tr>`;
}

// ------------------------------------------------------------------- akce

async function novyUzivatel(koren) {
  const vstup = await formularModal({
    nadpis: 'Přidat člověka do administrace',
    text: 'Pošleme mu e-mail s odkazem, kterým si nastaví heslo. Odkaz platí tři dny.',
    potvrzeni: 'Přidat a poslat pozvánku',
    polia: [
      { klic: 'jmeno', popisek: 'Jméno a příjmení', povinne: true },
      { klic: 'email', popisek: 'E-mail', typ: 'email', povinne: true },
      { klic: 'telefon', popisek: 'Telefon (nepovinné)', typ: 'telefon' },
      { klic: 'role', popisek: 'Role', typ: 'vyber', hodnota: 'provoz', moznosti: ROLE },
    ],
  });
  if (!vstup) return;

  try {
    const u = await api.post('/uzivatele', { ...vstup, poslat_pozvanku: true });

    if (u.pozvanka_odeslana) {
      hlaska(`${u.jmeno} je přidaný, pozvánka odešla na ${u.email}.`, 'ok');
    } else if (u.email_do_schranky) {
      // Na testu pozvánka nikam neodchází, ale dá se otevřít ve schránce
      // a odkaz v ní funguje.
      await vysledekEmailu({
        zprava: `${u.jmeno} je přidaný. Pozvánka je v testovací schránce.`,
        odeslano: false,
        email_do_schranky: true,
        email_id: u.email_id,
      });
    } else {
      // E-mail neodešel - místo nepravdivého "odesláno" ukážeme odkaz,
      // který může správce předat rovnou.
      await ukazOdkaz(u.jmeno, u.email, u.odkaz_na_heslo);
    }
    vykresli(koren);
  } catch (err) {
    hlaska(err.detaily ? Object.values(err.detaily)[0] : err.message, 'chyba');
  }
}

// Odkaz na nastavení hesla, když se e-mail neodeslal.
//
// Jméno se ukazuje na samostatném řádku, ne ve větě - čeština by ho chtěla
// skloňovat a to za lidi dělat nebudeme.
async function ukazOdkaz(jmeno, email, url) {
  if (!url) {
    hlaska('Účet je založený, ale pozvánka se neodeslala.', 'chyba');
    return;
  }
  await potvrd({
    nadpis: 'Pozvánka se neodeslala',
    text: `<span style="color:var(--text)">${esc(jmeno)}</span>
           <span class="text-faint"> · ${esc(email)}</span>
           <br /><br />
           Odesílání e-mailů zatím není nastavené, takže e-mail nikam nešel.
           Účet je ale založený — stačí předat tenhle odkaz osobně.
           Platí tři dny a jde použít jednou:
           <br /><br />
           <span class="mono" style="word-break:break-all;color:var(--muted)">${esc(url)}</span>`,
    potvrzeni: 'Rozumím',
    nebezpecne: false,
    jenPotvrzeni: true,
  });
}

async function upravUzivatele(koren, u) {
  const vstup = await formularModal({
    nadpis: `Upravit ${u.jmeno}`,
    potvrzeni: 'Uložit',
    polia: [
      { klic: 'jmeno', popisek: 'Jméno a příjmení', hodnota: u.jmeno, povinne: true },
      { klic: 'role', popisek: 'Role', typ: 'vyber', hodnota: u.role, moznosti: ROLE },
      { klic: 'aktivni', popisek: 'Má přístup do administrace', typ: 'prepinac', hodnota: u.aktivni },
    ],
  });
  if (!vstup) return;

  try {
    await api.patch(`/uzivatele/${u.id}`, vstup);
    hlaska('Uloženo.', 'ok');
    vykresli(koren);
  } catch (err) {
    hlaska(err.message, 'chyba');
  }
}

async function posliOdkaz(koren, u) {
  const ano = await potvrd({
    nadpis: u.ma_heslo ? 'Poslat odkaz na reset hesla?' : 'Poslat pozvánku?',
    text: `Na <strong>${esc(u.email)}</strong> pošleme odkaz pro nastavení hesla.
           ${u.ma_heslo ? 'Stávající heslo zůstane platné, dokud si nenastaví nové.' : ''}`,
    potvrzeni: 'Poslat',
    nebezpecne: false,
  });
  if (!ano) return;

  try {
    const odpoved = await api.post(`/uzivatele/${u.id}/reset-hesla`);
    if (odpoved.odeslano || odpoved.email_do_schranky) await vysledekEmailu(odpoved);
    else await ukazOdkaz(u.jmeno, u.email, odpoved.odkaz_na_heslo);
  } catch (err) {
    hlaska(err.message, 'chyba');
  }
}

async function smazUzivatele(koren, u) {
  const ano = await potvrd({
    nadpis: `Smazat ${esc(u.jmeno)}?`,
    text: `Přijde o přístup do administrace okamžitě, i kdyby byl právě přihlášený.
           Jeho záznamy v auditu zůstanou. Smazání se dá vzít zpět.`,
    potvrzeni: 'Smazat',
  });
  if (!ano) return;

  try {
    const odpoved = await api.del(`/uzivatele/${u.id}`);
    hlaska(odpoved.zprava, 'ok');
    vykresli(koren);
  } catch (err) {
    hlaska(err.message, 'chyba');
  }
}
