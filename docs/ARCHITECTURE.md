# Architecture

Chess Yes is a static single-page app. There is no backend: game data comes straight from public APIs, and the chess engine runs in the user's browser. Hosting is free on any static host (GitHub Pages, Cloudflare Pages, Netlify).

## Data flow of a review

```
username ──► sources/chesscom.ts | sources/lichess.ts ──► GameRecord (PGN + metadata)
                                                              │
                                                core/pgn.ts parsePgn
                                                              ▼
                                                         ParsedGame
                                                              │
               engine/analyzeGame.ts  ◄── engine/cache.ts (IndexedDB, resumable)
                 │  quick pass → full pass → double-check (engine/refine.ts),
                 │  one UCI search per position, in a Web Worker
                 ▼
         PositionAnalysis[]  (MultiPV 2, evals from White's point of view)
                 │
     core/review.ts buildGameReview  ◄── core/openings (book moves, opening name)
        ├─ core/winPercent.ts   eval → win % (calibrated scale)
        ├─ core/accuracy.ts     per-move + game accuracy (accuracyModel.ts: calibrated or Lichess)
        ├─ core/material.ts     sacrifice detection (legal static exchange)
        ├─ core/classify.ts     labels (thresholds.ts)
        ├─ core/tactics.ts      stories: the line that shows why (forks, pins, mates...)
        └─ core/explain.ts      plain-English text, led by the story
                 ▼
            GameReview ──► core/perspective.ts (the opponent's moves addressed to you)
                 │             ▼
                 │        features/review: board, eval bar, graph, move list,
                 │        "Show why" player, voice coach (src/voice), retry, share
                 │             └─► core/annotatedPgn.ts (export)
                 ▼
         library/library.ts (IndexedDB) ──► features/insights, features/puzzles
```

## Progressive analysis

A full-depth review of a 60-move game takes minutes on a laptop, so the review is built in passes (`features/review/useGameReview.ts`), each one replacing the previous results position by position:

1. **Quick pass** (`QUICK_PASS` in `engine/presets.ts`: depth 8, at most 250 ms per position). A complete, provisional review appears within seconds, even on a phone. It is skipped when a complete review is already available.
2. **Full pass** at the preset's depth (Fast 12, Standard 16, Deep 20, each with a time cap per position). The review is rebuilt as results stream in, throttled so that a slow device keeps responding (`rebuildInterval`), and progress updates are delivered at most every 200 ms.
3. **Double-check** (`engine/refine.ts`). Each position is searched on its own, so a search can miss what the next one sees. Up to 16 of the moves that matter most (Brilliant, Great, Miss, Mistake, Blunder) are searched again, 4 plies deeper with twice the time. A move's two positions are only applied together, and each verified analysis keeps the one it replaced: a position also belongs to the neighbouring move, which keeps its full-pass pair unless its other position was verified too. A label never compares a verified position with an unverified one.

Every pass saves to the IndexedDB cache as it goes, so a closed tab or a reload resumes where it stopped, and a finished review reopens without running the engine. The cache stores raw engine output per game and settings (with a `refined` flag), never reviews.

Building a review is pure and synchronous. Lines in SAN, stories and motif checks are memoised in `core/review.ts`, so rebuilding while analysis streams in costs little more than the moves that changed.

## Stories: "Show why"

