# AGENTS.md

このファイルは、AI コーディングエージェントがこのプロジェクトを扱うときに最初に読むための案内です。
毎回すべてのファイルを読む代わりに、ここで全体像と注意点を把握してください。

## プロジェクト概要

このプロジェクトは、コードリーディング練習を支援するチャット型 Web アプリです。

- フロントエンド: React 18 + Vite
- バックエンド: Node.js 標準 `http` サーバ
- AI 連携: Google Gemini API (`@google/generative-ai`)
- 目的: ユーザーがコードを読み、AI チューターと対話しながら理解を段階的に進める

ユーザーはプリセットコードを選ぶか、自分のコードを貼り付けます。
チャットでは以下のステップに沿って理解を進めます。

1. `purpose`: 全体の目的
2. `input_output`: 入力と出力
3. `loop`: ループ
4. `condition`: 条件分岐
5. `state_change`: 状態変化
6. `early_stop`: 早期終了
7. `summary`: まとめ

## 主要ファイル

### フロントエンド

- `src/main.jsx`
  - React アプリのエントリーポイント。
  - `App` を `#root` にマウントするだけの薄いファイル。

- `src/App.jsx`
  - UI と画面状態の中心。
  - コード選択画面 `SelectionPhase` とチャット画面 `ChattingPhase` を持つ。
  - `phase`, `activeCode`, `messages`, `step`, `isLoading`, `error` などを管理する。
  - ユーザー送信時に `sendToGemini()` を呼ぶ。

- `src/bot/geminiBot.js`
  - フロント側の Gemini 通信ラッパー。
  - 学習ステップ一覧、ステップラベル、次ステップ判定を持つ。
  - `/api/chat` に `sessionId`, `activeCode`, `currentStep`, `history`, `userMessage` を送る。

- `src/utils/logger.js`
  - セッション ID 生成と `/api/log` へのログ送信。

- `src/data/codeLibrary.js`
  - プリセット教材コードの定義。
  - ユーザー貼り付けコードを共通形式に変換する `createUserCode()` もここにある。

- `src/data/samplePython.js`
  - バブルソートのサンプルコード。
  - 現状では主要フローからは使われていない可能性が高い。

- `src/bot/ruleBot.js`
  - Gemini を使わない固定応答ボットのような実装。
  - 現状の `App.jsx` は `geminiBot.js` を使っているため、未使用の可能性が高い。

- `src/styles/global.css`
  - アプリ全体のスタイル。
  - 選択画面、コードペイン、チャットペイン、レスポンシブレイアウトを定義。

### バックエンド

- `server/index.js`
  - Node 標準 `http` で作られた API サーバ。
  - `POST /api/chat`: Gemini に問い合わせる。
  - `POST /api/log`: ログを `logs/YYYY-MM-DD.jsonl` に追記する。
  - `OPTIONS` と CORS ヘッダーもここで処理する。

- `server/gemini.js`
  - Gemini API 呼び出し本体。
  - `GEMINI_API_KEY` を環境変数から読む。
  - チューター用 system prompt を組み立てる。
  - Gemini の返答から `{ reply, advance }` を取り出す。

### 設定

- `package.json`
  - `npm run dev`: Vite フロントエンドを起動。
  - `npm run server`: Node API サーバを起動。
  - `npm run start`: フロントエンドとサーバを同時起動。
  - `npm run build`: 本番ビルド。

- `vite.config.js`
  - `/api` を `http://localhost:3001` に proxy する。

- `.env`
  - `GEMINI_API_KEY` が必要。
  - 秘密情報なので内容を表示・共有しないこと。

## データの流れ

```text
ユーザー入力
  -> src/App.jsx
  -> src/bot/geminiBot.js
  -> fetch('/api/chat')
  -> server/index.js
  -> server/gemini.js
  -> Gemini API
  -> { reply, advance }
  -> React 側でメッセージ追加・ステップ更新
```

ログの流れ:

```text
src/utils/logger.js
  -> fetch('/api/log')
  -> server/index.js
  -> logs/YYYY-MM-DD.jsonl
```

## 実行・確認コマンド

プロジェクトルートは `chatbot/` です。

```powershell
npm run start
```

フロントとサーバを同時に起動します。

```powershell
npm run build
```

ビルド確認に使います。

```powershell
npm run server
```

API サーバだけを起動します。

```powershell
npm run dev
```

Vite フロントエンドだけを起動します。

## 変更時の方針

- まずこの `AGENTS.md` を読んで全体像を把握する。
- その後、実際に変更するファイルと、その直接の依存先だけを読む。
- 画面の状態管理を変える場合は `src/App.jsx` を確認する。
- Gemini への送信内容やステップ進行を変える場合は `src/bot/geminiBot.js` と `server/gemini.js` を確認する。
- API の仕様を変える場合は、フロント側の `fetch` と `server/index.js` の両方を確認する。
- 教材コードを追加・変更する場合は `src/data/codeLibrary.js` を確認する。
- 見た目だけの変更なら、基本的には `src/styles/global.css` と関連 JSX の className を確認する。

## 注意点

- `.env` の中身や API キーを出力しないこと。
- `logs/`, `dist/`, `node_modules/` は通常、調査対象から外してよい。
- `ruleBot.js` と `samplePython.js` は未使用の可能性があるため、削除や流用の前に import されていないか確認すること。
- 日本語文字列が文字化けして見える場合がある。表示だけの問題か、ソース内容自体の問題かを確認してから修正すること。
- `npm run build` は、サンドボックス制限で失敗することがある。その場合は権限付きで再実行が必要になる場合がある。

## よくある修正箇所

- チャットの進行ルールを変えたい:
  - `src/bot/geminiBot.js`
  - `server/gemini.js`

- 初期メッセージやステップ名を変えたい:
  - `src/bot/geminiBot.js`

- チューターの振る舞いを変えたい:
  - `server/gemini.js`

- コード選択画面を変えたい:
  - `src/App.jsx`
  - `src/data/codeLibrary.js`
  - `src/styles/global.css`

- チャット画面を変えたい:
  - `src/App.jsx`
  - `src/styles/global.css`

- ログの内容や保存形式を変えたい:
  - `src/utils/logger.js`
  - `server/index.js`

## 期待するエージェントの振る舞い

- 大きな探索を始める前に、このファイルを確認する。
- 変更範囲を小さく保つ。
- 未使用に見えるファイルでも、削除前には必ず参照検索する。
- API キー、ログ、ユーザー入力コードの扱いに注意する。
- 変更後は可能なら `npm run build` で確認する。
