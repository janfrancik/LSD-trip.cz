// src/api/admin/auth.js
//
// Přihlášení, odhlášení, změna hesla, reset hesla a dvoufázové ověření.

import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import pool from '../../db.js';
import config from '../../config.js';
import { asyncHandler, chybaSpatnyVstup, chybaNeprihlasen, chybaBezOpravneni } from '../../chyby.js';
import { zvaliduj, schemaEmail, schemaHeslo } from '../../validace.js';
import { zahashujHeslo, overHeslo } from '../../auth/hesla.js';
import {
  vytvorSession,
  zrusSession,
  zrusVsechnySession,
  hashTokenu,
} from '../../auth/session.js';
import { limitPrihlaseni, limitResetHesla, zapisPokus, vyhodnotZamek } from '../../auth/limit.js';
import { zajistiCsrfToken } from '../../auth/csrf.js';
import { vyzadujePrihlaseni, pravaProKlienta } from '../../auth/opravneni.js';
import { zapisAudit } from '../../audit.js';
import { posliEmail } from '../../email/posli.js';
import { obalka, tlacitko, odkazNaApp } from '../../email/sablona.js';
import { overTotpKod, vytvorTotpSecret, totpUrl } from '../../auth/totp.js';

const router = express.Router();

// Jednotná odpověď o přihlášeném člověku. Klient si podle `prava` skládá menu.
function ja(uzivatel, csrf) {
  return {
    uzivatel: {
      id: uzivatel.id,
      email: uzivatel.email,
      jmeno: uzivatel.jmeno,
      role: uzivatel.role,
      maTotp: Boolean(uzivatel.maTotp ?? uzivatel.totp_potvrzeno_at),
    },
    prava: pravaProKlienta(uzivatel.role),
    prostredi: config.PROSTREDI,
    // Podle tohoto příznaku administrace ukáže modul Ke schválení a tlačítko
    // „Nahlásit problém“. V produkci je false a API pro akceptaci neexistuje.
    akceptace: config.akceptaceZapnuta,
    csrf,
  };
}

// GET /api/admin/ja - kdo jsem. Vrací i CSRF token, takže administrace nemusí
// nic dalšího volat.
router.get(
  '/ja',
  asyncHandler(async (req, res) => {
    const csrf = zajistiCsrfToken(req, res);
    if (!req.uzivatel) return res.status(401).json({ chyba: 'Nejsi přihlášen.', csrf });
    res.json(ja(req.uzivatel, csrf));
  })
);

const schemaPrihlaseni = z.object({
  email: schemaEmail,
  heslo: z.string().min(1, 'Zadej heslo.'),
  totp: z.string().trim().max(10).optional(),
});

// POST /api/admin/prihlaseni
router.post(
  '/prihlaseni',
  limitPrihlaseni,
  asyncHandler(async (req, res) => {
    const { email, heslo, totp } = zvaliduj(schemaPrihlaseni, req.body ?? {});

    const [rows] = await pool.query(
      `SELECT id, email, jmeno, role, heslo_hash, aktivni, zamceno_do,
              totp_secret, totp_potvrzeno_at
         FROM uzivatele WHERE email = ? AND smazano_at IS NULL`,
      [email]
    );
    const u = rows[0];

    // Stejná zpráva pro neexistující účet i špatné heslo - jinak by šlo
    // zjišťovat, kdo u nás má účet.
    const spatne = () =>
      chybaSpatnyVstup('Nesprávný e-mail nebo heslo.', { heslo: 'Nesprávný e-mail nebo heslo.' });

    if (!u) {
      await zapisPokus(email, req.ip, false, 'neznamy_email');
      throw spatne();
    }
    if (!u.aktivni) {
      await zapisPokus(email, req.ip, false, 'neaktivni');
      throw chybaBezOpravneni('Účet je deaktivovaný. Ozvi se správci.');
    }
    if (u.zamceno_do && new Date(u.zamceno_do) > new Date()) {
      await zapisPokus(email, req.ip, false, 'zamceno');
      throw chybaBezOpravneni(
        'Účet je kvůli opakovaným neúspěšným pokusům dočasně zamčený. Zkus to za 15 minut.'
      );
    }

    if (!(await overHeslo(u.heslo_hash, heslo))) {
      await zapisPokus(email, req.ip, false, 'spatne_heslo');
      const zamceno = await vyhodnotZamek(email);
      await zapisAudit({
        req,
        akce: 'prihlaseni_selhalo',
        entita: 'uzivatel',
        entitaId: u.id,
        popis: zamceno ? 'Špatné heslo, účet zamčen' : 'Špatné heslo',
      });
      throw spatne();
    }

    // Dvoufázové ověření, pokud si ho uživatel zapnul.
    if (u.totp_potvrzeno_at) {
      if (!totp) {
        return res.status(401).json({
          chyba: 'Zadej kód z aplikace.',
          potrebaTotp: true,
        });
      }
      if (!overTotpKod(u.totp_secret, totp)) {
        await zapisPokus(email, req.ip, false, 'spatny_totp');
        throw chybaSpatnyVstup('Kód nesouhlasí. Zkus další, který aplikace zobrazí.', {
          totp: 'Kód nesouhlasí.',
        });
      }
    }

    await pool.query(
      'UPDATE uzivatele SET posledni_prihlaseni_at = NOW(), zamceno_do = NULL WHERE id = ?',
      [u.id]
    );
    await zapisPokus(email, req.ip, true);
    await vytvorSession(res, u.id, req);
    const csrf = zajistiCsrfToken(req, res);

    req.uzivatel = { id: u.id, email: u.email, jmeno: u.jmeno, role: u.role };
    await zapisAudit({ req, akce: 'prihlaseni', entita: 'uzivatel', entitaId: u.id });

    res.json(ja({ ...u, maTotp: Boolean(u.totp_potvrzeno_at) }, csrf));
  })
);

