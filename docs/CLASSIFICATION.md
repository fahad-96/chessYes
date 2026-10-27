# How Chess Yes judges moves

This is the public specification for every number Chess Yes shows in a game review: win %, accuracy, the move labels (Brilliant, Great, Best, Excellent, Good, Book, Forced, Inaccuracy, Mistake, Blunder, Miss) and the explanations behind them. It is written for chess players who want to know why a move got its label, and for developers who want to change the rules.

Everything is computed in your browser from Stockfish's evaluations. Win % and accuracy use Chess Yes's own open model, **calibrated against the accuracy figures published by Chess.com game reviews** ([section 2](#calibration)). It is not Chess.com's model, which is not public, and its numbers are close to Chess.com's but not identical. The open formulas of [Lichess](https://github.com/lichess-org/lila) remain available as a second accuracy scale. The label rules are Chess Yes's own and are listed in full below.

| What                 | Code                                                        |
| -------------------- | ----------------------------------------------------------- |
| Every tunable number | [`src/core/thresholds.ts`](../src/core/thresholds.ts)       |
| Calibrated constants | [`src/core/accuracyModel.ts`](../src/core/accuracyModel.ts) |
| Eval → win %         | [`src/core/winPercent.ts`](../src/core/winPercent.ts)       |
| Accuracy             | [`src/core/accuracy.ts`](../src/core/accuracy.ts)           |
| Label rules          | [`src/core/classify.ts`](../src/core/classify.ts)           |
| Sacrifice detection  | [`src/core/material.ts`](../src/core/material.ts)           |
| Tactics and stories  | [`src/core/tactics.ts`](../src/core/tactics.ts)             |
| Explanations         | [`src/core/explain.ts`](../src/core/explain.ts)             |
| Putting it together  | [`src/core/review.ts`](../src/core/review.ts)               |

If this document and the code ever disagree, the code is what runs, and the disagreement is a bug: please open an issue.

## 1. Win percentage

Stockfish reports evaluations in centipawns (100 = one pawn) or as "mate in N". Chess Yes converts every evaluation into the side's chance of winning, from 0 to 100:

```
win % (White) = 100 / (1 + e^(−0.0019874 × cp))
```

- `cp` is the evaluation from White's point of view, **clamped to −1000…+1000**.
- A **forced mate** is a certain result: 100 % for the side that mates and 0 % for the side that gets mated, whatever its length.
- Black's win % is `100 − White's win %`.
- When the game is over on the board: the side that delivered **checkmate** has 100 %, the mated side 0 %. **Stalemate**, insufficient material, threefold repetition and the fifty-move rule are 50 %.

| Evaluation (White)        | White win % |
| ------------------------- | ----------- |
| 0.0                       | 50.0        |
| +0.5 / −0.5               | 52.5 / 47.5 |
| +1.0 / −1.0               | 55.0 / 45.0 |
| +2.0 / −2.0               | 59.8 / 40.2 |
| +3.0 / −3.0               | 64.5 / 35.5 |
| +5.0 / −5.0               | 73.0 / 27.0 |
| +7.0 / −7.0               | 80.1 / 19.9 |
| ±10.0 or more             | 87.9 / 12.1 |
| Forced mate, or checkmate | 100 / 0     |

This is the curve of the Lichess model (lila `WinPercent.scala`) with a slope about half as steep (Lichess: 0.00368208, which makes +3.0 worth 75.1 %), and with forced mates counted as certain wins instead of as ten pawns. Both changes come from the [calibration](#calibration): they are what brings Chess Yes's accuracies close to the published ones. The same win % drives the labels, the eval graph and the eval bar.

**Why win % instead of centipawns?** The same centipawn drop matters very differently depending on the position. Going from 0.0 to −3.0 costs 14.5 points of win % (a Mistake); going from +10.0 to +7.0 costs 7.9 points (an Inaccuracy), because you are still winning; going from +15 to +12 costs nothing. Measuring in win % treats all three fairly.

### Win % lost by a move

For every move Chess Yes compares two numbers, both from the **mover's** point of view:

- **Win % before** (`winBefore`): the evaluation of the engine's best line in the position before the move, that is, what you could have kept with best play.
- **Win % after** (`winAfter`): the evaluation of the engine's best line in the position after the move you played.

```
loss = max(0, winBefore − winAfter)
```

A move can never "gain" in this model; a positive difference (the engine found more after your move) counts as zero loss.

## 2. Accuracy

### Per move

```
accuracy = 78.962 × e^(−0.13101 × loss) + 21.038
```

and exactly 100 when the move lost nothing. A move that throws the game away scores about 21, never 0.

| Win % lost    | 0   | 1    | 2    | 5    | 10   | 20   | 30   | 50   |
| ------------- | --- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| Move accuracy | 100 | 90.3 | 81.8 | 62.1 | 42.3 | 26.8 | 22.6 | 21.2 |

### Per game

A player's game accuracy is the **harmonic mean** of their move accuracies: `moves / Σ (1 / accuracy)`. Every move counts, including book moves, forced moves and the engine's top moves. The harmonic mean punishes a few very bad moves more than an ordinary average would: one Blunder among twenty perfect moves takes the game from 100 to about 85.

A player who has not moved yet (for example while analysis is still running) is shown as 100 internally and as "—" in the interface.

### Calibration

Chess.com shows an accuracy for both players at the end of a game review. Its model is proprietary, so Chess Yes does not copy it. Instead, Chess Yes's open model has three numbers (the win % slope, and the scale and decay of the move curve) that were **fitted so that its accuracies land close to the published ones** (constants and details: [`src/core/accuracyModel.ts`](../src/core/accuracyModel.ts)):

- **Data:** 225 rated games from the public Chess.com API that carry published accuracies, 45 in each average-rating band (under 1000, 1000-1400, 1400-1800, 1800-2200, 2200 and up), blitz, rapid and daily. Chess Yes analysed every game itself, with the browser engine at the Standard preset (Stockfish 19 lite, depth 16, MultiPV 2).
- **Fit:** the numbers minimise the mean absolute error between Chess Yes's and the published accuracies, checked with 5-fold cross-validation by game: each game is predicted by a fit that did not see it.
- **Result on held-out games** (450 player-games):

| Error vs published accuracy | Lichess formulas | Calibrated |
| --------------------------- | ---------------- | ---------- |
| Mean absolute error         | 6.3              | **3.0**    |
| Average (bias)              | +3.1             | +0.4       |
| Players within 5 points     | 52 %             | 85 %       |
| Under 1000                  | 7.1              | 3.2        |
| 1000-1400                   | 7.6              | 3.6        |
| 1400-1800                   | 7.6              | 2.7        |
| 1800-2200                   | 5.4              | 2.8        |
| 2200 and up                 | 3.8              | 2.5        |

The biggest single improvement is counting a forced mate as a certain win. A version that also took the players' ratings into account improved the error by only 0.1 point, so the model does not use ratings.

So expect Chess Yes's accuracy to be within about 3 points of Chess.com's on average and within 5 points for most players, but not the same number: the engine, the search depth and the model all differ. [`src/core/accuracyModel.test.ts`](../src/core/accuracyModel.test.ts) checks five of the games against their published figures, so a change cannot silently undo the calibration.

Example: a 10-minute game between two players rated about 830, which Chess.com rated 73.2 for White and 56.6 for Black. The Lichess formulas give 81.8 and 70.3 on Chess Yes's analysis; the calibrated model gives 68.9 and 59.2.

### The Lichess scale

The open Lichess formulas (lila `WinPercent.scala` and `AccuracyPercent.scala`) are available as a second accuracy scale: **Settings → Analysis → Accuracy scale → Lichess formula** (`accuracyModel: 'lichess'` in `buildGameReview`). Only the accuracies change; labels, win % and the graph stay on the calibrated scale. Switching rebuilds the open review at once from the same analysis. Reviewed games in the library keep the scale they were saved with: insights leave out games on the other scale until they are reviewed again (the batch analysis does that, reusing saved engine results where it can).

- Win %: `50 + 50 × (2 / (1 + e^(−0.00368208 × cp)) − 1)`, cp clamped to ±1000, a forced mate counted as ±1000.
- Per move: `103.1668100711649 × e^(−0.04354415386753951 × loss) − 3.166924740191411 + 1`, clamped to 0…100 and 100 when nothing was lost (the `+ 1` is Lichess's "uncertainty bonus").
- Per game: the average of a volatility-weighted mean (each move weighted by the standard deviation of White's win % over a sliding window of `moves / 10` positions, clamped to 2…8, with weights clamped to 0.5…12) and a harmonic mean (move accuracies floored at 1).

## 3. Labels

### Order of precedence

The first rule that matches wins:

1. **Book**
2. **Forced**
3. **Brilliant**
4. **Great**
5. **Miss**
6. The base label: **Best**, **Excellent**, **Good**, **Inaccuracy**, **Mistake** or **Blunder**

Brilliant and Great can only upgrade a Best (or, for Brilliant, Excellent) move. Miss can only replace an Inaccuracy, Mistake or Blunder. So the precedence only matters between Book, Forced, Brilliant and Great.

### Base labels

All bounds are inclusive and come from `THRESHOLDS.loss`. They are the published bounds of Chess.com's labels (0.02, 0.05, 0.10 and 0.20 expected points), which Chess Yes applies to its own calibrated win %.

| Label          | Rule                                                                |
| -------------- | ------------------------------------------------------------------- |
| **Best**       | The move is the engine's top move, or it loses nothing (`loss ≤ 0`) |
| **Excellent**  | `loss ≤ 2`                                                          |
| **Good**       | `2 < loss ≤ 5`                                                      |
| **Inaccuracy** | `5 < loss ≤ 10`                                                     |
| **Mistake**    | `10 < loss ≤ 20`                                                    |
| **Blunder**    | `loss > 20`                                                         |

The engine's top move is always at least Best, even when the search after the move sees a small drop. That drop is search noise (a deeper look at the same line), not a fault of the move.

Example: from +0.3 (51.5 %) to −5.0 (27.0 %) loses 24.5 points: a Blunder.

### Forced mates

A forced mate counts as 100 % (0 % for the side that gets mated), so letting your own mate slip or walking into one costs win % like any other move:

- mate → +10.0 or more (87.9 %) loses 12.1 points: a Mistake (and usually a [Miss](#miss));
- mate → +3.0 (64.5 %) loses 35.5 points: a Blunder;
- at −5.0 (27.0 %), allowing a forced mate loses 27 points: a Blunder; at −10.0 or worse (12.1 %), 12.1 points: a Mistake.

A slower mate loses nothing, and neither does delivering checkmate. (On the Lichess scale every mate is worth ten pawns, so Chess Yes used to need separate "mate swing" rules for these cases; the calibrated scale does not.)

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
| The engine's second choice does **not** also keep `≥ maxSecondBestWin` | 87 %      | If a quiet move wins just as easily (+9.5 or a mate), the sacrifice was unnecessary  |

When the engine searched only one line (MultiPV 1), the last condition cannot be checked and the sacrifice gets the benefit of the doubt.

### Great: the only good move

A move is **Great** when all of these hold (`THRESHOLDS.great`):

| Condition                                                                                              | Threshold | Why                                                                     |
| ------------------------------------------------------------------------------------------------------ | --------- | ----------------------------------------------------------------------- |
| It is the engine's top move                                                                            |           |                                                                         |
| The engine's second choice is at least `minGapToSecond` worse                                          | 9 points  | Every alternative was clearly worse: this was the only move             |
| The second choice keeps less than `maxSecondBestWin`                                                   | 61 %      | If the alternative was still clearly better (+2.3), it was not critical |
| The search after the move confirms it: `loss ≤ maxLoss`                                                | 3 points  | A top move that the next search refutes was not a great find            |
| It does not answer a check                                                                             |           | With few legal options, finding the one that works is rarely hard       |
| It does not deliver checkmate                                                                          |           | The mate is the end of a winning plan; the moves that set it up decide  |
| It is not a simple recapture on the square the opponent just captured on                               |           | Taking a piece back is usually forced-looking and obvious               |
| It is not a capture that wins at least `obviousCaptureGain` outright (static exchange before the move) | 2 pawns   | Taking a piece that was simply hanging is obvious, not great            |

The gap is measured between the best and second-best lines of the **same** search (`winBefore − winSecondBest`), so it is not distorted by the different depth of the search after the move. Great needs MultiPV 2: without a second line a move is never Great.

A move that delivers checkmate stays Best, however bad the alternatives. (Brilliant would still take precedence, but a mating move never offers material: nothing can be taken after checkmate.)

Example: the only move that keeps the balance when every alternative loses a piece (second choice −2.0, 40.2 %, a gap of 9.8 points) is Great.

The Brilliant and Great numbers were first tuned on the Lichess win % scale (second choice below 97 % and 70 %, a gap of 15 points, a loss of at most 5) and carried over to the calibrated scale so that the same moves keep their labels. On the 225 rated games of the [calibration](#calibration), 95 % of the earlier Great moves and 44 of the 46 Brilliant moves kept their label, at almost the same rate (Great 0.69 → 0.73 and Brilliant 0.10 → 0.10 per player and game); on the 12 games in `src/core/__fixtures__/games` the rates did not change at all.

### Miss

A move is a **Miss** when you had a real chance, to cash in or to punish your opponent's mistake, and the move lets it slip without throwing the game away (`THRESHOLDS.miss`):

| Condition                                                                                                                                                                                                                                                                                                                                                                         | Threshold         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| The base label is Inaccuracy, Mistake or Blunder                                                                                                                                                                                                                                                                                                                                  |                   |
| There was a chance, at least one of:                                                                                                                                                                                                                                                                                                                                              |                   |
| • the engine's best move starts a forced mate                                                                                                                                                                                                                                                                                                                                     |                   |
| • the engine's best line wins material: over the part of the line the review shows for it ("Best was ..."), you come out at least `minMaterialWon` further ahead than over the line after your move; taking back a piece that was just taken does not count, and neither does material your move wins as well (taking with another piece, or winning the same piece a move later) | 2 pawns           |
| • your opponent's previous move was an error (Inaccuracy or worse) that gave away at least `minGift`, and your move gives back at least `minShareGivenBack` of it                                                                                                                                                                                                                 | 10 points, half   |
| You are not clearly worse after the move: `winAfter ≥ minWinAfter`                                                                                                                                                                                                                                                                                                                | 40 % (about −2.0) |

Being better is not a chance by itself: spoiling a won position when there was nothing concrete to take is a plain Inaccuracy, Mistake or Blunder. A move that leaves you clearly worse stays a Mistake or Blunder too, because the position it throws away matters more than the chance that went with it.

Example, from a 10-minute game between two players rated about 830 (`src/core/__fixtures__/rated`, Chess Yes's depth-16 analysis):

- **23.Re1** (mate in 6 → 77.0 %) and **25.Re6+** (mate in 1 → 87.9 %) let a forced mate go: Misses.
- 11...Bh5? lets White trap the bishop with g4. 13.Nd5 does not play it at once (67.7 % → 57.8 %), but the engine line after Nd5 still wins the bishop (...a5 Bxd4 exd4 g4 Bxg4 fxg4): an Inaccuracy, because the chance is only delayed, not missed.
- 18.Qh2 gives back most of a winning position (66.3 % → 52.0 %), but the best move 18.Nh3 wins nothing: a Mistake.
- 23...Qc8, right after White's Miss, allows mate again: a Blunder, not a Miss, because Black is lost after it.

Chess.com's review of this game counted 3 Misses for White and none for Black; Chess Yes finds 2 and none (which moves Chess.com picked is not published, so the rule was not tuned to match it). On the 225 rated games, Misses come up about 1.4 times per player and game below a rating of 1400, 1.1 times at 1400-1800 and 0.4 times above 1800.

The label used to be called Missed Win, under an earlier rule (a winning position let slip to roughly equal) that this one replaces. Its key in the code (`missedWin`) and the puzzle theme's key (`missed-win`) keep the old name.

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

The review highlights up to 8 moves: Brilliant and Great moves first, then the Misses, Blunders and Mistakes that cost the most win %. They are shown in game order.

## 6. Explanations

Every move gets a short plain-English explanation, and the moves where it matters also get a **story**: a few moves of the engine's line that show _why_ the move got its label, which the review can play on the board and read aloud. Like the labels, explanations are rule-based: no AI writes them.

| What gets a story                         | Story                                                                                                                              | Example                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Inaccuracy, Mistake, Blunder, Miss        | **Refutation** (`why`): the engine's line after the move, starting with the reply                                                  | "This leaves your rook on g8 unprotected: Bxg8 takes it for free."    |
| ...when the engine preferred another move | **Missed** (`bestIdea`): the engine's line from the position before, with its best move                                            | "You missed Nf6+, which forks the king and queen and wins the queen." |
| Brilliant, Great                          | **Idea** (`why`): the move followed by the engine's line                                                                           | "You sacrifice the queen on b8: after Nxb8, Rd8# is checkmate."       |
| Best, Excellent                           | **Idea**, only when the move itself sets up a tactic that pays off in the line, and does more than win back material you were down | "Nf6+ forks the king and queen and wins the queen."                   |
| Book, Forced, Good, and moves that mate   | None                                                                                                                               |                                                                       |

The explanation leads with the story when the story shows something concrete: a mate, a tactic, or material that changes hands and that the best line would have kept (so a piece that was lost whatever you played is not blamed on your move). It still names the better move: "Blunder. This leaves your rook on g8 unprotected: Bxg8 takes it for free. Best was Rxg7, which wins the undefended pawn on g7." Mate counts always come from the engine's evaluation; a mate of up to 3 moves is spelled out move by move ("This allows a back-rank mate: Rc1+ Rd1 Rxd1#.").

### Motifs

A motif is a tactical pattern created by one move (`findMotifs` in `src/core/tactics.ts`). Chess Yes prefers missing a pattern to naming one that is not there.

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
- **Mates.** Every forced mate counts as 100 %, whatever its length, so choosing a slower mate when a faster one existed loses nothing. A long mate that the search after the move does not find again (a horizon effect) can make a sound move look like a Mistake or a Miss.
- **Win % is a model.** Its slope was fitted to the published accuracies of games at every level (see [Calibration](#calibration)). It does not know your rating or the clock.
- **Calibrated, not identical.** Chess Yes's accuracy is usually within a few points of Chess.com's, but the engines, depths and models differ, so the numbers and labels will not always match. The calibration was done at the Standard preset (depth 16); the Fast and Deep presets were not fitted separately.
- **Book coverage.** The book contains named lines from the Lichess dataset, not every popular sideline, so a game can leave "book" earlier than you might expect.

## 8. Proposing changes

Classification rules are meant to be discussed in the open.

1. Open an issue with an example game (link or PGN), the move, the label Chess Yes gave, the label you expected, and the analysis depth from Settings.
2. If you want to change a rule, change three things together in one pull request:
   - the code (`src/core/thresholds.ts` for numbers, `src/core/classify.ts` for rules, `src/core/accuracyModel.ts` for the calibrated constants),
   - the tests (`src/core/classify.test.ts`, and `src/core/review.test.ts` if review building changes; a change to win % or accuracy must keep `src/core/accuracyModel.test.ts` green),
   - this document.
3. If the change alters labels for existing games, bump `REVIEW_FORMAT_VERSION` in `src/core/review.ts`.

Analyses are cached rather than reviews, so rule changes apply to every saved game without re-running the engine.

## Credits

The Lichess accuracy scale and the shape of the calibrated win % curve are from [Lichess](https://lichess.org) ([lila](https://github.com/lichess-org/lila), AGPL-3.0; the formulas are reimplemented here). The calibrated model was fitted to accuracy figures published by Chess.com game reviews; Chess Yes is not affiliated with Chess.com. The opening book uses the [Lichess chess-openings](https://github.com/lichess-org/chess-openings) dataset (CC0-1.0). Evaluations come from [Stockfish](https://stockfishchess.org) (GPL-3.0).
