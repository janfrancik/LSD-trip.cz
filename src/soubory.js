// src/soubory.js
//
// Nahrané soubory. Obecné zázemí pro fotky kurzů, později i pro fotogalerii
// a obrázky v obsahu webu (docs/plan-administrace.md §3.9).
//
// Soubory leží ve volume uploads (v Dockeru /app/uploads), v databázi je jen
// cesta - obrázky tak nenadýmají zálohu databáze a přežijí přestavbu image.
// Je to stejný postup jako u příloh akceptace (src/akceptace/prilohy.js);
// tabulka je ale jiná, protože tyhle soubory jsou obsah webu, ne interní
// snímky z testování, a mají navíc alt text, otisk a měkké mazání.
//
// Obrázek přichází jako base64 v JSON. Na multipart tady není důvod:
// prohlížeč soubor přečte sám a nepřidává to závislost navíc.
//
// Originál se ukládá tak, jak přišel, a vedle něj vzniká webová verze
// zmenšená na 1600 px na delší straně. Fotka z mobilu má klidně 4000 px
// a 5 MB; posílat ji návštěvníkovi v původní velikosti je plýtvání jeho
// daty a originál se přitom hodí - příště z něj půjde vyrobit cokoli
// dalšího, aniž by se musel nahrávat znovu. Převod na WebP a malé náhledy
// přijdou s fotogalerií (fáze 5).

import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import config from './config.js';
import pool from './db.js';
import { isoDatum } from './cas.js';
import { chybaSpatnyVstup } from './chyby.js';

export const MAX_BAJTU = 10 * 1024 * 1024;

