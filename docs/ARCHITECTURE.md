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
                 │  one UCI search per position, in order, in a Web Worker
                 ▼
         PositionAnalysis[]  (MultiPV 2, evals from White's point of view)
                 │
     core/review.ts buildGameReview  ◄── core/openings (book moves, opening name)
        ├─ core/winPercent.ts   eval → win %
        ├─ core/accuracy.ts     per-move + game accuracy
        ├─ core/material.ts     sacrifice detection (legal static exchange)
        ├─ core/classify.ts     labels (thresholds.ts)
        └─ core/explain.ts      plain-English text
                 ▼
            GameReview ──► features/review (board, eval bar, graph, move list)
```

## Key decisions

**Engine on the device.** Stockfish 19 "lite" single-threaded WASM (about 1.8 MB) runs in a Web Worker. It needs no cross-origin isolation headers, so it works on any static host and on phones. Each position is searched to a target depth with a per-position time cap, so slow devices finish in reasonable time and the reached depth is recorded.

**History-aware analysis.** The engine receives `position fen <start> moves ...` instead of a bare FEN, so it knows about repetitions (a move that forces a draw by repetition is evaluated as a draw).

**Cache analyses, not reviews.** IndexedDB stores the raw engine output per game and settings. Reviews are rebuilt from it in milliseconds, so classification rules can change without invalidating anyone's cache, and an interrupted analysis resumes where it stopped.

**Win %, not centipawns.** Losing 150 centipawns matters in an equal position and barely matters when you are a rook up. Measuring loss in win % (the open Lichess model) treats both correctly. See [CLASSIFICATION.md](CLASSIFICATION.md).

**Serial requests.** Chess.com's Published-Data API returns HTTP 429 for parallel requests, so `sources/http.ts` queues requests per host and backs off on 429. Past monthly archives never change and are stored permanently; the current month is revalidated through the browser's HTTP cache (`cache: 'no-cache'`), because the API rejects a custom `If-None-Match` header from browsers.

**Hash routing.** URLs look like `/#/review/lichess/abcd1234`, so the app needs no server rewrites. Every review URL contains the game id and can be reloaded or shared.
