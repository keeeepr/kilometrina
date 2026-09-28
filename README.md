# Kilometrina — navodila za postavitev

Ta mapa vsebuje samostojno spletno aplikacijo (PWA), ki jo lahko gostiš
brezplačno na GitHub Pages in dodaš na domači zaslon iPhona kot pravo
aplikacijo, z varnostnim kopiranjem podatkov v tvoj Google Drive.

Datoteke:
- `index.html` — sama aplikacija
- `manifest.json`, `service-worker.js` — naredita jo namestljivo in delujočo brez interneta
  (aplikacija se odpre takoj iz predpomnilnika; novo različico prenese v ozadju in ponudi gumb *Osveži*)
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — ikona aplikacije
- `oura-token-exchange.js`, `wrangler.toml`, `package.json` — Cloudflare Worker za prijavo in
  branje podatkov iz Oure (razdelek 5) ter AI oceno obrokov (razdelek 7). Teče na Cloudflare,
  ne na GitHub Pages; v repozitoriju je samo zato, da je koda shranjena.

## 1. Postavi GitHub Pages (gostovanje, brezplačno)

1. Pojdi na https://github.com in si ustvari brezplačen račun, če ga še nimaš.
2. Klikni **New repository**. Ime naj bo npr. `kilometrina`. Nastavi ga kot **Public**
   (GitHub Pages v brezplačni verziji zahteva javni repozitorij — vsebina bo javno
   vidna komurkoli s povezavo, kar je za to aplikacijo v redu, ker ne vsebuje gesel).
3. Naloži `index.html`, `manifest.json`, `service-worker.js` in tri ikone (6 datotek) v repozitorij (v spletnem vmesniku: **Add file → Upload files**).
4. Pojdi v **Settings → Pages**. Pod "Branch" izberi `main` in mapo `/ (root)`, nato **Save**.
5. Po približno minuti bo stran dostopna na `https://keeeepr.github.io/kilometrina/`.

## 2. Ustvari Google OAuth Client ID (za Drive sinhronizacijo)

1. Pojdi na https://console.cloud.google.com/ in ustvari nov projekt (poljubno ime, npr. "Kilometrina").
2. V iskalniku poišči **"Google Drive API"** in klikni **Enable**.
3. Pojdi na **APIs & Services → OAuth consent screen**.
   - User type: **External**
   - Izpolni osnovna polja (ime aplikacije, tvoj e-mail).
   - Publishing status pusti na **Testing**.
   - Pod "Test users" dodaj svoj Google e-mail naslov.
4. Pojdi na **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**
   - Pod "Authorized JavaScript origins" dodaj točen naslov iz koraka 1 **brez** končne poti,
     npr. `https://keeeepr.github.io` (brez `/kilometrina/` na koncu).
   - Klikni **Create**. Prikaže se **Client ID** (izgleda kot `123456-abc.apps.googleusercontent.com`).

## 3. Vstavi Client ID v kodo

V `index.html` poišči vrstico (bližje vrhu `<script>` bloka):

```js
const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com';
```

Zamenjaj `YOUR_CLIENT_ID_HERE.apps.googleusercontent.com` s svojim pravim Client ID iz koraka 2,
shrani datoteko in jo znova naloži v GitHub repozitorij (prepiše obstoječo `index.html`).

## 4. Dodaj na iPhone

1. Na iPhonu v Safariju odpri `https://keeeepr.github.io/kilometrina/`.
2. Tapni **Deli → Dodaj na začetni zaslon**.
3. Odpri aplikacijo z nove ikone, tapni **"Prijava v Google"** in dovoli dostop.
   Od zdaj naprej se bo vsak vnos samodejno (z nekaj sekund zamika) sinhroniziral
   v tvoj Google Drive (Moj disk) v dve datoteki:
   - `kilometrina-podatki.json` — varnostna kopija, iz katere aplikacija obnavlja podatke;
   - `kilometrina.xlsx` — Excel pregled istih podatkov z zavihki **Treningi** (en trening na
     vrstico, z Oura podatki istega dne), **Seti** (vsak set posebej) in **Oura** (vsi Oura
     podatki po dnevih). Odpreš ga v Google Sheets ali preneseš in odpreš v Excelu.
     **Datoteka se ob vsaki sinhronizaciji na novo zapiše**, zato vanjo ne vpisuj ničesar —
     spremembe bi se izgubile. Če jo želiš urejati, si naredi kopijo.
   Obe datoteki lahko premakneš v poljubno mapo v Drive, ne preimenuj pa ju.

