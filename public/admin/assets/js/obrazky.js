// public/admin/assets/js/obrazky.js
//
// Nahrávání snímků obrazovky (akceptační testování). Soubor se přečte
// v prohlížeči a pošle jako base64 v JSON - pro jeden obrázek to stačí
// a nepotřebuje to nic navíc na serveru.

import { api } from './api.js';
import { esc } from './ui.js';

export const MAX_BAJTU = 6 * 1024 * 1024;

export function prectiJakoDataUrl(soubor) {
  return new Promise((vyres, zamitni) => {
    const cetba = new FileReader();
    cetba.onload = () => vyres(cetba.result);
    cetba.onerror = () => zamitni(new Error('Soubor se nepodařilo přečíst.'));
    cetba.readAsDataURL(soubor);
  });
}

/**
 * Nahraje obrázek a vrátí { id, url }. Kontrola velikosti je i tady, aby
 * uživatel nečekal na odeslání osmi megabajtů, které server odmítne.
 */
export async function nahrajObrazek(soubor) {
  if (!soubor.type.startsWith('image/')) {
    throw new Error('Přiložit se dá jen obrázek (snímek obrazovky nebo fotka).');
  }
  if (soubor.size > MAX_BAJTU) {
    throw new Error(
      `Obrázek má ${(soubor.size / 1024 / 1024).toFixed(1)} MB, maximum je 6 MB.`
    );
  }
  const obsah = await prectiJakoDataUrl(soubor);
  return api.post('/akceptace/prilohy', { obsah, nazev: soubor.name });
}

// Náhled nahrané přílohy. Obrázek se bere z API (ne z dat v paměti), takže
// stejný kód funguje i pro přílohy uložené dřív.
export function nahled(priloha) {
  const url = priloha.url ?? `/api/admin/akceptace/prilohy/${priloha.id}`;
  return `<a class="nahled" href="${esc(url)}" target="_blank" rel="noopener"
     title="Otevřít v nové záložce">
     <img src="${esc(url)}" alt="Přiložený snímek" loading="lazy" />
   </a>`;
}

// ------------------------------------- vložení ze schránky a přetažení myší
//
// Na počítači je nejrychlejší cesta ke snímku Cmd/Ctrl+V nebo přetažení souboru;
// vybírat ho přes dialog je zbytečná okluka. Na mobilu zůstává tlačítko
// s výběrem souboru nebo fotoaparátu - tam schránka ani přetahování nedávají smysl.

// Obrázek z události "paste" nebo "drop". Vrací null, když v ní žádný není
// (zkopírovaný text, přetažený odkaz).
export function obrazekZUdalosti(udalost) {
  const prenos = udalost.clipboardData ?? udalost.dataTransfer;
  if (!prenos) return null;

  const soubor = [...(prenos.files ?? [])].find((s) => s.type.startsWith('image/'));
  if (soubor) return soubor;

  // Snímek obrazovky ze schránky nepřijde jako soubor, ale jako položka.
  for (const polozka of prenos.items ?? []) {
    if (polozka.kind === 'file' && polozka.type.startsWith('image/')) {
      const zPolozky = polozka.getAsFile();
      if (zPolozky) return zPolozky;
    }
  }
  return null;
}

function nesePrenosSoubor(udalost) {
  return [...(udalost.dataTransfer?.types ?? [])].includes('Files');
}

/**
 * Přetahování nad prvkem. Vrací funkci, která poslouchání odpojí -
 * obrazovky se překreslují, takže po sobě musí umět uklidit.
 */
export function pripojPretazeni(prvek, zpracuj) {
  const nad = (e) => {
    if (!nesePrenosSoubor(e)) return;
    e.preventDefault();
    prvek.classList.add('nad-souborem');
  };
  const pryc = (e) => {
    // dragleave chodí i při přejezdu mezi vnořenými prvky.
    if (e.relatedTarget && prvek.contains(e.relatedTarget)) return;
    prvek.classList.remove('nad-souborem');
  };
  const pust = (e) => {
    prvek.classList.remove('nad-souborem');
    const soubor = obrazekZUdalosti(e);
    if (!soubor) return;
    e.preventDefault();
    zpracuj(soubor);
  };

  prvek.addEventListener('dragover', nad);
  prvek.addEventListener('dragleave', pryc);
  prvek.addEventListener('drop', pust);

  return () => {
    prvek.removeEventListener('dragover', nad);
    prvek.removeEventListener('dragleave', pryc);
    prvek.removeEventListener('drop', pust);
  };
}

/**
 * Vkládání ze schránky. Posloucháme na dokumentu, protože Cmd+V zpravidla
 * přijde, když je zaostřené textové pole nebo vůbec nic - `kam` proto
 * u každé události rozhodne, kam obrázek patří (a null ho zahodí).
 */
export function pripojVkladani(kam, zpracuj) {
  const naVlozeni = (e) => {
    const soubor = obrazekZUdalosti(e);
    if (!soubor) return;
    const cil = kam(e);
    if (!cil) return;
    e.preventDefault();
    zpracuj(soubor, cil);
  };

  document.addEventListener('paste', naVlozeni);
  return () => document.removeEventListener('paste', naVlozeni);
}

// Věta pod tlačítkem. Na mobilu se schová - tam se nic nepřetahuje.
export const NAPOVEDA_VLOZENI =
  '<span class="jen-siroke text-faint">Snímek jde i vložit ze schránky (Cmd/Ctrl+V) nebo sem přetáhnout.</span>';

// Tlačítko pro výběr obrázku. Na mobilu otevře fotoaparát i galerii.
export function tlacitkoObrazek(id, popisek = 'Přidat snímek') {
  return `<label class="btn btn--obrys btn--maly" for="${esc(id)}" style="cursor:pointer">
      ${esc(popisek)}
      <input type="file" id="${esc(id)}" accept="image/png,image/jpeg,image/webp"
             hidden />
    </label>`;
}
