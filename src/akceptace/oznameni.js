// src/akceptace/oznameni.js
//
// E-mail testerům, že je na testu nová verze k odzkoušení.
//
// Odesílání jde přes obvyklou cestu (src/email/posli.js), takže i tady platí
// pojistka testovacího prostředí: v režimu 'test' se všechno přepíše na
// testovací adresu, v režimu 'vypnuto' se e-mail jen zaloguje. Dokud není
// Resend nastavený, zůstane oznámení jen v administraci - zvoneček a karta
// na přehledu fungují bez e-mailu.

import pool from '../db.js';
import config from '../config.js';
import { posliEmail } from '../email/posli.js';
import { obalka, tlacitko, escapujHtml } from '../email/sablona.js';
import { hodnota } from '../nastaveni.js';
import { PRAVA } from '../auth/opravneni.js';

// Kdo je tester: každý aktivní člověk, jehož role má právo na akceptaci.
// Seznam rolí se bere z oprávnění, ne z výčtu tady - přidání role se pak
// nemusí dopisovat na dvou místech.
const ROLE_TESTERU = Object.entries(PRAVA)
  .filter(([, prava]) => prava.akceptace)
  .map(([role]) => role);

export async function seznamTesteru() {
  const [rows] = await pool.query(
    `SELECT id, email, jmeno, role FROM uzivatele
      WHERE role IN (?) AND aktivni = 1 AND smazano_at IS NULL
      ORDER BY jmeno`,
    [ROLE_TESTERU]
  );
  return rows;
}

/**
 * Rozešle oznámení o verzi a orazítkuje `oznameno_at`. Vrací, komu to šlo -
 * administrace to ukáže, ať je vidět, že se něco stalo (i v režimu vypnuto,
 * kdy se e-mail jen zapsal do logu).
 */
export async function oznamVerzi(verzeId, { pocetUkolu = null } = {}) {
  const [[verze]] = await pool.query(
    'SELECT id, kod, nazev, popis FROM akceptace_verze WHERE id = ?',
    [verzeId]
  );
  if (!verze) return { odeslano: 0, prijemci: [], rezim: config.EMAIL_REZIM };

  const testeri = await seznamTesteru();
  if (testeri.length === 0) {
    return { odeslano: 0, prijemci: [], rezim: config.EMAIL_REZIM, bezTesteru: true };
  }

  const podpis = await hodnota('emaily.podpis');
  const odkaz = config.url('/admin/akceptace/' + verze.kod);
  let odeslano = 0;
  let doSchranky = 0;

  for (const tester of testeri) {
    const vysledek = await posliEmail({
      prijemce: tester.email,
      predmet: `K otestování: ${verze.nazev}`,
      sablona: 'akceptace_nova_verze',
      vazby: { uzivatelId: tester.id },
      telo: obalka({
        titulek: 'Na testovacím webu je nová verze',
        obsahHtml:
          `<p>Dobrý den, ${escapujHtml(tester.jmeno)},</p>` +
          `<p>na testovacím webu je připravená verze <strong>${escapujHtml(verze.nazev)}</strong>` +
          (pocetUkolu ? ` a ${pocetUkolu} ${sklonUkoly(pocetUkolu)} k odzkoušení` : '') +
          `. V administraci najdete u každého úkolu postup krok za krokem a políčko, ` +
          `kam napíšete, jestli to funguje.</p>` +
          `<p style="margin:22px 0">${tlacitko('Otevřít seznam úkolů', odkaz)}</p>` +
          `<p style="font-size:13px;color:#8B8987">Je to testovací web, ne ten skutečný — ` +
          `cokoli tam vyplníte je nanečisto a zákazníkům odtud nic neodejde.</p>`,
        podpis,
      }),
      textovaVerze:
        `Na testovacím webu je nová verze: ${verze.nazev}\n\n` +
        `Seznam úkolů k otestování: ${odkaz}\n`,
    });
    if (vysledek.odeslano) odeslano += 1;
    if (vysledek.doSchranky) doSchranky += 1;
  }

  await pool.query('UPDATE akceptace_verze SET oznameno_at = NOW() WHERE id = ?', [verzeId]);

  return {
    odeslano,
    doSchranky,
    prijemci: testeri.map((t) => t.email),
    rezim: config.EMAIL_REZIM,
  };
}

function sklonUkoly(pocet) {
  if (pocet === 1) return 'úkol';
  if (pocet >= 2 && pocet <= 4) return 'úkoly';
  return 'úkolů';
}
