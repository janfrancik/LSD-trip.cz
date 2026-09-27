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

// Tlačítko pro výběr obrázku. Na mobilu otevře fotoaparát i galerii.
export function tlacitkoObrazek(id, popisek = 'Přidat snímek') {
  return `<label class="btn btn--obrys btn--maly" for="${esc(id)}" style="cursor:pointer">
      ${esc(popisek)}
      <input type="file" id="${esc(id)}" accept="image/png,image/jpeg,image/webp"
             hidden />
    </label>`;
}