## 5. Oura Ring nastavitev (neobvezno)

Aplikacija vsak dan pobere tvoje Oura podatke o spanju, pripravljenosti in srčnem utripu,
jih shrani po datumih (tudi v Google Drive varnostno kopijo, glej razdelek 6) in jih pokaže
v razdelku "Oura Ring" ter pri vsakem treningu v zgodovini — za isti dan.

Zakaj je potreben še Cloudflare: Oura ne izdaja več osebnih žetonov (Personal Access
Tokens), prijava gre samo prek OAuth, ta pa zahteva **skrivni ključ** (client secret).
Tega ne smemo dati v `index.html`, ker je repozitorij javen. Zato skrivni ključ hrani
majhen brezplačen Cloudflare Worker (`oura-token-exchange.js`), ki zamenja kodo za žeton.
Ker Oura ne dovoli branja podatkov neposredno iz brskalnika (CORS), Worker posreduje tudi
branje podatkov (samo spanje, pripravljenost, aktivnost in srčni utrip) — s tvojim žetonom,
ničesar ne shranjuje.

### 5a. Registriraj aplikacijo pri Oura

1. Pojdi na https://cloud.ouraring.com/oauth/applications in se prijavi s svojim Oura računom.
2. Klikni **New Application** in izpolni:
   - **Display Name**: npr. `Kilometrina`
   - **Description**: npr. `Osebna aplikacija za beleženje plavalnih treningov.`
   - **Contact Email**: tvoj e-mail
   - **Website**: naslov strani, npr. `https://keeeepr.github.io/kilometrina/`
   - **Privacy Policy URL** in **Terms of Service URL**: Oura ju zahteva, za osebno uporabo pa
     zadošča kar povezava na tvoj GitHub repozitorij, npr.
     `https://github.com/keeeepr/kilometrina` (lahko pri obeh ista).
   - **Redirect URIs**: točen naslov strani **s** končno poševnico, npr.
     `https://keeeepr.github.io/kilometrina/`
     (za lokalno testiranje lahko dodaš še `http://localhost:8000/`).
     Brez `index.html` na koncu — aplikacija vedno uporabi naslov mape.
   - **Scopes**: obkljukaj vsaj **daily** in **heartrate**.
3. Shrani. Prikažeta se **Client ID** in **Client Secret** — oba si shrani.
   Client Secret gre **samo** v Cloudflare (korak 5b), nikoli v `index.html` ali na GitHub.

### 5b. Postavi Cloudflare Worker

1. Ustvari brezplačen račun na https://dash.cloudflare.com/sign-up.
2. Na računalniku (potreben je Node.js) v tej mapi v terminalu zaženi:

   ```sh
   npx wrangler login
   npm install
   npx wrangler deploy
   npx wrangler secret put OURA_CLIENT_ID
   npx wrangler secret put OURA_CLIENT_SECRET
   ```

   Nastavitve (ime Workerja, `ALLOWED_ORIGIN`) so v `wrangler.toml`. Pri zadnjih dveh ukazih te
   vpraša za vrednost — prilepi Client ID oziroma Client Secret iz 5a.
   `ALLOWED_ORIGIN` je naslov strani **brez** poti (brez `/kilometrina/`). Za lokalno testiranje
   lahko navedeš več naslovov, ločenih z vejico, npr.
   `https://keeeepr.github.io,http://localhost:8000`.
3. `deploy` izpiše naslov Workerja, npr. `https://kilometrina-oura.TVOJ-RACUN.workers.dev`.

### 5c. Vstavi podatke v kodo

V `index.html` poišči in zamenjaj:

```js
const OURA_CLIENT_ID = 'YOUR_OURA_CLIENT_ID';
const OURA_WORKER_URL = 'https://kilometrina-oura.YOUR-SUBDOMAIN.workers.dev';
```

s svojim Client ID (ta ni skriven) in naslovom Workerja (brez poševnice na koncu). Znova naloži
`index.html` na GitHub, odpri aplikacijo in tapni **"Prijava v Oura"**.

