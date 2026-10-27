# Chess Yes

**Free, open-source chess game review.** Enter a Chess.com or Lichess username, pick a game, and get a full review: eval bar and graph, every move classified, accuracy for both players, and plain-English explanations that show on the board _why_ a move was a blunder or a brilliant find, read aloud if you like.

Stockfish runs in your browser, so there is no account, no paywall and no server bill.

**Live:** https://chessyes.netlify.app · Created and maintained by [Fahad Yousuf](https://fahad-yousuf.netlify.app/)

> Chess Yes is an independent project. It is not affiliated with, endorsed by, or connected to Chess.com or Lichess.

## Features

- **Game lookup** from Chess.com (Published-Data API) and Lichess, or paste any PGN
- **Full-game analysis** with Stockfish 19 (WebAssembly, in a Web Worker) on your device. A quick first pass shows a complete review within seconds, the full pass then replaces it move by move, and a deeper double-check re-examines the key moments. Progress is saved, so a closed tab resumes where it stopped
- **Move classifications:** Brilliant, Great, Best, Excellent, Good, Book, Forced, Inaccuracy, Mistake, Blunder, Miss
- **Accuracy** for both players, from Chess Yes's open model calibrated against published accuracy figures from Chess.com game reviews (close to them, not identical), or on the Lichess scale (Settings → Accuracy scale)
- **Eval bar and eval graph**: click the graph to jump to any move
- **"Show why" with tactics**: a blunder shows the reply that punishes it, a brilliant or great move the idea behind it, played out on the board with arrows. Chess Yes spots forks, pins, skewers, discovered attacks and checks, hanging pieces, promotions and back-rank mates: _"You sacrifice the rook on h7: after Kxh7, Nf6+ forks the king and queen and wins the queen."_ Your opponent's moves are explained to you: _"You reply Rxg7+, forking their king and bishop, and win the bishop."_
- **Voice coach**: hear each move's verdict and the reason as you step through the game, or let it narrate the key moments while the board plays them. It speaks in a natural recorded voice (Bella, pre-rendered with Kokoro-82M) whose tiny clips start instantly and work offline, or with your device's own voice
- **Explore and retry**: play your own moves from any position with a live engine evaluation, step through the engine's best line, retry a mistake with hints, or work through all of yours with Learn
- **Share** a link to a move, the FEN, the PGN, or an annotated PGN with labels, evaluations, clocks and the stories as comments
- **Player insights** across your reviewed games: results, openings, accuracy by phase, move quality, time trouble and your costliest mistakes. Analyse a batch of games in the background
- **Puzzles from your own mistakes**, with hints, "Why it works" on the board, and spaced repetition that brings back the ones you missed
- **Works offline and installs as an app**: after the first visit the app and the engine are cached, so games you have already looked up, their reviews, insights and puzzles work without a connection
- **Works on phones**: analysis depth adapts to the device, and swipe moves through the game
- **Private**: games, analyses and progress stay in your browser

## How moves are classified

Each move is judged by how much it lowers your chance of winning (win %), computed from Stockfish's evaluation before and after the move. Losing 2 points of win % or less is Excellent; losing more than 20 is a Blunder. Brilliant (a sound sacrifice), Great (the only good move) and Miss (a real chance let slip) have their own documented rules.

The explanations are rule-based too: no AI writes them. Chess Yes replays the engine's line, finds the tactic in it and tells it in a sentence or two.

Every rule and threshold is documented in [docs/CLASSIFICATION.md](docs/CLASSIFICATION.md) and lives in one file, [src/core/thresholds.ts](src/core/thresholds.ts).

## Run it locally

Requires Node.js 20+.

```bash
git clone https://github.com/fahad-96/kibitz-chess.git
cd kibitz-chess
npm install
npm run dev
```

Then open http://localhost:5173.

`npm install`, `npm run dev` and `npm run build` also install the coach voice pack (about 20 MB of clips, named in `voice-pack.json`) into `public/voice-pack/`. Without network access the step is skipped with a warning and the app speaks with the device's voice instead.

`npm run build` produces a static site in `dist/` that any free static host can serve. Set `BASE_PATH` when serving from a sub-path, for example `BASE_PATH=/kibitz/ npm run build`. The offline service worker is only registered in production builds; try it with `npm run build && npm run preview`.

## Deploy to Netlify

All build settings live in [netlify.toml](netlify.toml), so there is nothing to configure:

1. In Netlify, choose **Add new site → Import an existing project → GitHub**.
2. Pick the `kibitz-chess` repository (private repositories work on the free plan).
3. Click **Deploy**. Every push to `main` redeploys automatically.

The site is fully static: no functions, no environment variables, no server costs. Each deploy gets a new service worker, and open copies of the app offer to reload into the new version.

## Tech stack

| Area        | Choice                                                  | Why                                                                   |
| ----------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| App         | Vite, React 19, TypeScript (strict)                     | Static build, widely known by contributors                            |
| Chess rules | chess.js                                                | Legal moves, SAN, PGN                                                 |
| Board       | chessground                                             | Fast, touch-friendly, arrows built in                                 |
| Engine      | Stockfish 19 lite (WASM)                                | Runs on the user's device; no special server headers                  |
| Voice       | Pre-rendered voice pack (Web Audio API); Web Speech API | Clips are fetched as needed (~7 kB each); no model runs on the device |
| Styling     | Tailwind CSS v4                                         | Classic (default), dark and light themes from design tokens           |
| Storage     | IndexedDB (idb-keyval)                                  | Analyses, reviewed games and puzzle progress, offline                 |
| Offline     | Hand-written service worker                             | Every caching rule readable in one file                               |
| Tests       | Vitest                                                  | Chess logic is pure TypeScript and fully unit-tested                  |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how data flows through the app.

## Roadmap

- [x] Username lookup, game list, board viewer, full-game analysis, classifications, accuracy, eval graph
- [x] Explore variations on the board
- [x] Retry your mistakes
- [x] "Show why" stories with tactics, and a voice coach that reads them
- [x] Player insights across many games and opening statistics
- [x] Puzzles generated from your own mistakes
- [x] Offline support, installable as an app
- [ ] Trapped pieces in the tactics stories (needs a search of its own)

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Chess Yes is free software, licensed under the [GNU GPL v3.0 or later](LICENSE).

It bundles [Stockfish](https://github.com/official-stockfish/Stockfish) via [stockfish.js](https://github.com/nmrugg/stockfish.js) (GPL-3.0) and uses [chessground](https://github.com/lichess-org/chessground) (GPL-3.0), [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause) and the [Lichess chess-openings](https://github.com/lichess-org/chess-openings) dataset (CC0). The win % curve and the alternative accuracy scale follow [Lichess](https://github.com/lichess-org/lila).

The coach voice is the [Chess Yes voice pack](https://github.com/fahad-96/chess-yes-voice), audio licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): "Chess Yes voice pack by Fahad Yousuf, generated with Kokoro-82M". It was generated once, ahead of time, with the [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) model by hexgrad (Apache-2.0). The build downloads it from that repository's releases (`voice-pack.json`, checked against its sha256).
