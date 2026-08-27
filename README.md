# LSD-trip.cz

Web spolku **Letecká společnost dobrodruhů z.s.** — tandemové seskoky, parašutistické kurzy,
expedice a helitour. Letiště Jihlava — Henčov.

Statický web bez build kroku: čisté HTML, CSS a vanilla JS. Hostováno na Netlify.

## Struktura

```
index.html            shell — hlavička, patička, lightbox
assets/css/style.css  kompletní styly včetně responzivních breakpointů
assets/js/data.js     obsahová data (termíny, kurzy, tým, FAQ, …)
assets/js/app.js      router, stav aplikace a renderování stránek
netlify.toml          deploy konfigurace (SPA fallback, hlavičky)
```

## Stránky

Routování běží na hashi, takže web funguje i z `file://`:

| Route | Obsah |
| --- | --- |
| `#/` | Domů — hero, statistiky, produkty, nejbližší termíny, aktuality |
| `#/tandem` | Tandemový seskok — průběh a ceníkové varianty |
| `#/kurzy` | Kurzy a výcvik |
| `#/kalendar` | Kalendář termínů s filtrováním |
| `#/termin/:id` | Detail termínu + výběr počtu osob |
| `#/booking` | Rezervační tok (účastníci → kontakt → platba → hotovo) |
| `#/poukaz` | Dárkový poukaz s živým náhledem |
| `#/expedice` | Expedice & Helitour |
| `#/galerie` | Galerie s lightboxem |
| `#/onas` | O spolku a tým |
| `#/faq` | Časté otázky |
| `#/kontakt` | Kontaktní údaje a formulář |

## Vývoj

Jakýkoli statický server nad kořenem repozitáře:

```bash
python3 -m http.server 8080
```

Pak otevřít <http://localhost:8080>.

## Nasazení

Produkce běží na <https://lsd-trip.netlify.app> (Netlify projekt `lsd-trip`).

Continuous deployment je napojené na GitHub: push do větve `main` spustí build
automaticky. Propojení stojí na read-only deploy klíči v nastavení repozitáře
a webhooku na `api.netlify.com/hooks/github`.

Build nemá žádný krok — Netlify publikuje kořen repozitáře tak, jak je
(`publish = "."` v `netlify.toml`). Ruční deploy mimo git:

```bash
netlify deploy --prod
```

## Responzivita

Breakpointy: `1080px` (přepnutí na hamburger menu), `1024px` (rozpad dvousloupcových
layoutů), `900px` (tabulka kalendáře se mění na karty), `780px`, `560px` a `380px`.
Zvlášť je ošetřena i krajina na nízkých displejích.

## Poznámka

Rezervační a platební tok je prototyp — data se nikam neodesílají a žádná platba
neproběhne. Fotografie se načítají z `www.lsd-trip.cz`.