// POST /api/admin/odhlaseni
router.post(
  '/odhlaseni',
  asyncHandler(async (req, res) => {
    if (req.session) {
      await zapisAudit({ req, akce: 'odhlaseni', entita: 'uzivatel', entitaId: req.uzivatel?.id });
      await zrusSession(res, req.session.sessionId);
    }
    res.json({ ok: true });
  })
);

const schemaZmenaHesla = z.object({
  stare: z.string().min(1, 'Zadej stávající heslo.'),
  nove: schemaHeslo,
});

// POST /api/admin/zmena-hesla
router.post(
  '/zmena-hesla',
  vyzadujePrihlaseni,
  asyncHandler(async (req, res) => {
    const { stare, nove } = zvaliduj(schemaZmenaHesla, req.body ?? {});

    const [rows] = await pool.query('SELECT heslo_hash FROM uzivatele WHERE id = ?', [
      req.uzivatel.id,
    ]);
    if (!rows[0] || !(await overHeslo(rows[0].heslo_hash, stare))) {
      throw chybaSpatnyVstup('Stávající heslo nesouhlasí.', { stare: 'Heslo nesouhlasí.' });
    }

    await pool.query('UPDATE uzivatele SET heslo_hash = ?, upravil_id = ? WHERE id = ?', [
      await zahashujHeslo(nove),
      req.uzivatel.id,
      req.uzivatel.id,
    ]);
    await zapisAudit({ req, akce: 'zmena_hesla', entita: 'uzivatel', entitaId: req.uzivatel.id });

    // Odhlásíme všechna zařízení a přihlásíme zpátky jen tohle.
    await zrusVsechnySession(req.uzivatel.id);
    await vytvorSession(res, req.uzivatel.id, req);

    res.json({ ok: true, zprava: 'Heslo je změněné. Ostatní zařízení jsme odhlásili.' });
  })
);

// POST /api/admin/reset-hesla - žádost o odkaz
router.post(
  '/reset-hesla',
  limitResetHesla,
  asyncHandler(async (req, res) => {
    const { email } = zvaliduj(z.object({ email: schemaEmail }), req.body ?? {});

    const [rows] = await pool.query(
      'SELECT id, jmeno, email FROM uzivatele WHERE email = ? AND aktivni = 1 AND smazano_at IS NULL',
      [email]
    );

    // Odpověď je vždy stejná, i když účet neexistuje - jinak by šlo zjišťovat,
    // kdo u nás účet má.
    const odpoved = {
      ok: true,
      zprava: 'Pokud e-mail patří k účtu, poslali jsme na něj odkaz pro nastavení hesla.',
    };

    if (!rows[0]) return res.json(odpoved);

    await posliOdkazNaHeslo(rows[0], 'reset', req);
    res.json(odpoved);
  })
);

