# オセロAIベンチマーク — 対局時プロンプト仕様

Jev と GPT に渡す指示プロンプトの定義。両者に **同じ盤面テキスト** と **同じ合法手リスト** を渡し、条件を揃える。
モデルへの指示は英語で統一する（安定性のため）。

- `--hints on|off` で戦略ヒントの有無を切り替える（デフォルト `on`）。
- `--annotate-moves` で、Jev の criteria と同じ「合法手ごとの説明」を GPT にも渡す（デフォルト off）。

実装: [src/prompts.ts](../src/prompts.ts)。以下の例はすべて実装から生成したもの。

---

## 0. 対局ループ共通の規則（`src/match.ts`）

- **パス**（合法手 0）: どちらのプレイヤーも API を呼ばない。
- **唯一手**（合法手 1）: どちらのプレイヤーも API を呼ばずにその手を打つ（`forced: true` として記録）。
- 手数 `Move N` = 盤上の石数 − 4 + 1。**パスは数えない。**
- 合法手の順序は a1, b1, …, h1, a2, …（行→列）で固定する。

---

## 1. 共通：盤面テキスト（`renderBoardPrompt()`）

両プレイヤーに同一の文字列を渡す。手番・手数・石数・空きマス数・盤面・合法手を含む。
空きマス数は、ヒントの「last ~10 moves」をモデルが判定できるようにするためのもの。

```
You are playing Othello (Reversi) as BLACK (X).
Move 9 of the game. Black: 7 discs, White: 5 discs. Empty squares: 52.

Board (columns a-h, rows 1-8; X = black, O = white, . = empty, * = your legal move):
    a b c d e f g h
 1  . . . . . . . .
 2  * * * * * . . .
 3  . O O O . * * .
 4  . . X X X O * .
 5  . . X X X X . .
 6  . . . O . . . .
 7  . . * * * . . .
 8  . . . . . . . .

Legal moves: a2, b2, c2, d2, e2, f3, g3, g4, c7, d7, e7
```

- 白番のときは `WHITE (O)` に置き換える。
- 石数・合法手数が 1 のときは単数形（`1 disc`）にする。

---

## 2. 共通：戦略ヒント（`STRATEGY_HINTS`）

`--hints on` のとき、Jev の `instructions` と GPT の system プロンプト両方に挿入する。

```
Strategy reminders:
- Corners are permanent and very valuable.
- Avoid X-squares (b2, g2, b7, g7) and C-squares next to an empty corner;
  they often hand the corner to the opponent.
- Edges are generally good.
- Early and mid game, prefer mobility (having more legal moves than your
  opponent) over disc count.
- In the endgame (last ~10 moves), maximize your final disc count.
```

---

## 3. Jev（`typesafe-ai/jev` / `experimental_evaluate`）

`ai` パッケージの `experimental_evaluate` を使う。モデル ID の文字列は Vercel AI Gateway で解決される（`AI_GATEWAY_API_KEY` が必要）。

### state

第1節の盤面テキストをそのまま文字列で渡す。

### questions

```ts
questions: {
  move: {
    type: 'choice',
    instructions: jevInstructions(color, hints),
    criteria: buildCriteria(board, color), // 合法手ごとに自動生成
  },
}
```

### instructions

`<COLOR>` は手番に応じて `BLACK` / `WHITE`。

ヒントあり:

```
Pick the move that gives <COLOR> the best chance of winning this Othello game.
Strategy reminders:
...（第2節と同じ）
```

ヒントなし:

```
Pick the move that gives <COLOR> the best chance of winning this Othello game.
```

### criteria（`buildCriteria()` で生成）

key は座標文字列で、順序は合法手リストと同じ。説明文には以下を必ず含める:

1. 座標（行・列）
2. 反転する石の数と位置
3. マスの種類: `CORNER square (permanent)` / `Edge square` / `X-square (diagonally adjacent to an empty corner a1)` / `C-square (adjacent to an empty corner a1)` / `Interior square`
   - X/C-square と判定するのは隣の隅が **空いているときだけ**。隅が埋まっていれば Interior / Edge として扱う。
4. 着手後の相手の合法手数（0 のときは `(they must pass)` を付ける）

第1節の局面での例（一部）:

