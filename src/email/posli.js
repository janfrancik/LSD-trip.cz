// src/email/posli.js
//
// Jediná cesta, kterou e-mail opouští aplikaci.
//
// Klíčová pojistka: v režimu 'test' se příjemce přepíše na EMAIL_TEST_PRIJEMCE
// JEŠTĚ PŘED voláním Resendu. Do logu se uloží obojí - komu e-mail patří
// (`prijemce`) i kam doopravdy šel (`prijemce_skutecny`). Na testovacím
// prostředí tedy nemůže dojít e-mail skutečnému zákazníkovi, i kdyby se v kódu
// spletl kdokoli.
//
// Režim 'vypnuto' je výchozí: e-mail nikam neodejde a v logu zůstane se stavem
// 'chyba' a důvodem. Tělo se ukládá i tak - záznam do `emaily` (včetně
// `telo_snapshot`, `telo_text` a příloh) vzniká PŘED rozhodnutím, jestli se
// odesílá, takže se v administraci dá otevřít a přečíst, co by bylo odešlo.
// Tlačítko "odeslat znovu" ale neexistuje: co se v tomhle režimu nepošle,
// musí člověk vyřídit sám.
//
// Režim 'schranka' (testovací prostředí, kde není Resend) taky nic neodešle,
// ale e-mail skončí ve stavu 've_schrance', tedy v testovací schránce
// v administraci, kde se dá otevřít jako v poštovním klientovi.

import { Resend } from 'resend';
import config from '../config.js';
import pool from '../db.js';
import { ulozPrilohuEmailu } from './prilohy.js';

let resend = null;
function klient() {
  if (!config.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(config.RESEND_API_KEY);
  return resend;
}

// Samotné odeslání je v jedné funkci, aby šlo v testech podstrčit. Bez toho
// by se nedalo otestovat ani "chyba 403 neshodí přihlášku", ani "opakované
// odeslání neodešle dvakrát" - jedině skutečným voláním Resendu, což v testech
// nemá co dělat.
//
// `maKlienta` je zvlášť, protože chybějící klíč není chyba odeslání: je to
// konfigurace a hlásí se jinou zprávou.
const skutecnyOdesilatel = {
  maKlienta() {
    return Boolean(klient());
  },
  async odesli(zprava, idempotencyKey) {
    // Idempotency-Key: kdyby se odpověď ztratila v síti a požadavek se
    // zopakoval, Resend druhý pokus se stejným klíčem nevyřídí znovu.
    // Bez toho by zákazník mohl dostat tentýž e-mail dvakrát i při jediném
    // kliknutí - zámek v databázi hlídá jen naši stranu, ne síť.
    const { data, error } = await klient().emails.send(
      zprava,
      idempotencyKey ? { idempotencyKey } : undefined
    );
    if (error) throw new Error(error.message ?? String(error));
    return data?.id ?? null;
  },
};

let odesilatel = skutecnyOdesilatel;

/**
 * Podstrčí odesílatele. **Jen pro testy.**
 *
 * Záměrně to není exportovaný objekt, do kterého by šlo kdykoli sáhnout:
 * tahle funkce mimo testy vyhodí výjimku. V kontejneru je `NODE_ENV=production`
 * i na testovacím prostředí (kvůli instalaci závislostí bez dev balíčků),
 * takže ani na testovacím webu, ani v produkci se podstrčit NEDÁ - a není
 * k tomu žádná proměnná v `.env` ani parametr požadavku.
 * `NODE_ENV=test` nastavuje výhradně `test/pomocnik.js`.
 */
export function _podstrcOdesilatel(nahrada = null) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      'Odesílatele e-mailů jde podstrčit jen v testech (NODE_ENV=test). ' +
        'Tohle je pojistka, ne nastavení.'
    );
  }
  odesilatel = nahrada ?? skutecnyOdesilatel;
}

