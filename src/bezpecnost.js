// src/bezpecnost.js
//
// Bezpečnostní hlavičky a robots.txt.
//
// CSP je postavená na dnešní podobu webu: v app.js se hojně používají atributy
// style="...", takže style-src potřebuje 'unsafe-inline'. Inline <script> na
// webu ani v administraci není, script-src proto zůstává jen 'self'.
// Fotky se do fáze 5 načítají ze starého webu, po migraci se z img-src vypustí.

import helmet from 'helmet';
import config from './config.js';

// Odkud se smí načítat obrázky. Starý web je tu jen do migrace fotek (fáze 5).
const ZDROJE_OBRAZKU = ["'self'", 'data:', 'https://www.lsd-trip.cz'];

export function bezpecnostniHlavicky() {
  const csp = helmet.contentSecurityPolicy({
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ZDROJE_OBRAZKU,
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      ...(config.jeHttps ? { upgradeInsecureRequests: [] } : {}),
    },
  });

  const zaklad = helmet({
    contentSecurityPolicy: false, // nastavujeme vlastní výše
    crossOriginEmbedderPolicy: false, // blokovalo by fotky ze starého webu
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: config.jeHttps ? { maxAge: 31536000, includeSubDomains: true } : false,
  });

  return [
    zaklad,
    csp,
    (req, res, next) => {
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
      // Na testovacím prostředí se nesmí nic dostat do vyhledávačů. Samotný
      // robots.txt nestačí - spolehlivě to zajistí až tahle hlavička.
      if (config.ROBOTS === 'zakazat') {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      }
      // Administrace není obsah pro vyhledávače nikdy, ani v produkci.
      if (req.path.startsWith('/admin') || req.path.startsWith('/api')) {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      }
      next();
    },
  ];
}

// robots.txt se generuje, ne aby ležel jako soubor - jinak by se na testu
// zapomněl a prostředí by se dostalo do Google.
//
// AI crawlery se povolují výslovně: některé se neřídí obecným User-agent: *,
// takže mlčení by pro ně znamenalo "nevím" a obsah spolku by v odpovědích
// asistentů chyběl. Úplný seznam a zdůvodnění je v docs/plan-administrace.md.
const AI_CRAWLERY = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
  'meta-externalagent',
];

export function robotsTxt(req, res) {
  res.type('text/plain; charset=utf-8');

  if (config.ROBOTS === 'zakazat') {
    return res.send(
      ['# Testovací prostředí - nic z něj nesmí do vyhledávačů.', 'User-agent: *', 'Disallow: /', ''].join('\n')
    );
  }

  const radky = ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /api', ''];
  for (const bot of AI_CRAWLERY) {
    radky.push(`User-agent: ${bot}`, 'Allow: /', 'Disallow: /admin', 'Disallow: /api', '');
  }
  radky.push(`Sitemap: ${config.url('/sitemap.xml')}`, '');

  res.send(radky.join('\n'));
}
