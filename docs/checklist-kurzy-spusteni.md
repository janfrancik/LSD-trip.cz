# Spuštění modulu Kurzy — co udělat před ostrým provozem

Modul kurzů je hotový (etapy E1–E5) a běží na testu. Tenhle dokument je
seznam kroků, které musí proběhnout, než se pustí na ostrý web: **co doplní
majitelka** v administraci a **co se udělá na serveru** při přechodu na `main`.

Dokud testeři modul neodsouhlasí v „Ke schválení“ (verze `kurzy-1`), do `main`
nejde nic.

---

## 1. Co doplní majitelka (v administraci na testu)

Všechno níž jsou texty a údaje, které dnes mají jen výchozí hodnotu ode mě.
Dají se upravit kdykoli později, ale **tohle by nemělo jít na web tak, jak to
je** — jsou to vaše slova, ne moje.

| Kde | Co doplnit | Proč na tom záleží |
| --- | --- | --- |
| **Nastavení → Souhlasy v přihlášce** | texty pro **provozní podmínky**, **zpracování osobních údajů** a **zdravotní prohlášení** | Ukládají se ke každé přihlášce v tom znění, jaké tam zrovna je. Co nastavíte, to budete za rok dokládat. |
| **Nastavení → Souhlasy v přihlášce** | **odkaz na plné znění podmínek** (adresa stránky nebo PDF) | Bez něj u zaškrtnutí není co „přečíst“. Samotný dokument musí někde vzniknout. |
| **Nastavení → Provoz → Kontaktní e-mail** | adresa provozu | Je prázdná, takže **upozornění na novou přihlášku zatím nikam nechodí**. |
| **Nastavení → E-maily → Podpis** | podpis pod e-maily | Teď je tam jen název spolku. |
| **Nastavení → Rezervace** | storno podmínky, lhůta splatnosti, držení místa | Promítne se do textů a lhůt u přihlášek. |
| **E-maily → Šablony e-mailů** | projít všech šest textů (přijatá, provozu, potvrzená, zaplacená, zrušená, zrušený termín) | Moje verze jsou funkční, ale je to váš hlas. U každé je náhled. |
| **Nastavení → Texty na webu** | nadpis a úvodní odstavec stránky `/kurzy` | Vidí ho každý, kdo si kurzy vygooglí. |
| **Kurzy** | skutečné kurzy: názvy, popisy, co je v ceně, průběh, požadavky, cena, DPH | Zkušební kurzy z testování se na ostrý web nepřenášejí. |
| **Kurzy → Fotky** | titulní fotka a galerie ke každému kurzu, u všech **popis fotky** | Popis čte čtečka pro nevidomé a ukáže se, když se obrázek nenačte. |
| **Termíny → Místa** | letiště a další místa i s adresou | Bez místa na stránce kurzu není kam přijet. |
| **Termíny** | termíny na nadcházející sezónu (hromadné zadání zvládne „každý pátek a sobotu v květnu“) | Bez termínu se na kurz nejde přihlásit — zbyde jen poptávka. |
| **Uživatelé** | účty pro provoz a instruktory ve správných rolích | Soupisku na letišti potřebuje i instruktor; přihlášky mění provoz. |

Dvě fotky, které pořád chybí ze staré titulky:

- **fotka kurzu IAFF** — ta dnešní má v obraze vypálenou cenu „13.500,-“.
  Potřeba **1600 × 1067 px** (poměr 3:2), JPG, bez textu a bez ceny.
  Dnes se používá jen jako náhled dárkového poukazu.
- **fotka týmu** — dnes je to marketingový banner s nápisem. Potřeba
  **1600 × 1000 px** (poměr 16:10), JPG, skupinová fotka bez textu.

---

## 2. Co se udělá na serveru při přechodu na `main`

Pořadí je závazné. Nasazení na `main` se spouští až po odsouhlasení testery.

> **Produkce není „starý web s administrací“.** Na `main` je dnes jen pět commitů:
> statický web a kostra aplikace s migrací `001`. Administrace, uživatelé,
> poptávky ani kurzy tam nikdy nebyly. Tenhle přechod proto nasazuje **fázi 1
> i kurzy najednou** — a produkční `.env` i volume se musí nejdřív připravit
> podle sekce **„Přechod main na novou verzi“ (P0–P3)** v
> [nasazeni-vps.md](nasazeni-vps.md). Bez toho nová verze vůbec nenaběhne:
> compose odmítne start bez `VOLUME_PREFIX`, `IMAGE_TAG` a `APP_CONTAINER`.

