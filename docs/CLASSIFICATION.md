# How Kibitz judges moves

This is the public specification for every number Kibitz shows in a game review: win %, accuracy and the move labels (Brilliant, Great, Best, Excellent, Good, Book, Forced, Inaccuracy, Mistake, Blunder, Missed Win). It is written for chess players who want to know why a move got its label, and for developers who want to change the rules.

Everything is computed in your browser from Stockfish's evaluations. The win % and accuracy formulas are the open formulas used by [Lichess](https://github.com/lichess-org/lila); the label rules are Kibitz's own and are listed in full below.

| What                 | Code                                                  |
| -------------------- | ----------------------------------------------------- |
| Every tunable number | [`src/core/thresholds.ts`](../src/core/thresholds.ts) |
| Eval → win %         | [`src/core/winPercent.ts`](../src/core/winPercent.ts) |
| Accuracy             | [`src/core/accuracy.ts`](../src/core/accuracy.ts)     |
| Label rules          | [`src/core/classify.ts`](../src/core/classify.ts)     |
| Sacrifice detection  | [`src/core/material.ts`](../src/core/material.ts)     |
| Putting it together  | [`src/core/review.ts`](../src/core/review.ts)         |

If this document and the code ever disagree, the code is what runs, and the disagreement is a bug: please open an issue.

## 1. Win percentage

Stockfish reports evaluations in centipawns (100 = one pawn) or as "mate in N". Kibitz converts every evaluation into the side's chance of winning, from 0 to 100, with the Lichess model (lila `WinPercent.scala`):

```
win % (White) = 50 + 50 × (2 / (1 + e^(−0.00368208 × cp)) − 1)
```