// Typ souboru se určuje z jeho obsahu, ne z toho, co tvrdí prohlížeč.
const PODPISY = [
  {
    mime: 'image/png',
    pripona: 'png',
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/jpeg',
    pripona: 'jpg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/webp',
    pripona: 'webp',
    test: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

function rozpoznej(bajty) {
  return PODPISY.find((p) => bajty.length > 12 && p.test(bajty)) ?? null;
}

// Kód do veřejné adresy (/media/<kod>). Záměrně ne `id`: pořadová čísla se
// dají projít po řadě, a tím i prohlédnout fotky kurzu, který ještě není
// zveřejněný. 12 bajtů = 96 bitů, hex kvůli collation sloupce (migrace 010).
export const DELKA_KODU = 24;

export function novyKod() {
  return crypto.randomBytes(DELKA_KODU / 2).toString('hex');
}

// ------------------------------------------------------------ webová verze

// Delší strana webové verze. 1600 px pokryje i velký monitor a Retinu
// u fotky na kartě; víc je zbytečné.
export const DELSI_STRANA_PRO_WEB = 1600;

// Jakost JPEG/WebP. 82 je obvyklý kompromis, nad kterým už soubor roste
// rychleji než viditelná kvalita.
const JAKOST = 82;

// produkty/2026-10/abc.jpg -> produkty/2026-10/abc-w1600.jpg
function webovaCesta(cesta) {
  const pripona = path.posix.extname(cesta);
  return `${cesta.slice(0, cesta.length - pripona.length)}-w${DELSI_STRANA_PRO_WEB}${pripona}`;
}

// Formát se zachovává. Převod na WebP je věc fáze 5 a znamenal by druhou
// adresu a <picture> na webu, ne jen jiný zápis souboru.
function vFormatu(obraz, mime) {
  if (mime === 'image/png') return obraz.png({ compressionLevel: 9 });
  if (mime === 'image/webp') return obraz.webp({ quality: JAKOST });
  return obraz.jpeg({ quality: JAKOST, mozjpeg: true, progressive: true });
}

/**
 * Rozměry obrázku tak, jak ho člověk uvidí. Nečitelný obrázek odmítne -
 * magické bajty na začátku souboru totiž projdou i torzu, které se do
 * prohlížeče nahrálo napůl.
 */
async function popisObrazku(bajty) {
  let popis;
  try {
    popis = await sharp(bajty).metadata();
  } catch {
    popis = null;
  }

  // Fotky z mobilu bývají uložené na boku a narovnané až příznakem v EXIF
  // (orientace 5-8). Rozměry "jak to člověk uvidí" jsou tedy prohozené.
  const naBoku = (popis?.orientation ?? 1) >= 5;
  const sirka = naBoku ? popis?.height : popis?.width;
  const vyska = naBoku ? popis?.width : popis?.height;

  if (!sirka || !vyska) {
    throw chybaSpatnyVstup(
      'Obrázek se nepodařilo přečíst — asi se nenahrál celý. Zkus to prosím ještě raz.'
    );
  }
  return { sirka, vyska };
}

/**
 * Webová verze obrázku. Vrací obsah sloupce `varianty`; `{ web: null }`
 * znamená "zmenšovat není co nebo to nešlo" - sloupec pak není NULL, takže
 * se o to údržba nebude pokoušet pořád znovu.
 */
async function vyrobWebovouVerzi(bajty, cesta, mime, { sirka, vyska }) {
  if (Math.max(sirka, vyska) <= DELSI_STRANA_PRO_WEB) {
    // Prohlížeče EXIF orientaci respektují, takže malý originál se dá
    // poslat tak, jak je - další přepsání by jen ubralo kvalitu.
    return { web: null, proc: 'originál je dost malý' };
  }

  try {
    // autoOrient() je tu povinně: zmenšením se EXIF zahodí, a bez narovnání
    // by fotka z mobilu ležela na webu na boku.
    const { data, info } = await vFormatu(
      sharp(bajty)
        .autoOrient()
        .resize({
          width: DELSI_STRANA_PRO_WEB,
          height: DELSI_STRANA_PRO_WEB,
          fit: 'inside',
          withoutEnlargement: true,
        }),
      mime
    ).toBuffer({ resolveWithObject: true });

    const relativni = webovaCesta(cesta);
    const cil = cestaKSouboru(relativni);
    await mkdir(path.dirname(cil), { recursive: true });
    await writeFile(cil, data);

    return {
      web: { cesta: relativni, sirka: info.width, vyska: info.height, velikost_b: info.size },
    };
  } catch (chyba) {
    // Originál je uložený, takže o fotku se nepřijde. Na web se zatím
    // pošle v původní velikosti - lepší než nahrávání odmítnout.
    console.error('[soubory] zmenšení se nepodařilo:', chyba.message);
    return { web: null, proc: `zmenšení selhalo: ${chyba.message}` };
  }
}

// Sloupec `varianty` je v MariaDB LONGTEXT s kontrolou na JSON. Ovladač ho
// dnes vrací už rozbalený, ale spoléhat se na to nebudeme.
function rozbalVarianty(hodnota) {
  if (!hodnota) return null;
  if (typeof hodnota === 'object') return hodnota;
  try {
    return JSON.parse(hodnota);
  } catch {
    return null;
  }
}

/**
 * Co se má doopravdy poslat na web: webová verze, a když není, originál.
 * Vrací vždycky cestu, rozměry a velikost toho, co se posílá.
 */
export function verzeProWeb(soubor) {
  const web = rozbalVarianty(soubor.varianty)?.web;
  if (web?.cesta) {
    return { cesta: web.cesta, sirka: web.sirka, vyska: web.vyska, velikost_b: web.velikost_b };
  }
  return {
    cesta: soubor.cesta,
    sirka: soubor.sirka,
    vyska: soubor.vyska,
    velikost_b: soubor.velikost_b,
  };
}

/**
 * Uloží nahraný obrázek a vrátí záznam z databáze.
 *
 * Stejná fotka nahraná podruhé se neukládá znovu - vrátí se ta původní.
 * Pozná se podle otisku obsahu, ne podle názvu, takže to funguje i když ji
 * majitelka přetáhne z telefonu pod jiným jménem.
 *
 * @param {object} p
 * @param {string} p.obsah       data URL nebo čistý base64
 * @param {string|null} p.nazev  původní jméno souboru (jen pro člověka)
 * @param {string|null} p.alt    popis obrázku
 * @param {number} p.uzivatelId
 * @param {string} [p.podadresar]
 */
export async function ulozSoubor({ obsah, nazev = null, alt = null, uzivatelId, podadresar = 'produkty' }) {
  const base64 = String(obsah ?? '').replace(/^data:[^;]+;base64,/, '');
  if (!base64) throw chybaSpatnyVstup('Soubor je prázdný.');

  let bajty;
  try {
    bajty = Buffer.from(base64, 'base64');
  } catch {
    throw chybaSpatnyVstup('Soubor se nepodařilo přečíst.');
  }
  if (bajty.length === 0) throw chybaSpatnyVstup('Soubor je prázdný.');
  if (bajty.length > MAX_BAJTU) {
    throw chybaSpatnyVstup(
      `Fotka je moc velká (${(bajty.length / 1024 / 1024).toFixed(1)} MB). ` +
        `Maximum je ${MAX_BAJTU / 1024 / 1024} MB — zkus ji v telefonu zmenšit.`
    );
  }

  const typ = rozpoznej(bajty);
  if (!typ) throw chybaSpatnyVstup('Nahrát se dá jen obrázek JPEG, PNG nebo WebP.');

  const otisk = crypto.createHash('sha256').update(bajty).digest('hex');

  // Tatáž fotka už nahraná být může - znovu se neukládá. Smazané se
  // přeskakují, jinak by se "smazaná" fotka vrátila bez souboru na disku.
  const [shodne] = await pool.query(
    'SELECT * FROM soubory WHERE hash_sha256 = ? AND smazano_at IS NULL LIMIT 1',
    [otisk]
  );
  if (shodne[0]) return { ...shodne[0], uzJeNahrany: true };

  // Rozměry se čtou dřív, než se cokoli uloží - torzo souboru se tím odmítne
  // bez toho, aby po něm na disku něco zůstalo.
  const rozmery = await popisObrazku(bajty);

  const mesic = isoDatum(new Date()).slice(0, 7); // 2026-10, podle pražského dne
  const jmeno = `${crypto.randomBytes(16).toString('hex')}.${typ.pripona}`;
  const relativni = path.posix.join(podadresar, mesic, jmeno);
  const kod = novyKod();

  const cil = path.join(config.uploadDir, relativni);
  await mkdir(path.dirname(cil), { recursive: true });
  await writeFile(cil, bajty);

  const varianty = await vyrobWebovouVerzi(bajty, relativni, typ.mime, rozmery);

  const [vysledek] = await pool.query(
    `INSERT INTO soubory
       (kod, cesta, puvodni_nazev, mime, velikost_b, sirka, vyska, varianty,
        alt, zdroj, hash_sha256, nahral_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload', ?, ?)`,
    [
      kod,
      relativni,
      nazev ? String(nazev).slice(0, 255) : null,
      typ.mime,
      bajty.length,
      rozmery.sirka,
      rozmery.vyska,
      JSON.stringify(varianty),
      alt ? String(alt).slice(0, 255) : null,
      otisk,
      uzivatelId ?? null,
    ]
  );

  const [novy] = await pool.query('SELECT * FROM soubory WHERE id = ?', [vysledek.insertId]);
  return { ...novy[0], uzJeNahrany: false };
}

// Absolutní cesta k souboru. Jméno souboru vyrábíme sami, ale kontrola je tu
// i tak - kdyby se do databáze někdy dostala cesta s "..", nesmí vést mimo
// adresář s nahranými soubory.
export function cestaKSouboru(cesta) {
  const cil = path.resolve(config.uploadDir, cesta);
  const koren = path.resolve(config.uploadDir) + path.sep;
  if (!cil.startsWith(koren)) return null;
  return cil;
}

export async function nactiSoubor(id) {
  const [rows] = await pool.query(
    'SELECT * FROM soubory WHERE id = ? AND smazano_at IS NULL',
    [id]
  );
  return rows[0] ?? null;
}

// Veřejné zobrazení chodí podle kódu, ne podle id. Porovnání je díky collation
// sloupce bez ohledu na velikost písmen, ale na entropii to nic nemění: kódy
// jsou vždycky malá hexadecimální písmena a jiný tvar router vůbec nepustí.
export async function nactiSouborPodleKodu(kod) {
  const [rows] = await pool.query(
    'SELECT * FROM soubory WHERE kod = ? AND smazano_at IS NULL',
    [kod]
  );
  return rows[0] ?? null;
}

/**
 * Srovná fotky produktu: pořadí od jedničky a titulní na první.
 *
 * Potřeba je to po odebrání fotky. Kdyby se odebrala zrovna titulní,
 * zůstal by produkt bez ní a na kartě by nebyl obrázek, i když fotky má.
 *
 * @param {object} spojeni  spojení z poolu (běží uvnitř transakce volajícího)
 */
export async function srovnejFotkyProduktu(spojeni, produktId) {
  const [fotky] = await spojeni.query(
    `SELECT f.soubor_id
       FROM produkt_fotky f
       JOIN soubory s ON s.id = f.soubor_id
      WHERE f.produkt_id = ? AND s.smazano_at IS NULL
      ORDER BY f.titulni DESC, f.poradi, f.soubor_id`,
    [produktId]
  );

  for (let i = 0; i < fotky.length; i++) {
    await spojeni.query(
      'UPDATE produkt_fotky SET poradi = ?, titulni = ? WHERE produkt_id = ? AND soubor_id = ?',
      [i + 1, i === 0 ? 1 : 0, produktId, fotky[i].soubor_id]
    );
  }
  return fotky.length;
}

/**
 * Měkké smazání. Soubor na disku zůstává - kdyby se smazalo omylem, jde to
 * vrátit, a tvrdě se uklidí až dávkou, až bude jisté, že na něj nic nevisí.
 */
export async function smazSoubor(id) {
  const [vysledek] = await pool.query(
    'UPDATE soubory SET smazano_at = NOW() WHERE id = ? AND smazano_at IS NULL',
    [id]
  );
  return vysledek.affectedRows > 0;
}

/**
 * Úklid souborů, na kterých nic nevisí. Smazané déle než den a bez vazby
 * na produkt se odstraní i z disku.
 *
 * Bez úklidu by ve volume zůstávaly navždy fotky, které někdo nahrál
 * a pak si to rozmyslel.
 */
/**
 * Dopočítá webové verze fotkám, které je ještě nemají.
 *
 * Potřeba je to dvakrát: jednorázově po zavedení zmenšování (fotky nahrané
 * dřív webovou verzi nemají) a pak u všeho, co do `soubory` přijde mimo
 * nahrávání - třeba při importu fotek ze starého webu (fáze 5).
 *
 * Běží z údržby, takže se o to nikdo nemusí starat ručně; `scripts/prepocitej-fotky.js`
 * je tentýž výpočet, jen hned a s výpisem.
 *
 * @param {number} limit  kolik souborů nejvýš za jedno spuštění
 */
export async function dopocitejChybejiciVarianty(limit = 20) {
  const [rows] = await pool.query(
    `SELECT id, cesta, mime FROM soubory
      WHERE varianty IS NULL AND smazano_at IS NULL AND mime LIKE 'image/%'
      ORDER BY id
      LIMIT ?`,
    [limit]
  );

  let hotovo = 0;
  for (const radek of rows) {
    let sirka = null;
    let vyska = null;
    let varianty;
    try {
      const cesta = cestaKSouboru(radek.cesta);
      if (!cesta) throw new Error('cesta vede mimo adresář s uploady');
      const bajty = await readFile(cesta);
      const rozmery = await popisObrazku(bajty);
      sirka = rozmery.sirka;
      vyska = rozmery.vyska;
      varianty = await vyrobWebovouVerzi(bajty, radek.cesta, radek.mime, rozmery);
    } catch (chyba) {
      // Soubor na disku chybí nebo se nedá přečíst. Zapíšeme to do varianty,
      // ať se o něj údržba nepokouší při každém kole znovu.
      varianty = { web: null, proc: `nepodařilo se přečíst: ${chyba.message}` };
    }

    await pool.query('UPDATE soubory SET sirka = ?, vyska = ?, varianty = ? WHERE id = ?', [
      sirka,
      vyska,
      JSON.stringify(varianty),
      radek.id,
    ]);
    if (varianty.web) hotovo++;
  }
  return hotovo;
}

export async function uklidOsireleSoubory() {
  const [rows] = await pool.query(
    `SELECT s.id, s.cesta, s.varianty
       FROM soubory s
       LEFT JOIN produkt_fotky f ON f.soubor_id = s.id
      WHERE f.soubor_id IS NULL
        AND s.smazano_at IS NOT NULL
        AND s.smazano_at < DATE_SUB(NOW(), INTERVAL 1 DAY)
      LIMIT 500`
  );

  for (const radek of rows) {
    // Z disku musí zmizet i webová verze, jinak by ve volume zůstávala
    // bez souboru, ke kterému patřila.
    const webova = rozbalVarianty(radek.varianty)?.web?.cesta;
    for (const relativni of [radek.cesta, webova].filter(Boolean)) {
      const cesta = cestaKSouboru(relativni);
      if (cesta) await unlink(cesta).catch(() => {});
    }
    await pool.query('DELETE FROM soubory WHERE id = ?', [radek.id]);
  }
  return rows.length;
}
