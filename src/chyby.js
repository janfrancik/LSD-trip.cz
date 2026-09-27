// src/chyby.js
//
// Chybové zprávy vidí netechnický člověk na letišti z mobilu, takže musí být
// česky a k věci. ChybaApi je jediný způsob, jak z API vrátit chybu se
// smysluplným textem; všechno ostatní skončí jako obecná 500 a do logu.

export class ChybaApi extends Error {
  constructor(status, zprava, detaily = null) {
    super(zprava);
    this.name = 'ChybaApi';
    this.status = status;
    this.detaily = detaily;
  }
}

export const chybaSpatnyVstup = (zprava, detaily) => new ChybaApi(400, zprava, detaily);
export const chybaNeprihlasen = (zprava = 'Nejsi přihlášen.') => new ChybaApi(401, zprava);
export const chybaBezOpravneni = (zprava = 'Na tuhle akci nemáš oprávnění.') => new ChybaApi(403, zprava);
export const chybaNenalezeno = (zprava = 'Nenalezeno.') => new ChybaApi(404, zprava);
export const chybaKonflikt = (zprava, detaily) => new ChybaApi(409, zprava, detaily);
export const chybaPrilisMnoho = (zprava = 'Příliš mnoho požadavků, zkus to za chvíli.') =>
  new ChybaApi(429, zprava);

// Obal asynchronního handleru - bez něj by odmítnutý Promise spadl mimo
// Express a spojení by zůstalo viset.
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