Prijava v Oura ostane veljavna (aplikacija žeton sama osvežuje), dokler ne tapneš **"Odjava"**.

## 6. Shema podatkov in kaj se dnevno pridobiva iz Oura

Ob vsakem odprtju aplikacija (če si prijavljen v Oura) pogleda zadnjih **7 dni** in iz Oure
pobere samo tiste dni, ki še niso popolni (manjka ocena spanja ali pripravljenosti). Danes je
pogosto nepopoln, dokler se prstan zjutraj ne sinhronizira, zato ga poskusi znova ob naslednjem
odprtju. **"Osveži zdaj"** na novo pobere vseh 7 dni. Po vsaki spremembi se sproži običajna
Drive sinhronizacija.

Datum je Ourin "dan": noč spada k jutru, ko se zbudiš — torej isti dan kot trening po njej.

Datoteka `kilometrina-podatki.json` v Drive:

```json
{
  "workouts": [ … ],
  "words": [ … ],
  "oura": {
    "2026-09-26": {
      "sleep_score": 84,
      "total_sleep_duration_min": 452,
      "deep_sleep_min": 98,
      "rem_sleep_min": 110,
      "light_sleep_min": 244,
      "sleep_efficiency": 93,
      "avg_hr_overnight": 52,
      "lowest_hr_overnight": 46,
      "avg_hrv_overnight": 68,
      "respiratory_rate": 14.2,
      "readiness_score": 78,
      "resting_heart_rate": 48,
      "temperature_deviation": 0.1,
      "bedtime_start": "2026-09-25T23:12:00+02:00",
      "bedtime_end": "2026-09-26T07:04:00+02:00",
      "activity_score": 90
    }
  },
  "savedAt": 1790000000000
}
```

Od kod pride posamezno polje (Oura API v2):

| Polje | Vir |
|---|---|
| `sleep_score` | `daily_sleep` → `score` |
| `total_sleep_duration_min`, `deep_sleep_min`, `rem_sleep_min`, `light_sleep_min` | `sleep` (najdaljše spanje tistega dne) → trajanja, pretvorjena v minute |
| `sleep_efficiency`, `bedtime_start`, `bedtime_end` | `sleep` → `efficiency`, `bedtime_start`, `bedtime_end` |
| `avg_hr_overnight`, `lowest_hr_overnight` | izračunano iz `heartrate` (vzorci na ~5 min) med `bedtime_start` in `bedtime_end`; če v tem času ni vzorcev, se uporabita Ourina `average_heart_rate` / `lowest_heart_rate` iz `sleep` |
| `avg_hrv_overnight` | `sleep` → `average_hrv` |
| `respiratory_rate` | `sleep` → `average_breath` (vdihov na minuto) |
| `readiness_score`, `temperature_deviation` | `daily_readiness` → `score`, `temperature_deviation` (°C) |
| `resting_heart_rate` | `sleep` → `lowest_heart_rate` (to Oura v aplikaciji prikazuje kot mirovni utrip) |
| `activity_score` | `daily_activity` → `score` |

Polje, ki ga Oura za tisti dan nima, je `null`. Dan, ko prstana nisi nosil, se ne zapiše.
Pri **"Obnovi iz Drive"** se `workouts`, `words`, `meals`, `supplements` in `supplementList`
nadomestijo s kopijo iz Drive, `oura` pa se združi (dnevi iz Drive dopolnijo tiste na napravi).

Prehrana (razdelek 7) doda v isto datoteko še tri ključe:

```json
"meals": [
  { "id": "m-…", "date": "2026-09-26", "time": 1790000000000, "type": "kosilo",
    "name": "Losos z rižem", "calories": 620, "protein": 38, "carbs": 65, "fat": 20,
    "portion": 1, "confidence": "medium", "notes": "Predpostavljena 1 skodelica riža.",
    "source": "ai", "hasPhoto": true }
],
"supplements": [
  { "id": "s-…", "date": "2026-09-26", "time": 1790000000000, "name": "Magnezij B6",
    "serving": "2 tableti", "servings": 1,
    "ingredients": [ { "name": "Magnezij", "amount": 375, "unit": "mg", "nrv": 100 } ] }
],
"supplementList": [
  { "name": "Magnezij B6", "brand": "Solgar", "serving": "2 tableti",
    "ingredients": [ { "name": "Magnezij", "amount": 375, "unit": "mg", "nrv": 100 } ] }
]
```

