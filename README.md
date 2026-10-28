# Žreb: Instagram winner picker

Izvlačenje pobednika nagradne igre iz komentara na Instagram objavi. Besplatno, bez instalacije, bez API ključeva i bez posebne prijave.

**Aplikacija:** https://gru-webdesign.github.io/Winner_picker/

## Kako radi

1. **Prevuci dugme Žreb na traku sa obeleživačima.** Samo prvi put.
2. **Otvori objavu na Instagramu i klikni Žreb** u traci. Komentari se preuzimaju (napredak se vidi na samoj objavi).
3. **Klikni „Otvori u Žrebu“.** Komentari stižu u Žreb, ti podesiš pravila i izvučeš pobednike.

Obeleživač čita komentare u tvom pregledaču, sa prijavom koju već imaš na Instagramu, istim pozivima koje Instagram koristi dok skroluješ komentare. Ništa ne ide preko drugog servera. Radi na računaru (Chrome, Edge, Firefox, Safari).

## Pravila

- broj pobednika i rezervi (do 100)
- minimum tagova u komentaru, bez ponavljanja istih tagova i bez taga sebe ili organizatora
- svaki komentar je šansa ili jedan korisnik jedna šansa, uz limit šansi po korisniku
- da li isti korisnik može da osvoji više puta
- provera praćenja: ručna potvrda pobednika ili poređenje sa listom pratilaca iz Instagram izvoza
- obavezna reč ili hashtag, rok za komentare, isključeni nalozi, odgovori na komentare
- više objava u jednom žrebu
- kod žreba: isti kod i isti komentari daju isti rezultat

Rezultat: pobednici, rezerve, tekst za kopiranje, slika za story i javni link rezultata za pratioce. Pravila se pamte u pregledaču za sledeći žreb.

## Objavljivanje na GitHub Pages

Settings → Pages → Deploy from branch → `main` / `/ (root)` → Save. Za minut-dva aplikacija je na adresi iznad.

## Napomena

Ako Instagram promeni svoje interne pozive, obeleživač može prestati da radi. Kod obeleživača je funkcija `zrebBookmarklet` na vrhu `index.html`. Posle izmene u Žrebu ponovo prevuci dugme na traku.