```ts
{
  a2: 'Play a2 (row 2, column a). Flips 1 disc: b3. C-square (adjacent to an empty corner a1). Opponent will have 6 legal moves after this.',
  b2: 'Play b2 (row 2, column b). Flips 1 disc: c3. X-square (diagonally adjacent to an empty corner a1). Opponent will have 6 legal moves after this.',
  c2: 'Play c2 (row 2, column c). Flips 2 discs: c3, d3. Interior square. Opponent will have 6 legal moves after this.',
  f3: 'Play f3 (row 3, column f). Flips 1 disc: f4. Interior square. Opponent will have 7 legal moves after this.',
  c7: 'Play c7 (row 7, column c). Flips 1 disc: d6. Interior square. Opponent will have 8 legal moves after this.',
  // ...残りの合法手
}
```

### 着手の決定

- `--policy argmax`: `answers.move.choice`
- `--policy sample`: `answers.move.probabilities` からサンプリングする。分布が返らなかった場合は `choice` を使い、記録の `sampled: false` で区別する。

---

## 4. GPT（`openai/<mini or nano>` / `generateText` + `Output.object`）

`generateObject` は AI SDK で非推奨になったため、後継の `generateText({ output: Output.object({ schema }) })` を使う。
デフォルトのモデルは `openai/gpt-5-mini`（`--gpt-model` で変更。例: `openai/gpt-5-nano`）。

### zod スキーマ

```ts
z.object({
  move: z.string().describe('One of the legal moves, e.g. "d3"'),
  reasoning: z.string().describe('One short sentence'),
})
```

### system プロンプト

ヒントあり:

```
You are an expert Othello (Reversi) player. You will be shown the current board
and the list of legal moves for your color. Choose exactly one move from the
legal move list.

Strategy reminders:
...（第2節と同じ）

Respond with JSON only: {"move": "<one of the legal moves>", "reasoning": "<one short sentence>"}
Your move MUST be one of the listed legal moves. Do not invent coordinates.
```

ヒントなし: 上から `Strategy reminders` のブロックを除いたもの。

### user プロンプト

第1節の盤面テキストの末尾に 1 行追加する。

```
<盤面テキスト>

Choose your move.
```

`--annotate-moves` のときは、盤面テキストと `Choose your move.` の間に Jev の criteria と同じ説明を挿入する:

```
<盤面テキスト>

Move details:
- a2: Play a2 (row 2, column a). Flips 1 disc: b3. C-square (adjacent to an empty corner a1). Opponent will have 6 legal moves after this.
- b2: ...

Choose your move.
```

### 合法性の判定

`move` の前後の空白を除き、小文字にしてから合法手リストと照合する（`" F5 "` は `f5` として受け付ける）。

### 非合法手リトライ（最大 2 回）

会話履歴に、直前の assistant 応答（モデルが返した生テキスト）と、以下の user メッセージを追加して再送する。

```
"{move}" is not a legal move. The legal moves are: a2, b2, c2, d2, e2, f3, g3, g4, c7, d7, e7.
Choose one of these exactly.
```

- スキーマに合わない応答（JSON として解析できない等）も非合法として扱い、`{move}` には生テキストを入れる。
- 初回＋リトライ 2 回の計 3 回とも非合法なら、`reason: "illegal_move"` で反則負けとして記録する。

---

## 5. 記録形式（`results/*.jsonl`）

1 行 1 イベントで、発生した時点で追記する（ビューアが実行中のログを追えるようにするため）。

| type | 内容 |
|---|---|
| `run` | 実行設定（`config`）と開始時刻 |
| `game_start` | 局番号、黒/白のプレイヤー名、P1 の色 |
| `turn` | 1 手分の記録。着手後の盤面（64 文字）、合法手、着手、`detail`（下記） |
| `game_end` | 勝者、終局理由（`completed` / `illegal_move`）、石数、所要時間 |
| `game_error` | API エラーで無効になった局（勝敗には数えない） |
| `run_end` | 終了時刻 |

`turn.detail` には実際のリクエストとレスポンスをそのまま残す:

- Jev: `request`（state / questions）、`response`（answers・probabilities、providerMetadata、warnings）、レイテンシ、トークン数
- GPT: `request`（system と、再試行を含む全 messages）、`attempts[]`（各試行の生テキスト、解析結果、合法かどうか、レイテンシ、トークン数）

---

## 6. 公平性のメモ

- 盤面テキスト・合法手リスト・戦略ヒントは両者に同一のものを渡す。
- パス・唯一手ではどちらも API を呼ばないので、呼び出し回数の条件も揃う。
- Jev の criteria に含める付加情報（反転数・マス種別・相手の合法手数）は、デフォルトでは GPT に渡していない。
  特に「相手の合法手数」は 1 手先読みに相当する情報なので、条件を揃えた比較には `--annotate-moves` を使う。
- ヒントあり/なしの両条件で回すと「与えた知識を判断に活かせるか」を比較できる。