`type` je `zajtrk`, `kosilo`, `vecerja` ali `prigrizek`; `source` je `ai`, `repeat` (ponovljen
prejšnji obrok) ali `manual`; `portion` je izbrana količina (številke so že pomnožene z njo).
Pri dopolnilih je `servings` število odmerkov; `ingredients` so na en odmerek. Vnos
dopolnila ima kopijo sestavin iz časa vnosa, zato ostane pravilen, tudi če dopolnilo kasneje
znova slikaš ali izbrišeš s seznama.

## 7. Prehrana: prehranski dnevnik z AI oceno

Na vrhu aplikacije izbereš **Treningi & Oura** ali **Prehrana** (izbira se zapomni). V delu
Prehrana:

- **Nov obrok** — tapni *Slikaj ali izberi sliko*; Claude (model Claude Opus 5) oceni ime obroka,
  kalorije, beljakovine, ogljikove hidrate in maščobe ter pove, kako zanesljiva je ocena in kaj je
  predpostavil. Številke lahko pred shranjevanjem popraviš. Namesto slike (ali poleg nje) lahko
  obrok opišeš, npr. "200 g riža, brez omake" — opis ima prednost pred sliko. Brez AI lahko
  številke vpišeš tudi ročno.
- **Že jedel** — obroki, ki si jih že vnesel (najpogostejši najprej, z iskanjem). Tapni enega in
  obrazec se izpolni z isto količino kot zadnjič; če si pojedel več ali manj, izberi količino
  (½, ¾, 1, 1½, 2 ali poljubno število) in shrani. Brez AI.
- **Količina** velja tudi za AI oceno in ročni vnos: številke se pomnožijo s količino.
- **Obroki** — seznam za izbrani dan, s seštevkom zgoraj; vsak obrok lahko urediš ali izbrišeš.
- **Prehranska dopolnila** — tapni *Slikaj etiketo dopolnila*: Claude z etikete prebere ime,
  znamko, odmerek in vse sestavine s količinami na odmerek (in % priporočenega vnosa). Dopolnilo
  shraniš med svoja, nato ga vsakič z enim dotikom zabeležiš; pri vnosu so izpisane sestavine,
  pod seznamom pa seštevek sestavin za cel dan (npr. dva izdelka z magnezijem se seštejeta).
  Brez AI: vpiši ime in (neobvezno) sestavine na odmerek, npr. `Magnezij 300 mg, Vitamin B6 2 mg`.
  Pri vsakem vnosu z gumboma − / + spremeniš število odmerkov (npr. 2 tableti); naslednjič je
  privzeto enako kot zadnjič.

Vse gre v Drive varnostno kopijo in v `kilometrina.xlsx` (zavihki *Prehrana*, *Dopolnila* in
*Dnevni pregled*, ki po dnevih združi km, kalorije, makrohranila, dopolnila in Oura podatke).
**Slike obrokov** se ob sinhronizaciji naložijo v mapo **Kilometrina slike** v tvojem Drive (nekaj na
sinhronizacijo, vsaka samo enkrat; obrok dobi `photoDriveId`). Na novi napravi se po *Obnovi iz Drive*
slika prenese, ko jo prvič odpreš; ob brisanju obroka ali slike se izbriše tudi v Drive.

### Nastavitev (enkrat)

API ključ za Claude ne sme biti v `index.html` (repozitorij je javen), zato oceno naredi isti
Cloudflare Worker kot pri Ouri. Ker ključ stane denar, Worker za vsako AI zahtevo preveri **dvoje**:

- **geslo** (`APP_PASSCODE`), ki ga vpišeš v razdelku *AI analiza* (Prehrana) — znaki so skriti,
  vidni so samo, ko obkljukaš *Pokaži geslo*; aplikacija si ga zapomni na napravi;
- **prijavo v Google** z računom `ALLOWED_EMAIL` — Worker pri Googlu preveri, da je žeton res
  izdan za to aplikacijo in za tvoj račun. Brez prijave v Google AI ne deluje (niti z geslom), in
  geslo lahko vpišeš samo, ko si prijavljen. Google prijava velja približno 1 uro.

