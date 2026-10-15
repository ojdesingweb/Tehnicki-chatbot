# Best Asistent — chat bot backend za Autocentar Best

Ovo je kompletan sistem (ne demo): Node.js/Express backend koji poziva
pravi AI model, uz bazu znanja izvučenu sa sajta i iz dva zvanična
Pravilnika, plus frontend widget (crveno dugme za chat) koji se ubacuje na
bilo koji sajt jednom `<script>` linijom.

Backend podržava dva AI provajdera, bez izmene koda — samo se menja koji
ključ je upisan u environment:

- **Groq — potpuno besplatno, bez kartice.** Za demo klijentu dok ne
  odluči da li plaća. Dovoljno dobar kvalitet, ali preporučeno samo za
  probu/demo, ne za trajnu produkciju (Groq ume da promeni besplatne limite
  bez najave).
- **Anthropic (Claude) — plaćeno, najbolji kvalitet.** Za kad klijent
  pristane da pokrije troškove.

Ako je `GROQ_API_KEY` postavljen, koristi se Groq; inače, ako je
`ANTHROPIC_API_KEY` postavljen, koristi se Claude. Prelazak sa jednog na
drugi je samo promena environment promenljive, restart servera — ništa se
ne menja u kodu.

## Kako sve radi (ukratko)

1. Klijent otkuca pitanje u widgetu na sajtu.
2. Widget (`widget/bot_widget.js`) šalje pitanje na backend (`POST /api/chat`).
3. Backend pretraži bazu znanja (`server/kb/chunks.json`, 228 delova — sadržaj
   sajta + oba Pravilnika) i nađe 6 najrelevantnijih delova (BM25 pretraga,
   bez spoljnih troškova).
4. Backend pošalje ta 6 dela + pitanje Claude AI modelu, sa strogim
   uputstvom da odgovara SAMO na osnovu toga i da ne izmišlja.
5. Ako model nije siguran u odgovor, pitanje se beleži kao "neodgovoreno"
   (vidi `/api/admin/unanswered`) da bi osoblje moglo ručno da odgovori i da
   se po potrebi doda u bazu znanja.

## Šta ti treba da ovo zaživi (besplatna verzija za demo)

1. **Groq API ključ — besplatno, bez kartice.** Napraviš nalog na
   https://console.groq.com (samo email) i ključ na
   https://console.groq.com/keys.
2. **Hosting za backend** (gde će server 24/7 da radi) — Render.com,
   besplatan plan. Uputstvo ispod.
3. Ja nemam ovlašćenje niti nalog da ovo radim umesto tebe (API ključ i
   hosting nalog moraju biti na tvoje ime/mejl), ali mogu da te provedem
   kroz svaki korak ili da ti pripremim tačno šta da unosiš.

Kasnije, kad klijent pristane da plaća, prebacivanje na pravi Claude je
samo zamena jednog environment podatka (vidi ispod) — ništa se ne menja u
kodu niti u widgetu.

## Lokalno testiranje (na tvom računaru)

```bash
npm install
cp .env.example .env
# ostavi sve prazno i upiši MOCK_MODE=1 da prvo proveriš da sve radi
npm start
```

Zatim otvori `http://localhost:3000/demo` u pretraživaču — videćeš praznu
test-stranicu sa chat dugmetom. Radiće, ali će davati test-odgovore
(označene sa "[MOCK]") umesto pravih AI odgovora — to samo dokazuje da
server, baza znanja i widget rade ispravno pre nego što uključimo pravi AI.

Kad dobiješ Groq ključ: u `.env` upiši `GROQ_API_KEY=gsk_...` i postavi
`MOCK_MODE=0`. Restartuj server (`npm start`) — na `/api/health` treba da
piše `"provider":"groq"`. Na `/demo` sad dobijaš prave AI odgovore,
besplatno.

## Deploy na hosting (Render.com — besplatan plan)

1. Napraviš nalog na https://render.com (može preko GitHub naloga, bez
   kartice za free plan).
2. "New +" → "Web Service".
3. Poveži svoj GitHub repo sa ovim kodom (ili uploaduj direktno — Render
   nudi i to).
4. Podesi:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. U "Environment" sekciji dodaj promenljive:
   - `GROQ_API_KEY` → tvoj besplatni ključ
   - `ADMIN_SECRET` → neka tvoja lozinka (čuvaj je tajno)
   - `ALLOWED_ORIGINS` → tačan domen klijentovog sajta, npr.
     `https://autocentarbest.rs` (ili privremeno `*` dok testiraš)
   - `MOCK_MODE` → `0`
6. Klikni "Create Web Service". Render ti daje adresu tipa
   `https://autobest-bot.onrender.com` — i to je to, sve besplatno.
7. Na klijentov sajt dodaš pred `</body>`:
   ```html
   <script>window.BEST_ASISTENT_API_URL = "https://autobest-bot.onrender.com";</script>
   <script src="https://autobest-bot.onrender.com/widget/bot_widget.js"></script>
   ```

Napomena: besplatan Render plan "zaspi" posle 15 min neaktivnosti i prvi
sledeći poziv tad traje par sekundi duže (widget će samo malo duže
prikazivati "piše..." prvi put).

## Kad klijent pristane da plaća — prelazak na Claude (bolji kvalitet)

1. Napraviš Anthropic nalog na https://console.anthropic.com, uneseš
   karticu, napraviš ključ na https://console.anthropic.com/settings/keys.
2. Na Render-u, u Environment sekciji, dodaš `ANTHROPIC_API_KEY` i (po
   želji) obrišeš `GROQ_API_KEY` — ili ga samo ostaviš, nebitno, jer kod
   uvek prvo gleda Groq ako postoji; ako hoćeš da pređeš na Claude dok oba
   ključa postoje, obriši `GROQ_API_KEY` sa Render-a.
3. Render sam restartuje servis — gotovo, sad odgovara pravi Claude.

## Pregled neodgovorenih pitanja

Otvori u pretraživaču:

```
https://<tvoj-backend>/api/admin/unanswered?secret=<tvoj ADMIN_SECRET>
```

Tu vidiš listu pitanja na koja bot nije bio siguran da odgovori — odatle
znaš šta da doplniš u `server/kb/site_content.md` (pa pokreneš
`npm run build-kb` i restartuješ server da osveži bazu znanja).

## Struktura projekta

```
server/
  index.js            — Express server, /api/chat, /api/admin/unanswered
  retrieval.js         — BM25 pretraga baze znanja (bez spoljnih troškova)
  kb/
    site_content.md     — ručno unet sadržaj sajta (uredi ovde za izmene)
    raw_tehnicki_pregled.txt   — čist tekst iz Pravilnika o tehničkom pregledu
    raw_podela_vozila.txt      — čist tekst iz Pravilnika o podeli vozila
    build_chunks.py      — pravi chunks.json od gornja tri fajla
    chunks.json          — generisana baza znanja (ne uređuj ručno)
widget/
  bot_widget.js         — widget za ubacivanje na klijentov sajt
  demo.html             — prazna test-stranica za lokalno testiranje
.env.example             — šablon za podešavanja (kopiraj u .env)
```

## Mesečno održavanje (orijentaciono, za dogovor sa klijentom)

- Hosting backend-a: besplatno (Render free plan), ili par dolara mesečno
  za plaćeni plan (da ne "spava").
- AI pozivi: $0 na Groq-u (dok demo traje), ili par centi po razgovoru na
  Claude-u kasnije — zavisi od broja poruka klijenata mesečno.
- Tvoje vreme: povremeno dopunjavanje baze znanja na osnovu
  `/api/admin/unanswered`.
