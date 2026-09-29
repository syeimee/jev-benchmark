# 実際に送った入力と返ってきた応答（ログからの抜粋）

すべて実際のログから機械的に抜き出したもの。出典のファイルと手番を各節に記載。

## 1. Jev の呼び出し方（AI SDK）

```ts
import { experimental_evaluate } from 'ai';

const result = await experimental_evaluate({
  model: 'typesafe-ai/jev',           // Vercel AI Gateway 経由
  state: '<盤面テキスト>',             // 判断の対象
  questions: {
    move: {
      type: 'choice',
      instructions: '<何を基準に選ぶか>',
      criteria: { d3: '<説明>', c4: '<説明>', ... },  // 選択肢と説明
    },
  },
});
result.answers.move.choice;          // 選ばれた選択肢
result.answers.move.probabilities;   // 選択肢ごとの確率
result.providerMetadata.typesafe.confidence.move;  // Jev の自信
```

## 2. オセロ: Jev（criteria v1）

出典: `results/phase3-v1.jsonl 1局目 21手目`

### state（盤面テキスト。両プレイヤー共通）

```
You are playing Othello (Reversi) as BLACK (X).
Move 21 of the game. Black: 10 discs, White: 14 discs. Empty squares: 40.

Board (columns a-h, rows 1-8; X = black, O = white, . = empty, * = your legal move):
    a b c d e f g h
 1  . . * O O O . .
 2  . * O O X . . *
 3  . . X O X * O .
 4  . . X O O X . .
 5  . . X X X O X .
 6  . X . O O * O .
 7  . . * O * * * .
 8  . . . * . . . .

Legal moves: c1, b2, h2, f3, f6, c7, e7, f7, g7, d8
```

### instructions

```
Pick the move that gives BLACK the best chance of winning this Othello game.
Strategy reminders:
- Corners are permanent and very valuable.
- Avoid X-squares (b2, g2, b7, g7) and C-squares next to an empty corner;
  they often hand the corner to the opponent.
- Edges are generally good.
- Early and mid game, prefer mobility (having more legal moves than your
  opponent) over disc count.
- In the endgame (last ~10 moves), maximize your final disc count.
```

### criteria（合法手ごとの説明）

```json
{
  "c1": "Play c1 (row 1, column c). Flips 2 discs: c2, d2. Edge square. Opponent will have 12 legal moves after this.",
  "b2": "Play b2 (row 2, column b). Flips 2 discs: c2, d2. X-square (diagonally adjacent to an empty corner a1). Opponent will have 12 legal moves after this.",
  "h2": "Play h2 (row 2, column h). Flips 1 disc: g3. C-square (adjacent to an empty corner h1). Opponent will have 12 legal moves after this.",
  "f3": "Play f3 (row 3, column f). Flips 1 disc: e4. Interior square. Opponent will have 11 legal moves after this.",
  "f6": "Play f6 (row 6, column f). Flips 1 disc: f5. Interior square. Opponent will have 11 legal moves after this.",
  "c7": "Play c7 (row 7, column c). Flips 1 disc: d6. Interior square. Opponent will have 14 legal moves after this.",
  "e7": "Play e7 (row 7, column e). Flips 2 discs: d6, e6. Interior square. Opponent will have 15 legal moves after this.",
  "f7": "Play f7 (row 7, column f). Flips 1 disc: e6. Interior square. Opponent will have 14 legal moves after this.",
  "g7": "Play g7 (row 7, column g). Flips 1 disc: g6. X-square (diagonally adjacent to an empty corner h8). Opponent will have 13 legal moves after this.",
  "d8": "Play d8 (row 8, column d). Flips 2 discs: d6, d7. Edge square. Opponent will have 14 legal moves after this."
}
```

### 応答

```json
{
  "choice": "c1",
  "probabilities": {
    "c1": 0.38,
    "g7": 0.01,
    "d8": 0.14,
    "f6": 0.06,
    "f3": 0.14,
    "f7": 0.03,
    "c7": 0.09,
    "e7": 0.12,
    "h2": 0.02,
    "b2": 0.01
  },
  "confidence": 0.32,
  "gateway_cost_usd": "0.000046746",
  "latencyMs": 482
}
```

## 3. オセロ: Jev（criteria v2 = 先読みの情報入り）

出典: `results/phase2-jev2-rule2.jsonl 1局目 31手目`

### state（盤面テキスト。両プレイヤー共通）