1. Na https://console.anthropic.com → **API Keys** → **Create Key** ustvari nov ključ (npr.
   "Kilometrina") in ga kopiraj.
2. Priporočeno: v **Settings → Limits** nastavi mesečno omejitev porabe.
3. V terminalu v tej mapi:

   ```sh
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put APP_PASSCODE
   npx wrangler secret put ALLOWED_EMAIL
   ```

   Pri prvem prilepi API ključ, pri drugem si izmisli geslo (npr. 4–6 besed), pri tretjem vpiši
   Gmail naslov, s katerim se v aplikaciji prijavljaš v Google. Ključa in gesla ne pošiljaj
   nikomur in ju ne vpisuj v kodo. `GOOGLE_CLIENT_ID` je v `wrangler.toml` (ni skriven).
4. V aplikaciji se prijavi v Google, odpri Prehrana → *AI analiza* in vpiši geslo iz koraka 3.

Ena ocena obroka stane približno 1–3 cente (slika je pred pošiljanjem pomanjšana).

## 8. Telesna masa in pijača

- **Telesna masa** (Treningi & Oura): vpiši maso za dan (vejica ali pika, npr. `72,4`). En vpis na
  dan — ponovni vpis za isti dan ga zamenja. Prikazana je zadnja masa, sprememba od prejšnje
  meritve in zadnjih 10 meritev.
- **Pijača** (Prehrana): izberi, kaj si popil (Voda, Kava, Čaj, Mleko, Sok, Izotonik, Pivo, Vino
  ali svojo — pri svoji lahko vpišeš kcal na 100 ml), izberi količino (100–750 ml ali poljubno) in
  tapni *Zabeleži pijačo*. Privzeta količina je enaka kot zadnjič za to pijačo. Kalorije iz pijače
  se prištejejo k dnevnim kcal (makrohranila ne), pod seštevkom je skupna tekočina.

V Drive varnostni kopiji sta nova ključa `weights` (`{date, kg}`) in `drinks`
(`{date, time, name, ml, kcal}`) ter seznam `drinkTypes`; v `kilometrina.xlsx` zavihka
*Telesna masa* in *Pijača*, v *Dnevnem pregledu* pa stolpca Masa in Tekočina.

## 9. Prenova (faza 1): zavihki, Danes, plavalni trening, zgodovina

Spodaj je stalna vrstica z zavihki:

- **Danes** — zadnjih 7 dni (km, stolpci po dnevih, napredek do tedenskega cilja — tapni *cilj*, da ga
  spremeniš), Oura trak, današnji trening (ogrevanje / glavni / iztek), prehrana in masa danes. Gumb **+**
  odpre Trening.
- **Trening** — *Plavanje | Fitnes* (fitnes pride v 3. fazi), bazen 25 / 50 m. Seti z gumbi (ponovitve →
  razdalja → slog → oznake/interval → Dodaj) ali s tipkanjem (`8x100 p tempo na 1:45`, več setov loči s `;`).
  Pri gumbih ni nič izbrano vnaprej — *Dodaj* se odklene, ko izbereš ponovitve, razdaljo in slog (ponoven tap
  izbiro prekliče), po dodajanju se izbira počisti. Tap na set ga odpre za urejanje. Bližnjici: *Ponovi zadnji*,
  *Razveljavi*; *Skrij* (desno zgoraj v vnosnem delu) skrije gumbe in zapre tipkovnico, *+ Dodaj set* jih vrne;
  svinčnik ureja gumbe. Nedokončan trening ostane shranjen na napravi, dokler ga ne shraniš.
- **Zgodovina** — iskanje, Teden / Mesec / Leto / Vse, graf zadnjih 12 tednov, seznam po tednih;
  tap odpre podrobnosti z gumbi *Uredi*, *Podvoji*, *Izbriši* (dvojni tap). Izvoz CSV je zgoraj desno.
- **Prehrana** — kot prej (prenova v 2. fazi).
- **Zdravje** — Oura, telesna masa, povezave (Google Drive) in AI geslo.