// Kam e-mail doopravdy poslat. Nikdy nevrací adresu zákazníka mimo režim live.
//
// `interni` = upozornění pro provoz (nová přihláška, nová poptávka), ne e-mail
// zákazníkovi. Rozlišení existuje kvůli režimu 'jen_provoz': ten interní
// upozornění odesílá, ale zákazníkům neposílá nic.
function skutecnyPrijemce(prijemce, interni = false) {
  if (config.EMAIL_REZIM === 'live') return prijemce;
  if (config.EMAIL_REZIM === 'test') return config.EMAIL_TEST_PRIJEMCE;
  if (config.EMAIL_REZIM === 'jen_provoz') {
    // Pojistka: i kdyby se `prijemce` vzal odjinud, v tomhle režimu odejde
    // upozornění jen na adresu z .env. Bez ověřené domény umí Resend odeslat
    // jen na adresu majitele účtu a cokoli jiného by skončilo chybou 403.
    // Kdo adresu vybírá, řeší src/email/provoz.js - tady je to poslední
    // kontrola, ne druhé rozhodování.
    return interni ? config.EMAIL_PROVOZ_PRIJEMCE : null;
  }
  return null; // vypnuto i schranka - ven nejde nic
}

/**
 * Odešle e-mail a zapíše ho do logu.
 *
 * @param {object} p
 * @param {string} p.prijemce      komu e-mail patří (skutečný adresát)
 * @param {string} p.predmet
 * @param {string} p.telo          HTML
 * @param {string} [p.textovaVerze]
 * @param {string} [p.sablona]     klíč šablony do logu
 * @param {object} [p.vazby]       { rezervaceId, zakaznikId, terminId, poptavkaId, uzivatelId }
 * @param {Array}  [p.prilohy]     [{ filename, content }]
 * @param {boolean} [p.interni]    upozornění pro provoz, ne e-mail zákazníkovi
 * @returns {Promise<{id:number, odeslano:boolean, prijemceSkutecny:string|null}>}
 */
export async function posliEmail({
  prijemce,
  predmet,
  telo,
  textovaVerze = null,
  sablona = null,
  vazby = {},
  prilohy = [],
  interni = false,
  odpovedetNa = null,
}) {
  const kam = skutecnyPrijemce(prijemce, interni);
  const rezim = config.EMAIL_REZIM;
  const doSchranky = rezim === 'schranka';

  // Předmět v testu označíme, aby nebylo pochyb, odkud e-mail přišel.
  const predmetKOdeslani = rezim === 'test' ? `[TEST] ${predmet}` : predmet;

  const [vysledekVlozeni] = await pool.query(
    `INSERT INTO emaily
       (sablona_klic, prijemce, prijemce_skutecny, predmet, telo_snapshot, telo_text,
        rezervace_id, zakaznik_id, termin_id, poptavka_id, uzivatel_id, stav, rezim)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sablona,
      prijemce,
      kam,
      predmetKOdeslani,
      telo,
      textovaVerze,
      vazby.rezervaceId ?? null,
      vazby.zakaznikId ?? null,
      vazby.terminId ?? null,
      vazby.poptavkaId ?? null,
      vazby.uzivatelId ?? null,
      doSchranky ? 've_schrance' : 've_fronte',
      rezim,
    ]
  );
  const id = vysledekVlozeni.insertId;

  // Přílohy se ukládají vždy - ve schránce si je má být možné stáhnout,
  // v produkci slouží jako doklad o tom, co přesně zákazník dostal.
  for (const priloha of prilohy) {
    await ulozPrilohuEmailu(id, priloha).catch((err) =>
      console.error(`[email] přílohu se nepodařilo uložit (log #${id}):`, err.message)
    );
  }

  if (doSchranky) {
    console.log(`[email] schránka - uložen "${predmet}" pro ${prijemce} (schránka #${id})`);
    return { id, odeslano: false, doSchranky: true, prijemceSkutecny: null };
  }

  // Neodešlo, ale ne proto, že by se něco pokazilo - tenhle režim to tak má.
  // Stav je proto 'neodeslano', ne 'chyba': na dashboardu to nesvítí jako
  // problém a v administraci se na to dá pověsit "Odeslat znovu", až bude
  // kam odesílat.
  if (!kam) {
    const duvod =
      rezim === 'jen_provoz'
        ? 'Neodesláno - režim jen_provoz (zákazníkům se neposílá, dokud není ověřená doména).'
        : `Neodesláno - odesílání e-mailů je vypnuté (EMAIL_REZIM=${rezim}).`;

    await pool.query(
      `UPDATE emaily SET stav = 'neodeslano', chyba = ?, stav_at = NOW() WHERE id = ?`,
      [duvod, id]
    );
    console.log(`[email] ${rezim} - neodeslán "${predmet}" pro ${prijemce} (log #${id})`);
    return { id, odeslano: false, doSchranky: false, prijemceSkutecny: null };
  }

  if (!odesilatel.maKlienta()) {
    await pool.query(
      `UPDATE emaily SET stav = 'chyba', chyba = ?, stav_at = NOW() WHERE id = ?`,
      ['Chybí RESEND_API_KEY.', id]
    );
    console.error(`[email] chybí RESEND_API_KEY - neodeslán "${predmet}" (log #${id})`);
    return { id, odeslano: false, doSchranky: false, prijemceSkutecny: kam };
  }

  // První pokus. Pořadí se zapisuje do databáze, aby `Idempotency-Key` přežil
  // i restart aplikace uprostřed odesílání.
  await pool.query('UPDATE emaily SET pokusu = pokusu + 1 WHERE id = ?', [id]);
  const [[{ pokusu }]] = await pool.query('SELECT pokusu FROM emaily WHERE id = ?', [id]);

  try {
    const resendId = await odesilatel.odesli(
      {
        // Upozornění provozu chodí pod jménem "LSD web", ať je v poště
        // poznat, že je to ze stránek, a ne od člověka. Adresa zůstává
        // z EMAIL_ODESILATEL - tu určuje ověřená doména, ne my.
        from: interni ? odesilatelProvozu() : config.EMAIL_ODESILATEL,
        to: [kam],
        subject: predmetKOdeslani,
        html: telo,
        ...(textovaVerze ? { text: textovaVerze } : {}),
        ...(prilohy.length ? { attachments: prilohy } : {}),
        // Reply-To na zákazníka: u upozornění provozu stačí v poště kliknout
        // na Odpovědět a odpověď jde rovnou jemu, ne na adresu odesílatele.
        ...(odpovedetNa ? { replyTo: odpovedetNa } : {}),
      },
      klicPokusu(id, pokusu)
    );

    await pool.query(
      `UPDATE emaily SET resend_id = ?, stav = 'odeslano', odeslano_at = NOW(), stav_at = NOW()
        WHERE id = ?`,
      [resendId, id]
    );
    // Úspěch se loguje taky, jinak nejde ze serveru dohledat, co odešlo -
    // v logu byly jen zadržené a chybné e-maily. Adresa zákazníka se maskuje,
    // log si čte víc lidí než databázi.
    console.log(
      `[email] odesláno "${predmet}" -> ${maskujAdresu(kam)} ` +
        `(log #${id}, šablona ${sablona ?? 'bez šablony'}, resend ${resendId ?? '-'})`
    );
    return { id, odeslano: true, doSchranky: false, prijemceSkutecny: kam };
  } catch (err) {
    await pool.query(
      `UPDATE emaily SET stav = 'chyba', chyba = ?, stav_at = NOW() WHERE id = ?`,
      [String(err.message ?? err).slice(0, 2000), id]
    );
    console.error(`[email] odeslání selhalo (log #${id}):`, err.message);
    return { id, odeslano: false, doSchranky: false, prijemceSkutecny: kam };
  }
}

