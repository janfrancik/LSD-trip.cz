// src/api/media.js
//
// Zobrazení nahraných fotek. Vlastní router mimo /api schválně ze dvou důvodů:
//
//   - adresa obrázku má být krátká a stálá, protože se objeví v HTML
//     stránky, v OG tagu a později i v e-mailu,
//   - veřejné API má rate limit 120 požadavků za minutu, do kterého by se
//     stránka s galerií vešla jednou a pak by se obrázky přestaly načítat.
//
// Veřejné je to schválně: fotky kurzů jsou obsah webu a administrace si je
// zobrazuje touž cestou, takže není potřeba druhý, chráněný endpoint.
// Osobní údaje tudy neodcházejí - ven jde obrázek, ne název souboru ani to,
// kdo ho nahrál. Přílohy akceptace tudy nejdou, ty mají vlastní tabulku
// i vlastní endpoint za přihlášením.
//
// V adrese je náhodný kód souboru, ne jeho id. Pořadová čísla se dala projít
// po řadě, a tím i prohlédnout fotky kurzu, který ještě není zveřejněný.

import express from 'express';
import { asyncHandler, chybaNenalezeno } from '../chyby.js';
import { nactiSouborPodleKodu, cestaKSouboru, verzeProWeb, DELKA_KODU } from '../soubory.js';

const router = express.Router();

router.get(
  `/:kod([0-9a-f]{${DELKA_KODU}})`,
  asyncHandler(async (req, res) => {
    const soubor = await nactiSouborPodleKodu(req.params.kod);
    if (!soubor) throw chybaNenalezeno('Obrázek nenalezen.');

    // Ven jde webová verze (delší strana 1600 px), ne originál z mobilu.
    // Originál zůstává ve volume jako záloha a zdroj pro další velikosti.
    const cesta = cestaKSouboru(verzeProWeb(soubor).cesta);
    if (!cesta) throw chybaNenalezeno('Obrázek nenalezen.');

    // Obsah souboru se nikdy nemění, takže se smí cachovat natvrdo.
    // Výměnou fotky vznikne nový záznam, a tedy i nová adresa.
    res.type(soubor.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(cesta, (chyba) => {
      // Záznam v databázi je, soubor na disku ne - například po obnově
      // zálohy databáze bez volume. Z pohledu návštěvníka prostě chybí
      // obrázek, není to chyba serveru.
      if (chyba && !res.headersSent) res.status(404).end();
    });
  })
);

// Cokoli jiného než kód je 404, ne stránka webu. Bez tohohle by se stará
// adresa /media/12 propadla až na veřejný web a vrátila jeho HTML s kódem 200.
router.use((req, res) => res.status(404).end());

export default router;
