# PAM Word Challenge · تحدي الكلمات

A bilingual (Arabic / English) word-guessing game for the **Public Authority of Manpower — Information Technology Department**, built for a **vertical Android touch screen**, with a separate **admin console** and a **champions board**.

- Created by the **Information Security Section** (قسم سرية المعلومات)
- 100% static frontend → host free on **GitHub Pages**
- **Supabase** (free tier) stores words, players, games and settings
- Answers are checked **on the server** — the kiosk never receives the word until the game ends
- Works without Supabase too: **demo mode** stores everything in the browser so you can preview right away

---

## Files

| Path | What it is |
|---|---|
| `index.html` | The kiosk game (attract screen → registration → game → result → champions) |
| `admin.html` | Admin console for another PC (words, results, champions, settings) |
| `supabase/schema.sql` | **Paste this into the Supabase SQL Editor** — tables, security, game logic, starter words |
| `js/config.js` | Your Supabase URL + anon key, default language, logo path |
| `assets/logo.png` | Public Authority of Manpower logo (shown on a white badge) |

---

## 1. Set up Supabase (5 minutes)

1. Create a free project at <https://supabase.com>.
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
3. **Authentication → Users → Add user** → create your admin email + password (tick *Auto confirm*).
4. Back in the SQL Editor, run (with your email):
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'you@example.com'
   on conflict do nothing;
   ```
5. **Admin → Dictionary**: click **Import ready-made English dictionary** (about 116k real words), and upload an Arabic word list (.txt, one word per line). Guesses that are not real words are rejected without using an attempt. Words in your answer list are always accepted.
6. **Project Settings → API** → copy the *Project URL* and the *anon public* key into `js/config.js`:
   ```js
   SUPABASE_URL: 'https://xxxx.supabase.co',
   SUPABASE_ANON_KEY: 'eyJhbGciOi...',
   ```
   The anon key is meant to be public. The kiosk can only call the game functions; it cannot read the words table or other players' data.
7. Optional but recommended: **Authentication → Providers → Email** → turn off *Allow new users to sign up*, so only the admins you create can sign in.

## 2. Publish on GitHub Pages

1. Create a GitHub repository and push this folder.
2. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root**.
3. Your links will be:
   - Game: `https://<user>.github.io/<repo>/`
   - Admin: `https://<user>.github.io/<repo>/admin.html`

## 3. Set up the Android touch screen

- Open the game URL in **Chrome** → menu → **Add to Home screen**. It launches fullscreen and portrait (from `manifest.webmanifest`).
- For a locked-down display, use a kiosk browser such as **Fully Kiosk Browser**. Set the start URL to the game and turn on *Keep screen on*.
- Or use Android **App pinning** (Settings → Security → App pinning) so employees can't leave the app.
- The game keeps the screen awake (Wake Lock), returns to the attract screen when idle, and blocks zoom and long-press menus.

## 4. Branding

- The PAM logo is `assets/logo.png`; the colours (green · red · black · silver, plus a Kuwait-flag ribbon) come from it.
- Brand colours are tokens at the top of `css/theme.css` (`--accent`, `--brand-green`, `--brand-red`, …).
- The game title (Arabic and English) is set from **Admin → Settings**.

---

## How scoring works

| Part | Points |
|---|---|
| Attempts | 1000 on the 1st try, −150 for each extra try (minimum 200) |
| Speed bonus | Up to +300 (−1 per second taken; there is no visible timer) |
| Long-word bonus | +100 for each letter above 5 |
| Hint | −150 (configurable) |

The champions board ranks players by total points this **season**. Ties are broken by wins, then the fastest solve. You can start a new season from **Admin → Champions** at any time; no data is deleted.

## Admin console

- **Overview**: live KPIs, a 14-day activity chart, top players and the latest games.
- **Categories**: Arabic + English names. The player sees the word's category above the letter boxes.
- **Dictionary**: one-click English import, upload Arabic/English word files, check any word.
- **Words**: pick a category, then bulk-paste words (one per line, `word | English hint | Arabic hint`), with live validation. Language is detected automatically. You can activate, deactivate, edit or delete words.
- **Results**: every game with player, word, guesses, score and time. Filter, search and **export to CSV** (opens correctly in Excel with Arabic).
- **Champions**: rank by today, the last 7 days, the season or all time. Full ID numbers are shown to admins only. Export to CSV, or start a new season.
- **Settings**: attempts, time limit, plays per day, word language, hints, idle timeout, sound, ID length, time zone and more. Changes reach the kiosk within 5 minutes, or straight away on reload.

## Testing locally

Any static server works, for example:

```bash
python -m http.server 8080
```

Then open <http://localhost:8080> (game) and <http://localhost:8080/admin.html> (admin). With no Supabase keys set, both pages run in **demo mode** and share data through the browser's local storage.
