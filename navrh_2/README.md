# Návrh 2

Statický náhled pro majitelku — jedna z variant vizuálu LSD-trip.cz.

Zdroj: Claude Design, projekt `57f571eb-9bfa-44f2-b0e5-b0671500aca0`,
soubory `LSD Trip v2.dc.html` + `support.js`.

**Tohle není produkce.** Web zůstává návrh 1 v `public/` na rootu; tenhle
návrh je dostupný jen na `/navrh-2/` a nic na něj odnikud neodkazuje.

Až se majitelka rozhodne, buď složku smažeme, nebo se její obsah překlopí
do `public/` a teprve tím se stane produkcí.

## Obsah složky

```
index.html                 shell — horní lišta, hlavička, patička, modál, lightbox
assets/css/style.css       kompletní styly včetně responzivních breakpointů
assets/js/data.js          obsahová data (termíny, kurzy, tým, FAQ, …)
assets/js/app.js           router, stav aplikace a renderování stránek
LSD Trip v2.dc.html        původní návrh z Claude Design (jen jako předloha)
support.js                 runtime Claude Designu k předloze (nepoužívá se)
```

Stejná struktura jako v `public/`, takže překlopení do produkce je pouhé
zkopírování `index.html` a `assets/`.

## Jak se to liší od návrhu 1

Návrh 1 (`public/`) je tmavý, s kondenzovaným písmem Oswald a syrovějším
výrazem. Návrh 2 je světlý: bílé karty na šedém pozadí, oranžový akcent
`#FF4D1C`, tmavě modrá `#0F1B2D` a písmo Plus Jakarta Sans. Navíc má horní
kontaktní lištu s odkazem do členské sekce a rozcestník „Proč s námi“
se statistikami.

Obsah i rozsah stránek jsou v obou návrzích stejné, aby se daly poctivě
porovnat.

## Prohlížení

Aplikace složku servíruje sama na `/navrh-2/` — stačí spustit `npm run dev`
a otevřít <http://127.0.0.1:3000/navrh-2/>. Nasazená verze žije na
<https://lsd.francik.eu/navrh-2/>.

Mapování `navrh_N/` → `/navrh-N/` obstarává `src/server.js` obecně, takže
další návrh stačí přidat jako složku `navrh_3/` s vlastním `index.html`.

Stránka běží na hashi, takže funguje i po otevření `index.html` přímo
z disku — fotografie se ale načítají z `www.lsd-trip.cz`.

## Stránky

| Route | Obsah |
| --- | --- |
| `#/` | Domů — hero, produkty, tandem, kurzy, termíny, proč s námi, aktuality |
| `#/tandem` | Tandemový seskok — průběh a ceníkové varianty |
| `#/kurzy` | Kurzy a výcvik |
| `#/kalendar` | Kalendář termínů s filtrováním |
| `#/termin/:id` | Detail termínu + výběr počtu osob |
| `#/booking` | Rezervační tok (účastníci → kontakt → platba → hotovo) |
| `#/poukaz` | Dárkový poukaz s živým náhledem |
| `#/expedice` | Expedice a helitour |
| `#/galerie` | Galerie s lightboxem |
| `#/onas` | O spolku a tým |
| `#/faq` | Časté otázky |
| `#/kontakt` | Kontaktní údaje a formulář |

## Poznámka

Rezervační i platební tok je prototyp — data se nikam neodesílají a žádná
platba neproběhne. U termínu bez ceny se tok přepne na nezávaznou poptávku.
