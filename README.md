# Auto Delić — Dijelovi (kopija starog programa)

Nova aplikacija koja radi **na istoj bazi** kao stari program sa `dijelovi.delicauto.com`
(sve tabele i kolone su iste — samo prebačene iz MariaDB u SQLite).

Na Node.js 22.13+ ne treba nikakav paket. Na Node.js 20 pokreni jednom `npm install` (instalira `better-sqlite3`).

## Moduli

| Modul | Šta radi |
|---|---|
| **Početna** | brojke, zadnji uneseni / prodati / vraćeni dijelovi, aktivni nalozi, sadržaj polica P1 i P599 |
| **Dijelovi** | pretraga i filteri (marka, model, vrsta, grupa, strana, gorivo, lokacija, cijena, slike, OLX, datum, radnik), unos (sa vozila-donora, automatsko preuzimanje motora/mjenjača po pravilima vrste, kompleti i pod-dijelovi, „Sačuvaj + sljedeći”), izmjena, slike (kamera), premještanje, prodaja, povrat, kopija, etiketa sa barkodom, tekst oglasa, istorija lokacija/prodaje/naloga |
| **Nalozi** | nalog magacinu (hitno / za slanje / napomena, više dijelova u jednom nalogu), Novi → U realizaciji → Zatvoren (dio ide na P599), opciono prodaja pri zatvaranju; prodaja dijela sama zatvara nalog |
| **Vozila (donori)** | unos/izmjena, slike, YouTube, felne na vozilu, svi dijelovi sa vozila, zarada po vozilu, prodaja cijelog vozila |
| **Felne** | unos (F-šifre), filteri po vrsti/prečniku/širini/šarafima, premještanje, prodaja, povrat |
| **Magacin** | magacini → prolazi → regali → police → palete/kutije; automatski kodovi (A/B/C, R1, P123, PL5, K45), dodatne oznake (P600B), merdevine/viljuškar, premještanje paleta/kutija, etikete |
| **Premještanje** | ekran za magacionera: lokacija pa šifre dijelova jedna za drugom (Enter ili 📷 skeniranje kamerom) |
| **Inventura** | izaberi policu/kutiju, skeniraj sve što je fizički na njoj → šta nedostaje, šta je višak (višak se jednim dugmetom upiše na tu lokaciju) |
| **Analitika** | promet, prodato, uneseno, po radnicima (unos, slike, premještanja, prodaja, nalozi), najprodavanije vrste i marke, najisplativija vozila, stanje skladišta |
| **Korisnici** | korisnici, lozinke, profili i prava (ista prava kao stari program: ROLE_SP_*, ROLE_VEH_*, ROLE_REQ_* …) |
| **Administracija** | vrste dijelova (strane, pod-dijelovi, pravila), grupe, marke, modeli, šifarnici felni, tipovi lokacija, podešavanja (opisi oglasa…), pozadinski zadaci, OLX |

Globalna pretraga gore: šifra dijela (9N32), felne (F189), vozila (440), broj naloga, lokacija (P123), kataloški broj. Dugme 📷 skenira barkod etikete kamerom telefona (Chrome na Androidu).

Ostalo: zvuk i vibracija kad stigne novi nalog (ekran Nalozi), brza izmjena cijene (✏️ pored cijene), automatska dnevna rezervna kopija baze (Administracija → Rezervne kopije), zaštita od pogađanja lozinke, kompresija podataka za brži rad na mobilnim podacima.

## Instalacija na VPS (Termius)

```bash
# 1) Node.js 20 ili noviji (node -v). Na Node 20 u folderu programa jednom: npm install

# 2) Kod
mkdir -p /var/www/delic-dijelovi && cd /var/www/delic-dijelovi
#   (raspakuj ZIP ovdje ili git clone)

# 3) Podešavanja
cp .env.example .env
sed -i "s/promijeni-me/$(openssl rand -hex 24)/" .env    # nasumičan tajni ključ; PORT=3020

# 4) Baza iz backupa starog programa (fajl prebaci na server preko Termius SFTP)
node --no-warnings tools/import.js /root/delic08072026.sql.gz
#   traje ~10 sekundi; može se ponoviti sa novijim backupom kad god (stara baza se sačuva kao rezerva)

# 5) Lozinka i puna prava za tebe
npm run set-password -- peendo@gmail.com TvojaLozinka
npm run superadmin -- peendo@gmail.com

# 6) Pokretanje
pm2 start ecosystem.config.cjs && pm2 save
```