For the moves where it matters, `core/review.ts` asks `core/tactics.ts` to tell a **story**: a few moves of the engine's line, the tactical motifs in it (with their squares), the material that changes hands and a sentence or two. A blunder gets the refutation and the better move's idea; a brilliant or great move gets its own idea. The rules are in [CLASSIFICATION.md](CLASSIFICATION.md#6-explanations).

The story flows into:

- **the explanation** (`core/explain.ts`), which leads with it when it shows something concrete;
- **the review screen**: "Show why" plays the line on the board with arrows for the motifs and a caption per move (`features/review/story.ts`, `StoryPanel.tsx`);
- **the voice coach**, which says each move's coach line: the move, its verdict and the main reason (`features/review/coach.ts`, `useCoach.ts`);
- **puzzles**, as "Why it works" after a puzzle is solved (`features/puzzles/story.ts`);
- **the annotated PGN** export, as comments and a variation (`core/annotatedPgn.ts`).

Texts are written to the player who made the move. When the review knows who you are (the game list you came from, or `?as=<username>`), `core/perspective.ts` rewrites your opponent's moves for you: "Your opponent replies Rxg7+" becomes "You reply Rxg7+".

## Library, insights and puzzles

A finished review is saved to the **library** (`library/library.ts`, IndexedDB store `kibitz-library`) as a compact entry: the game record, accuracies and their scale, and per move the label, win % before and after, accuracy, the best line and the clock. A deeper review replaces a shallower one, never the other way round, unless the stored one is on another accuracy scale than the one in Settings. Insights and puzzles read only the library, so they work offline and never re-run the engine. Entries carry `LIBRARY_VERSION`; when it changes (as when accuracy moved to the calibrated scale), older entries are ignored until the game is reviewed again, and the insights and puzzles pages say so.

- **Insights** (`features/insights`): results, openings, rating, accuracy by phase, move quality, time trouble and costliest mistakes across a player's reviewed games (`stats.ts`, pure). The batch job (`analysisJob.ts`) analyses many games in the background, with the same full pass and double-check as the review screen, and adds them to the library. There is one engine: the job pauses between searches while a review analyses (`holdInsightsJob`).
- **Puzzles** (`features/puzzles`): every Mistake, Blunder and Miss of yours whose best move is clearly the one to find becomes a puzzle (`generate.ts`). A move you try is judged by the engine (`practice/checkMove.ts`), so another winning move counts too. Progress uses a light version of SM-2 spaced repetition (`progress.ts`, IndexedDB store `kibitz-puzzles`).

## Voice

`src/voice` speaks without any server, and no speech model runs on the device. The default **coach voice** (Bella) is a pack of about 2,800 short MP3 clips (moves, squares, numbers and short phrases), rendered once with Kokoro-82M in the [chess-yes-voice](https://github.com/fahad-96/chess-yes-voice) repository and published there as a release archive.

- `vocabulary.ts` lists every clip with its stable key and the exact text the model says. `scripts/voice-clips.mjs` writes it out as the voice repository's `clips.json`.
- `coachScript.ts` builds a move's **coach line** from the review: a list of clip keys with the pause after each, plus the same words as text (for captions and the device voice). `features/review/coach.ts` picks the line for a move, a key moment or the move whose story is shown.
- `scripts/fetch-voice.mjs` installs the pack at build time (`npm install`, `npm run dev` and `npm run build` run it): it downloads the archive named in `voice-pack.json`, refuses it unless its sha256 matches, and unpacks it into `public/voice-pack/` (not committed). It never fails a build; without a pack the app uses the device voice. `VOICE_PACK_DIR=<folder>` installs a local render instead.
- `packPlayer.ts` plays a line: it reads `voice-pack/manifest.json` (each clip's file and length), fetches and decodes the clips with one shared `AudioContext` and schedules them back to back. Each clip keeps 40 ms of silence at both ends, so the next one starts at the previous start + its length - 80 ms + the line's pause (`packPlan.ts`, pure and tested; the lengths come from the manifest because some decoders pad MP3s). Decoded clips stay in a small LRU cache sized for phones, and the clips of the next few lines are prefetched at low priority (none with Data Saver or on 2G). Phones only allow audio after a tap, iOS only inside the tap's own handler, so while narration is on every tap and key press unlocks the audio first; this also recovers a context that iOS interrupted or suspended in the background, and iOS is asked to play speech with the silent switch on.
- If any clip of a line is missing from the pack or fails to load, the **whole line** is said by the device voice: one line is never spoken in two voices.
- `systemVoice.ts` is the **device voice** (Web Speech API): the alternative in Settings, the fallback, and the reader of plain text outside the vocabulary (puzzle stories). It ranks the installed English voices; voices that use an online service are labelled as such. The speed setting applies to it only.
- `speakable.ts` turns notation in plain text into words ("Nxe5+" → "Knight takes e5 check", "1-0" → "White wins") for the device voice.

## Offline and updates

`public/sw.js` is a hand-written service worker, registered only in production builds (`app/registerServiceWorker.ts`). At build time the `kibitz:service-worker` plugin in `vite.config.ts` fills in a build id (a hash of the output) and the precache list: the app shell, every hashed asset and Stockfish (which lives in its own cache, so a deploy does not download it again). The coach voice is never precached: each clip is cached the first time it is played, in a capped cache of its own that survives deploys (the names are hashed, so cache first is always right), while the pack's manifest is fetched network first.

Navigations are network first with the cached app as the fallback; hashed assets are cache first. A new deploy installs in the background and the page offers to reload (`app/UpdateToast.tsx`); the old caches are removed once the new version takes over.

## Storage

| Where                          | What                                                      |
| ------------------------------ | --------------------------------------------------------- |
| IndexedDB `kibitz-analysis`    | Raw engine analyses per game and settings (resumable)     |
| IndexedDB `kibitz-library`     | Reviewed games, for insights and puzzles                  |
| IndexedDB `kibitz-puzzles`     | Puzzle attempts and the practice streak                   |
| IndexedDB `kibitz-chesscom`    | Chess.com monthly archives                                |
| IndexedDB `kibitz-pgn`         | Pasted PGNs                                               |
| localStorage `kibitz-settings` | Settings and recent searches                              |
| localStorage `kibitz-voice`    | Voice settings                                            |
| Cache Storage                  | The service worker's caches, including played voice clips |

Everything can be cleared in Settings → Storage, or with the browser's site data.

## Key decisions

**Engine on the device.** Stockfish 19 "lite" single-threaded WASM (about 1.8 MB) runs in a Web Worker. It needs no cross-origin isolation headers, so it works on any static host and on phones. Each position is searched to a target depth with a per-position time cap, so slow devices finish in reasonable time and the reached depth is recorded.

**History-aware analysis.** The engine receives `position fen <start> moves ...` instead of a bare FEN, so it knows about repetitions (a move that forces a draw by repetition is evaluated as a draw).

**Cache analyses, not reviews.** IndexedDB stores the raw engine output per game and settings. Reviews are rebuilt from it in milliseconds, so classification rules and explanations can change without invalidating anyone's cache, and an interrupted analysis resumes where it stopped.

**Win %, not centipawns.** Losing 150 centipawns matters in an equal position and barely matters when you are a rook up. Measuring loss in win % treats both correctly. Chess Yes's win % and accuracy are an open model calibrated against published accuracy figures from Chess.com game reviews (the Lichess formulas remain available as a second accuracy scale). See [CLASSIFICATION.md](CLASSIFICATION.md).

**Rule-based explanations.** Stories come from replaying the engine's line with chess.js and a small attack map, not from a language model: they are free, instant, work offline, and every sentence can be traced to a rule and a test.

**Serial requests.** Chess.com's Published-Data API returns HTTP 429 for parallel requests, so `sources/http.ts` queues requests per host and backs off on 429. Past monthly archives never change and are stored permanently; the current month is revalidated through the browser's HTTP cache (`cache: 'no-cache'`), because the API rejects a custom `If-None-Match` header from browsers.

**Hash routing.** URLs look like `/#/review/lichess/abcd1234`, so the app needs no server rewrites. Every review URL contains the game id and can be reloaded or shared; `?ply=N` opens it at a move.