### 2.1 Před nasazením

1. **Kontrola staré produkční databáze a záloha.** Krok **P0** v
   [nasazeni-vps.md](nasazeni-vps.md): ověřit, že v tabulce `poptavky` nic
   není, dokud je stará databáze ještě po ruce. **Musí to proběhnout se starým
   `.env`** — jakmile se přepíše (P2), ptal by se dotaz už nové, prázdné
   databáze a vyšla by nula i v případě, že ve staré něco je. `scripts/zaloha.sh`
   běží v cronu; před zásahem se spustí ještě jednou ručně a ověří se, že
   záloha má rozumnou velikost a jde rozbalit.
2. **Kontrola `.env` na produkci** (soubor vytváří člověk, workflow ho nikdy
   nepřepisuje). Celý vzor je v P2 v [nasazeni-vps.md](nasazeni-vps.md), kde se
   stávající soubor nejdřív odloží do `.env.stary-<datum>`. Tady jsou řádky,
   na kterých záleží nejvíc:

   | Proměnná | Hodnota | Poznámka |
   | --- | --- | --- |
   | `PROSTREDI` | `produkce` | Podle toho se pozná produkce, ne podle `NODE_ENV`. Když zůstane výchozí `vyvoj`, aplikace **naběhne** — ale s modulem „Ke schválení“ na očích a bez indexace. |
   | `ROBOTS` | `zakazat`, dokud jsme na `lsd.francik.eu` | Na `www.lsd-trip.cz` běží pořád starý web na jiném hostingu. Kdyby se indexovala i tahle adresa, soutěžily by v Googlu dvě kopie webu. Na `povolit` se přepne až s přechodem na `www.lsd-trip.cz` (viz „Přechod na lsd-trip.cz“ v [README](../README.md)). Pozor: `zakazat` je i výchozí hodnota, takže se na tenhle řádek nedá poznat, že je nastavený schválně. |
   | `APP_URL` | celá adresa ostrého webu | Skládají se z ní odkazy v e-mailech a kanonické adresy. |
   | `EMAIL_REZIM` | `vypnuto` (zatím) | **Tohle je ten přepínač** — viz 2.1a níž. Na `live` se přepne, až bude Resend; `schranka` produkce odmítne a nenastartuje. |
   | `RESEND_API_KEY` | — (zatím prázdné) | Povinný teprve při `live` — bez něj by aplikace s `live` nenastartovala. |
   | `EMAIL_ODESILATEL` | `LSD <rezervace@…>` | Doména musí být ověřená v Resendu (až k `live`). |
   | `EMAIL_TEST_PRIJEMCE` | — | V produkci se nepoužívá; nechat prázdné. |
   | `VOLUME_PREFIX` | `lsd_main` | Bez téhle (a `IMAGE_TAG=latest`, `APP_CONTAINER=lsdtrip-app`) compose schválně nenastartuje. |
   | `MOONE_BASE_URL` | `https://api-test.znpay.tech` | **Testovací brána, i v produkčním `.env`.** Platby jsou fáze 4 a zatím se nepoužívají, takže to teď nevadí — ale **před zapnutím plateb se musí přepnout na ostrou bránu** i s ostrými přístupy, jinak by zákazník platil do testovacího prostředí a peníze by nikam nedošly. |

3. **Kontaktní e-mail provozu** v Nastavení (bod 1) — jinak provoz o nových
   přihláškách neví.

### 2.1a Rozhodnutí: pustit přihlášku s vypnutými e-maily, nebo počkat na Resend?

Dva návody si tady do teď protiřečily. [nasazeni-vps.md](nasazeni-vps.md) (P2)
nechává produkci na `EMAIL_REZIM=vypnuto`, dokud není ověřená doména v Resendu;
tenhle checklist chtěl `live`. Platí tohle:

- **`EMAIL_REZIM=live`** — potřebuje hotový Resend (ověřená doména, klíč).
  Teprve s ním má veřejná přihláška smysl: zákazník dostane potvrzení a provoz
  upozornění.
- **`EMAIL_REZIM=vypnuto`** — přihláška z webu **projde a uloží se**, ale
  **nikomu nic nepřijde**: ani potvrzení zákazníkovi, ani upozornění provozu.
  V administraci v sekci E-maily se takový e-mail objeví jako chyba
  („Odesílání e-mailů je vypnuté“), takže se nic neztratí — ale někdo musí
  přihlášky hlídat ručně a ozvat se telefonem.