Stare lozinke radnika možda rade odmah (pokušava se isti SHA-256 kao stari program).
Ako ne rade — postavi im novu u **Korisnici → korisnik → 🔑 Lozinka**.

### Nginx (npr. novi poddomen `dijelovi2.delicauto.com`)

```nginx
server {
    server_name dijelovi2.delicauto.com;
    client_max_body_size 30M;
    location / {
        proxy_pass http://127.0.0.1:3020;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```
Pa `certbot --nginx -d dijelovi2.delicauto.com`.

## Automatsko ažuriranje sa GitHuba

```bash
(crontab -l 2>/dev/null; echo "* * * * * /var/www/delicdijelovi/deploy.sh >> /var/log/delicdijelovi-deploy.log 2>&1") | crontab -
```
Svaki minut provjeri GitHub; ako ima novog koda — povuče ga i restartuje program (`.env` i baza se ne diraju).

## Slike

Backup baze sadrži samo **spisak** slika (442.619 zapisa), ne i same fotografije — one su na serveru starog programa.
- Kad dobiješ folder sa slikama od programera: `npm run import-images -- /putanja/do/slika`
  (prepoznaje fajlove po ID-u slike u imenu i kopira u `data/uploads/`).
- Ili, ako stari server daje slike po ID-u na nekoj adresi, upiši u `.env`:
  `IMG_FALLBACK_URL=https://dijelovi.delicauto.com/...{id}...` — aplikacija će preusmjeravati na stare slike.
- Nove slike se čuvaju u `data/uploads/<id>.jpg` (+ umanjena `_t.jpg`), telefon ih sam smanji prije slanja.

## OLX

Nakon uvoza OLX integracija je **isključena**, da nova i stara aplikacija ne bi istovremeno objavljivale/skidale oglase.
Kad se pređe potpuno na novi program: **Administracija → Podešavanja** → OLX pristup (client ID/token iz starog programa
ili OLX korisničko ime + lozinka) → uključi „OLX integracija uključena”. Tada:
- prodat dio se odmah skida sa OLX-a,
- zadatak `OLX_INTEGRATION` (02 i 04 h) objavljuje nove dijelove sa slikom,
- dugmad „OLX objavi / ukloni” na dijelu.
Prvo probaj ručno na jednom dijelu i pogledaj **Administracija → OLX → Dnevnik**.

## Javni API za webshop

U `.env` postavi `PUBLIC_API_KEY=nesto-tajno`, pa:
- `GET /api/public/parts?limit=100&offset=0` — svi dijelovi na stanju (sa slikama `/img/<id>`)
- `GET /api/public/parts?since=2026-11-01 00:00:00` — sve izmjene od datuma (prodati/obrisani imaju `available:false`)
- `GET /api/public/parts/9N32` — jedan dio
Zaglavlje: `X-API-Key: nesto-tajno`.

## Rezervna kopija

Cijela baza je jedan fajl: `data/delic.db` (+ slike u `data/uploads/`).
Program sam pravi komprimovanu kopiju svaki dan u 03:10 u `data/backups/` (čuva zadnjih 10) — vidi i preuzmi u **Administracija → Rezervne kopije**.
Vraćanje kopije: `pm2 stop delic-dijelovi && gunzip -c data/backups/delic-DATUM.db.gz > data/delic.db && rm -f data/delic.db-wal data/delic.db-shm && pm2 start delic-dijelovi`.

Ponovni uvoz starog backupa (`tools/import.js`) odbija da prepiše postojeću bazu bez `--force` — da se slučajno ne izgubi ono što je uneseno u novoj aplikaciji.

## Struktura

```
server/index.js        provjera Node verzije + .env
server/main.js         HTTP server
server/db.js           SQLite, indeksi
server/schema.sql      šema (ista kao stari program)
server/seed.sql        početni šifarnici za praznu bazu (login admin / admin)
server/routes/*.js     API: parts, vehicles, rims, whs, req, users, admin, analytics, dashboard, files, olx, public
server/olx.js          OLX.ba API
server/scheduler.js    pozadinski zadaci iz core_factory_task
public/                aplikacija (bez build koraka)
public/js/modules/*.js ekrani po modulima
tools/                 import.js, import-images.js, set-password.js, make-superadmin.js
```