// Vytvoří jednorázový token a pošle e-mail. Používá i zakládání uživatele.
//
// Vrací i to, jestli e-mail doopravdy odešel. Volající to musí umět říct
// nahlas - tvrdit "pozvánka odešla", když je odesílání vypnuté, by znamenalo,
// že nový člověk marně čeká na e-mail, který nikdy nepřijde.
export async function posliOdkazNaHeslo(uzivatel, ucel, req = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hodin = ucel === 'pozvanka' ? 72 : 1;

  // Starší nepoužité tokeny zneplatníme, ať platí jen ten poslední.
  await pool.query(
    'UPDATE reset_hesla SET pouzito_at = NOW() WHERE uzivatel_id = ? AND pouzito_at IS NULL',
    [uzivatel.id]
  );
  await pool.query(
    `INSERT INTO reset_hesla (uzivatel_id, token_hash, ucel, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
    [uzivatel.id, hashTokenu(token), ucel, hodin]
  );

  const url = odkazNaApp(`/admin/nove-heslo/${token}`);
  const jePozvanka = ucel === 'pozvanka';
  const titulek = jePozvanka ? 'Přístup do administrace LSD' : 'Nastavení nového hesla';
  const text = jePozvanka
    ? `<p>Ahoj ${uzivatel.jmeno},</p>
       <p>máš přístup do administrace webu LSD. Nastav si heslo tímhle odkazem — platí 3 dny.</p>`
    : `<p>Ahoj ${uzivatel.jmeno},</p>
       <p>někdo (nejspíš ty) požádal o nastavení nového hesla do administrace LSD.
          Odkaz platí jednu hodinu a jde použít jednou.</p>`;

  const vysledek = await posliEmail({
    prijemce: uzivatel.email,
    predmet: titulek,
    sablona: jePozvanka ? 'pozvanka' : 'reset_hesla',
    vazby: { uzivatelId: uzivatel.id },
    telo: obalka({
      titulek,
      obsahHtml: `${text}
        <p style="margin:22px 0">${tlacitko('Nastavit heslo', url)}</p>
        <p style="font-size:13px;color:#8B8987">Kdyby tlačítko nefungovalo, otevři tuhle adresu:<br />
        <span style="word-break:break-all">${url}</span></p>
        ${jePozvanka ? '' : '<p style="font-size:13px;color:#8B8987">Pokud jsi o heslo nežádal, nic nedělej — heslo zůstane stejné.</p>'}`,
      podpis: 'Letecká společnost dobrodruhů z.s.',
    }),
  });

  if (req) {
    await zapisAudit({
      req,
      akce: jePozvanka ? 'pozvanka_odeslana' : 'reset_hesla_odeslan',
      entita: 'uzivatel',
      entitaId: uzivatel.id,
      popis: vysledek.odeslano ? null : 'E-mail se neodeslal, odkaz je potřeba předat ručně',
    });
  }

  return { token, url, odeslano: vysledek.odeslano, prijemceSkutecny: vysledek.prijemceSkutecny };
}

// GET /api/admin/reset-hesla/:token - ověření, že odkaz ještě platí
router.get(
  '/reset-hesla/:token',
  asyncHandler(async (req, res) => {
    const zaznam = await najdiToken(req.params.token);
    res.json({
      platny: Boolean(zaznam),
      ucel: zaznam?.ucel ?? null,
      jmeno: zaznam?.jmeno ?? null,
    });
  })
);

// POST /api/admin/reset-hesla/:token - nastavení nového hesla
router.post(
  '/reset-hesla/:token',
  limitResetHesla,
  asyncHandler(async (req, res) => {
    const { heslo } = zvaliduj(z.object({ heslo: schemaHeslo }), req.body ?? {});
    const zaznam = await najdiToken(req.params.token);
    if (!zaznam) {
      throw chybaSpatnyVstup('Odkaz už neplatí. Požádej o nový.');
    }

    await pool.query('UPDATE uzivatele SET heslo_hash = ? WHERE id = ?', [
      await zahashujHeslo(heslo),
      zaznam.uzivatel_id,
    ]);
    await pool.query('UPDATE reset_hesla SET pouzito_at = NOW() WHERE id = ?', [zaznam.id]);
    await zrusVsechnySession(zaznam.uzivatel_id);

    req.uzivatel = { id: zaznam.uzivatel_id, email: zaznam.email, role: zaznam.role };
    await zapisAudit({
      req,
      akce: 'heslo_nastaveno',
      entita: 'uzivatel',
      entitaId: zaznam.uzivatel_id,
      popis: zaznam.ucel === 'pozvanka' ? 'První nastavení hesla z pozvánky' : 'Reset hesla',
    });

    res.json({ ok: true, zprava: 'Heslo je nastavené. Teď se můžeš přihlásit.' });
  })
);

async function najdiToken(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const [rows] = await pool.query(
    `SELECT r.id, r.uzivatel_id, r.ucel, u.jmeno, u.email, u.role
       FROM reset_hesla r
       JOIN uzivatele u ON u.id = r.uzivatel_id
      WHERE r.token_hash = ? AND r.pouzito_at IS NULL AND r.expires_at > NOW()
        AND u.aktivni = 1 AND u.smazano_at IS NULL`,
    [hashTokenu(token)]
  );
  return rows[0] ?? null;
}

// ------------------------------------------------------------ 2FA (volitelné)

// POST /api/admin/2fa/zapnout - vygeneruje tajemství a QR adresu
router.post(
  '/2fa/zapnout',
  vyzadujePrihlaseni,
  asyncHandler(async (req, res) => {
    const secret = vytvorTotpSecret();
    await pool.query(
      'UPDATE uzivatele SET totp_secret = ?, totp_potvrzeno_at = NULL WHERE id = ?',
      [secret, req.uzivatel.id]
    );
    res.json({
      secret,
      url: totpUrl(secret, req.uzivatel.email),
      napoveda:
        'Načti QR kód v aplikaci (Google Authenticator, Authy, 1Password) a pak potvrď kódem, který zobrazí.',
    });
  })
);

// POST /api/admin/2fa/potvrdit
router.post(
  '/2fa/potvrdit',
  vyzadujePrihlaseni,
  asyncHandler(async (req, res) => {
    const { kod } = zvaliduj(
      z.object({ kod: z.string().trim().min(6, 'Zadej šestimístný kód.').max(10) }),
      req.body ?? {}
    );
    const [rows] = await pool.query('SELECT totp_secret FROM uzivatele WHERE id = ?', [
      req.uzivatel.id,
    ]);
    if (!rows[0]?.totp_secret) {
      throw chybaSpatnyVstup('Nejdřív si dvoufázové ověření zapni.');
    }
    if (!overTotpKod(rows[0].totp_secret, kod)) {
      throw chybaSpatnyVstup('Kód nesouhlasí. Zkus další, který aplikace zobrazí.', {
        kod: 'Kód nesouhlasí.',
      });
    }
    await pool.query('UPDATE uzivatele SET totp_potvrzeno_at = NOW() WHERE id = ?', [
      req.uzivatel.id,
    ]);
    await zapisAudit({ req, akce: '2fa_zapnuto', entita: 'uzivatel', entitaId: req.uzivatel.id });
    res.json({ ok: true, zprava: 'Dvoufázové ověření je zapnuté.' });
  })
);

// POST /api/admin/2fa/vypnout - vyžaduje heslo, aby to nešlo z ukradené session
router.post(
  '/2fa/vypnout',
  vyzadujePrihlaseni,
  asyncHandler(async (req, res) => {
    const { heslo } = zvaliduj(
      z.object({ heslo: z.string().min(1, 'Zadej svoje heslo.') }),
      req.body ?? {}
    );
    const [rows] = await pool.query('SELECT heslo_hash FROM uzivatele WHERE id = ?', [
      req.uzivatel.id,
    ]);
    if (!(await overHeslo(rows[0]?.heslo_hash, heslo))) {
      throw chybaSpatnyVstup('Heslo nesouhlasí.', { heslo: 'Heslo nesouhlasí.' });
    }
    await pool.query(
      'UPDATE uzivatele SET totp_secret = NULL, totp_potvrzeno_at = NULL WHERE id = ?',
      [req.uzivatel.id]
    );
    await zapisAudit({ req, akce: '2fa_vypnuto', entita: 'uzivatel', entitaId: req.uzivatel.id });
    res.json({ ok: true, zprava: 'Dvoufázové ověření je vypnuté.' });
  })
);

export default router;
