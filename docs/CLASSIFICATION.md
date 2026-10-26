# How Kibitz judges moves

This is the public specification for every number Kibitz shows in a game review: win %, accuracy, the move labels (Brilliant, Great, Best, Excellent, Good, Book, Forced, Inaccuracy, Mistake, Blunder, Missed Win) and the explanations behind them. It is written for chess players who want to know why a move got its label, and for developers who want to change the rules.

Everything is computed in your browser from Stockfish's evaluations. The win % and accuracy formulas are the open formulas used by [Lichess](https://github.com/lichess-org/lila); the label rules are Kibitz's own and are listed in full below.

| What                 | Code                                                  |
| -------------------- | ----------------------------------------------------- |
| Every tunable number | [`src/core/thresholds.ts`](../src/core/thresholds.ts) |
| Eval → win %         | [`src/core/winPercent.ts`](../src/core/winPercent.ts) |
| Accuracy             | [`src/core/accuracy.ts`](../src/core/accuracy.ts)     |
| Label rules          | [`src/core/classify.ts`](../src/core/classify.ts)     |
| Sacrifice detection  | [`src/core/material.ts`](../src/core/material.ts)     |
| Tactics and stories  | [`src/core/tactics.ts`](../src/core/tactics.ts)       |
| Explanations         | [`src/core/explain.ts`](../src/core/explain.ts)       |
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

