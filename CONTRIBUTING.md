# Contributing to Kibitz

Thanks for helping make free game review better for every chess player. This guide covers setup, how the code is organised, and what a good pull request looks like.

## Setup

You need Node.js 20 or newer.

```bash
git clone https://github.com/fahad-96/kibitz-chess.git
cd kibitz-chess
npm install        # also copies Stockfish into public/engine and the voice runtime into public/voice
npm run dev        # http://localhost:5173
```

| Script              | What it does                                            |
| ------------------- | ------------------------------------------------------- |
| `npm run dev`       | Start the dev server                                    |
| `npm test`          | Run the unit tests once (`npm run test:watch` to watch) |
| `npm run typecheck` | TypeScript, no emit                                     |
| `npm run lint`      | ESLint                                                  |
| `npm run format`    | Prettier (`npm run format:check` to verify)             |
| `npm run build`     | Typecheck and build the static site into `dist/`        |
| `npm run openings`  | Rebuild the opening book from the Lichess dataset       |

## How the code is organised

```
src/
  core/        Pure TypeScript chess logic, no React. Fully unit-tested.
    types.ts       Shared domain types (start here)
    thresholds.ts  Every classification number in one place
    winPercent.ts  Engine eval -> win %
    accuracy.ts    Per-move and per-game accuracy (Lichess formulas)
    classify.ts    Move classification rules
    material.ts    Static exchange evaluation, sacrifice detection
    tactics.ts     Forks, pins, skewers... found along an engine line, told as a story
    explain.ts     Plain-English explanations (lead with the story when there is one)
    perspective.ts  Rewrites a text for the mover's opponent ("You reply ...")
    review.ts      Engine analyses -> full GameReview, with the stories
    annotatedPgn.ts  Review -> PGN with NAGs, [%eval], [%clk] and the stories
    pgn.ts         PGN parsing (clocks, FEN starts)
    openings/      Opening book (Lichess chess-openings, CC0)
  engine/      Stockfish (WASM) in a Web Worker, analysis passes, IndexedDB cache
  library/     Reviewed games, kept compact in IndexedDB for insights and puzzles
  practice/    Checking a move you try against the engine, hints, lines in SAN
  voice/       Speech: SAN to words, system voices, the optional Kokoro natural voice
  sources/     Chess.com and Lichess clients, pasted PGN storage
  components/  Board, eval bar, eval graph, move list, classification icons
  features/    Screens
    review/        The review: board, cards, "Show why" player, voice coach, retry, share
    insights/      Player insights and the background batch analysis
    puzzles/       Puzzles from your mistakes, spaced repetition
    home/ games/ import/ settings/ about/
  app/         Routes, layout, service worker registration and update prompt
  state/       Persisted user settings (zustand)
public/
  sw.js        The service worker (offline start, offline analysis, updates)
docs/
  CLASSIFICATION.md   The public spec for every move label and explanation
  ARCHITECTURE.md     How data flows through the app
```

Rules of thumb:

- **Chess logic goes in `src/core`** and stays free of React and browser APIs, so it can be tested in isolation.
- **Classification changes need three things together:** the code (`classify.ts` / `thresholds.ts`), tests, and `docs/CLASSIFICATION.md`. The same goes for the wording of explanations and stories (`explain.ts`, `tactics.ts`): when you add a sentence that names a player, add it to `perspective.test.ts` too, so the opponent's version reads right.
- **Precision before recall in tactics.** A wrong "fork" is worse than none: `tactics.ts` only reports a motif that pays off in the engine's line.
- **Network access goes through `src/sources/http.ts`.** Chess.com rejects parallel requests, so requests are queued per host.
- **The engine runs on the user's device.** Don't add server-side analysis; keeping the project free to run is a core goal. There is one shared engine: background work (the insights batch) pauses while the review screen analyses.
- **Keep the install small.** The service worker precaches the app shell, the hashed assets and Stockfish. Anything big and optional (the natural voice) is fetched only when a user turns it on: see `ON_DEMAND_ASSET` in `vite.config.ts` and the header of `public/sw.js`.
- **Text that is spoken goes through `src/voice/speakable.ts`**, which turns SAN into words ("Nxe5+" → "Knight takes e5 check").

## Reporting a wrong classification

Open an issue with the game (link or PGN), the move, what Kibitz said and what you expected. Please include the analysis depth from Settings. Engine depth changes evaluations, so "wrong" sometimes means "shallow".

## Pull requests

- Keep PRs focused; one feature or fix per PR.
- Add or update tests for logic changes.
- Check UI changes at phone width (320-400px) and in both light and dark themes, with tap targets of at least 40px.
- Don't use another site's name, logo or visual design as Kibitz branding.

## License

Kibitz is licensed under GPL-3.0-or-later (it ships Stockfish, which is GPL-3.0). By contributing you agree that your contributions are licensed under the same terms.
