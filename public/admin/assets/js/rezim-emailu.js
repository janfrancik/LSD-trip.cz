// Jediné místo, kde se popisuje režim odesílání e-mailů.
//
// Dřív si každá obrazovka psala vlastní větu a chyběl v nich `jen_provoz` -
// detail poptávky na produkci tvrdil „odpověď odejde na testovací adresu",
// přestože žádný přepis neběžel a odpověď neodcházela vůbec. Proto je text
// na jednom místě a chybějící režim se pozná hned: `REZIMY[rezim]` je
// `undefined` a funkce vrátí opatrnou větu, ne vymyšlenou.

const REZIMY = {
  live: {
    nazev: 'ostrý provoz',
    // Jediná situace, kdy e-mail opravdu dojde zákazníkovi.
    odesilaSe: true,
    varovani: null,
    tlacitko: 'Odeslat odpověď',
  },
  jen_provoz: {
    nazev: 'jen upozornění provozu',
    odesilaSe: false,
    varovani:
      'Zákazníkům se e-maily zatím neposílají — odesílací služba nemá ověřenou doménu. ' +
      'Odpověď se uloží k poptávce, ale sama nikam neodejde.',
    tlacitko: 'Uložit odpověď',
  },
  test: {
    nazev: 'testovací (přesměrováno)',
    // E-mail se opravdu odešle, jen jinam. Tlačítko „Odeslat" tu proto dává
    // smysl - a varování řekne, že to nedojde zákazníkovi.
    odesilaSe: true,
    varovani: 'Testovací režim: odpověď odejde na testovací adresu, ne zákazníkovi.',
    tlacitko: 'Odeslat odpověď',
  },
  schranka: {
    nazev: 'testovací schránka',
    odesilaSe: false,
    varovani:
      'Testovací schránka: odpověď se uloží do administrace (E-maily), ' +
      'zákazníkovi nikam neodejde.',
    tlacitko: 'Uložit odpověď do schránky',
  },
  vypnuto: {
    nazev: 'odesílání vypnuté',
    odesilaSe: false,
    varovani:
      'Odesílání e-mailů je vypnuté. Odpověď se uloží k poptávce, ale zákazníkovi ' +
      'nikam neodejde — pošli mu ji zatím jinudy.',
    tlacitko: 'Uložit odpověď (e-mail neodejde)',
  },
};

// Neznámý režim nesmí skončit tím, že se ukáže text jiného režimu. Radši
// opatrná věta, než tvrzení, které neplatí.
const NEZNAMY = {
  nazev: 'neznámý režim',
  odesilaSe: false,
  varovani: 'Nastavení odesílání e-mailů tahle verze administrace nezná. Načti stránku znovu.',
  tlacitko: 'Uložit odpověď',
};

export function rezimEmailu(rezim) {
  return REZIMY[rezim] ?? NEZNAMY;
}

export function popisRezimu(rezim) {
  return rezimEmailu(rezim).nazev;
}

/**
 * Odešle se v tomhle režimu zákaznický e-mail vůbec?
 *
 * Pozor na rozdíl: v režimu "test" se odešle, ale na testovací adresu - tedy
 * NE skutečnému zákazníkovi. Tahle funkce odpovídá serverovému
 * config.muzeZakaznikovi, aby administrace nenabízela "Odeslat" tam, kde
 * server stejně nic nepošle. Jestli to dojde i zákazníkovi, říká "varovani".
 */
export function odesilaSe(rezim) {
  return rezimEmailu(rezim).odesilaSe;
}
