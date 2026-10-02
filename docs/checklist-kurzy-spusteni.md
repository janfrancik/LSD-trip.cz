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

### 2.1 Před nasazením

1. **Záloha produkční databáze.** `scripts/zaloha.sh` běží v cronu; před
   zásahem se spustí ještě jednou ručně a ověří se, že záloha má rozumnou
   velikost a jde rozbalit.
2. **Kontrola `.env` na produkci** (soubor vytváří člověk, workflow ho nikdy
   nepřepisuje):

   | Proměnná | Hodnota | Poznámka |
   | --- | --- | --- |
   | `PROSTREDI` | `produkce` | Podle toho se pozná produkce, ne podle `NODE_ENV`. |
   | `EMAIL_REZIM` | `live` | **Tohle je ten přepínač.** Dokud tam je `schranka` nebo `test`, zákazníkům nic nedojde. |
   | `RESEND_API_KEY` | klíč z Resendu | Bez něj se e-mail neodešle a zapíše se chyba. |
   | `EMAIL_ODESILATEL` | `LSD <rezervace@…>` | Doména musí být ověřená v Resendu. |
   | `EMAIL_TEST_PRIJEMCE` | — | V produkci se nepoužívá; nechat prázdné. |
   | `APP_URL` | celá adresa ostrého webu | Skládají se z ní odkazy v e-mailech a kanonické adresy. |

3. **Kontaktní e-mail provozu** v Nastavení (bod 1) — jinak provoz o nových
   přihláškách neví.

### 2.2 Nasazení

4. **Merge `test` → `main`** (jen s výslovným souhlasem majitelky repozitáře).
5. Workflow nasadí produkci sám a v tomhle pořadí:
   - spustí **migrace 008–012** nad produkční databází (`docker compose run --rm app npm run migrate`),
   - teprve pak zamění kontejner a čeká, až nahlásí `healthy`.

   | Migrace | Co přidá |
   | --- | --- |
   | `008_produkty_a_cenik.sql` | sazby DPH, produkty (kurzy), požadavky, průběh, historie cen |
   | `009_soubory_a_fotky.sql` | nahrané soubory a jejich napojení na produkty |
   | `010_soubory_kod.sql` | náhodný kód do veřejné adresy fotky |
   | `011_mista_a_terminy.sql` | místa, termíny, série, instruktoři |
   | `012_zakaznici_a_prihlasky.sql` | zákazníci, přihlášky, účastníci, položky, šablony e-mailů |

   Všechny migrace jen přidávají tabulky a sloupce. Žádná nic nemaže ani
   nepřejmenovává, takže se stará verze aplikace nad novým schématem nerozbije.

6. **Ověřit po nasazení:**
   - `/api/health` vrací `prostredi: produkce` a `migrace: 12`,
   - `/kurzy` a stránka jednoho kurzu se načtou,
   - v administraci sedí Kurzy, Termíny, Přihlášky a Šablony e-mailů,
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

Na produkci se tohle pouští **jen tehdy**, když se tam něco zkoušelo. Pokud
produkce dostane modul čistý, je to zbytečné.

### 2.4 Po spuštění

7. **První ostrý e-mail si pošlete sama**: založte přihlášku po telefonu na
   svůj e-mail se zapnutým přepínačem a zkontrolujte, že dorazila a vypadá,
   jak má. Teprve pak pustíte přihlášku do oběhu.
8. **Sledujte E-maily** první dny — je tam vidět, co odešlo a jestli se to
   doručilo.
9. Na VPS běží vedle i cizí aplikace ve sdílené síti. Žádný `docker system
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