Stari treningi ostanejo nespremenjeni: set je še vedno `{ text, meters }`, novi seti imajo poleg tega
`{ reps, dist, stroke, tags, note }`, trening pa `pool` (dolžina bazena). Stare vrstice brez sloga se pri
urejanju pokažejo kot besedilo (lahko jih pretvoriš v set). Nekdanje besede »Hitro vstavi« so zdaj med
oznakami. V Drive kopiji so novi ključi `shortcuts`, `templates` in `weekGoal`.
V `kilometrina.xlsx` na Drivu je bazen jasno označen: stolpec *Bazen* (»25 m« / »50 m«, pri starejših
treningih brez podatka »ni označeno«) v zavihkih *Treningi* in *Seti*, v *Dnevnem pregledu* pa sta
stolpca *Km v 25 m bazenu* in *Km v 50 m bazenu*. Tudi CSV izvoz ima stolpec `pool`.
Zavihek *Seti* je razdeljen po treningih: obarvana naslovna vrstica (dan, datum, naslov, bazen, število
setov), oštevilčeni seti, krepka vrstica *Skupaj: … m = … km* in prazna vrstica do naslednjega treninga.

## 10. Prenova (faza 2): prehrana in makro cilji

- **Prehrana** — trak zadnjih 7 dni (tapni *mesec* za starejši dan), trije makro krogi (tapni → Makro
  cilji), obroki po vrstah (zajtrk, kosilo, prigrizek, večerja; tapni obrok za urejanje ali brisanje),
  pijača (ploščice = en tap doda zadnjo količino, spodaj *Druga pijača*), dopolnila (tap = zabeleži,
  tap na ✓ = odstrani ta dan). Gumb **Dodaj hrano** odpre vnos.
- **Vnos** — *Hrana | Dopolnilo*, zavihka *Novo* in *Že jedel / Moja dopolnila*. Besedilo in/ali slika
  (kamera ali galerija); pri sliki polje postane »Dopiši, česar ni na sliki« in AI dobi oboje. Rezultat
  je urejljiv (ime, prepoznane sestavine — ✕ odšteje njihov delež, kcal/B/OH/M, količina ½–2).
  *Vpiši ročno, brez AI* ostane. Pred prvo AI uporabo se odpre okno za kodo (potrebna je Google prijava;
  *Pokaži kodo*, *Zapomni si na tej napravi*); ključavnica zgoraj desno kodo pozabi (dva tapa).
- **Razdeli na dva obroka** — drugi obrok in razmerje v korakih po 10 %. S kljukico »del še ni pojeden«
  se drugi del pokaže kot *Ostanki* z gumbi **Pojedel / Polovico / Zavrgel**; do potrditve ne šteje v
  vsote. Model: `split: { groupId, share }`, ostanek še `pending: true`.
- **Dopolnila** — etiketa in/ali besedilo (AI tudi samo iz besedila), odmerek, *kdaj* (zjutraj / po
  treningu / zvečer, shrani se kot `slot`).
- **Makro cilji** — *Samodejno* (Mifflin-St Jeor + vsakdanja aktivnost 1,25 / 1,4 / 1,55 + šport
  (MET − 1) × kg × ur/teden / 7, ±10 % za cilj; beljakovine g/kg, maščobe % energije, OH ostanek;
  masa iz zadnjega vnosa mase) ali *Po meri* (g/kg ali g na dan, opomba). **Koledar**: krona, ko so vsi
  trije makri ≥ 90 % cilja; pike za posamezne makre; število kron, najdaljši niz, % dni; nagrade.
  Nastavitve so v `kilometrina.goals` in v Drive kopiji (`goals`); v xlsx zavihek *Cilji*, v
  *Dnevnem pregledu* stolpec *Krona*, v *Prehrani* *Del obroka* in *Stanje*.

Stari obroki in dopolnila delujejo naprej; nova polja (`split`, `pending`, `slot`) so neobvezna.
Worker (`/meal`) zdaj vrne tudi `items` (prepoznane sestavine), `/supplement` pa sprejme tudi samo opis.

## 11. Prenova (faza 3): fitnes

**Trening → Fitnes.** Zgoraj *Nov program*: naloži PDF od trenerja ali slikaj list (lahko več strani),
obkljukaj **»Dovolim, da AI prebere ta program«** (brez tega gumb ne dela) in *Analiziraj z AI*. AI
(Worker, pot `/fitness`, isto preverjanje kot pri obrokih: koda + Google prijava) program samo prepiše:
mikrocikle, treninge A/B s ciljem, core, vse vaje s seti (`% · kg × ponovitve`, `× ponovitve` ali
sekunde), opombe, volumen in urnik. Pred shranjevanjem vidiš pregled in morebitne nejasnosti. Program se
nikoli ne spremeni sam. Brez PDF-ja lahko poskusiš s *primerom (junij 2026)*.

