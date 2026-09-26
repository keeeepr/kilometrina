# Kilometrina — navodila za postavitev

Ta mapa vsebuje samostojno spletno aplikacijo (PWA), ki jo lahko gostiš
brezplačno na GitHub Pages in dodaš na domači zaslon iPhona kot pravo
aplikacijo, z varnostnim kopiranjem podatkov v tvoj Google Drive.

Datoteke:
- `index.html` — sama aplikacija
- `manifest.json`, `service-worker.js` — naredita jo namestljivo in delujočo brez interneta
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
    "confidence": "medium", "notes": "Predpostavljena 1 skodelica riža.",
    "source": "ai", "hasPhoto": true }
],
"supplements": [ { "id": "s-…", "date": "2026-09-26", "time": 1790000000000, "name": "Magnezij 300 mg" } ],
"supplementList": [ "Magnezij 300 mg", "Vitamin D 2000 IE" ]
```

`type` je `zajtrk`, `kosilo`, `vecerja` ali `prigrizek`; `source` je `ai` ali `manual`.

## 7. Prehrana: prehranski dnevnik z AI oceno

Na vrhu aplikacije izbereš **Treningi & Oura** ali **Prehrana** (izbira se zapomni). V delu
Prehrana:

- **Nov obrok** — tapni *Slikaj ali izberi sliko*; Claude (model Claude Opus 5) oceni ime obroka,
  kalorije, beljakovine, ogljikove hidrate in maščobe ter pove, kako zanesljiva je ocena in kaj je
  predpostavil. Številke lahko pred shranjevanjem popraviš. Namesto slike (ali poleg nje) lahko
  obrok opišeš, npr. "200 g riža, brez omake" — opis ima prednost pred sliko. Brez AI lahko
  številke vpišeš tudi ročno.
- **Obroki** — seznam za izbrani dan, s seštevkom zgoraj; vsak obrok lahko urediš ali izbrišeš.
- **Prehranska dopolnila** — enkrat dodaš svoja dopolnila (npr. "Magnezij 300 mg"), nato vsakič
  z enim dotikom zabeležiš, da si ga vzel.

Vse gre v Drive varnostno kopijo in v `kilometrina.xlsx` (zavihki *Prehrana*, *Dopolnila* in
*Dnevni pregled*, ki po dnevih združi km, kalorije, makrohranila, dopolnila in Oura podatke).
**Slike obrokov ostanejo samo na napravi**, kjer si jih slikal — za Drive so prevelike.

### Nastavitev (enkrat)

API ključ za Claude ne sme biti v `index.html` (repozitorij je javen), zato oceno naredi isti
Cloudflare Worker kot pri Ouri. Ker ključ stane denar, Worker zahteva še **geslo**, ki ga
aplikacija vpraša ob prvi oceni in si ga zapomni.

1. Na https://console.anthropic.com → **API Keys** → **Create Key** ustvari nov ključ (npr.
   "Kilometrina") in ga kopiraj.
2. Priporočeno: v **Settings → Limits** nastavi mesečno omejitev porabe.
3. V terminalu v tej mapi:

   ```sh
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put APP_PASSCODE
   ```

   Pri prvem prilepi API ključ, pri drugem si izmisli geslo (npr. 4–6 besed). Nobenega od njiju
   ne pošiljaj nikomur in ju ne vpisuj v kodo.
4. V aplikaciji odpri Prehrana, slikaj obrok in ob vprašanju vpiši geslo iz koraka 3.

Ena ocena obroka stane približno 1–3 cente (slika je pred pošiljanjem pomanjšana).

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