**Rozhodnuto (3. 10. 2026):** Resend hotový není, produkce jde na
`EMAIL_REZIM=vypnuto`, a **termíny se přesto zveřejní** — přihláška z webu
tedy poběží bez automatických e-mailů. Je to vědomá volba majitele
repozitáře; alternativa (zveřejnit kurzy bez termínů, takže se nejde
přihlásit a zbyde jen poptávka) se nebere.

Co z toho plyne pro provoz, dokud se nepřepne na `live`:

- **Nové přihlášky se nikam neohlásí.** Musí se hlídat v administraci
  v sekci **Přihlášky** — e-mail provozu nepřijde. Dokud není `live`, dívejte
  se tam každý den.
- **Zákazník nedostane potvrzení.** Po odeslání přihlášky uvidí na webu
  děkovnou stránku a nic víc. Ozvěte se mu telefonem nebo z vlastní pošty,
  ať neví jen to, že „něco odeslal“.
- **Nic se neztratí.** E-mail se uloží celý (předmět, HTML i textová verze)
  a v sekci **E-maily** se dá otevřít a přečíst; jen má stav „chyba“
  s důvodem „Odesílání e-mailů je vypnuté“. Co odeslat mělo, je tím pádem
  dohledatelné.
- **Tlačítko „odeslat znovu“ není.** Po přepnutí na `live` se staré
  e-maily samy nerozešlou — co se v tomhle období nepošle, zůstane
  nerozeslané a vyřídí se po telefonu.

Až bude Resend hotový, je přepnutí na `live` změna `EMAIL_REZIM`
a `RESEND_API_KEY` v `.env` plus `docker compose up -d`. Žádné nasazování,
žádná migrace. Pak platí bod 8 v 2.4 (první ostrý e-mail si pošlete sama).

### 2.2 Nasazení

4. **Merge `test` → `main`** (jen s výslovným souhlasem majitelky repozitáře)
   — až po P0–P3, tedy po kontrole staré databáze, novém `.env` a odstranění
   starého volume. Je to
   krok P4: `git merge --ff-only test`, žádný vlastní commit do `main`.
5. Workflow nasadí produkci sám a v tomhle pořadí:
   - spustí **migrace 002–012** nad produkční databází (`docker compose run --rm app npm run migrate`),
   - teprve pak zamění kontejner a čeká, až nahlásí `healthy`.

   Produkce má zatím jen `001_init.sql`, takže se nedohánějí jen kurzy, ale
   celá administrace:

   | Migrace | Co přidá |
   | --- | --- |
   | `002`–`007` | uživatelé, role a audit, e-maily a poptávky, modul akceptace, časy v UTC, testovací schránka |
   | `008_produkty_a_cenik.sql` | sazby DPH, produkty (kurzy), požadavky, průběh, historie cen |
   | `009_soubory_a_fotky.sql` | nahrané soubory a jejich napojení na produkty |
   | `010_soubory_kod.sql` | náhodný kód do veřejné adresy fotky |
   | `011_mista_a_terminy.sql` | místa, termíny, série, instruktoři |
   | `012_zakaznici_a_prihlasky.sql` | zákazníci, přihlášky, účastníci, položky, šablony e-mailů |

   Všechny migrace jen přidávají tabulky a sloupce. Žádná nic nemaže ani
   nepřejmenovává, takže se stará verze aplikace nad novým schématem nerozbije.
   Data plní jen dvě z nich, a to číselníky: `008` sazby DPH a `012` šest
   výchozích šablon e-mailů. **Žádné zkušební kurzy migrace nezakládají** —
   produkce dostane modul čistý.

6. **Založit první účet.** Databáze je po přechodu prázdná, takže se do
   administrace nemá kdo přihlásit — tenhle krok nejde vynechat:

   ```bash
   cd /home/deploy/apps/lsdtrip
   docker compose exec app node scripts/vytvor-uzivatele.js <e-mail> "<jméno>" admin
   ```

   Heslo si skript vypíše; při prvním přihlášení se mění a nastaví se druhý
   faktor. Účty pro provoz a instruktory se pak zakládají už v administraci.