- **Program** — izbira treninga A/B in mikrocikla (pri vsakem, kolikokrat si ga že naredil — isti teden
  lahko večkrat), podatki tedna, urnik pon–ned (tap vklopi/izklopi dan).
- **Današnji trening** — ogrevanje in raztezanje s kljukico in nastavljivimi minutami, core s krogci
  serij, vaje s seti kot gumbi (tap = opravljen), *Uredi* po setih (kg, ponovitve/sekunde, + set, − set,
  *Na program*). Preklop **Program** trajno spremeni predpis za ta mikrocikel.
- **Namig** (brez AI): če si zadnjič pri vaji naredil manj ponovitev od programa in je ta teden teža
  višja, predlaga »ostani na X kg« — *Uporabi*.
- **Vse po programu** in **Potrdi trening** → povzetek (seti, volumen, core, minute) in namig za
  naslednjič; trening se pokaže v Zgodovini in na Danes. Sprememba po potrditvi posodobi isti zapis;
  *Še uredi* ga umakne.
- *Nov program* hrani tudi **arhiv** prejšnjih programov (*Uporabi*, *Izbriši*).

Podatki: `kilometrina.fitnessPrograms` in `kilometrina.fitnessLog` (v Drive kopiji kot `fitnessPrograms`,
`fitnessLog`), v xlsx zavihka *Fitnes dnevnik* in *Fitnes program*, v *Dnevnem pregledu* stolpec *Fitnes*.
Današnje kljukice pred potrditvijo so samo na napravi (`kilometrina.fitnessDraft`).

## 12. Prenova (faza 4): zdravje in zaključek

- **Zdravje** — zgoraj noč, na katero se nanašajo Oura podatki, in gumb za osvežitev. Obroči za
  pripravljenost, spanje in aktivnost; spanje s fazami (globoko / REM / lahko), učinkovitostjo, dihanjem
  in temperaturo; utrip čez noč (povprečje / najnižji) in HRV s trendom 14 dni. Celotna tabela 7 dni je
  pod *Oura · zadnjih 7 dni*.
- **Telesna masa** — graf 30 dni s spremembo, −/+ 0,1 kg in *Shrani* (za danes); drug dan in vse
  meritve pod *Drug dan in vse meritve*.
- **Povezave** — Oura (prijava, osveži, odjava), Google Drive (prijava, sinhroniziraj, obnovi, **odjava**)
  in AI geslo; pika pove stanje (zelena = povezano, rumena = delno / v teku).

Preverjeno na koncu: prazna aplikacija (vsi zasloni brez napak), obnova iz stare Drive kopije (pred
prenovo — stare »hitro vstavi« besede se pri tem dodajo med oznake), delovanje brez interneta (service
worker) in varni robovi za iPhone z zarezo (`viewport-fit=cover`, `env(safe-area-inset-*)`).

## 13. Popravki po prenovi

- **Krone ostanejo** — cilj, ki je veljal na določen dan, se zapomni (`kilometrina.goalHistory`, v Drive
  kopiji `goalHistory`). Sprememba ciljev ali nove mase velja od tega dne naprej; pretekle krone se ne
  spremenijo.
- **Slike obrokov v Drive** — glej razdelek 7.
- **Fitnes v Zgodovini** — tapni zapis → **Uredi** odpre ta trening v Fitnesu; vsaka sprememba sproti
  posodobi isti zapis (datum ostane). *Končano* te vrne na današnji trening.
- **Slogi plavanja so bližnjice** — v *Uredi bližnjice* (svinčnik pri vnosu treninga) dodaš, odstraniš ali
  premakneš gumbe za slog (npr. »prosto«); tipkan set jih prepozna po imenu.
- **Vsaka jed posebej** — AI (ali ročni vnos) vrne jedi na krožniku kot ločene jedi (npr. »Pražen riž«,
  »Jota«); vsaka se shrani kot svoj vnos. *Združi v eno jed* jih po potrebi združi, *+ Dodaj jed* doda novo.
