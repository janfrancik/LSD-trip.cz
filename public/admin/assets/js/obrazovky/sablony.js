// Šablony e-mailů: texty, které chodí zákazníkům.
//
// Šablona je prostý text s proměnnými {{takhle}} — žádné HTML. Obálku,
// barvy a odstavce doplní aplikace, takže vzhled e-mailu se nedá rozbít.
//
// Náhled renderuje server toutéž cestou jako skutečné odeslání, jen
// s ukázkovými daty. Kdyby si ho kreslil prohlížeč po svém, ukazoval by
// něco jiného, než co zákazníkovi doopravdy dojde.

import { api } from '../api.js';
import { esc, datumCas, prazdno, hlaska, ukazChybyPoli } from '../ui.js';
import { jdiNa, stav as globalniStav } from '../admin.js';

export async function vykresli(koren, { parametr }) {
  if (parametr) return editor(koren, parametr);
  return seznam(koren);
}

function smiMenit() {
  return globalniStav.ja?.prava?.emaily_sablony === 'menit';
}

// ---------------------------------------------------------------- seznam

async function seznam(koren) {
  const data = await api.get('/sablony');

  koren.innerHTML = `
    <button type="button" class="btn btn--obrys btn--maly" data-zpet
            style="margin-bottom:12px">← E-maily</button>

    <div class="panel__hlava" style="margin-bottom:14px">
      <h1 class="nadpis">Šablony e-mailů</h1>
    </div>

    <p class="sekce__napoveda" style="margin-bottom:18px">
      Texty, které odcházejí zákazníkům. Upravíš je tady, bez nasazování nové verze.
      Vypnutá šablona znamená, že se e-mail neposílá vůbec.
    </p>

    ${data.data.length === 0
      ? prazdno('Žádné šablony', 'Výchozí texty doplní migrace.')
      : `<div class="seznam">${data.data.map(radek).join('')}</div>`}`;

  koren.querySelector('[data-zpet]').addEventListener('click', () => jdiNa('emaily'));
  koren.querySelectorAll('[data-otevrit]').forEach((b) =>
    b.addEventListener('click', () => jdiNa('sablony/' + b.dataset.otevrit))
  );
}

function radek(s) {
  return `<div class="radek">
      <button type="button" data-otevrit="${s.id}"
              style="width:100%;background:none;border:0;padding:0;text-align:left;color:inherit;cursor:pointer">
        <span class="radek__hlava">
          <span class="radek__nazev">${esc(s.nazev)}</span>
          <span class="stitek ${s.aktivni ? 'stitek--hotovo' : 'stitek--spam'}">
            ${s.aktivni ? 'posílá se' : 'vypnutá'}
          </span>
        </span>
        <span class="radek__meta">${esc(s.predmet)}</span>
        <span class="radek__ukazka">${esc(s.popis ?? '')}</span>
      </button>
    </div>`;
}

// ---------------------------------------------------------------- editor

