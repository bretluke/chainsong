# Chainsong

The car game, as an app. Name a song; the next player names one that shares a
word (title **or** artist) with it — but never the word that linked *into* the
current song. Conjugations/plurals count (love/loved/loving, property/properties).

## What's actually built (v0.1)

- **Core game logic** (`lib/wordlink.js`) — tokenizing, stop-word filtering,
  the stemmer for your conjugation rules, and full move validation.
  **24 unit tests** including your exact Huey Lewis → Whitney → Saliva →
  Saliva → Black Eyed Peas chain. Run `npm test`.
- **Hybrid verification** (`lib/verify.js`) — after a player commits, the song
  is checked against MusicBrainz (free, keyless, legal, metadata-only) and the
  result cached in Neon. Never runs while typing, so it can't act as search.
- **Pass-and-play frontend** (`public/index.html`) — no autocomplete; you type
  title + artist + a freeform "describe it" field, then pick the link word.
  Includes the group-override path for real-but-obscure songs.
- **Deploy pipeline** — GitHub → Vercel → Neon, same as your last project.

## Setup (your usual workflow)

1. Push this folder to a new GitHub repo.
2. Create a Neon project; run `schema.sql` in its SQL editor.
3. Import the repo into Vercel; set env var `DATABASE_URL` to the Neon
   connection string. Deploy.
4. `npm test` locally to confirm logic before each deploy.

## What is NOT done yet — honest roadmap

This is a working foundation, **not** an App-Store-ready app. Remaining work,
roughly in order:

1. **Online multiplayer** — the schema (`games`, `moves`) is built for it, but
   lobbies, turn sync, and realtime (websockets / Vercel + a pusher service)
   are not implemented. This is the single biggest remaining piece.
2. **Accounts & game persistence** — currently the chain lives in browser
   memory; refresh loses it. Needs the games/moves tables wired to the UI.
3. **Scoring / win conditions** — timer, elimination, streaks. Not yet built;
   we defaulted the rules but didn't implement scoring.
4. **MusicBrainz edge cases** — covers/remixes, "feat." artists, and very new
   songs are inconsistently matched; the override path is the current safety
   net but real tuning is needed.
5. **Native iOS app + App Store** — this requires *your* Apple Developer
   account ($99/yr), a native wrapper (Capacitor/Expo or a true rewrite),
   privacy-nutrition-label disclosures, and Apple's review. I can build the
   wrapper and guide you, but the account, submission, and review are yours.

I'd suggest playing the browser version in the car first to pressure-test the
rules before investing in multiplayer and native — that's the cheapest way to
find out if a rule needs to change.
