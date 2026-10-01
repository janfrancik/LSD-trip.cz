// src/api/media.js
//
// Zobrazení nahraných fotek. Vlastní router mimo /api schválně ze dvou důvodů:
//
//   - adresa obrázku má být krátká a stálá (/media/12), protože se objeví
//     v HTML stránky, v OG tagu a později i v e-mailu,
//   - veřejné API má rate limit 120 požadavků za minutu, do kterého by se
//     stránka s galerií vešla jednou a pak by se obrázky přestaly načítat.
//
// Veřejné je to schválně: fotky kurzů jsou obsah webu a administrace si je
// zobrazuje touž cestou, takže není potřeba druhý, chráněný endpoint.
// Osobní údaje tudy neodcházejí - ven jde obrázek, ne název souboru ani to,
// kdo ho nahrál. Přílohy akceptace tudy nejdou, ty mají vlastní tabulku
// i vlastní endpoint za přihlášením.

import express from 'express';
import { asyncHandler, chybaNenalezeno } from '../chyby.js';
import { nactiSoubor, cestaKSouboru } from '../soubory.js';

const router = express.Router();

router.get(
  '/:id(\\d+)',
  asyncHandler(async (req, res) => {
    const soubor = await nactiSoubor(Number(req.params.id));
    if (!soubor) throw chybaNenalezeno('Obrázek nenalezen.');

    const cesta = cestaKSouboru(soubor.cesta);
    if (!cesta) throw chybaNenalezeno('Obrázek nenalezen.');

    // Jméno souboru je náhodné a jeho obsah se nikdy nemění, takže se smí
    // cachovat natvrdo. Výměnou fotky vznikne nové id, a tedy i nová adresa.
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

export default router;
