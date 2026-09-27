// src/cas.js
//
// Jediné místo, kde se v projektu formátují data a časy. Platí pro administraci,
// e-maily, exporty i doklady: **vždy Europe/Prague**, vždy české formáty.
//
// Proč to má vlastní modul: v exportu akceptace se objevil čas vygenerování
// v UTC vedle časů z databáze v pražském čase, takže souhrn tvrdil, že vznikl
// hodinu před testy, které popisuje. Dokud si každé místo formátovalo čas samo,
// byla to otázka času, kdy se to stane zas.
//
// Tenhle soubor běží v Node i v prohlížeči (administrace si ho načítá jako
// /admin/assets/js/cas.js, viz src/app.js), takže nesmí nic importovat.
//
// Dva druhy vstupu, dvojí zacházení:
//   1. "2026-09-27 22:49:00" z databáze - DATETIME bez zóny. Aplikace i databáze
//      běží v Europe/Prague, takže je to pražský čas na hodinách. Nepřepočítává
//      se, jen se přeskládá - výsledek je proto stejný i na stroji v jiné zóně.
//   2. Date nebo ISO řetězec se zónou ("2026-09-27T20:49:00Z") - okamžik na ose
//      času. Ten se do pražského času převede přes Intl, včetně letního času.

export const ZONA = 'Europe/Prague';

const MESICE = [
  'ledna', 'února', 'března', 'dubna', 'května', 'června',
  'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
];

// DATE i DATETIME z databáze, s nepovinnými sekundami a zlomky.
const DB_TVAR = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/;

const formatovac = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

function zOkamziku(datum) {
  const casti = {};
  for (const { type, value } of formatovac.formatToParts(datum)) casti[type] = value;
  return {
    rok: Number(casti.year),
    mesic: Number(casti.month),
    den: Number(casti.day),
    // Půlnoc hlásí některé prohlížeče jako 24, ne 00.
    hodina: Number(casti.hour) % 24,
    minuta: Number(casti.minute),
    sekunda: Number(casti.second),
  };
}

/**
 * Rozloží hodnotu na pražské datum a čas. Vrací null, když hodnota není datum -
 * volající pak vypíše pomlčku, místo aby ukázal "Invalid Date".
 */
export function slozky(hodnota) {
  if (hodnota == null || hodnota === '') return null;

  if (hodnota instanceof Date) {
    return Number.isNaN(hodnota.getTime()) ? null : zOkamziku(hodnota);
  }

  if (typeof hodnota === 'number') return zOkamziku(new Date(hodnota));

  const text = String(hodnota).trim();
  const zDb = text.match(DB_TVAR);
  if (zDb) {
    return {
      rok: Number(zDb[1]),
      mesic: Number(zDb[2]),
      den: Number(zDb[3]),
      hodina: Number(zDb[4] ?? 0),
      minuta: Number(zDb[5] ?? 0),
      sekunda: Number(zDb[6] ?? 0),
    };
  }

  const datum = new Date(text);
  return Number.isNaN(datum.getTime()) ? null : zOkamziku(datum);
}

/**
 * Okamžik na ose času - pro počítání rozdílů ("před 5 minutami") a porovnávání.
 * Hodnotu z databáze bere jako pražský čas na hodinách, ne jako UTC.
 */
export function okamzik(hodnota) {
  if (hodnota instanceof Date) return Number.isNaN(hodnota.getTime()) ? null : hodnota;
  if (typeof hodnota === 'number') return new Date(hodnota);

  const casti = slozky(hodnota);
  if (!casti) return null;

  const text = String(hodnota).trim();
  if (!DB_TVAR.test(text)) return new Date(text);

  // Pražský čas na hodinách → okamžik. Posun se hledá ve dvou krocích: první
  // odhad může spadnout na jinou stranu přechodu letního času, druhý už ne.
  const jakoUtc = Date.UTC(
    casti.rok, casti.mesic - 1, casti.den, casti.hodina, casti.minuta, casti.sekunda
  );
  let vysledek = jakoUtc - posunMs(new Date(jakoUtc));
  vysledek = jakoUtc - posunMs(new Date(vysledek));
  return new Date(vysledek);
}

// O kolik jdou pražské hodiny napřed proti UTC v daném okamžiku.
function posunMs(okamzikUtc) {
  const c = zOkamziku(okamzikUtc);
  const prazskeJakoUtc = Date.UTC(c.rok, c.mesic - 1, c.den, c.hodina, c.minuta, c.sekunda);
  // Sekundy zaokrouhlené na celé - milisekundy Intl nevrací.
  return prazskeJakoUtc - Math.floor(okamzikUtc.getTime() / 1000) * 1000;
}

// ------------------------------------------------------------------ formáty

export function datum(hodnota) {
  const c = slozky(hodnota);
  return c ? `${c.den}. ${c.mesic}. ${c.rok}` : '—';
}

export function datumSlovy(hodnota) {
  const c = slozky(hodnota);
  return c ? `${c.den}. ${MESICE[c.mesic - 1]} ${c.rok}` : '—';
}

export function cas(hodnota) {
  const c = slozky(hodnota);
  return c ? `${c.hodina}:${String(c.minuta).padStart(2, '0')}` : '—';
}

export function datumCas(hodnota) {
  const c = slozky(hodnota);
  return c ? `${datum(hodnota)} ${cas(hodnota)}` : '—';
}

// Strojový tvar pro názvy souborů a cesty - taky v pražském dni, aby soubor
// z 1:00 v noci nespadl do včerejška.
export function isoDatum(hodnota) {
  const c = slozky(hodnota);
  if (!c) return '';
  const dvojmistne = (n) => String(n).padStart(2, '0');
  return `${c.rok}-${dvojmistne(c.mesic)}-${dvojmistne(c.den)}`;
}

export function isoDatumCas(hodnota) {
  const c = slozky(hodnota);
  if (!c) return '';
  const dvojmistne = (n) => String(n).padStart(2, '0');
  return `${isoDatum(hodnota)} ${dvojmistne(c.hodina)}:${dvojmistne(c.minuta)}:${dvojmistne(c.sekunda)}`;
}

// "před 5 minutami" - v seznamech se čte líp než přesné datum.
export function pred(hodnota, ted = new Date()) {
  const kdy = okamzik(hodnota);
  if (!kdy) return '—';

  const sekundy = Math.floor((ted.getTime() - kdy.getTime()) / 1000);
  if (sekundy < 0) return datumCas(hodnota);
  if (sekundy < 60) return 'právě teď';

  const minuty = Math.floor(sekundy / 60);
  if (minuty < 60) return `před ${minuty} ${sklon(minuty, 'minutou', 'minutami', 'minutami')}`;

  const hodiny = Math.floor(minuty / 60);
  if (hodiny < 24) return `před ${hodiny} ${sklon(hodiny, 'hodinou', 'hodinami', 'hodinami')}`;

  const dny = Math.floor(hodiny / 24);
  if (dny === 1) return 'včera';
  if (dny < 7) return `před ${dny} dny`;
  return datum(hodnota);
}

export function sklon(pocet, jeden, dva, vic) {
  if (pocet === 1) return jeden;
  if (pocet >= 2 && pocet <= 4) return dva;
  return vic;
}