```
You are playing Othello (Reversi) as BLACK (X).
Move 31 of the game. Black: 20 discs, White: 14 discs. Empty squares: 30.

Board (columns a-h, rows 1-8; X = black, O = white, . = empty, * = your legal move):
    a b c d e f g h
 1  . . * O . . . .
 2  X * * O * * . .
 3  X O O O O * . .
 4  X O X X O X . .
 5  * O X X O X X .
 6  O . X O O X . .
 7  . . X X O X . .
 8  . . X X X X X .

Legal moves: c1, b2, c2, e2, f2, f3, a5
```

### instructions

```
Pick the move that gives BLACK the best chance of winning this Othello game.
Strategy reminders:
- Corners are permanent and very valuable.
- Avoid X-squares (b2, g2, b7, g7) and C-squares next to an empty corner;
  they often hand the corner to the opponent.
- Edges are generally good.
- Early and mid game, prefer mobility (having more legal moves than your
  opponent) over disc count.
- In the endgame (last ~10 moves), maximize your final disc count.
```

### criteria（合法手ごとの説明）

```json
{
  "c1": "Play c1 (row 1, column c). Flips 2 discs: d2, e3. Edge square. Opponent will have 13 legal moves after this. Gives the opponent no corner. Stable discs: +0 (you will have 0). After the opponent's best reply, you will have at least 5 legal moves. Discs after this move: you 23, opponent 12.",
  "b2": "Play b2 (row 2, column b). Flips 1 disc: c3. X-square (diagonally adjacent to an empty corner a1). Opponent will have 12 legal moves after this. WARNING: gives the opponent access to corner a1. Stable discs: +0 (you will have 0). After the opponent's best reply, you will have at least 6 legal moves. Discs after this move: you 22, opponent 13.",
  "c2": "Play c2 (row 2, column c). Flips 4 discs: b3, c3, d3, e4. Interior square. Opponent will have 12 legal moves after this. Gives the opponent no corner. Stable discs: +0 (you will have 0). After the opponent's best reply, you will have at least 6 legal moves. Discs after this move: you 25, opponent 10.",
  "e2": "Play e2 (row 2, column e). Flips 6 discs: d3, e3, e4, e5, e6, e7. Interior square. Opponent will have 11 legal moves after this. Gives the opponent no corner. Stable discs: +0 (you will have 0). After the opponent's best reply, you will have at least 5 legal moves. Discs after this move: you 27, opponent 8.",
  "f2": "Play f2 (row 2, column f). Flips 1 disc: e3. Interior square. Opponent will have 12 legal moves after this. Gives the opponent no corner. Stable discs: +0 (you will have 0). After the opponent's best reply, you will have at least 7 legal moves. Discs after this move: you 22, opponent 13.",
  "f3": "Play f3 (row 3, column f). Flips 5 discs: b3, c3, d3, e3, e4. Interior square. Opponent will have 12 legal moves after this. Gives the opponent no corner. Stable discs: +0 (you will have 0). After the opponent's best reply, you will have at least 4 legal moves. Discs after this move: you 26, opponent 9.",
  "a5": "Play a5 (row 5, column a). Flips 1 disc: b5. Edge square. Opponent will have 11 legal moves after this. WARNING: gives the opponent access to corner a1. Stable discs: +0 (you will have 0). After the opponent's best reply, you will have at least 6 legal moves. Discs after this move: you 22, opponent 13."
}
```

### 応答

```json
{
  "choice": "e2",
  "probabilities": {
    "c2": 0.07,
    "f3": 0.06,
    "c1": 0.05,
    "b2": 0,
    "a5": 0.01,
    "f2": 0.01,
    "e2": 0.8
  },
  "confidence": 0.76,
  "gateway_cost_usd": "0.00005607",
  "latencyMs": 3949
}
```

## 4. オセロ: GPT（gpt-5-mini）

出典: `results/phase5-gpt.jsonl` 1局目 17手目

### system

```
You are an expert Othello (Reversi) player. You will be shown the current board
and the list of legal moves for your color. Choose exactly one move from the
legal move list.

Strategy reminders:
- Corners are permanent and very valuable.
- Avoid X-squares (b2, g2, b7, g7) and C-squares next to an empty corner;
  they often hand the corner to the opponent.
- Edges are generally good.
- Early and mid game, prefer mobility (having more legal moves than your
  opponent) over disc count.
- In the endgame (last ~10 moves), maximize your final disc count.

Respond with JSON only: {"move": "<one of the legal moves>", "reasoning": "<one short sentence>"}
Your move MUST be one of the listed legal moves. Do not invent coordinates.
```

### user

