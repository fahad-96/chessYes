# Contributing to Chess Yes

Thanks for helping make free game review better for every chess player. This guide covers setup, how the code is organised, and what a good pull request looks like.

## Setup

You need Node.js 20 or newer.

```bash
git clone https://github.com/fahad-96/kibitz-chess.git
cd kibitz-chess
npm install        # also copies Stockfish into public/engine and installs the voice pack into public/voice-pack
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
  voice/       The voice coach: coach lines, the voice pack player, the device voice
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
- **Keep the install small.** The service worker precaches the app shell, the hashed assets and Stockfish. The voice pack is never precached: clips are cached as they are played (see the header of `public/sw.js`).
- **What the coach says is built from voice clips.** A review line is a `CoachScript` from `src/voice/coachScript.ts`, made only of clips in `src/voice/vocabulary.ts`. Other spoken text goes through `src/voice/speakable.ts` (SAN to words) and is read by the device voice.

## Changing what the coach says

The coach voice is pre-rendered, so a new sentence needs new clips:

1. Edit `src/voice/vocabulary.ts` (and `coachScript.ts` to use the new clips). Changing a clip's key or text, or adding clips, means bumping `VOCABULARY_VERSION`. `vocabulary.test.ts` and `coachScript.test.ts` check that every line uses known clips.
2. Regenerate the clip list in the voice repository: `npm run voice:clips -- ../chess-yes-voice/clips.json`.
3. In [chess-yes-voice](https://github.com/fahad-96/chess-yes-voice), render (`node render.mjs --jobs 3`; only new or changed clips are rendered) and pack (`node pack.mjs`), then publish `dist/chess-yes-voice-af_bella-v<version>.tar.gz` and its `.sha256` as release `v<version>` (see its README).
4. Bump `voice-pack.json` here: `version`, the release `url` and the `sha256` from the `.sha256` file. The next install or build downloads the new pack.

Until the new pack is published, lines that need a missing clip are spoken by the device voice, so the app keeps working. To try a local render first, run `VOICE_PACK_DIR=../chess-yes-voice/pack npm run voice:fetch`.

## Reporting a wrong classification

Open an issue with the game (link or PGN), the move, what Chess Yes said and what you expected. Please include the analysis depth from Settings. Engine depth changes evaluations, so "wrong" sometimes means "shallow".

## Pull requests

- Keep PRs focused; one feature or fix per PR.
- Add or update tests for logic changes.
- Check UI changes at phone width (320-400px) and in the classic, dark and light themes, with tap targets of at least 40px.
- Don't use another site's name, logo or visual design as Chess Yes branding.

## License

Chess Yes is licensed under GPL-3.0-or-later (it ships Stockfish, which is GPL-3.0). By contributing you agree that your contributions are licensed under the same terms.