/**
 * Odešle znovu e-mail, který zůstal neodeslaný.
 *
 * Posílá se **uložené tělo**, ne nově vyrenderovaná šablona: zákazník má
 * dostat to, co je v logu, i kdyby se text šablony mezitím změnil.
 *
 * Dvojí odeslání hlídá podmíněný UPDATE, ne kontrola před ním. Kdyby se
 * kliklo dvakrát (nebo běžela hromadná akce a zároveň jedno tlačítko),
 * stav si vezme jen jeden z nich - ten druhý dostane `duvod: 'jiz_vyrizeno'`
 * a nic neodešle.
 *
 * @param {number} id
 * @returns {Promise<{odeslano:boolean, duvod?:string, prijemceSkutecny?:string|null}>}
 */
export async function odesliZnovu(id) {
  if (!config.muzeZakaznikovi) {
    return { odeslano: false, duvod: 'rezim_nedovoluje' };
  }

  const [[email]] = await pool.query(
    `SELECT id, prijemce, predmet, telo_snapshot, telo_text, sablona_klic
       FROM emaily WHERE id = ?`,
    [id]
  );
  if (!email) return { odeslano: false, duvod: 'nenalezeno' };

  // Zabrání si řádek a zároveň zvýší pořadí pokusu - obojí jedním příkazem,
  // ať se mezi tím nikdo nevejde. Když řádek už někdo zabral (nebo je dávno
  // odeslaný), affectedRows je 0.
  //
  // Zkusit znovu jde i e-mail ve stavu 'chyba': typicky 403 od Resendu, který
  // po ověření domény zmizí. Co je 'odeslano', se znovu neposílá.
  const [zabrano] = await pool.query(
    `UPDATE emaily SET stav = 've_fronte', pokusu = pokusu + 1, stav_at = NOW()
      WHERE id = ? AND stav IN ('neodeslano', 'chyba')`,
    [id]
  );
  if (!zabrano.affectedRows) return { odeslano: false, duvod: 'jiz_vyrizeno' };

  const [[{ pokusu }]] = await pool.query('SELECT pokusu FROM emaily WHERE id = ?', [id]);
  const kam = skutecnyPrijemce(email.prijemce);

  if (!kam || !odesilatel.maKlienta()) {
    await oznacChybu(id, kam ? 'Chybí RESEND_API_KEY.' : 'Režim neumí odeslat zákazníkovi.');
    return { odeslano: false, duvod: 'nelze_odeslat' };
  }

  try {
    const resendId = await odesilatel.odesli(
      {
        from: config.EMAIL_ODESILATEL,
        to: [kam],
        subject: config.EMAIL_REZIM === 'test' ? `[TEST] ${email.predmet}` : email.predmet,
        html: email.telo_snapshot ?? undefined,
        ...(email.telo_text ? { text: email.telo_text } : {}),
      },
      klicPokusu(id, pokusu)
    );

    await pool.query(
      `UPDATE emaily
          SET resend_id = ?, prijemce_skutecny = ?, stav = 'odeslano',
              chyba = NULL, odeslano_at = NOW(), stav_at = NOW()
        WHERE id = ?`,
      [resendId, kam, id]
    );
    return { odeslano: true, prijemceSkutecny: kam };
  } catch (err) {
    // Skutečná chyba odesílací služby (403, 5xx, timeout) je 'chyba', ne
    // 'neodeslano'. 'Neodeslano' znamená "režim to zakázal" - úmysl. Kdyby
    // se sem psalo obojí, nešlo by na dashboardu poznat, co se opravdu
    // pokazilo, a hromadné rozeslání by selhané e-maily zkoušelo dokola.
    await oznacChybu(id, String(err.message ?? err).slice(0, 2000));
    console.error(`[email] opakované odeslání selhalo (log #${id}):`, err.message);
    return { odeslano: false, duvod: 'chyba_odeslani' };
  }
}

