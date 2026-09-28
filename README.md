# jev-testing — Othello AI benchmark

Jev（`typesafe-ai/jev`、`experimental_evaluate`）と GPT（`openai/gpt-5-mini` など）をオセロで対局させ、強さと応答の中身を比較する。
プロンプト仕様は [docs/prompt-spec.md](docs/prompt-spec.md) を参照。

## セットアップ

```sh
npm install
cp .env.example .env   # AI_GATEWAY_API_KEY を設定（Jev・GPT とも Vercel AI Gateway 経由）
```

## 対局を実行する

```sh
npm run bench                                    # Jev vs GPT を 2 局（先後入れ替え）
npm run bench -- --games 10 --hints off
npm run bench -- --gpt-model openai/gpt-5-nano --annotate-moves
npm run bench -- --policy sample --seed 42
npm run bench -- --p1 jev:v2 --p2 rule:v2 --games 20   # criteria v2 の Jev vs ルールベース
npm run bench -- --p1 rule:v1 --p2 random --games 40   # API キーなしで動作確認
npm run bench -- --help
```

- プレイヤー: `jev` / `gpt` / `rule`（ルールベース）/ `random`。`:v2` を付けると criteria v2（先読みの結果入り）を使う。
- 最初の 4 手はランダム（`--random-opening`）。同じ序盤を先後入れ替えて 2 局ずつ打つ。

結果は `results/<timestamp>.jsonl` に 1 手ずつ追記される（リポジトリに含める）。これまでの試行と結果は [docs/experiments.md](docs/experiments.md)。1 手ごとの画像が欲しいときは `npm run capture -- <jsonl>`。

## ビューア

```sh
npm run viewer        # http://localhost:5174
```

- 実行ごとの戦績（勝敗・平均石差・反則負け・API 呼び出し回数・レイテンシ・トークン数）
- 対局の盤面リプレイ（着手前/着手後、返った石、← → キーで移動）と石差の推移
- 各手で実際に送ったリクエストと、返ってきたレスポンス
  - Jev: 候補手ごとの確率（盤上のヒートマップと棒グラフ）、criteria、confidence、生の answers
  - GPT: 試行ごとの生レスポンス・理由・非合法手・送った再試行メッセージ
- ベンチマーク実行中は 2 秒ごとに自動更新する（「最新の手を追う」）
- URL の `#run=...&game=2&turn=15` で特定の手を直接開ける

## テスト

```sh
npm test
npm run typecheck
```
