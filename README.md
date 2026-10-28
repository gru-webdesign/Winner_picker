# Žreb: Instagram winner picker

Nalepiš link Instagram objave, Žreb sam preuzme sve komentare, primeni pravila, izvuče pobednike i proveri da li prate stranicu.

Potpuno nezavisna aplikacija: **sopstveni scraper**, bez Apify-ja, bez Instagram API ključeva i bez npm paketa. Jedino što treba je [Node.js](https://nodejs.org) (LTS).

## Pokretanje

1. Instaliraj Node.js LTS sa [nodejs.org](https://nodejs.org) (jednom).
2. Preuzmi repo: zeleno dugme **Code → Download ZIP**, pa raspakuj.
3. Dupli klik na:
   - **Windows:** `start-windows.bat`
   - **Mac:** `start-mac.command` (prvi put: desni klik → Open)
   - **Linux:** `./start-linux.sh`
4. Otvoriće se `http://localhost:4747`. Prijavi se na Instagram nalog, nalepi link objave, gotovo.

Ili iz terminala: `node server.js`.

## Kako preuzima komentare

Žreb radi isto što i instagram.com u pregledaču kad otvoriš objavu i skroluješ komentare. Koristi iste interne pozive kao open-source alati [Instaloader](https://instaloader.github.io) i instagrapi:

| Korak | Endpoint |
|---|---|
| Prijava (lozinka, 2FA) | `/api/v1/web/accounts/login/ajax/`, `.../two_factor/` |
| Kod iz linka u ID objave | dekodiranje baze 64, rezervno iz HTML-a objave |
| Podaci o objavi | `/api/v1/media/{id}/info/` |
| Komentari | `/api/v1/media/{id}/comments/` sa `min_id` / `max_id` kursorom |
| Odgovori | `/api/v1/media/{id}/comments/{pk}/child_comments/` |
| Provera praćenja | `/api/v1/friendships/{id}/followers/?query=` |

Ponaša se kao čovek: 1 do 2 sekunde između strana, duža pauza na svakih 20 strana, a kad Instagram traži da se uspori (HTTP 429), čeka i nastavlja sam. Oko 15 komentara po strani znači **1.000 komentara za oko 2 minuta**.

Pauze se podešavaju promenljivom `ZREB_PACE` (npr. `ZREB_PACE=2 node server.js` za opreznije preuzimanje velikih objava).

## Prijava na Instagram

Instagram ne prikazuje komentare bez prijave, pa Žreb koristi tvoj nalog:

- **Korisničko ime i lozinka**, uz kod ako imaš dvofaktorsku zaštitu. Lozinka se ne čuva. Čuvaju se samo kolačići sesije, i to u `.zreb/session.json` na tvom računaru.
- **Kolačić sessionid**, ako Instagram traži dodatnu potvrdu: na instagram.com u Chrome-u F12 → Application → Cookies → `sessionid`.

Preporuka: koristi **sporedni nalog**. Instagram ne dozvoljava automatsko čitanje u uslovima korišćenja i može privremeno ograničiti nalog koji šalje mnogo zahteva. Za nagradne igre sa nekoliko hiljada komentara to se u praksi retko dešava.

## Obeleživač (bez instalacije)

Verzija na GitHub Pages (`https://gru-webdesign.github.io/Winner_picker/`) radi i bez Node.js:

1. Prevuci dugme **Žreb** na traku sa obeleživačima.
2. Otvori objavu na instagram.com (prijavljen).
3. Klikni obeleživač. Komentari se preuzimaju u tom tabu i stižu u Žreb.

Ako pregledač blokira prozor, obeleživač sačuva `zreb-komentari.json`, koji učitaš pod **Drugi načini unosa → Fajl**. Automatska provera praćenja radi samo u lokalnoj aplikaciji.

## Pravila

| Pravilo | Opis |
|---|---|
| Broj pobednika i rezervi | do 100 |
| Minimum tagova | 0 do 20 @tagova u komentaru |
| Tagovi se ne ponavljaju | ista tagovana osoba se računa samo jednom po korisniku |
| Ne računaj tag sebe i organizatora | |
| Svaki komentar / jedan po korisniku | uz limit šansi po korisniku |
| Ponavljanje pobednika | isti korisnik na više mesta ili ne |
| Praćenje stranice | automatska provera (zamenjuje one koji ne prate), ručna potvrda, ili lista pratilaca iz Instagram izvoza |
| Više naloga za praćenje | npr. organizator i partner |
| Obavezna reč ili hashtag, rok, isključeni nalozi, odgovori | pod „Dodatni uslovi“ |
| Više objava u jednom žrebu | do 10 linkova |
| Kod žreba | isti kod i isti komentari daju isti rezultat (proverljivo) |

Rezultat: pobednici, rezerve, diskvalifikovani sa razlogom, tekst za kopiranje, slika za story (1080×1920) i **javni link rezultata** za pratioce.

## Testovi

```bash
npm test
```

Pokreće lažni Instagram server (`test/mock-instagram.js`) i prolazi ceo tok: prijava sa 2FA, 260 komentara kroz 18 strana, pauza posle 429, odgovori, provera praćenja, bezbednost. Ako Instagram promeni odgovore, ovde se vidi šta treba prilagoditi u `scraper/instagram.js`.

## Struktura

```
index.html              aplikacija (radi i kao statična stranica na GitHub Pages)
server.js               lokalni server na 127.0.0.1:4747
scraper/instagram.js    scraper: prijava, komentari, odgovori, praćenje
start-*.bat/.command/.sh  pokretači
test/                   lažni Instagram i testovi
```

Server sluša samo na `127.0.0.1` i odbija zahteve sa drugih adresa, pa niko na mreži ne može da koristi tvoju sesiju.