async function oznacChybu(id, chyba) {
  await pool.query(
    `UPDATE emaily SET stav = 'chyba', chyba = ?, stav_at = NOW() WHERE id = ?`,
    [chyba, id]
  );
}

// Klíč pro Resend. Stejný pokus = stejný klíč, takže síťové zopakování
// neodešle druhý e-mail; vědomé odeslání znovu zvýší `pokusu` a klíč je jiný.
function klicPokusu(id, pokusu) {
  return `email-${id}-pokus-${pokusu}`;
}

// Odesílatel interních upozornění: jiné zobrazované jméno, TÁŽ adresa.
// Adresu určuje doména ověřená u odesílací služby, takže se měnit nesmí -
// mění se jen to, co uvidí člověk v seznamu pošty.
const JMENO_PROVOZ = 'LSD web';

export function odesilatelProvozu() {
  const adresa = adresaZOdesilatele(config.EMAIL_ODESILATEL);
  return adresa ? `${JMENO_PROVOZ} <${adresa}>` : config.EMAIL_ODESILATEL;
}

// Z "LSD <rezervace@…>" vytáhne "rezervace@…". Když je v .env jen holá
// adresa, vrátí ji beze změny.
function adresaZOdesilatele(odesilatel) {
  const vZavorkach = String(odesilatel ?? '').match(/<([^>]+)>/);
  if (vZavorkach) return vZavorkach[1].trim();

  const holaAdresa = String(odesilatel ?? '').trim();
  return holaAdresa.includes('@') ? holaAdresa : null;
}

// h***@gmail.com - do logu patří tolik, aby se poznalo, o koho šlo, ne celá
// adresa. Log čte víc lidí a zůstává v souborech dýl než data v databázi.
export function maskujAdresu(adresa) {
  const text = String(adresa ?? '');
  const zavinac = text.indexOf('@');
  if (zavinac < 1) return '***';
  return `${text[0]}***${text.slice(zavinac)}`;
}

// Export pro testy: ověřuje se, že v testovacím režimu nikdy nevznikne
// adresa zákazníka.
export const _skutecnyPrijemce = skutecnyPrijemce;
