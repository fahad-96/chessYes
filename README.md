# Kibitz

**Free, open-source chess game review.** Enter a Chess.com or Lichess username, pick a game, and get a full review: eval bar and graph, every move classified, accuracy for both players, best-move arrows and plain-English explanations of the key moments.

Stockfish runs in your browser, so there is no account, no paywall and no server bill.

> Kibitz is an independent project. It is not affiliated with, endorsed by, or connected to Chess.com or Lichess.

## Features

- **Game lookup** from Chess.com (Published-Data API) and Lichess, or paste any PGN
- **Full-game analysis** with Stockfish 19 (WebAssembly, in a Web Worker) on your device, with live progress, cancel and resume
- **Move classifications:** Brilliant, Great, Best, Excellent, Good, Book, Forced, Inaccuracy, Mistake, Blunder, Missed Win
- **Accuracy** for both players (the open Lichess formula)
- **Eval bar and eval graph**: click the graph to jump to any move
- **Best-move arrows** and the engine's line for every move
- **Plain-English explanations**: "This hangs your knight on f5. Best was Nd2."
- **Works on phones**: analysis depth adapts to the device, and swipe moves through the game
- **Private**: games and analyses stay in your browser

## How moves are classified

Each move is judged by how much it lowers your chance of winning (win %), computed from Stockfish's evaluation before and after the move. Losing 2 points of win % or less is Excellent; losing more than 20 is a Blunder. Brilliant (a sound sacrifice), Great (the only good move) and Missed Win have their own documented rules.

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

`npm run build` produces a static site in `dist/` that any free static host can serve. Set `BASE_PATH` when serving from a sub-path, for example `BASE_PATH=/kibitz/ npm run build`.

## Deploy to Netlify

All build settings live in [netlify.toml](netlify.toml), so there is nothing to configure:

1. In Netlify, choose **Add new site → Import an existing project → GitHub**.
2. Pick the `kibitz-chess` repository (private repositories work on the free plan).
3. Click **Deploy**. Every push to `main` redeploys automatically.

The site is fully static: no functions, no environment variables, no server costs.

## Tech stack

| Area        | Choice                              | Why                                                  |
| ----------- | ----------------------------------- | ---------------------------------------------------- |
| App         | Vite, React 19, TypeScript (strict) | Static build, widely known by contributors           |
| Chess rules | chess.js                            | Legal moves, SAN, PGN                                |
| Board       | chessground                         | Fast, touch-friendly, arrows built in                |
| Engine      | Stockfish 19 lite (WASM)            | Runs on the user's device; no special server headers |
| Styling     | Tailwind CSS v4                     | Design tokens, light and dark themes                 |
| Storage     | IndexedDB (idb-keyval)              | Cached archives and resumable analyses               |
| Tests       | Vitest                              | Chess logic is pure TypeScript and fully unit-tested |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how data flows through the app.

## Roadmap

- [x] Username lookup, game list, board viewer, full-game analysis, classifications, accuracy, eval graph
- [ ] Explore variations on the board
- [ ] Retry your mistakes
- [ ] Player insights across many games and opening statistics
- [ ] Puzzles generated from your own mistakes

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Kibitz is free software, licensed under the [GNU GPL v3.0 or later](LICENSE).

It bundles [Stockfish](https://github.com/official-stockfish/Stockfish) via [stockfish.js](https://github.com/nmrugg/stockfish.js) (GPL-3.0) and uses [chessground](https://github.com/lichess-org/chessground) (GPL-3.0), [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause) and the [Lichess chess-openings](https://github.com/lichess-org/chess-openings) dataset (CC0). The win % and accuracy formulas follow [Lichess](https://github.com/lichess-org/lila).
