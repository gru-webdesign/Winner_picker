# Žreb: Instagram winner picker

Izvlačenje pobednika nagradne igre iz komentara na Instagram objavi. Jedan `index.html`, bez servera i bez build koraka. Sve se računa u pregledaču.

## Kako se koristi

1. **Komentari**: nalepi komentare kopirane sa instagram.com, učitaj CSV/JSON/TXT fajl ili ih preuzmi direktno preko Instagram Graph API-ja.
2. **Pravila**: podesi uslove (ispod).
3. **Učesnici**: pregledaj ko važi, a ko je isključen i zašto.
4. **Izvuci pobednike**: dobiješ pobednike, rezerve, kod žreba, tekst za kopiranje i sliku za story (1080×1920).

## Pravila

| Pravilo | Opis |
|---|---|
| Broj pobednika i rezervi | Rezerve služe za zamenu diskvalifikovanih |
| Minimum tagova | Koliko @tagova mora da ima komentar |
| Tagovi se ne ponavljaju | Ista tagovana osoba se korisniku računa samo jednom |
| Ne računaj tag sebe i stranice | Tag sopstvenog naloga ili organizatora ne važi |
| Svaki komentar / jedan po korisniku | Više šansi za više komentara ili samo jedna |
| Limit šansi po korisniku | Npr. najviše 3 komentara po osobi |
| Ponavljanje pobednika | Da li isti korisnik može da osvoji više mesta |
| Praćenje stranice | Bez provere, ručna potvrda (profil, potvrdi ili zameni rezervom) ili poređenje sa listom pratilaca |
| Obavezna reč ili hashtag | Npr. `#nagradnaigra` |
| Rok za komentare | Komentari posle roka ne važe (ako postoji vreme komentara) |
| Isključeni nalozi | Zaposleni, partneri, vlasnik |
| Odgovori na komentare | Uključi ili isključi |
| Kod žreba | Isti kod i isti komentari daju isti rezultat, pa izvlačenje može da se proveri |

Nasumičnost: seed se pravi preko `crypto.getRandomValues`, a izvlačenje koristi deterministički PRNG (sfc32) nad tim seedom.

## Provera praćenja

Instagram API ne daje listu pratilaca. Zato postoje dve opcije:

- **Ručna potvrda**: za svakog pobednika otvoriš profil i potvrdiš ili ga zameniš sledećom rezervom.
- **Lista pratilaca**: Instagram → Podešavanja → Centar naloga → Tvoje informacije i dozvole → Preuzmi informacije → Pratioci i praćenja, format JSON. Učitaj `followers_1.json`. Radi i TXT lista korisničkih imena.

## Instagram Graph API

Potreban je poslovni ili kreatorski Instagram nalog povezan sa Facebook stranicom.

1. Na [developers.facebook.com](https://developers.facebook.com) napravi aplikaciju.
2. U Graph API Explorer-u generiši User token sa dozvolama `instagram_basic`, `instagram_manage_comments`, `pages_show_list`, `pages_read_engagement`.
3. Nalepi token u aplikaciju, klikni „Učitaj moje objave“ i izaberi objavu.

Token se ne čuva i ne šalje nigde osim na `graph.facebook.com`. Verzija API-ja je u konstanti `GRAPH` u `index.html`.

## Format fajlova

CSV sa kolonama `username,text,timestamp` (prepoznaju se i `korisnik`, `komentar`, `datum`, `user`, `comment`...). JSON niz objekata sa istim poljima ili odgovor Graph API-ja (`{ "data": [...] }`).

## Objavljivanje

GitHub Pages: Settings → Pages → Deploy from branch → `main` / root. Stranica je dostupna na `https://gru-webdesign.github.io/winner_picker/`.