7. **Ověřit po nasazení:**
   - `/api/health` vrací `prostredi: produkce` a `migrace: 12`
     (dnes vrací jen `{"status":"ok"}` — podle toho se pozná, že je nahoře nová verze),
   - `/robots.txt` existuje a má `Disallow: /` (dokud jsme na `lsd.francik.eu`),
   - `/api/poptavky` **už není veřejné** — nová adresa je `/api/admin/poptavky`
     a bez přihlášení vrací 401,
   - `/kurzy` a stránka jednoho kurzu se načtou,
   - v administraci sedí Kurzy, Termíny, Přihlášky a Šablony e-mailů,
   - v menu **není** „Ke schválení“ (v produkci se modul nezapíná),
   - fotka kurzu se zobrazí (adresa `/media/<kód>`).

### 2.3 Zkušební data

Na testu i na produkci se po odsouhlasení **uklidí, co vzniklo při zkoušení**.
Smazat se musí v tomhle pořadí (jinak to nepustí cizí klíče):

```sql
-- 1. přihlášky a všechno, co na nich visí
DELETE FROM rezervace_ucastnici WHERE rezervace_id IN (SELECT id FROM rezervace);
DELETE FROM rezervace_polozky  WHERE rezervace_id IN (SELECT id FROM rezervace);
DELETE FROM emaily   WHERE rezervace_id IS NOT NULL;
DELETE FROM rezervace;
DELETE FROM zakaznici;

-- 2. termíny a jejich série
DELETE FROM termin_instruktori;
DELETE FROM terminy;
DELETE FROM termin_serie;

-- 3. zkušební kurzy i s fotkami (POZOR: jen ty zkušební, ne ostré!)
DELETE FROM produkt_fotky WHERE produkt_id IN (SELECT id FROM produkty WHERE nazev LIKE 'Zkušební%');
DELETE FROM produkt_kroky WHERE produkt_id IN (SELECT id FROM produkty WHERE nazev LIKE 'Zkušební%');
DELETE FROM produkt_pozadavky WHERE produkt_id IN (SELECT id FROM produkty WHERE nazev LIKE 'Zkušební%');
DELETE FROM produkty WHERE nazev LIKE 'Zkušební%';
```

Co se **nemaže**:

- `dph_sazby` a `email_sablony` — číselníky, které plní migrace a upravuje
  majitelka,
- `mista` — letiště zůstávají,
- fotky ve volume `uploads` — osiřelé soubory uklidí sama hodinová údržba den
  po smazání.

**Na produkci se tohle nepouští.** Produkční databáze vzniká při přechodu
nová a prázdná (P3) a migrace do ní žádné zkušební kurzy nezakládají — není
tam co uklízet. Skript výš je určený pro **test**, kde zkušební data po
akceptaci zůstala.

### 2.4 Po spuštění

8. **První ostrý e-mail si pošlete sama**: založte přihlášku po telefonu na
   svůj e-mail se zapnutým přepínačem a zkontrolujte, že dorazila a vypadá,
   jak má. Teprve pak pustíte přihlášku do oběhu. (Platí pro
   `EMAIL_REZIM=live`; při `vypnuto` není co kontrolovat — viz 2.1a.)
9. **Sledujte E-maily** první dny — je tam vidět, co odešlo a jestli se to
   doručilo.
10. **Přidat produkční řádek do cronu** pro zálohy (viz P5 v
    [nasazeni-vps.md](nasazeni-vps.md)) — bez něj se produkce nezálohuje.
11. Na VPS běží vedle i cizí aplikace ve sdílené síti. Žádný `docker system
    prune` a žádný zásah mimo adresáře `lsdtrip*` a volumes `lsd_*`.

---

## 3. Co modul zatím neumí (a ví se o tom)

Aby nevznikla očekávání, která nemůžu splnit:

- **Platby a doklady** nejsou součástí modulu (rozhodnutí 8). „Zaplacená“
  nastavuje provoz ručně podle výpisu z účtu. Platební brána a faktury jsou
  fáze 4.
- **Čekací listina** se nevede. Plný termín přihlášku odmítne a nabídne jiné
  termíny téhož kurzu.
- **Přesun přihlášky na jiný termín** se dělá domluvou, ne tlačítkem
  (rozhodnutí 7).
- **Tandem, expedice a aktuality** na webu pořád vycházejí z `data.js`.
  Mají přijít vlastním modulem.
- **Kalendář na webu** ukazuje jen tandemové dny. Termíny kurzů jsou na
  stránce kurzu a v „Nejbližších termínech“ na titulce.
