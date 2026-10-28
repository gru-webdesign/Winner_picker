# Žreb: Instagram winner picker

Nalepiš link Instagram objave, Žreb preuzme sve komentare, primeni pravila i izvuče pobednike. Isti princip kao Wask i GiveawayPick.

```
index.html  (GitHub Pages)  ──►  worker/  (Cloudflare Worker, čuva token)  ──►  Apify Instagram Comments Scraper
```

Instagram ne dozvoljava pregledaču da direktno čita komentare, pa ih preuzima Apify scraper. Worker stoji između sajta i Apify-ja da Apify token ne bi bio vidljiv posetiocima.

## Pokretanje (jednom, oko 10 minuta)

### 1. Apify nalog
1. Napravi besplatan nalog na [apify.com](https://apify.com). Dobija se $5 kredita mesečno, što je oko 1.900 komentara.
2. Console → Settings → API & Integrations → kopiraj **Personal API token**.

### 2. Cloudflare Worker
Potreban je besplatan nalog na [cloudflare.com](https://dash.cloudflare.com) i Node.js.

```bash
cd worker
npx wrangler login
npx wrangler secret put APIFY_TOKEN     # nalepi Apify token
npx wrangler deploy
```

Wrangler ispiše adresu, npr. `https://zreb-api.tvoje-ime.workers.dev`.

U `worker/wrangler.toml` po potrebi promeni:
- `ALLOWED_ORIGINS`: sajt koji sme da koristi Worker (podrazumevano `https://gru-webdesign.github.io`)
- `MAX_COMMENTS`: najviše komentara po objavi, štiti kredit (podrazumevano 2000)
- `MAX_POSTS`: najviše objava u jednom žrebu (podrazumevano 10)

### 3. Poveži sajt sa Workerom
U `index.html` upiši adresu Workera:

```js
const DEFAULT_API = "https://zreb-api.tvoje-ime.workers.dev";
```

Commit, push. Posetiocima više ne treba nikakvo podešavanje.

### 4. GitHub Pages
Repo → Settings → Pages → Deploy from branch → `main` / root. Sajt: `https://gru-webdesign.github.io/winner_picker/`.

**Bez Workera:** u aplikaciji klikni zupčanik i unesi svoj Apify token. Čuva se samo u tom pregledaču. Dobro za ličnu upotrebu, ne za javni sajt.

## Kako se koristi

1. **Objava**: nalepi link (`/p/`, `/reel/`, `/tv/`). Preuzimanje kreće samo. Može i više objava u jednom žrebu.
2. **Pravila**: podesi uslove.
3. **Učesnici**: vidi ko važi, a ko je isključen i zašto.
4. **Pobednici**: pobednici i rezerve, kod žreba, tekst za kopiranje, slika za story i **link rezultata** koji može da se podeli pratiocima.

## Pravila

| Pravilo | Opis |
|---|---|
| Broj pobednika i rezervi | Rezerve zamenjuju diskvalifikovane |
| Minimum tagova | Koliko @tagova mora da ima komentar (0 do 20) |
| Tagovi se ne ponavljaju | Ista tagovana osoba se korisniku računa samo jednom |
| Ne računaj tag sebe i stranice | Tag sopstvenog naloga ili organizatora ne važi |
| Svaki komentar / jedan po korisniku | Više šansi za više komentara ili samo jedna |
| Limit šansi po korisniku | Npr. najviše 3 komentara po osobi |
| Ponavljanje pobednika | Da li isti korisnik može da osvoji više mesta |
| Praćenje stranice | Bez provere, ručna potvrda ili poređenje sa listom pratilaca |
| Obavezna reč ili hashtag | Npr. `#nagradnaigra` |
| Rok za komentare | Komentari posle roka ne važe |
| Isključeni nalozi | Zaposleni, partneri |
| Odgovori na komentare | Apify ih vraća samo na plaćenom planu |
| Kod žreba | Isti kod i isti komentari daju isti rezultat |

## Provera praćenja

Ni Instagram ni scraperi ne mogu pouzdano da provere da li neko prati stranicu. Postoje dve opcije:

- **Ručna potvrda**: za svakog pobednika otvoriš profil, pa potvrdiš ili ga zameniš sledećom rezervom.
- **Lista pratilaca**: Instagram → Centar naloga → Tvoje informacije i dozvole → Preuzmi informacije → Pratioci i praćenja, JSON. Učitaj `followers_1.json`.

## Troškovi

| | Besplatno | Napomena |
|---|---|---|
| GitHub Pages | da | |
| Cloudflare Worker | da, 100.000 zahteva dnevno | jedan žreb je 10 do 30 zahteva |
| Apify | $5 mesečno, oko 1.900 komentara | zatim oko $2,3 do $2,6 na 1.000 komentara |

## Ostali unosi

Pod „Drugi načini unosa“: nalepljen tekst sa instagram.com ili fajl (CSV `username,text,timestamp`, Apify JSON, Graph API JSON).