- **Moje jedi** — vse, kar si že jedel. Med pisanjem se pod poljem pokažejo ujemajoče jedi — tap jo doda
  z isto količino kot zadnjič, brez AI. V *Že jedel* svinčnik ✎ desno od jedi odpre urejanje: novo ime
  se zapiše tudi v vse že shranjene obroke s to jedjo, kcal/B/OH/M za 1 porcijo veljajo za naslednje
  vnose; jed lahko tudi odstraniš s seznama. Spremembe so v `kilometrina.dishes` (v Drive kopiji `dishes`).
  Pri urejanju posameznega obroka (tap na Prehrani) kljukica *Preimenuj povsod* novo ime zapiše tudi v
  prejšnje vnose z istim imenom.
- **Dopolnila** — na Prehrani ✎ pri zabeleženem dopolnilu (ali čip *✎ Uredi*) odpre urejanje imena,
  vrednosti in sestavin; enako svinčnik v *Moja dopolnila*. Dopolnilo ima lahko kcal in makrohranila na
  odmerek (npr. proteinski napitek), ki se prištejejo dnevu. Preimenovanje preimenuje tudi pretekle vnose.
  Na Prehrani je blok *Vzeto danes* (kartica za vsak vnos: čas, sestavine, kcal) in pod njim *Še ni vzeto*
  (tap zabeleži z enakim številom odmerkov kot zadnjič). Število odmerkov se vedno spremeni z − / + ali
  vpisom (npr. 1,5); enako se izbere pred beleženjem v *Moja dopolnila* in pri novem dopolnilu z etikete.
- **Stari vnosi po jedeh** — v *Dodaj hrano → Že jedel* je kartica *Stari vnosi*: *Razdeli stare vnose na
  jedi (AI)* pošlje imena in vrednosti starih obrokov (Worker, pot `/split-meals`, isto preverjanje) in
  pokaže predogled (npr. »Losos z rižem → Losos 500 + Riž 320«). *Uporabi razdelitev* vsak tak obrok
  zamenja z vnosom na jed; skupne kcal in makri vsakega obroka ostanejo enaki, slika ostane pri prvi jedi,
  ostanki ostanejo ostanki. *Razveljavi razdelitev* vrne prejšnje stanje (kopija je samo na tej napravi).
  Obrok lahko razdeliš tudi ročno: tapni ga na Prehrani → *+ Razdeli: dodaj jed*.
- Google prijava še vedno velja približno 1 uro (namenoma).

## Ko boš želel dodati novo funkcijo

Vrni se v ta pogovor s Claude in povej, kaj bi rad spremenil ali dodal. Ko bom
posodobil `index.html` (ali druge datoteke), jih preprosto znova naložiš v isti
GitHub repozitorij (prepišeš stare) — sprememba bo na iPhonu vidna takoj ob
naslednjem odprtju aplikacije (ker se stran vedno najprej poskusi osvežiti iz
interneta), brez ponovnega "Dodajanja na začetni zaslon".

## Omejitve, ki jih je vredno poznati

- **En Client ID = ena gostovana stran.** Če kdaj spremeniš naslov strani (npr. preimenuješ
  repozitorij), moraš v Google Cloud Console dodati nov "Authorized JavaScript origin".
- **Prijava velja približno 1 uro.** Po preteku boš moral znova tapniti "Prijava v Google" —
  to je normalno in ne izbriše ničesar, samo osveži dovoljenje.
- **Nova naprava najprej obnovi.** Če aplikacijo odpreš na novi napravi (npr. iPadu ali po
  brisanju podatkov Safarija) in se prijaviš v Google, bo našla obstoječo kopijo v Drive, a je
  ne bo prepisala — status pokaže *"v Drive je že kopija"*. Tapni **"Obnovi iz Drive"**, od tam
  naprej pa ta naprava sinhronizira v isto datoteko. Obnova nadomesti podatke na napravi s
  tistimi iz Drive (ne združi jih), zato jo naredi, preden na novi napravi vneseš treninge.
- Repozitorij je **javno viden** (brezplačni GitHub Pages to zahteva) — kdorkoli s povezavo lahko
  vidi kodo in odpre aplikacijo, a brez tvoje Google prijave ne more videti tvojih podatkov.
