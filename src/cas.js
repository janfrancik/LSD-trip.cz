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
// V databázi je všechno v UTC (od migrace 005). "2026-09-27 20:49:00" z DATETIME
// je tedy okamžik v UTC, stejně jako Date nebo ISO řetězec se zónou - všechno
// se sem dá poslat a ven vypadne pražský čas, včetně letního.
//
// Proč UTC v databázi: pražský čas "na hodinách" je nejednoznačný. Poslední
// říjnovou neděli proběhne hodina 2:00-3:00 dvakrát, takže "2026-10-25 02:30:00"
// jsou dva různé okamžiky vzdálené hodinu. U držení rezervace, splatností
// a pořadí plateb je to chyba, kterou už nejde opravit.

export const ZONA = 'Europe/Prague';

const MESICE = [
  'ledna', 'února', 'března', 'dubna', 'května', 'června',
  'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
];

// DATE i DATETIME z databáze (bez zóny = UTC), s nepovinnými sekundami a zlomky.
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

  const datum = zTextu(String(hodnota).trim());
  return datum ? zOkamziku(datum) : null;
}

// Řetězec na okamžik. Tvar z databáze nemá zónu a je v UTC - bez doplněného
// "Z" by ho prohlížeč i Node četly jako místní čas stroje.
function zTextu(text) {
  const zDb = text.match(DB_TVAR);
  const datum = zDb
    ? new Date(
        `${zDb[1]}-${zDb[2]}-${zDb[3]}T${zDb[4] ?? '00'}:${zDb[5] ?? '00'}:${zDb[6] ?? '00'}Z`
      )
    : new Date(text);
  return Number.isNaN(datum.getTime()) ? null : datum;
}

/**
 * Okamžik na ose času - pro počítání rozdílů ("před 5 minutami") a porovnávání.
 * Hodnotu z databáze bere jako pražský čas na hodinách, ne jako UTC.
 */
export function okamzik(hodnota) {
  if (hodnota == null || hodnota === '') return null;
  if (hodnota instanceof Date) return Number.isNaN(hodnota.getTime()) ? null : hodnota;
  if (typeof hodnota === 'number') return new Date(hodnota);
  return zTextu(String(hodnota).trim());
}

// Čas pro zápis do databáze: "YYYY-MM-DD HH:MM:SS" v UTC. Ovladač si s Date
// poradí sám, tohle je pro místa, kde se čas skládá do řetězce.
export function proDb(hodnota = new Date()) {
  const datum = okamzik(hodnota);
  return datum ? datum.toISOString().slice(0, 19).replace('T', ' ') : null;
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

// ------------------------------------------------ kalendářní dny (bez zóny)
//
// Termíny na letišti jsou dny na kalendáři, ne okamžiky na ose času: "17. 5."
// je 17. 5. bez ohledu na zónu. Počítá se proto nad UTC půlnocemi - posouvání
// po 24 hodinách v místní zóně by na přechodu letního času den přeskočilo
// nebo zopakovalo. Tyhle funkce berou i vracejí "YYYY-MM-DD".

function pulnoc(iso) {
  const cas = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(cas) ? null : cas;
}

const DEN_MS = 24 * 60 * 60 * 1000;

// ISO číslování: 1 = pondělí … 7 = neděle.
export function denVTydnu(iso) {
  const cas = pulnoc(iso);
  if (cas === null) return null;
  const den = new Date(cas).getUTCDay();
  return den === 0 ? 7 : den;
}

export function oDniDal(iso, dni = 1) {
  const cas = pulnoc(iso);
  if (cas === null) return iso;
  return new Date(cas + dni * DEN_MS).toISOString().slice(0, 10);
}

// Délka rozsahu ve dnech včetně obou krajů.
export function pocetDni(od, doKdy) {
  const zacatek = pulnoc(od);
  const konec = pulnoc(doKdy);
  if (zacatek === null || konec === null) return 0;
  return Math.floor((konec - zacatek) / DEN_MS) + 1;
}

/**
 * Data v rozsahu, případně jen vybrané dny v týdnu.
 *
 * @param {string} od     "2026-05-01"
 * @param {string} doKdy  "2026-06-30"
 * @param {number[]} dny  1 = pondělí … 7 = neděle; prázdné = všechny dny
 */
export function datumyVRozsahu(od, doKdy, dny = []) {
  const vybrane = new Set(dny);
  const vysledek = [];
  const zacatek = pulnoc(od);
  const konec = pulnoc(doKdy);
  if (zacatek === null || konec === null || konec < zacatek) return vysledek;

  for (let cas = zacatek; cas <= konec; cas += DEN_MS) {
    const den = new Date(cas).toISOString().slice(0, 10);
    if (vybrane.size && !vybrane.has(denVTydnu(den))) continue;
    vysledek.push(den);
  }
  return vysledek;
}
