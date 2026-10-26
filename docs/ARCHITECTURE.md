# Architecture

Kibitz is a static single-page app. There is no backend: game data comes straight from public APIs, and the chess engine runs in the user's browser. Hosting is free on any static host (GitHub Pages, Cloudflare Pages, Netlify).

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
        ├─ core/winPercent.ts   eval → win %
        ├─ core/accuracy.ts     per-move + game accuracy
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
3. **Double-check** (`engine/refine.ts`). Each position is searched on its own, so a search can miss what the next one sees. Up to 16 of the moves that matter most (Brilliant, Great, Missed Win, Mistake, Blunder) are searched again, 4 plies deeper with twice the time. A move's two positions are only applied together, and each verified analysis keeps the one it replaced: a position also belongs to the neighbouring move, which keeps its full-pass pair unless its other position was verified too. A label never compares a verified position with an unverified one.

Every pass saves to the IndexedDB cache as it goes, so a closed tab or a reload resumes where it stopped, and a finished review reopens without running the engine. The cache stores raw engine output per game and settings (with a `refined` flag), never reviews.

Building a review is pure and synchronous. Lines in SAN, stories and motif checks are memoised in `core/review.ts`, so rebuilding while analysis streams in costs little more than the moves that changed.

## Stories: "Show why"

For the moves where it matters, `core/review.ts` asks `core/tactics.ts` to tell a **story**: a few moves of the engine's line, the tactical motifs in it (with their squares), the material that changes hands and a sentence or two. A blunder gets the refutation and the better move's idea; a brilliant or great move gets its own idea. The rules are in [CLASSIFICATION.md](CLASSIFICATION.md#6-explanations).

The story flows into:

- **the explanation** (`core/explain.ts`), which leads with it when it shows something concrete;
- **the review screen**: "Show why" plays the line on the board with arrows for the motifs and a caption per move (`features/review/story.ts`, `StoryPanel.tsx`);
- **the voice coach**, which reads the verdict and the story (`features/review/coach.ts`, `useCoach.ts`);
- **puzzles**, as "Why it works" after a puzzle is solved (`features/puzzles/story.ts`);
- **the annotated PGN** export, as comments and a variation (`core/annotatedPgn.ts`).

Texts are written to the player who made the move. When the review knows who you are (the game list you came from, or `?as=<username>`), `core/perspective.ts` rewrites your opponent's moves for you: "Your opponent replies Rxg7+" becomes "You reply Rxg7+".

## Library, insights and puzzles

A finished review is saved to the **library** (`library/library.ts`, IndexedDB store `kibitz-library`) as a compact entry: the game record, accuracies, and per move the label, win % before and after, the best line and the clock. A deeper review replaces a shallower one, never the other way round. Insights and puzzles read only the library, so they work offline and never re-run the engine.

- **Insights** (`features/insights`): results, openings, rating, accuracy by phase, move quality, time trouble and costliest mistakes across a player's reviewed games (`stats.ts`, pure). The batch job (`analysisJob.ts`) analyses many games in the background, with the same full pass and double-check as the review screen, and adds them to the library. There is one engine: the job pauses between searches while a review analyses (`holdInsightsJob`).
- **Puzzles** (`features/puzzles`): every Mistake, Blunder and Missed Win of yours whose best move is clearly the one to find becomes a puzzle (`generate.ts`). A move you try is judged by the engine (`practice/checkMove.ts`), so another winning move counts too. Progress uses a light version of SM-2 spaced repetition (`progress.ts`, IndexedDB store `kibitz-puzzles`).

## Voice

`src/voice` speaks without any server:

- `speakable.ts` turns notation into words ("Nxe5+" → "Knight takes e5 check", "1-0" → "White wins").
- `systemVoice.ts` uses the browser's Web Speech API and ranks the installed English voices. Voices that use an online service are labelled as such in Settings.
- `kokoroVoice.ts` and `kokoro.worker.ts` run the optional natural voice, Kokoro-82M, with Transformers.js on WebGPU in a worker. It is offered only when the browser has a GPU adapter and is opt-in: the weights (326 MB) come from the Hugging Face Hub and are cached by the browser; the ONNX runtime is served from our own site (`public/voice`, copied by `scripts/copy-engine.mjs`). A device that turns out slower than real time falls back to the system voice.

## Offline and updates

`public/sw.js` is a hand-written service worker, registered only in production builds (`app/registerServiceWorker.ts`). At build time the `kibitz:service-worker` plugin in `vite.config.ts` fills in a build id (a hash of the output) and the precache list: the app shell, every hashed asset and Stockfish (which lives in its own cache, so a deploy does not download it again). The natural voice is left out of the precache and fetched only when a user turns it on.

Navigations are network first with the cached app as the fallback; hashed assets are cache first. A new deploy installs in the background and the page offers to reload (`app/UpdateToast.tsx`); the old caches are removed once the new version takes over.

## Storage

| Where                          | What                                                     |
| ------------------------------ | -------------------------------------------------------- |
| IndexedDB `kibitz-analysis`    | Raw engine analyses per game and settings (resumable)    |
| IndexedDB `kibitz-library`     | Reviewed games, for insights and puzzles                 |
| IndexedDB `kibitz-puzzles`     | Puzzle attempts and the practice streak                  |
| IndexedDB `kibitz-chesscom`    | Chess.com monthly archives                               |
| IndexedDB `kibitz-pgn`         | Pasted PGNs                                              |
| localStorage `kibitz-settings` | Settings and recent searches                             |
| localStorage `kibitz-voice`    | Voice settings                                           |
| Cache Storage                  | The service worker's caches; the natural voice's weights |

Everything can be cleared in Settings → Storage, or with the browser's site data.

## Key decisions

**Engine on the device.** Stockfish 19 "lite" single-threaded WASM (about 1.8 MB) runs in a Web Worker. It needs no cross-origin isolation headers, so it works on any static host and on phones. Each position is searched to a target depth with a per-position time cap, so slow devices finish in reasonable time and the reached depth is recorded.

**History-aware analysis.** The engine receives `position fen <start> moves ...` instead of a bare FEN, so it knows about repetitions (a move that forces a draw by repetition is evaluated as a draw).

**Cache analyses, not reviews.** IndexedDB stores the raw engine output per game and settings. Reviews are rebuilt from it in milliseconds, so classification rules and explanations can change without invalidating anyone's cache, and an interrupted analysis resumes where it stopped.

**Win %, not centipawns.** Losing 150 centipawns matters in an equal position and barely matters when you are a rook up. Measuring loss in win % (the open Lichess model) treats both correctly. See [CLASSIFICATION.md](CLASSIFICATION.md).

**Rule-based explanations.** Stories come from replaying the engine's line with chess.js and a small attack map, not from a language model: they are free, instant, work offline, and every sentence can be traced to a rule and a test.

**Serial requests.** Chess.com's Published-Data API returns HTTP 429 for parallel requests, so `sources/http.ts` queues requests per host and backs off on 429. Past monthly archives never change and are stored permanently; the current month is revalidated through the browser's HTTP cache (`cache: 'no-cache'`), because the API rejects a custom `If-None-Match` header from browsers.

**Hash routing.** URLs look like `/#/review/lichess/abcd1234`, so the app needs no server rewrites. Every review URL contains the game id and can be reloaded or shared; `?ply=N` opens it at a move.