- `cp` is the evaluation from White's point of view, **clamped to −1000…+1000**.
- A forced mate counts as ±1000 centipawns, whatever its length.
- Black's win % is `100 − White's win %`.
- When the game is over on the board: the side that delivered **checkmate** has 100 %, the mated side 0 %. **Stalemate**, insufficient material, threefold repetition and the fifty-move rule are 50 %.

| Evaluation (White)     | White win % |
| ---------------------- | ----------- |
| 0.0                    | 50.0        |
| +0.5 / −0.5            | 54.6 / 45.4 |
| +1.0 / −1.0            | 59.1 / 40.9 |
| +2.0 / −2.0            | 67.6 / 32.4 |
| +3.0 / −3.0            | 75.1 / 24.9 |
| +5.0 / −5.0            | 86.3 / 13.7 |
| +7.0 / −7.0            | 92.9 / 7.1  |
| ±10.0 or more, or mate | 97.5 / 2.5  |
| Checkmate on the board | 100 / 0     |

**Why win % instead of centipawns?** The same centipawn drop matters very differently depending on the position. Going from 0.0 to −1.5 costs 13.5 points of win % (a Mistake); going from +7.0 to +5.5 costs 4.6 points (Good), because you are still winning. Measuring in win % treats both fairly.

### Win % lost by a move

For every move Kibitz compares two numbers, both from the **mover's** point of view:

- **Win % before** (`winBefore`): the evaluation of the engine's best line in the position before the move, that is, what you could have kept with best play.
- **Win % after** (`winAfter`): the evaluation of the engine's best line in the position after the move you played.

```
loss = max(0, winBefore − winAfter)
```

A move can never "gain" in this model; a positive difference (the engine found more after your move) counts as zero loss.

## 2. Accuracy

Accuracy follows lila `AccuracyPercent.scala` exactly.

### Per move

```
accuracy = 103.1668100711649 × e^(−0.04354415386753951 × loss) − 3.166924740191411 + 1
```

clamped to 0…100, and exactly 100 when the move lost nothing. The final `+ 1` is Lichess's "uncertainty bonus" for imperfect engine analysis.

| Win % lost    | 0   | 1    | 2    | 5    | 10   | 20   | 30   | 50  | 89+ |
| ------------- | --- | ---- | ---- | ---- | ---- | ---- | ---- | --- | --- |
| Move accuracy | 100 | 96.6 | 92.4 | 80.8 | 64.6 | 41.0 | 25.8 | 9.5 | 0   |

### Per game

A player's game accuracy is the average of two means of their move accuracies:

1. **Volatility-weighted mean.** Each move is weighted by how sharp the game was around it: the population standard deviation of White's win % over a sliding window of positions, clamped to 0.5…12. The window size is `moves / 10` (integer division), clamped to 2…8; the first window is repeated so there is exactly one window per move. A mistake in a quiet position therefore counts less than one in a tactical melee.
2. **Harmonic mean**, with each accuracy floored at 1 so that a single 0 % move cannot zero the whole game. The harmonic mean punishes a few very bad moves more than an ordinary average would.

`game accuracy = (weighted mean + harmonic mean) / 2`

A player who has not moved yet (for example while analysis is still running) is shown as 100 internally and as "—" in the interface.

## 3. Labels

### Order of precedence

The first rule that matches wins:

1. **Book**
2. **Forced**
3. **Brilliant**
4. **Great**
5. **Missed Win**
6. The base label: **Best**, **Excellent**, **Good**, **Inaccuracy**, **Mistake** or **Blunder**, made worse by a [mate swing](#mate-swings) when there is one

Brilliant and Great can only upgrade a Best (or, for Brilliant, Excellent) move. Missed Win can only replace an Inaccuracy, Mistake or Blunder. So the precedence only matters between Book, Forced, Brilliant and Great.

### Base labels

All bounds are inclusive and come from `THRESHOLDS.loss`.

| Label          | Rule                                                                |
| -------------- | ------------------------------------------------------------------- |
| **Best**       | The move is the engine's top move, or it loses nothing (`loss ≤ 0`) |
| **Excellent**  | `loss ≤ 2`                                                          |
| **Good**       | `2 < loss ≤ 5`                                                      |
| **Inaccuracy** | `5 < loss ≤ 10`                                                     |
| **Mistake**    | `10 < loss ≤ 20`                                                    |
| **Blunder**    | `loss > 20`                                                         |

The engine's top move is always at least Best, even when the search after the move sees a small drop. That drop is search noise (a deeper look at the same line), not a fault of the move.

Example: from +0.3 (52.8 %) to −5.0 (13.7 %) loses 39.1 points: a Blunder.

### Mate swings

Every mate counts as 97.5 %, the same as being ten pawns up, so the win % alone misses two kinds of mistake: letting your own forced mate slip while staying far ahead, and walking into a forced mate when you were already losing. Kibitz follows Lichess here (`THRESHOLDS.mate`). For any move other than the engine's top move, the base label becomes at least:

| The move...                                                        | Blunder            | Mistake                     | Inaccuracy           |
| ------------------------------------------------------------------ | ------------------ | --------------------------- | -------------------- |
| **allows a forced mate** you were not already facing               | win % before > 7 % | 2.5 % < win % before ≤ 7 %  | win % before ≤ 2.5 % |
| **lets your forced mate slip** (no mate and no checkmate after it) | win % after < 93 % | 93 % ≤ win % after < 97.5 % | win % after ≥ 97.5 % |

7 %, 2.5 %, 93 % and 97.5 % are about −7.0, −10.0, +7.0 and +10.0. If the win % loss already gives a worse label, that label stays. A slower mate is not a mate swing, and neither is delivering checkmate.

Examples: you have mate in 2 but take a rook instead and stay +15: an Inaccuracy ("You had a forced mate in 2"), although the win % did not move. At −8.0 (5.0 %) you allow mate in 3: a Mistake, although only 2.5 points of win % were lost.

### Book

The move is **Book** when the position after it appears in the opening book **and** every earlier move of the game was Book too. Once a game leaves the book it stays out, even if it later transposes back into a known position.

The book is built from the [Lichess chess-openings](https://github.com/lichess-org/chess-openings) dataset (CC0) by `npm run openings`. Every position along every named line is stored, keyed by piece placement, side to move and castling rights (the en passant square is ignored so transpositions match). The opening shown for the game is the deepest named position reached while still in book.

Book beats every other label: these moves are theory, not decisions to grade.

### Forced

The move is **Forced** when it was the only legal move. There was nothing to decide.

### Brilliant: a sound sacrifice

A move is **Brilliant** when all of these hold (`THRESHOLDS.brilliant`):

| Condition                                                              | Threshold | Why                                                                                  |
| ---------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| The base label is Best or Excellent and `loss ≤ maxLoss`               | 2         | The sacrifice has to be (nearly) the best move: it must be _sound_                   |
| The move offers material (see [Sacrifices](#sacrifices))               | ≥ 2 pawns | An exchange sacrifice or more; giving up a single pawn is a gambit, not a brilliancy |
| The mover is not worse after the move: `winAfter ≥ minWinAfter`        | 50 %      | A sacrifice that leaves you worse is desperation, not brilliance                     |
| The engine's second choice does **not** also keep `≥ maxSecondBestWin` | 97 %      | If a quiet move wins just as easily, the sacrifice was flashy but unnecessary        |

When the engine searched only one line (MultiPV 1), the last condition cannot be checked and the sacrifice gets the benefit of the doubt.

### Great: the only good move

A move is **Great** when all of these hold (`THRESHOLDS.great`):

| Condition                                                                | Threshold | Why                                                             |
| ------------------------------------------------------------------------ | --------- | --------------------------------------------------------------- |
| It is the engine's top move                                              |           |                                                                 |
| The engine's second choice is at least `minGapToSecond` worse            | 10 points | Every alternative was clearly worse: this was the only move     |
| The second choice keeps less than `maxSecondBestWin`                     | 70 %      | If the alternative was still winning, the move was not critical |
| It is not a simple recapture on the square the opponent just captured on |           | Taking a piece back is usually forced-looking and obvious       |

The gap is measured between the best and second-best lines of the **same** search (`winBefore − winSecondBest`), so it is not distorted by the different depth of the search after the move. Great needs MultiPV 2: without a second line a move is never Great.

Example: finding the only mate in one when every other move lets the win slip (second choice +1.0, 59 %) is Great.

### Missed Win

A move is a **Missed Win** when (`THRESHOLDS.missedWin`):

| Condition                                                                      | Threshold           |
| ------------------------------------------------------------------------------ | ------------------- |
| The base label is Inaccuracy, Mistake or Blunder                               |                     |
| The position before was winning: `winBefore ≥ minWinBefore`                    | 70 %                |
| The position after is roughly balanced: `minWinAfter ≤ winAfter < maxWinAfter` | 40 % ≤ win % < 60 % |
| `loss ≥ minLoss`                                                               | 10 points           |

Example: from +4.0 (81.3 %) to +1.0 (59.1 %) is a Missed Win. From +4.0 to −3.0 (24.9 %) is simply a Blunder: the position is not balanced but lost. (With the current numbers the last condition is implied by the others; it is a safety net for when the thresholds are tuned.)

## 4. Sacrifices

A move offers material when the opponent could win material on one of the mover's pieces as a result of it. In detail (`detectSacrifice` in `src/core/material.ts`):

1. For each of the mover's pieces except the king, after the move, compute how much the opponent could win by capturing on its square: a **static exchange evaluation** where both sides recapture with their least valuable legal piece and either side may stop the sequence at any time. Legal moves are used, so pins and checks are respected.
2. Subtract what the opponent could already win on that piece's previous square before the move (looking at the position before the move as if the mover had passed; skipped when the mover was in check). This way a piece that was already hanging does not count as a new sacrifice.
3. The offered amount is the largest result, minus the value of anything the move itself captured and any promotion gain.
4. It is a sacrifice when the offered amount is at least `THRESHOLDS.brilliant.minSacrifice` (2 pawns).

Piece values (`PIECE_VALUES`): pawn 1, knight 3, bishop 3, rook 5, queen 9.

## 5. Key moments

The review highlights up to 8 moves: Brilliant and Great moves first, then the Missed Wins, Blunders and Mistakes that cost the most win %. They are shown in game order.

## 6. Known limitations

- **Engine depth.** Evaluations come from Stockfish running on your device, at depth 12, 16 or 20 depending on the preset, with a time cap per position that can stop the search earlier on slow devices. A shallow search can misjudge sharp positions, so a "Blunder" may occasionally be a deep idea the engine did not see, or the other way round. Raising the depth in Settings gives more reliable labels.
- **Horizon effects.** Each position is searched separately, so the evaluation before and after a move can come from searches that saw different things. This is why the engine's own top move is always at least Best.
- **Brilliant and Great are heuristics.** "Sound sacrifice" and "only good move" are judged from material counts and two engine lines. They catch most real brilliancies and only-moves but will sometimes miss one (for example a positional sacrifice of a pawn, or a sacrifice that only pays off beyond the exchange on one square) or flag an obvious one.
- **Mates.** Every mate counts as ±10 pawns (97.5 %), so choosing a slower mate when a faster one existed loses nothing, and accuracy does not punish the [mate swings](#mate-swings) that the labels catch. Delivering checkmate on the board is 100 %.
- **Win % is a model.** It was fitted by Lichess to games between strong players. It does not know your rating or the clock.
- **Book coverage.** The book contains named lines from the Lichess dataset, not every popular sideline, so a game can leave "book" earlier than you might expect.

## 7. Proposing changes

Classification rules are meant to be discussed in the open.

1. Open an issue with an example game (link or PGN), the move, the label Kibitz gave, the label you expected, and the analysis depth from Settings.
2. If you want to change a rule, change three things together in one pull request:
   - the code (`src/core/thresholds.ts` for numbers, `src/core/classify.ts` for rules),
   - the tests (`src/core/classify.test.ts`, and `src/core/review.test.ts` if review building changes),
   - this document.
3. If the change alters labels for existing games, bump `REVIEW_FORMAT_VERSION` in `src/core/review.ts`.

Analyses are cached rather than reviews, so rule changes apply to every saved game without re-running the engine.

## Credits

The win % model and the accuracy formula are from [Lichess](https://lichess.org) ([lila](https://github.com/lichess-org/lila), AGPL-3.0; the formulas are reimplemented here). The opening book uses the [Lichess chess-openings](https://github.com/lichess-org/chess-openings) dataset (CC0-1.0). Evaluations come from [Stockfish](https://stockfishchess.org) (GPL-3.0).