```
You are playing Othello (Reversi) as BLACK (X).
Move 17 of the game. Black: 14 discs, White: 6 discs. Empty squares: 44.

Board (columns a-h, rows 1-8; X = black, O = white, . = empty, * = your legal move):
    a b c d e f g h
 1  . . . O . . . .
 2  . . O O * . . .
 3  . . . O * * . .
 4  X X X X O * * .
 5  . . X X X O * .
 6  . . X . X . . .
 7  . . . X X X . .
 8  . . X . X . . .

Legal moves: e2, e3, f3, f4, g4, g5

Choose your move.
```

### 応答

```json
{
  "parsed": {
    "move": "f4",
    "reasoning": "Plays f4 to flip e4, consolidating my strong row-4 chain and keeping safe central control while avoiding risky corner-adjacent squares."
  },
  "latencyMs": 46473,
  "usage": {
    "inputTokens": 436,
    "outputTokens": 2570,
    "reasoningTokens": 2496
  }
}
```

## 5. 問い合わせの振り分け: Jev

出典: `apps/inquiry-router/results/eval-2026-09-28T15-54-27-685Z.json`（config と #11 の行）

state は `{ "inquiry": "<問い合わせ文>" }`。1 回の呼び出しで 2 つの質問（部署・緊急度）に答えさせる。

### instructions と criteria

```json
{
  "model": "typesafe-ai/jev",
  "instructions": {
    "department": "Which team should handle this customer inquiry?",
    "urgency": "How urgently does this customer inquiry need a response?"
  },
  "criteria": {
    "department": {
      "billing": "Money on an existing contract: invoices, receipts, charges, payment methods, refunds.",
      "technical": "The product is not working as expected: errors, bugs, login or sync problems, slowness, integrations, how to use a feature.",
      "account": "Changes to the account or contract itself: cancellation, plan changes, users and permissions, company or personal details.",
      "sales": "Not yet a customer for this, or wants to buy more: quotes, demos, trials, pre-purchase questions, partnerships.",
      "other": "None of the above: feedback, media or recruitment inquiries, spam, unrelated messages."
    },
    "urgency": {
      "high": "Work is stopped, or money, data or security is at risk right now; needs a response today.",
      "normal": "A real problem or request, but work can continue; a response within a few days is fine.",
      "low": "A question, idea or feedback with no time pressure."
    }
  }
}
```

### 例: #11「請求画面を開くと真っ白になって何も表示されません。ブラウザはChromeです。」（正解: technical / normal、キーワードは「請求」だが中身は表示の不具合）

```json
{
  "department": {
    "choice": "technical",
    "probabilities": {
      "other": 0,
      "technical": 0.98,
      "billing": 0.02,
      "account": 0,
      "sales": 0
    },
    "confidence": 0.98
  },
  "urgency": {
    "choice": "high",
    "probabilities": {
      "normal": 0.33,
      "high": 0.67,
      "low": 0
    },
    "confidence": 0.49
  },
  "latencyMs": 342,
  "costUsd": 2.5536e-05
}
```

## 6. 問い合わせの振り分け: GPT

### system

```
You route customer inquiries.

Departments:
- billing: Money on an existing contract: invoices, receipts, charges, payment methods, refunds.
- technical: The product is not working as expected: errors, bugs, login or sync problems, slowness, integrations, how to use a feature.
- account: Changes to the account or contract itself: cancellation, plan changes, users and permissions, company or personal details.
- sales: Not yet a customer for this, or wants to buy more: quotes, demos, trials, pre-purchase questions, partnerships.
- other: None of the above: feedback, media or recruitment inquiries, spam, unrelated messages.

Urgency:
- high: Work is stopped, or money, data or security is at risk right now; needs a response today.
- normal: A real problem or request, but work can continue; a response within a few days is fine.
- low: A question, idea or feedback with no time pressure.

Respond with JSON only.
```

user には問い合わせ文だけを渡す。出力は `{department, urgency, reasoning}` の JSON（zod スキーマで検証）。

### 例: #11 への応答

```json
{
  "department": "technical",
  "urgency": "normal",
  "reasoning": "Chromeで請求画面が真っ白になり表示されないため、技術的な対応が必要です。",
  "latencyMs": 3682,
  "costUsd": 0.00066725
}
```

## 7. キーワードルール（振り分けアプリ）

```json
{
  "department": [],
  "urgency": [
    {
      "rule": "至急・緊急",
      "pattern": "/至急|緊急|大至急/",
      "value": "high"
    }
  ]
}
```

R-1 では部署ルールが 3 本あった（解約|退会 → account、請求書|領収書|インボイス → billing、見積|デモ → sales）。誤発火が多かったため外した。
