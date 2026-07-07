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
  - `phase`, `activeCode`, `sessionId`, `messages`, `step`, `isLoading`, `error` などを管理する。
  - `sessionId` は `handleStart()`（コードを選ぶ・貼り付けるたび）に新規発行され、`App` のstateで保持して `ChattingPhase` にpropで渡す。
    （以前はモジュールスコープでアプリ起動時に1回だけ生成していたため、別のコードに切り替えても
    同じsessionIdを使い回し、サーバー側のchatセッションが前のコードの内容のまま再利用される事故があった。修正済み）
  - ユーザー送信時に `sendToGemini()` を呼ぶ。

- `src/bot/geminiBot.js`
  - フロント側の Gemini 通信ラッパー。
  - 学習ステップ一覧、ステップラベル、次ステップ判定を持つ。
  - `/api/chat` に `sessionId`, `activeCode`, `currentStep`, `userMessage` を送る。
  - 会話履歴(`history`)はクライアントからは送らない。サーバー側(`server/gemini.js`)が `sessionId` ごとに Gemini の `chat` インスタンスを保持しており、履歴はそちら側で管理される。

- `src/utils/logger.js`
  - セッション ID 生成と `/api/log` へのログ送信。

- `src/data/codeLibrary.js`
  - プリセット教材コードの定義。
  - ユーザー貼り付けコードを共通形式に変換する `createUserCode()` もここにある。
  - `stepFocus`（任意）: ステップ単位で着目観点を上書きする仕組み。`{ [stepId]: string }` の形。
    未指定のステップは `server/gemini.js` の汎用 `STEP_FOCUS` にフォールバックする。
    ユーザー貼り付けコード（`stepFocus` なし）は常に汎用フォーカスのみを使う。

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
  - `POST /api/chat`: Gemini に問い合わせる。`sessionId`, `activeCode`, `currentStep`, `userMessage` は必須。
  - `POST /api/log`: ログを `logs/YYYY-MM-DD.jsonl` に追記する。
  - `OPTIONS` と CORS ヘッダーもここで処理する。
  - `/api/chat` のログには `totalMs`（リクエスト全体の所要時間）、`chatReadyMs`（chatセッション準備時間）、`apiCallMs`（Gemini API呼び出し自体の時間）も記録される。レイテンシ原因の切り分けに使う。

- `server/gemini.js`
  - Gemini API 呼び出し本体。
  - `GEMINI_API_KEY` を環境変数から読む。
  - チューター用 system prompt（ルール文＋対象コード全文＋現在ステップの着目観点）を組み立てる。
  - `STEP_FOCUS` はコード構造に依存しない汎用な書き方にしてあり、`activeCode.stepFocus[step]` があればそちらを優先する（`buildSystemPrompt()`）。
  - 現在のステップの概念（ループ・分岐・状態変化・早期終了など）が対象コードに存在しない場合、AI は質問を無理に続けず `advance: true` でスキップしてよいと `TUTOR_RULES` に明記してある（ループのないコードや分岐のないコードなどへの対応）。
  - **`sessionId` ごとに Gemini の `chat` インスタンスをメモリ上の `Map`（`sessions`）に保持する。** 同じコード・同じステップが続く間は `chat` を再利用し、`systemInstruction` の再構築・再送信を避ける。ステップが変わった場合、または対象コード（`activeCode.id`）が変わった場合は `chat` を作り直す（`getOrCreateChat()`）。
    - `activeCode.id` のチェックは、万一同一 `sessionId` で別のコードに切り替えられた場合でも、古いコードの内容で構築済みの `chat` が使い回されないようにする防御策。本来は `src/App.jsx` 側でコードごとに新規 `sessionId` を発行することで回避しているが、両方で二重に守っている。
  - そのため、会話履歴はクライアントから送られてくる `history` ではなく、Gemini SDK の `chat` オブジェクト内部で保持される。
  - 注意: サーバープロセスを再起動すると `sessions` の内容（＝進行中の全会話履歴）は失われる。複数プロセス・サーバーレス環境ではこの仕組みは機能しない（`sessions` がプロセスごとに独立してしまうため）。
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
  -> fetch('/api/chat')  ※ sessionId, activeCode, currentStep, userMessage のみ（historyは送らない）
  -> server/index.js
  -> server/gemini.js   ※ sessionIdごとにchatを保持・再利用
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
- `server/gemini.js` の `sessions` Map（セッション保持の仕組み）を変更する場合は、サーバー再起動時の挙動・メモリリークの可能性・複数プロセス環境での非対応を踏まえること。
- `sessionId` の発行タイミング（`src/App.jsx` の `handleStart()`）は変えないこと。コードを切り替えるたびに新規発行する前提が崩れると、別のコードなのに前のコードの会話が続くバグが再発する。

## 注意点

- `.env` の中身や API キーを出力しないこと。
- `logs/`, `dist/`, `node_modules/` は通常、調査対象から外してよい。
- `ruleBot.js` と `samplePython.js` は未使用の可能性があるため、削除や流用の前に import されていないか確認すること。
- 日本語文字列が文字化けして見える場合がある。表示だけの問題か、ソース内容自体の問題かを確認してから修正すること。
- `npm run build` は、サンドボックス制限で失敗することがある。その場合は権限付きで再実行が必要になる場合がある。
- `server/gemini.js` の `sessions` Map にはセッションの自動破棄（タイムアウト）の仕組みがまだない。長時間運用するとメモリ使用量が増え続ける点に注意。
- `sessionId` は必ずコードを選ぶ・貼り付けるたびに新規発行すること（`src/App.jsx` の `handleStart()`）。アプリ起動時に1回だけ生成する方式に戻すと、コードを切り替えた際に前のコードの会話を引き継ぐ事故が再発する（過去に実際に発生した不具合）。

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

- セッション保持の仕組み（chatの再利用・破棄）を変えたい:
  - `server/gemini.js` の `sessions` Map と `getOrCreateChat()`
  - `src/App.jsx` の `sessionId` 発行タイミング（`handleStart()`）

## 期待するエージェントの振る舞い

- 大きな探索を始める前に、このファイルを確認する。
- 変更範囲を小さく保つ。
- 未使用に見えるファイルでも、削除前には必ず参照検索する。
- API キー、ログ、ユーザー入力コードの扱いに注意する。
- 変更後は可能なら `npm run build` で確認する。
