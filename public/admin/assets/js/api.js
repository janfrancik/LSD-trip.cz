// public/admin/assets/js/api.js
//
// Komunikace s API. Ke každému zápisu přidává hlavičku X-CSRF-Token z cookie
// (double-submit ochrana) a chyby převádí na výjimku s českou zprávou a
// detaily po polích, aby je formulář mohl ukázat u vstupů.

export class ChybaApi extends Error {
  constructor(status, zprava, detaily, data = null) {
    super(zprava);
    this.status = status;
    this.detaily = detaily ?? null;
    // Celé tělo odpovědi - server u některých chyb posílá i příznaky
    // (např. potrebaTotp u přihlášení), které klient potřebuje.
    this.data = data;
  }
}

function cookie(nazev) {
  const nalez = document.cookie
    .split('; ')
    .find((c) => c.startsWith(nazev + '='));
  return nalez ? decodeURIComponent(nalez.slice(nazev.length + 1)) : null;
}

async function zavolej(metoda, cesta, telo) {
  const hlavicky = {};
  if (telo !== undefined) hlavicky['Content-Type'] = 'application/json';
  if (metoda !== 'GET') {
    const csrf = cookie('lsd_csrf');
    if (csrf) hlavicky['X-CSRF-Token'] = csrf;
  }

  let odpoved;
  try {
    odpoved = await fetch('/api/admin' + cesta, {
      method: metoda,
      headers: hlavicky,
      credentials: 'same-origin',
      body: telo === undefined ? undefined : JSON.stringify(telo),
    });
  } catch {
    throw new ChybaApi(0, 'Nepodařilo se spojit se serverem. Zkontroluj připojení.');
  }

  if (odpoved.status === 204) return null;

  let data = null;
  try {
    data = await odpoved.json();
  } catch {
    // Prázdné nebo nečitelné tělo - chybu složíme ze stavu.
  }

  if (!odpoved.ok) {
    throw new ChybaApi(
      odpoved.status,
      data?.chyba ?? `Server odpověděl chybou ${odpoved.status}.`,
      data?.detaily,
      data
    );
  }
  return data;
}

export const api = {
  get: (cesta) => zavolej('GET', cesta),
  post: (cesta, telo = {}) => zavolej('POST', cesta, telo),
  patch: (cesta, telo = {}) => zavolej('PATCH', cesta, telo),
  del: (cesta) => zavolej('DELETE', cesta),
};

// Query string z objektu - vynechá prázdné hodnoty, ať v adrese nezůstávají
// prázdné parametry.
export function dotaz(parametry) {
  const usp = new URLSearchParams();
  for (const [klic, hodnota] of Object.entries(parametry)) {
    if (hodnota === undefined || hodnota === null || hodnota === '') continue;
    usp.set(klic, String(hodnota));
  }
  const text = usp.toString();
  return text ? '?' + text : '';
}