Book beats every other label: these moves are theory, not decisions to grade. The dataset also names trap lines, such as "Barnes Opening: Fool's Mate" (1.f3 e5 2.g4?? Qh4#), which contain the losing move itself. So the book also ends, and the move is graded like any other, when a move in a book position:

- delivers checkmate, or
- loses more than an Inaccuracy's worth of win % (`loss > 10`) and is not the engine's top move, or
- allows a forced mate.

In Fool's Mate, 1.f3 and 1...e5 are Book, 2.g4 is a Blunder and 2...Qh4# is Best.

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

| Condition                                                                                              | Threshold | Why                                                                    |
| ------------------------------------------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------- |
| It is the engine's top move                                                                            |           |                                                                        |
| The engine's second choice is at least `minGapToSecond` worse                                          | 15 points | Every alternative was clearly worse: this was the only move            |
| The second choice keeps less than `maxSecondBestWin`                                                   | 70 %      | If the alternative was still winning, the move was not critical        |
| The search after the move confirms it: `loss ≤ maxLoss`                                                | 5 points  | A top move that the next search refutes was not a great find           |
| It does not answer a check                                                                             |           | With few legal options, finding the one that works is rarely hard      |
| It does not deliver checkmate                                                                          |           | The mate is the end of a winning plan; the moves that set it up decide |
| It is not a simple recapture on the square the opponent just captured on                               |           | Taking a piece back is usually forced-looking and obvious              |
| It is not a capture that wins at least `obviousCaptureGain` outright (static exchange before the move) | 2 pawns   | Taking a piece that was simply hanging is obvious, not great           |

The gap is measured between the best and second-best lines of the **same** search (`winBefore − winSecondBest`), so it is not distorted by the different depth of the search after the move. Great needs MultiPV 2: without a second line a move is never Great.

A move that delivers checkmate stays Best, however bad the alternatives. (Brilliant would still take precedence, but a mating move never offers material: nothing can be taken after checkmate.)

Example: the only move that keeps the balance when every alternative loses a piece (second choice −2.0, 32.4 %, a gap of 17.6 points) is Great.

### Missed Win

A move is a **Missed Win** when (`THRESHOLDS.missedWin`):

| Condition                                                                      | Threshold           |
| ------------------------------------------------------------------------------ | ------------------- |
| The base label is Inaccuracy, Mistake or Blunder                               |                     |
| The position before was winning: `winBefore ≥ minWinBefore`                    | 75 % (about +3.0)   |
| The position after is roughly balanced: `minWinAfter ≤ winAfter < maxWinAfter` | 40 % ≤ win % < 60 % |
| `loss ≥ minLoss`                                                               | 10 points           |

Example: from +4.0 (81.3 %) to +1.0 (59.1 %) is a Missed Win. From +4.0 to −3.0 (24.9 %) is simply a Blunder: the position is not balanced but lost. (With the current numbers the last condition is implied by the others; it is a safety net for when the thresholds are tuned.)

## 4. Sacrifices

A move offers material when the opponent could win material on one of the mover's pieces as a result of it. In detail (`detectSacrifice` in `src/core/material.ts`):

1. For each of the mover's pieces except the king, after the move, compute how much the opponent could win by capturing on its square: a **static exchange evaluation** where both sides recapture with their least valuable legal piece and either side may stop the sequence at any time. Legal moves are used, so pins and checks are respected.
2. Subtract what the opponent could already win on that piece's previous square before the move (looking at the position before the move as if the mover had passed, also when the mover was in check). This way a piece that was already hanging does not count as a new sacrifice: stepping out of a fork, or blocking a check while another piece hangs, offers nothing.
3. The offered amount is the largest result, minus the value of anything the move itself captured and any promotion gain.
4. It is a sacrifice when the offered amount is at least `THRESHOLDS.brilliant.minSacrifice` (2 pawns).

Two kinds of move never count as a sacrifice:

- **A move that ends the game** on the board (checkmate, stalemate, or a capture that leaves too little material to mate): nothing can be taken after it.
- **A capture or check whose material comes straight back** (`isRegainedAtOnce` in `src/core/material.ts`): the engine's line after the move has the opponent capture, and after the mover's next move the mover is down less than 2 pawns compared with before the move. A rook check that is taken but uncovers an attack on the queen is a trick, not a sacrifice; it can still be Great. A line that ends in a forced mate for the mover keeps the sacrifice. Quiet moves are not checked this way, so a quiet sacrifice such as Kasparov's 37.Rd7 against Topalov stays Brilliant.

Piece values (`PIECE_VALUES`): pawn 1, knight 3, bishop 3, rook 5, queen 9.

## 5. Key moments

The review highlights up to 8 moves: Brilliant and Great moves first, then the Missed Wins, Blunders and Mistakes that cost the most win %. They are shown in game order.

## 6. Explanations

Every move gets a short plain-English explanation, and the moves where it matters also get a **story**: a few moves of the engine's line that show _why_ the move got its label, which the review can play on the board and read aloud. Like the labels, explanations are rule-based: no AI writes them.

| What gets a story                         | Story                                                                                                                              | Example                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Inaccuracy, Mistake, Blunder, Missed Win  | **Refutation** (`why`): the engine's line after the move, starting with the reply                                                  | "This leaves your rook on g8 unprotected: Bxg8 takes it for free."    |
| ...when the engine preferred another move | **Missed** (`bestIdea`): the engine's line from the position before, with its best move                                            | "You missed Nf6+, which forks the king and queen and wins the queen." |
| Brilliant, Great                          | **Idea** (`why`): the move followed by the engine's line                                                                           | "You sacrifice the queen on b8: after Nxb8, Rd8# is checkmate."       |
| Best, Excellent                           | **Idea**, only when the move itself sets up a tactic that pays off in the line, and does more than win back material you were down | "Nf6+ forks the king and queen and wins the queen."                   |
| Book, Forced, Good, and moves that mate   | None                                                                                                                               |                                                                       |

The explanation leads with the story when the story shows something concrete: a mate, a tactic, or material that changes hands and that the best line would have kept (so a piece that was lost whatever you played is not blamed on your move). It still names the better move: "Blunder. This leaves your rook on g8 unprotected: Bxg8 takes it for free. Best was Rxg7, which wins the undefended pawn on g7." Mate counts always come from the engine's evaluation; a mate of up to 3 moves is spelled out move by move ("This allows a back-rank mate: Rc1+ Rd1 Rxd1#.").

### Motifs

A motif is a tactical pattern created by one move (`findMotifs` in `src/core/tactics.ts`). Kibitz prefers missing a pattern to naming one that is not there.

| Motif                          | Rule                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fork**                       | The moved piece attacks two or more pieces (not pawns) that each matter: the king (check), a piece worth more than the attacker, or a piece it could take at a profit (static exchange). At least one target is newly attacked, and the forking piece cannot simply be taken without losing material. |
| **Pin**                        | A bishop, rook or queen attacks a knight, bishop, rook or queen with the king (absolute pin) or a more valuable piece (relative pin) right behind it. The pinned piece cannot take the pinner along the line, and the pinner cannot simply be taken.                                                  |
| **Skewer**                     | The same line through the king, or through a piece worth more than both the attacker and the piece behind it, which is then won.                                                                                                                                                                      |
| **Discovered attack / check**  | Moving a piece opens a line from another piece to an enemy piece (that it could take at a profit) or to the king.                                                                                                                                                                                     |
| **Double check**               | Two pieces give check at once.                                                                                                                                                                                                                                                                        |
| **Hanging piece**              | A capture the opponent cannot answer by winning material back on that square. Taking back on the square the previous move captured on is a trade, not a hanging piece.                                                                                                                                |
| **Promotion**                  | A pawn promotes and the new piece cannot be won back at once.                                                                                                                                                                                                                                         |
| **Checkmate / back-rank mate** | The move mates. It is a back-rank mate when a rook or queen mates along the king's first rank and the king's own pieces block all but at most one of the squares in front of it.                                                                                                                      |

Pins, skewers and checks that already existed before the move are not reported. Trapped pieces are not detected yet: doing that reliably needs a search.

### Stories

`describeLine` turns an engine line into a story:

1. **Which moves to show.** The line runs to the last quiet position within 6 plies (no check, and the next move is not a capture or promotion), or on to the end of a run of captures and checks still going on there (up to 11 plies). The engine line is read one move further than shown, so a line cut short in the middle of an exchange is never taken for a finished one. It is then cut right after the move that cashes in the tactic and its recapture, if the rest of the line does not change the material, and trailing moves that capture nothing are dropped. A line that ends in checkmate within 11 plies is shown in full.
2. **Which motifs count.** Only motifs of the side carrying out the story (your opponent in a refutation, you otherwise), and only when they pay off within the shown line: that side ends up at least a pawn ahead over the whole line, from that move on, and actually captures one of the targets; or the line ends in its checkmate. A refutation counts material from the position before your move, so taking back what your move captured is a trade. Likewise, when your opponent has just started an exchange and the line takes back on that square, material is counted from before their capture: taking back is not winning material.
3. **The text.** One or two sentences in the second person, naming pieces and squares and ending with the outcome. The leading motif is the strongest one (mate, fork, skewer, pin, checks, discovered attack, hanging piece, promotion), as long as it accounts for at least half of the material the line wins; a capture that only wins back a piece lost earlier in the line does not lead. A capture or promotion that only starts the winning says what follows ("Bxb7 wins the undefended pawn on b7 and then the exchange."). Without a motif the story names the material won: as one capture's when that capture accounts for it ("After Nc6 f4, exf4 wins a pawn.", "Your opponent replies Rxg6 and wins the exchange."), otherwise as the outcome ("you come out a pawn ahead"). A piece the opponent could already take before your move "is still hanging" rather than being left unprotected by it. A sacrifice is named when the reply takes the piece and you are still at least 2 pawns down after your next move, but not when the move answers a check, takes back what the move before captured, or leaves a piece that could already be taken, nor in a refutation you do not come out of behind. Runs of more than 4 moves read "a few moves later", since the board shows them anyway. When the line shows nothing concrete, the story only carries the moves and a neutral sentence, and the explanation does not use it. The review plays a story on the board ("Show why") only when it shows a motif, a mate, a sacrifice, or material going the way of the label: lost after a bad move, won by a good one or by the better move.

Each story also records the material won or lost by the reviewed player over the shown line, the sacrifice it opens with (the board captions it), and, when it ends in mate, the length of the mate.

Stories and explanations are written to the player who made the move. When the review knows which player you are, the texts of your opponent's moves are rewritten for you (`src/core/perspective.ts`): "Your opponent replies Rxg7+ and wins your pawn on g7" becomes "You reply Rxg7+ and win their pawn on g7". Puzzles tell the solution as an idea, in the present tense: "Rxg7+ forks the king and bishop and wins the bishop."

## 7. Known limitations

- **Engine depth.** Evaluations come from Stockfish running on your device, at depth 12, 16 or 20 depending on the preset, with a time cap per position that can stop the search earlier on slow devices. A shallow search can misjudge sharp positions, so a "Blunder" may occasionally be a deep idea the engine did not see, or the other way round. Raising the depth in Settings gives more reliable labels.
- **Horizon effects.** Each position is searched separately, so the evaluation before and after a move can come from searches that saw different things. This is why the engine's own top move is always at least Best.
- **Brilliant and Great are heuristics.** "Sound sacrifice" and "only good move" are judged from material counts and two engine lines. They catch most real brilliancies and only-moves but will sometimes miss one (for example a positional sacrifice of a pawn, a sacrifice that only pays off beyond the exchange on one square, or a queen left en prise that was already attacked, such as Fischer's 17...Be6 against Byrne in 1956, which is Great) or flag an obvious one. A sacrifice the engine only finds at a higher depth is missed too: Kasparov's 24.Rxd4 against Topalov (1999) needs more than depth 16.
- **Mates.** Every mate counts as ±10 pawns (97.5 %), so choosing a slower mate when a faster one existed loses nothing, and accuracy does not punish the [mate swings](#mate-swings) that the labels catch. Delivering checkmate on the board is 100 %.
- **Win % is a model.** It was fitted by Lichess to games between strong players. It does not know your rating or the clock.
- **Book coverage.** The book contains named lines from the Lichess dataset, not every popular sideline, so a game can leave "book" earlier than you might expect.

## 8. Proposing changes

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
