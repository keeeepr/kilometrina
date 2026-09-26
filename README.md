# Kilometrina — navodila za postavitev

Ta mapa vsebuje samostojno spletno aplikacijo (PWA), ki jo lahko gostiš
brezplačno na GitHub Pages in dodaš na domači zaslon iPhona kot pravo
aplikacijo, z varnostnim kopiranjem podatkov v tvoj Google Drive.

Datoteke:
- `index.html` — sama aplikacija
- `manifest.json`, `service-worker.js` — naredita jo namestljivo in delujočo brez interneta
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — ikona aplikacije
- `oura-token-exchange.js` — majhen Cloudflare Worker za prijavo v Oura (glej razdelek 5).
  Te datoteke **ni treba** nalagati na GitHub — teče na Cloudflare, ne na GitHub Pages.

## 1. Postavi GitHub Pages (gostovanje, brezplačno)

1. Pojdi na https://github.com in si ustvari brezplačen račun, če ga še nimaš.
2. Klikni **New repository**. Ime naj bo npr. `kilometrina`. Nastavi ga kot **Public**
   (GitHub Pages v brezplačni verziji zahteva javni repozitorij — vsebina bo javno
   vidna komurkoli s povezavo, kar je za to aplikacijo v redu, ker ne vsebuje gesel).
3. Naloži `index.html`, `manifest.json`, `service-worker.js` in tri ikone (6 datotek) v repozitorij (v spletnem vmesniku: **Add file → Upload files**).
4. Pojdi v **Settings → Pages**. Pod "Branch" izberi `main` in mapo `/ (root)`, nato **Save**.
5. Po približno minuti bo stran dostopna na `https://TVOJE-UPORABNIŠKO-IME.github.io/kilometrina/`.

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
     npr. `https://TVOJE-UPORABNIŠKO-IME.github.io` (brez `/kilometrina/` na koncu).
   - Klikni **Create**. Prikaže se **Client ID** (izgleda kot `123456-abc.apps.googleusercontent.com`).

## 3. Vstavi Client ID v kodo

V `index.html` poišči vrstico (bližje vrhu `<script>` bloka):

```js
const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com';
```

Zamenjaj `YOUR_CLIENT_ID_HERE.apps.googleusercontent.com` s svojim pravim Client ID iz koraka 2,
shrani datoteko in jo znova naloži v GitHub repozitorij (prepiše obstoječo `index.html`).

## 4. Dodaj na iPhone

1. Na iPhonu v Safariju odpri `https://TVOJE-UPORABNIŠKO-IME.github.io/kilometrina/`.
2. Tapni **Deli → Dodaj na začetni zaslon**.
3. Odpri aplikacijo z nove ikone, tapni **"Prijava v Google"** in dovoli dostop.
   Od zdaj naprej se bo vsak vnos samodejno (z nekaj sekund zamika) sinhroniziral
   v datoteko `kilometrina-podatki.json` v tvojem Google Drive.

## 5. Oura Ring nastavitev (neobvezno)

Aplikacija lahko pokaže tvoje Oura ocene (spanec, pripravljenost, aktivnost, HRV) in
srčni utrip (najnižji / povprečni) za zadnjih 7 dni, pri vsakem treningu v zgodovini pa ocene za tisti dan.

Zakaj je potreben še Cloudflare: Oura ne izdaja več osebnih žetonov (Personal Access
Tokens), prijava gre samo prek OAuth, ta pa zahteva **skrivni ključ** (client secret).
Tega ne smemo dati v `index.html`, ker je repozitorij javen. Zato skrivni ključ hrani
majhen brezplačen Cloudflare Worker (`oura-token-exchange.js`), ki samo zamenja kodo za
žeton — ničesar ne shranjuje.

### 5a. Registriraj aplikacijo pri Oura

1. Pojdi na https://cloud.ouraring.com/oauth/applications in se prijavi s svojim Oura računom.
2. Klikni **New Application** in izpolni:
   - **Display Name**: npr. `Kilometrina`
   - **Description**: npr. `Osebna aplikacija za beleženje plavalnih treningov.`
   - **Contact Email**: tvoj e-mail
   - **Website**: naslov strani, npr. `https://TVOJE-UPORABNIŠKO-IME.github.io/kilometrina/`
   - **Privacy Policy URL** in **Terms of Service URL**: Oura ju zahteva, za osebno uporabo pa
     zadošča kar povezava na tvoj GitHub repozitorij, npr.
     `https://github.com/TVOJE-UPORABNIŠKO-IME/kilometrina` (lahko pri obeh ista).
   - **Redirect URIs**: točen naslov strani **s** končno poševnico, npr.
     `https://TVOJE-UPORABNIŠKO-IME.github.io/kilometrina/`
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
   npx wrangler deploy oura-token-exchange.js \
     --name kilometrina-oura \
     --compatibility-date 2025-01-01 \
     --var ALLOWED_ORIGIN:https://TVOJE-UPORABNIŠKO-IME.github.io
   npx wrangler secret put OURA_CLIENT_ID     --name kilometrina-oura
   npx wrangler secret put OURA_CLIENT_SECRET --name kilometrina-oura
   ```

   Pri zadnjih dveh ukazih te vpraša za vrednost — prilepi Client ID oziroma Client Secret iz 5a.
   `ALLOWED_ORIGIN` je naslov strani **brez** poti (brez `/kilometrina/`). Za lokalno testiranje
   lahko navedeš več naslovov, ločenih z vejico, npr.
   `https://TVOJE-UPORABNIŠKO-IME.github.io,http://localhost:8000`.
3. `deploy` izpiše naslov Workerja, npr. `https://kilometrina-oura.TVOJ-RACUN.workers.dev`.

### 5c. Vstavi podatke v kodo

V `index.html` poišči in zamenjaj:

```js
const OURA_CLIENT_ID = 'YOUR_OURA_CLIENT_ID';
const OURA_WORKER_URL = 'https://kilometrina-oura.YOUR-SUBDOMAIN.workers.dev';
```

s svojim Client ID (ta ni skriven) in naslovom Workerja (brez poševnice na koncu). Znova naloži
`index.html` na GitHub, odpri aplikacijo in tapni **"Prijava v Oura"**.

Podatki se samodejno osvežijo ob vsakem odprtju aplikacije (zadnjih 14 dni), ali ročno z
**"Osveži zdaj"**. Prijava v Oura ostane veljavna (aplikacija žeton sama osvežuje), dokler ne tapneš **"Odjava"**.
Oura podatki se hranijo samo v brskalniku na napravi, ne v Drive varnostni kopiji — ob
ponovni prijavi se preprosto znova naložijo.

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
