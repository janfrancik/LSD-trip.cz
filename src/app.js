// src/app.js
//
// Sestavení aplikace. Oddělené od src/server.js, aby se dala v testech
// nastartovat na náhodném portu bez vedlejších efektů (údržba, signály).

import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ChybaApi } from './chyby.js';
import { bezpecnostniHlavicky, robotsTxt } from './bezpecnost.js';
import { limitVerejneApi } from './auth/limit.js';
import { zajistiCsrfToken } from './auth/csrf.js';
import verejneApi from './api/verejne.js';
import adminApi from './api/admin/index.js';
import mediaApi from './api/media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const adminDir = path.join(publicDir, 'admin');

export function vytvorApp() {
  const app = express();

  // Za reverse proxy (Caddy) potřebujeme skutečnou IP klienta - jinak by rate
  // limity i audit viděly pořád jednu adresu proxy.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(bezpecnostniHlavicky());
  app.use(cookieParser());

  // Limit těla: administrace posílá jen formuláře, nic velkého. Výjimkou je
  // nahrání snímku obrazovky v akceptaci - obrázek jde jako base64 v JSON,
  // takže potřebuje vyšší limit. Limit je proto na cestě, ne globální; kdyby
  // byl globální, dal by se každý endpoint zahltit osmimegovým tělem.
  const teloMale = express.json({ limit: '100kb' });
  const teloSObrazkem = express.json({ limit: '8mb' });
  // Fotky kurzů jdou rovnou z mobilu a bývají větší než snímek obrazovky.
  // Base64 navíc nafoukne obsah o třetinu, takže 10MB fotka potřebuje 14MB tělo.
  const teloSFotkou = express.json({ limit: '14mb' });
  const VELKE_TELO = new Map([
    ['/api/admin/akceptace/prilohy', teloSObrazkem],
    ['/api/admin/soubory', teloSFotkou],
  ]);
  app.use((req, res, next) => (VELKE_TELO.get(req.path) ?? teloMale)(req, res, next));

  // ---------------------------------------------------------------------- API

  app.use('/robots.txt', robotsTxt);
  // Obrázky mimo /api - krátká adresa a žádný rate limit (viz api/media.js).
  app.use('/media', mediaApi);
  app.use('/api/admin', adminApi);
  app.use('/api', limitVerejneApi, verejneApi);

  // Neznámé /api/* cesty vracejí JSON, ne HTML shell.
  app.use('/api', (req, res) => {
    res.status(404).json({ chyba: 'Neznámý endpoint.' });
  });

  // ------------------------------------------------------------- administrace

  // Formátování času má celý projekt na jednom místě (src/cas.js) - server
  // i prohlížeč. Administrace i veřejný web si ten samý soubor načtou jako
  // modul odsud; kopie v public/ by se dřív nebo později rozešla se serverovou
  // verzí a v exportu by zase svítil čas z jiné zóny.
  //
  // Veřejný web ho potřebuje kvůli jediné věci: "který den je dnes v Praze",
  // aby nenabízel termíny, které už proběhly. Vlastní výpočet nad UTC by
  // kolem půlnoci ukázal včerejšek.
  for (const cesta of ['/admin/assets/js/cas.js', '/assets/js/cas.js']) {
    app.get(cesta, (req, res) => {
      res.type('application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(rootDir, 'src', 'cas.js'));
    });
  }

  // Administrace je samostatná aplikace na /admin. Routuje se na cestě, takže
  // každá podcesta musí vrátit její shell - a CSRF cookie s ním, aby první
  // požadavek z prohlížeče už měl s čím pracovat.
  // no-cache neznamená "necachovat", ale "před použitím se zeptej serveru".
  // Bez toho může prohlížeč po nasazení chvíli používat staré moduly a míchat
  // starý kód s novými daty.
  app.use(
    '/admin',
    express.static(adminDir, {
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
    })
  );
  app.get(/^\/admin(\/.*)?$/, (req, res) => {
    zajistiCsrfToken(req, res);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(adminDir, 'index.html'));
  });

  // ------------------------------------------------------------- veřejný web

  app.use(express.static(publicDir));

  // Statické návrhy pro majitelku: složka navrh_2/ se servíruje na /navrh-2/.
  // Další návrh stačí přidat jako složku navrh_3/ s vlastním index.html,
  // nic se nikde nenastavuje.
  function najdiNavrhy() {
    return fs
      .readdirSync(rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^navrh_\d+$/.test(entry.name))
      .map((entry) => ({
        dir: path.join(rootDir, entry.name),
        cesta: '/' + entry.name.replace('_', '-'),
      }))
      .filter((navrh) => fs.existsSync(path.join(navrh.dir, 'index.html')))
      .sort((a, b) => a.cesta.localeCompare(b.cesta));
  }

  for (const navrh of najdiNavrhy()) {
    // Bez koncového lomítka by relativní cesty k assets mířily do rootu,
    // kde leží návrh 1 - proto přesměrování na /navrh-N/. Express matchuje
    // i variantu s lomítkem, tu musíme pustit dál, jinak vznikne smyčka.
    app.get(navrh.cesta, (req, res, next) => {
      if (req.path.endsWith('/')) return next();
      res.redirect(navrh.cesta + '/');
    });

    app.use(navrh.cesta, express.static(navrh.dir));

    // Neznámá podcesta vrátí shell daného návrhu, ne návrh 1.
    app.get(`${navrh.cesta}/*`, (req, res) => {
      res.sendFile(path.join(navrh.dir, 'index.html'));
    });

    console.log(`Návrh ${navrh.cesta}/ se servíruje z ${path.basename(navrh.dir)}/`);
  }

  // Zbytek obsluhuje shell webu - ten dnes routuje na hashi. Serverové
  // renderování podle cesty přijde ve fázi 2.
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // -------------------------------------------------------------- chybování

  app.use((err, req, res, next) => {
    if (err instanceof ChybaApi) {
      return res.status(err.status).json({
        chyba: err.message,
        ...(err.detaily ? { detaily: err.detaily } : {}),
      });
    }

    // Tělo požadavku, které není platný JSON, hlásí express jako SyntaxError.
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ chyba: 'Neplatný formát požadavku.' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ chyba: 'Požadavek je příliš velký.' });
    }

    console.error(`[${req.method} ${req.originalUrl}]`, err);
    res.status(500).json({ chyba: 'Někde se to zadrhlo. Zkus to znovu, nebo se ozvi správci.' });
  });

  return app;
}