async function editor(koren, id) {
  let s;
  try {
    const data = await api.get('/sablony');
    s = data.data.find((x) => String(x.id) === String(id));
  } catch (chyba) {
    koren.innerHTML = prazdno('Šablonu se nepodařilo načíst', chyba.message);
    return;
  }
  if (!s) {
    koren.innerHTML = prazdno('Šablona nenalezena', 'Možná ji někdo mezitím odebral.');
    return;
  }

  const muze = smiMenit();

  koren.innerHTML = `
    <button type="button" class="btn btn--obrys btn--maly" data-zpet
            style="margin-bottom:12px">← Šablony</button>

    <form class="karta-termin" data-karta novalidate>
      <div class="karta-hlavicka">
        <div class="karta-hlavicka__text">
          <h1 class="karta-hlavicka__nazev">${esc(s.nazev)}</h1>
          <div class="karta-hlavicka__udaje">
            <span class="mono">${esc(s.klic)}</span>
            <span class="stitek ${s.aktivni ? 'stitek--hotovo' : 'stitek--spam'}">
              ${s.aktivni ? 'posílá se' : 'vypnutá'}
            </span>
            ${s.updated_at ? `<span>upraveno ${esc(datumCas(s.updated_at))}</span>` : ''}
            ${s.upravil_jmeno ? `<span>${esc(s.upravil_jmeno)}</span>` : ''}
          </div>
          ${s.popis ? `<p class="sekce__napoveda">${esc(s.popis)}</p>` : ''}
        </div>
        <div class="karta-hlavicka__akce">
          <button type="button" class="btn btn--obrys btn--maly" data-nahled>Náhled</button>
        </div>
      </div>

      <div class="karta-sloupce">
        <section class="sekce">
          <div class="sekce__hlava">
            <h2 class="sekce__nadpis">Text e-mailu</h2>
            <p class="sekce__napoveda">
              Prázdný řádek dělá odstavec. Žádné HTML se psát nemusí — obálku a barvy
              doplní aplikace.
            </p>
          </div>

          <div class="pole-skupina" data-pole="predmet">
            <label class="pole-skupina__popisek" for="pole-predmet">Předmět</label>
            <input class="pole" type="text" id="pole-predmet" name="predmet"
                   value="${esc(s.predmet)}" ${muze ? '' : 'readonly'} />
            <div class="pole-skupina__chyba" hidden></div>
          </div>

          <div class="pole-skupina" data-pole="telo">
            <label class="pole-skupina__popisek" for="pole-telo">Text</label>
            <textarea class="pole pole--vysoke" id="pole-telo" name="telo"
                      ${muze ? '' : 'readonly'}>${esc(s.telo)}</textarea>
            <div class="pole-skupina__chyba" hidden></div>
          </div>

          <div class="promenne">
            <div class="promenne__nadpis">Co se dá do textu vložit</div>
            <div class="promenne__seznam">
              ${(s.promenne ?? '').split(',').map((p) => p.trim()).filter(Boolean)
                .map((p) => `<button type="button" class="promenna" data-vlozit="{{${esc(p)}}}">{{${esc(p)}}}</button>`)
                .join('')}
            </div>
            <p class="sekce__napoveda">
              Klikni a proměnná se vloží do textu. Při odeslání se nahradí skutečnou hodnotou.
            </p>
          </div>

          ${muze ? `<label class="prepinac" style="margin-top:16px">
            <input type="checkbox" name="aktivni" ${s.aktivni ? 'checked' : ''}
                   style="width:22px;height:22px;accent-color:var(--accent)" />
            <span class="prepinac__text">Tenhle e-mail se posílá</span>
          </label>` : ''}
        </section>

        <section class="sekce">
          <div class="sekce__hlava">
            <h2 class="sekce__nadpis">Náhled</h2>
            <p class="sekce__napoveda">
              Ukázková data, skutečné vykreslení. Tak e-mail dojde zákazníkovi.
            </p>
          </div>
          <div data-nahled-obsah>
            <p class="sekce__udaj text-faint">Klikni na Náhled nahoře.</p>
          </div>
        </section>
      </div>
    </form>

    ${muze ? `<div class="ulozit-lista">
      <button type="button" class="btn btn--hlavni btn--blok" data-ulozit>Uložit šablonu</button>
    </div>` : ''}`;

  koren.querySelector('[data-zpet]').addEventListener('click', () => jdiNa('sablony'));

  koren.querySelectorAll('[data-vlozit]').forEach((b) =>
    b.addEventListener('click', () => vlozDoTextu(koren, b.dataset.vlozit))
  );
  koren.querySelector('[data-nahled]').addEventListener('click', () => nahled(koren, s));
  koren.querySelector('[data-ulozit]')?.addEventListener('click', () => uloz(koren, s));

  nahled(koren, s);
}

// Proměnná se vloží tam, kde je kurzor - ne na konec. Majitelka ji chce
// obvykle doprostřed věty.
function vlozDoTextu(koren, text) {
  const pole = koren.querySelector('#pole-telo');
  if (!pole || pole.readOnly) return;
  const zacatek = pole.selectionStart ?? pole.value.length;
  const konec = pole.selectionEnd ?? pole.value.length;
  pole.value = pole.value.slice(0, zacatek) + text + pole.value.slice(konec);
  pole.focus();
  pole.selectionStart = pole.selectionEnd = zacatek + text.length;
}

async function nahled(koren, s) {
  const obal = koren.querySelector('[data-nahled-obsah]');
  const form = koren.querySelector('[data-karta]');
  obal.innerHTML = '<p class="sekce__udaj text-faint">Vykresluji…</p>';

  try {
    const data = await api.post(`/sablony/${s.id}/nahled`, {
      predmet: form.querySelector('[name="predmet"]').value,
      telo: form.querySelector('[name="telo"]').value,
    });

    // HTML e-mailu se nikdy nevkládá do stránky administrace - je to obsah,
    // který se má jen ukázat. Textová verze stačí a je čitelnější.
    obal.innerHTML = `
      <p class="sekce__udaj"><span class="text-faint">Předmět:</span> <strong>${esc(data.predmet)}</strong></p>
      <pre class="nahled-text">${esc(data.text)}</pre>
      ${data.rezim !== 'live'
        ? `<p class="sekce__napoveda">
             Režim e-mailů: <strong>${esc(data.rezim)}</strong> — z tohohle prostředí
             zákazníkovi nic nedojde.
           </p>`
        : ''}`;
  } catch (chyba) {
    obal.innerHTML = `<p class="sekce__udaj text-faint">${esc(chyba.message)}</p>`;
  }
}

async function uloz(koren, s) {
  const form = koren.querySelector('[data-karta]');
  try {
    await api.patch(`/sablony/${s.id}`, {
      predmet: form.querySelector('[name="predmet"]').value,
      telo: form.querySelector('[name="telo"]').value,
      aktivni: form.querySelector('[name="aktivni"]')?.checked ?? true,
    });
    hlaska('Šablona je uložená.');
    editor(koren, s.id);
  } catch (chyba) {
    if (!ukazChybyPoli(form, chyba.detaily)) hlaska(chyba.message, 'chyba');
  }
}
