/* ==========================================================================
   LSD — obsahová data webu
   ========================================================================== */

(function (global) {
  'use strict';

  var IMG = {
    hero:      'https://www.lsd-trip.cz/image/eshop/1512969318_image_gopr3595_00_00_49_00_49.jpg',
    tandem:    'https://www.lsd-trip.cz/image/eshop/1512893393_image_img_5635ab.jpeg',
    tandemCam: 'https://www.lsd-trip.cz/image/eshop/1512969318_image_gopr3595_00_00_49_00_49.jpg',
    vycvik:    'https://www.lsd-trip.cz/image/eshop/1512986228_image_vlcsnap-2017-04-02-20h56m57s323.png',
    iaff:      'https://www.lsd-trip.cz/image/carousel/1652266303_1_image_28350.jpg',
    zv:        'https://www.lsd-trip.cz/image/carousel/1512896173_1_image_zv2.jpg'
  };

  var GAL = [
    '1696490824_image_vlcsnap-2023-09-23-16h51m19s209.png',
    '1696490816_image_vlcsnap-2023-09-23-16h46m51s665.png',
    '1696490807_image_vlcsnap-2023-09-23-16h35m47s333.png',
    '1696490793_image_vlcsnap-2023-09-23-16h32m56s778.png',
    '1696490745_image_vlcsnap-2023-09-23-16h31m16s031.png',
    '1696490733_image_vlcsnap-2023-09-23-16h28m39s835.png',
    '1696490725_image_vlcsnap-2023-09-23-16h27m22s452.png',
    '1696490715_image_vlcsnap-2023-09-23-16h25m54s629.png',
    '1696490704_image_vlcsnap-2023-09-23-16h23m56s545.png',
    '1696490696_image_vlcsnap-2023-09-23-16h23m23s758.png'
  ].map(function (f) { return 'https://www.lsd-trip.cz/image/gallery/' + f; });

  var TERMINY = [
    {
      id: 904, kind: 'kurz', type: 'Parašutistický výcvik',
      date: '4. 9. 2026', day: 'pátek', time: 'teorie od 10:00',
      place: 'Jihlava — Henčov', taken: 7, max: 10, price: 4600, img: IMG.vycvik,
      desc: 'Zahájení základního výcviku: teorie od 10:00, první seskok v sobotu ráno. Kurz obsahuje zákonem požadovanou výuku dle osnov V-PARA 1 a V-PARA 2, rozšířenou o praktický nácvik na hangáru.'
    },
    {
      id: 900, kind: 'tandem', type: 'Tandem',
      date: '4. 9. 2026', day: 'pátek', time: 'starty od 13:30',
      place: 'Jihlava — Henčov', taken: 16, max: 16, price: 4700, img: IMG.tandem,
      desc: 'Tandemové seskoky z 4 000 metrů. Na letišti počítej se dvěma až třemi hodinami — instruktáž, postroj, nástup, seskok, video.'
    },
    {
      id: 893, kind: 'tandem', type: 'Tandem',
      date: '5. 9. 2026', day: 'sobota', time: 'starty 7:30 — 15:00',
      place: 'Jihlava — Henčov', taken: 24, max: 24, price: 4700, img: IMG.tandem,
      desc: 'Hlavní sobotní provoz. V 15:30 navíc seskok nad Křižanovem.'
    },
    {
      id: 899, kind: 'tandem', type: 'Tandem',
      date: '6. 9. 2026', day: 'neděle', time: 'starty od 9:00',
      place: 'Jihlava — Henčov', taken: 24, max: 24, price: 4700, img: IMG.tandem,
      desc: 'Nedělní provoz, klidnější vzduch a nejlepší viditelnost do Vysočiny.'
    },
    {
      id: 901, kind: 'tandem', type: 'Tandem',
      date: '18. 9. 2026', day: 'pátek', time: 'starty od 14:00',
      place: 'Jihlava — Henčov', taken: 1, max: 8, price: 4700, img: IMG.tandemCam,
      desc: 'Odpolední blok s nejlepším světlem pro kameru. Ideální termín, pokud chceš video s externím kameramanem.'
    },
    {
      id: 902, kind: 'tandem', type: 'Tandem',
      date: '19. 9. 2026', day: 'sobota', time: 'starty od 8:30',
      place: 'Jihlava — Henčov', taken: 18, max: 24, price: 4700, img: IMG.tandem,
      desc: 'Celodenní provoz. Doprovod má vstup na letiště zdarma.'
    },
    {
      id: 903, kind: 'tandem', type: 'Tandem',
      date: '20. 9. 2026', day: 'neděle', time: 'starty od 8:30',
      place: 'Jihlava — Henčov', taken: 12, max: 16, price: 4700, img: IMG.tandem,
      desc: 'Poslední nedělní blok v září.'
    },
    {
      id: 910, kind: 'kurz', type: 'Kurz IAFF s větrným tunelem',
      date: '2. 10. 2026', day: 'pátek', time: 'start 9:00',
      place: 'Jihlava + tunel Praha', taken: 3, max: 6, price: 0, img: IMG.iaff,
      desc: 'Zrychlený výcvik volného pádu s přípravou ve větrném tunelu. Cena podle rozsahu tunelových minut — potvrdíme e-mailem.'
    }
  ];

  var NAV = [
    { label: 'Tandem',   route: 'tandem'   },
    { label: 'Kurzy',    route: 'kurzy'    },
    { label: 'Kalendář', route: 'kalendar' },
    { label: 'Expedice', route: 'expedice' },
    { label: 'Galerie',  route: 'galerie'  },
    { label: 'O nás',    route: 'onas'     },
    { label: 'FAQ',      route: 'faq'      },
    { label: 'Kontakt',  route: 'kontakt'  }
  ];

  var PRODUCTS = [
    { title: 'Tandemový seskok', tag: 'Nejžádanější', short: 'Skok z 4 000 metrů připoutaný k instruktorovi. Bez tréninku, hned dnes.', price: '4 700 Kč', img: IMG.tandem, route: 'tandem' },
    { title: 'Tandem s kamerou + foto', tag: 'S videem', short: 'Externí kameraman letí s tebou. Sestříhané video a fotky týž den.', price: '6 500 Kč', img: IMG.tandemCam, route: 'tandem' },
    { title: 'Výcvik se 2 seskoky', tag: 'Vlastní licence', short: '48 hodin teorie a praxe podle osnov ÚCL, dva samostatné seskoky.', price: '4 600 Kč', img: IMG.vycvik, route: 'kurzy' },
    { title: 'Kurz IAFF s tunelem', tag: 'Zrychlený výcvik', short: 'Příprava ve větrném tunelu a rychlý postup do volného pádu.', price: 'Cena na dotaz', img: IMG.iaff, route: 'kurzy' }
  ];

  var NEWS = [
    { title: 'Jihlava 4. — 6. 9. 2026', text: 'Teorie ZV v pátek od 10:00, start ve 13:30. Sobota starty 7:30 — 15:00 (15:30 seskok Křižanov), neděle od 9:00.', img: 'https://www.lsd-trip.cz/image/news/1787649526_1_image_srpen1.jpg' },
    { title: 'Jihlava 21. — 23. 8. 2026', text: 'Výcvik teorie v pátek od 10:00, seskoky od 14:00. Provoz sobota a neděle od 8:30.', img: 'https://www.lsd-trip.cz/image/news/1786465737_1_image_bc527bf2-415c-40dc-a6b9-db69180468aa.jpg' },
    { title: 'Jihlava 7. — 9. 8. 2026', text: 'ZV teorie v pátek od 10:00, start ve 14:00. Sobota a neděle od 8:30.', img: 'https://www.lsd-trip.cz/image/news/1785300889_1_image_vlcsnap-2026-07-28-17h53m57s259.jpg' }
  ];

  var TANDEM_STEPS = [
    { n: '01', title: 'Příjezd a papíry', text: 'Na letišti se ohlásíš u rezervací, podepíšeš prohlášení a dozvíš se čas svého startu.' },
    { n: '02', title: 'Instruktáž', text: 'Patnáct minut s instruktorem: poloha těla, výskok, otevření padáku, přistání.' },
    { n: '03', title: 'Postroj a nástup', text: 'Oblečeme ti postroj, zkontrolujeme upnutí a nasedáš do letadla. Výstup na 4 000 m trvá cca 15 minut.' },
    { n: '04', title: 'Volný pád', text: 'Padesát sekund, 200 km/h. Pak instruktor otevře padák a přijde ticho.' },
    { n: '05', title: 'Přistání a video', text: 'Pět minut plachtění nad Vysočinou, měkké přistání na nohy a předání videa.' }
  ];

  var TANDEM_VARIANTS = [
    { title: 'Tandem klasik', price: '4 700 Kč', note: 'Seskok z 4 000 m, instruktáž, postroj, pojištění.' },
    { title: 'Tandem + kamera a foto', price: '6 500 Kč', note: 'Externí kameraman, sestříhané video a fotografie.' },
    { title: 'Skupina 5+ osob', price: '−10 %', note: 'Firemní akce a oslavy, vlastní blok na letišti.' }
  ];

  var COURSES = [
    { title: 'Parašutistický výcvik se 2 seskoky', tag: 'Základní kurz', text: '48 hodin výuky podle osnov V-PARA 1 a V-PARA 2, rozšířených o praxi navíc. Končíš dvěma samostatnými seskoky.', dur: '48 hodin', level: 'Začátečník', price: '4 600 Kč', img: IMG.vycvik, terminId: 904 },
    { title: 'Parašutistický výcvik s 1 seskokem', tag: 'Zkrácená verze', text: 'Stejná teorie, jeden samostatný seskok. Ideální, když si chceš vyzkoušet, jestli to je pro tebe.', dur: '48 hodin', level: 'Začátečník', price: '3 900 Kč', img: IMG.zv, terminId: 904 },
    { title: 'Kurz IAFF s větrným tunelem', tag: 'Zrychlený výcvik', text: 'Příprava ve větrném tunelu a metodika IAFF: rychlejší postup, víc času ve volném pádu, instruktor letí s tebou.', dur: '5 dní', level: 'Pokročilý', price: 'Cena na dotaz', img: IMG.iaff, terminId: 910 }
  ];

  var COURSE_CHECKLIST = [
    'Lékařské potvrzení o způsobilosti (stačí praktický lékař).',
    'Sportovní obuv nad kotník a oblečení podle počasí.',
    'U osob do 18 let písemný souhlas zákonného zástupce.',
    'Dobrou náladu a odpočaté tělo — teorie je nabitý den.'
  ];

  var VOUCHERS = [
    { title: 'Tandemový seskok', note: '4 000 m, 50 s volného pádu', price: 4700 },
    { title: 'Tandem + video a foto', note: 'externí kameraman, sestříhané video', price: 6500 },
    { title: 'Výcvik se 2 seskoky', note: '48 h teorie a praxe, vlastní seskok', price: 4600 }
  ];

  var TRIPS = [
    { title: 'Slovinsko — Bovec', tag: 'Expedice', text: 'Seskoky nad Julskými Alpami se přistáním v dolině Soči. Týden skákání, raftingu a lokální kuchyně.', meta: '7 dní · červen 2027 · 12 míst', price: 'od 21 900 Kč', img: GAL[0] },
    { title: 'Helitour — seskok z vrtulníku', tag: 'Helitour', text: 'Výskok z vrtulníku bez proudu vzduchu od motoru: pár sekund absolutního ticha, pak volný pád.', meta: '1 den · dle počasí · 6 míst', price: 'od 8 900 Kč', img: GAL[3] },
    { title: 'Boogie na Vysočině', tag: 'Setkání', text: 'Prodloužený víkend pro členy i veřejnost — formace, večerní projekce videí, oheň na letišti.', meta: '3 dny · srpen 2027', price: 'vstup 500 Kč', img: GAL[6] }
  ];

  var TEAM = [
    { name: 'Kateřina Fojtová', role: 'Zakladatelka spolku od 2009', bio: 'Vedení, plánování a vyjasňování cílů týmu. Stará se o to, abyste se u nás cítili skvěle.', img: '1372779154_image_jeseniky-2010-016.jpg' },
    { name: 'Markéta Svobodová', role: 'Instruktorka parašutismu, kameramanka', bio: 'Kategorie D, oprávnění H a H-AFF, trenérka I. a II. stupně. Na kontě 1200+ seskoků.', img: '1396448517_image_p1090735.jpg' },
    { name: 'Pavel „Líza“ Linhart', role: 'Instruktor parašutismu, kameraman', bio: 'Nejmladší člen týmu. Držitel kategorie D a speciálního oprávnění H.', img: '1434792026_image_liza.jpg' },
    { name: 'Eva Nováková', role: 'Parašutistka, balička, rezervace tandemů', bio: 'Se spolkem spolupracuje od roku 2015. Většinou právě ona ti potvrdí termín.', img: '1475007122_image_080.jpg' },
    { name: 'Andrea Průchová', role: 'Parašutistka, programová koordinátorka', bio: 'Ve spolku od 2012. Skákání i balení padáků. Momentálně žije na Bali.', img: '1470664660_image_13394115_10209817739028824_3442450487870716424_n.jpg' },
    { name: 'Pavlína Streichsbierová', role: 'Střihačka videí', bio: 'Stará se o stříhání tandemových videí — díky ní má seskok i pořádnou dohru.', img: '1469002345_image_img_7829--copy.jpg' }
  ].map(function (m) {
    return { name: m.name, role: m.role, bio: m.bio, img: 'https://www.lsd-trip.cz/image/member/' + m.img };
  });

  var FAQ = [
    { q: 'Musím mít nějakou zkušenost?', a: 'Ne. Na tandemový seskok stačí přijít — vše potřebné se dozvíš při instruktáži přímo na letišti. Zvládají to i lidé, kteří nikdy neletěli.' },
    { q: 'Jaký je váhový a věkový limit?', a: 'Do 95 kg a od 15 let. Účastníkům do 18 let stačí písemný souhlas zákonného zástupce.' },
    { q: 'Co když bude špatné počasí?', a: 'Provoz závisí na počasí. Pokud se neskáče, termín přesuneme bez jakéhokoli poplatku — o startu informujeme SMS den předem.' },
    { q: 'Jak dlouho jsem na letišti?', a: 'U tandemu dvě až tři hodiny včetně čekání a předání videa. U základního kurzu jde o 48 hodin výuky rozdělených do dnů.' },
    { q: 'Můžu mít s sebou doprovod?', a: 'Ano a rádi. Doprovod má na letiště vstup zdarma a seskok pěkně vidí ze země.' },
    { q: 'Kdy dostanu video?', a: 'Sestříhané video z tandemu ti předáme ještě týž den, případně posíláme odkaz ke stažení do 48 hodin.' },
    { q: 'Jak funguje dárkový poukaz?', a: 'Vystavíme ho do pěti minut, pošleme v PDF nebo tištěný poštou. Platí 12 měsíců a termín si obdarovaný vybere sám v kalendáři.' },
    { q: 'Je seskok pojištěný?', a: 'Ano, každý účastník je pojištěn v rámci provozu spolku. Doporučujeme si ověřit i vlastní cestovní pojištění pro adrenalinové sporty.' }
  ];

  var PAY_METHODS = [
    { key: 'card',     label: 'Platební karta',   note: 'Okamžité potvrzení rezervace' },
    { key: 'transfer', label: 'Bankovní převod',  note: 'QR platba, potvrzení do 24 h' },
    { key: 'onsite',   label: 'Platba na letišti', note: 'Hotově nebo kartou v den seskoku' }
  ];

  var FILTERS = ['Vše', 'Tandem', 'Kurzy', 'Volná místa'];

  global.LSD_DATA = {
    IMG: IMG,
    GAL: GAL,
    TERMINY: TERMINY,
    NAV: NAV,
    PRODUCTS: PRODUCTS,
    NEWS: NEWS,
    TANDEM_STEPS: TANDEM_STEPS,
    TANDEM_VARIANTS: TANDEM_VARIANTS,
    COURSES: COURSES,
    COURSE_CHECKLIST: COURSE_CHECKLIST,
    VOUCHERS: VOUCHERS,
    TRIPS: TRIPS,
    TEAM: TEAM,
    FAQ: FAQ,
    PAY_METHODS: PAY_METHODS,
    FILTERS: FILTERS
  };
})(window);
