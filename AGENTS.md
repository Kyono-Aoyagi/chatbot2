# AGENTS.md

このファイルは、AI コーディングエージェントがこのプロジェクトを扱うときに最初に読むための案内です。
毎回すべてのファイルを読む代わりに、ここで全体像と注意点を把握してください。

## プロジェクト概要

コードリーディング練習を支援するチャット型 Web アプリです。ユーザーはコードを読み、AI チューターと対話しながら理解を深めます。
研究用プロトタイプであり、複数の「チューターの介入方法（条件）」を切り替えて比較・観察できる作りになっています。

- フロントエンド: React 18 + Vite
- バックエンド: **Vercel のサーバーレス関数**（`api/` 配下。ステートレス）
- AI 連携: Google Gemini API（`@google/generative-ai`。モデル名は `api/_lib/gemini.js` の `MODEL_NAME`）
- ログ保存: Supabase（`chat_logs` テーブル）
- ユーザーはプリセットコードを選ぶか、自分のコードを貼り付ける

## 実験条件（condition）

`src/utils/condition.js` の `resolveCondition()` が決める。**デフォルトは `opportunistic`（日和見モード）。**
現時点では日和見モードを第一候補として実装を進めている。

| 条件 | 概要 | 進行の仕組み |
|---|---|---|
| `opportunistic`（既定） | ユーザーの発言中の手がかり・保留中の問いを優先して次の一手を選ぶ（Letovsky 1986 の日和見主義モデルを参考） | `mentalModel`（why/how）と `openQuestions` をクライアントが保持し、毎回送受信する |
| `guided` | 固定の7ステップ（purpose → input_output → loop → condition → state_change → early_stop → summary）を順に進める | `currentStep` と AI の `advance` で進行 |
| `free` | 質問に直接説明する対照群。guided と話題の範囲・返答の長さ上限（8文）を揃えてある | ステップ無し（常に `free`） |

- 条件の指定: URL の `?c=guided|free|opportunistic` が最優先。指定した条件は localStorage（キー `code-reading-tutor.condition.v2`）に保存され、リロードしても変わらない。
- 指定が無ければ既定の `opportunistic`。**ランダム割り当ては廃止済み。** guided/free の比較実験を再開する場合は、`?c=` 付きのリンクを参加者ごとに配布する。
- 旧キー `code-reading-tutor.condition` には過去のランダム割り当て結果が残っている可能性があるため、意図的に読まない。
- 評価方針: 以前は評価条件を揃えて定量的に判断する方針だったが、現在は**ログ（会話の道筋）を読んで判断する定性寄り**に移行している。

## 主要ファイル

### フロントエンド

- `src/main.jsx`: React のエントリーポイント。
- `src/App.jsx`
  - UI と画面状態の中心。コード選択画面 `SelectionPhase` とチャット画面 `ChattingPhase` を持つ。
  - `condition` は `App` でマウント時に1回だけ解決し、セッション中は変わらない。
  - `sessionId` は `handleStart()`（コードを選ぶ・貼り付けるたび）に新規発行して `App` の state で保持し、`ChattingPhase` に渡す。
  - 会話履歴 `messages` は `ChattingPhase` の state（クライアント側）で保持し、毎回 `history` として API に送る。
  - opportunistic 条件では `mentalModel` / `openQuestions` の state を持ち、チャット上部に why/how の状態と保留中の問いを表示する。
  - 実行結果パネル: free / opportunistic は最初から表示。guided は summary ステップ完了後に表示。
  - コードペインには行番号が表示される（`CodeBlock`）。
- `src/bot/geminiBot.js`
  - `/api/chat` の通信ラッパー。`STEPS` / `STEP_LABELS` / 初期メッセージ / `getInitialMentalState()` を持つ。
  - `sendToGemini()`（guided / free 用）と `sendToGeminiOpportunistic()`（opportunistic 用）の2系統。
- `src/utils/condition.js`: 条件の解決と表示名（`CONDITION_LABELS`）、`DEFAULT_CONDITION`。
- `src/utils/logger.js`: セッション ID 生成と `/api/log` へのログ送信。
- `src/data/codeLibrary.js`: プリセット教材コードの定義と `createUserCode()`。詳細は「教材コード」節。
- `src/styles/global.css`: 全体のスタイル。
- `src/data/samplePython.js` / `src/bot/ruleBot.js`: 主要フローからは使われていない可能性が高い（未確認）。削除・流用の前に import されていないか確認すること。

### バックエンド（`api/`。Vercel サーバーレス関数）

- `api/chat.js`
  - `POST /api/chat`。必須は `activeCode.code` と `userMessage`。
  - 受け取る: `activeCode, currentStep, userMessage, history, sessionId, condition, mentalModel, openQuestions`
  - `askGemini()` を呼び、結果を Supabase にログ保存（`insertLog`）して返す。
    `chat` ログには `condition, currentStep, codeId, turn, promptVersion, model, userMessage, reply, advance, move, note, parseFailed, retries, mentalModel, openQuestions, totalMs, apiCallMs` が入る（`buildLogContext()` が共通項目を作る。`turn` は history 中の user 発言数+1）。
  - クライアントに返すのは `reply, advance, mentalModel, openQuestions` のみ（`move` / `note` / `retries` はログ専用で返さない）。
  - Gemini 呼び出しが失敗した場合は `chat_error` イベントをログに残す（`transient` / `retries` / `errorMessage`）。
    一時的なエラー（リトライ後も失敗）は HTTP 503 と `code: 'model_busy'`・利用者向けの案内文を返し、生のエラー文は返さない。それ以外は従来どおり 500 とエラー文を返す。
- `api/log.js`: `POST /api/log`。クライアントからのイベント（`session_start` / `result_shown`）を Supabase に保存。
  `session_start` には `codeId, source, title, difficulty, tags, condition` が入る（ユーザー貼付コードは title 以外が無く、コード本文は保存しない）。
- `api/admin.js`: `/api/admin`。ログ閲覧用の管理画面（Basic 認証。`ADMIN_USER` / `ADMIN_PASSWORD` が未設定なら全員拒否）。認証・データ取得・画面の振り分けだけを持つ。
  - 既定: **セッション一覧**（1行=1セッション。問題、mode、ターン数、所要時間、最終の why/how、`move` の色付き帯、エラー/リトライ/解析失敗、プロンプト版）。
    mode・問題・プロンプト版で絞り込める。ターン0のセッションは既定で隠す。直近1000イベントから集計する（Supabase の1リクエスト上限）ため、古いセッションは欠けうる。
  - `?session_id=...`: **会話ビュー**。発言と返答をチャット風に並べ、`move` / `note`、`mentalModel` / `openQuestions` の変化（差分）を各ターンに表示する。生 JSON は折りたたみ。
  - `?view=raw`: 従来の生ログ表（event_type / mode / session_id で絞り込み。`payload` を JSON のまま表示）。
- `api/_lib/adminView.js`: 管理画面の HTML 生成とセッション集計（`groupSessions()`）。DB には触れない純粋関数。`CONDITION_LABELS` と `move` の色/ラベル（`MOVE_META`）もここ。
  ログに由来する文字列は必ず `escapeHtml` を通すこと。guided/free の `chat` ログにも既定の `mentalModel` が入るため、状態・`move` の帯は opportunistic のときだけ表示する。
- `api/_lib/gemini.js`: Gemini 呼び出し本体。詳細は次節。
- `api/_lib/supabase.js`: Supabase クライアントと `insertLog()`。`chat_logs` テーブルに `session_id` / `event_type` / `payload`（JSONB）を保存する。未設定時は `console.log` にフォールバック。`payload` は JSONB なので、ログに新しいフィールドを足してもテーブル変更は不要。

### `api/_lib/gemini.js` の構造

- **ステートレス。** サーバー側に会話状態を持たない。リクエストごとに `history`（クライアントから受信）で `chat` を作り直す。
  （以前あった `sessions` Map によるサーバー内保持は廃止済み。サーバーレスでは機能しないため。）
- `buildSystemPrompt()` が条件ごとにプロンプトを組み立てる:
  - guided: `TUTOR_RULES` + 対象コード + `tutorHints` + 現在ステップの着目観点（`activeCode.stepFocus[step]` を優先し、無ければ汎用 `STEP_FOCUS`）
  - free: `TUTOR_RULES_FREE` + 対象コード
  - opportunistic: `TUTOR_RULES_OPPORTUNISTIC` + 対象コード + 参照情報（`buildReferenceBlock()`。あれば）+ 現在の `mentalModel` / `openQuestions`
- 返答は JSON。guided は `{reply, advance}`、free は `{reply}`、opportunistic は `{reply, move, note, mentalModel, openQuestions}`。
  JSON でなかった／パースに失敗した場合は、生テキストを `reply` にして `advance: false`、状態は直前のものを維持する（この場合 `move` は付かず、`parseFailed: true` になる）。
- `MODEL_NAME` と `PROMPT_VERSION` を export している。**プロンプト（`TUTOR_RULES*` / `STEP_FOCUS` / `buildSystemPrompt()`）を変えたら `PROMPT_VERSION` を手で更新すること。**
  `chat` ログに記録され、管理画面でプロンプト版ごとに会話を比べられる。
- **一時的なエラーはサーバー側でリトライする**（`sendWithRetry()`）。対象は 503 / 429 / 500 / 502 / 504 と通信エラー。
  最大2回（1秒後・2秒後）で、経過時間が `RETRY_BUDGET_MS`（8秒）を超えるなら打ち切る。400 や認証エラーはリトライしない。
  試行ごとに `chat` を作り直す。`apiCallMs` にはリトライの待ち時間も含まれ、リトライ回数は `retries` に記録される。
  リトライしても失敗した場合、投げるエラーに `transient` と `retries` が付く。
- `sanitizeMentalModel` / `sanitizeOpenQuestions` / `sanitizeMove` が LLM 出力を検証する。`openQuestions` は最大 `MAX_OPEN_QUESTIONS`（5）件。

### 旧実装（原則触らない）

- `server/index.js`: 旧ローカル用 Node サーバー。`./gemini.js` を import しているが `server/` に `gemini.js` が無く、**単独では動かない**。
- `server_legacy/`: 旧 `index.js` と旧 `gemini.js`（サーバー内 `sessions` Map 版）。
- `logs/`: 旧ローカルサーバーが書いた `YYYY-MM-DD.jsonl`。現行のログ保存先は Supabase。
- いずれも削除前に参照検索すること。

### 設定

- `package.json`: スクリプトは `dev`（Vite）/ `build` / `preview` のみ。（旧 `server` / `start` は無い）
- `vite.config.js`: プロキシ設定は無い。`api/` は `vercel dev` が同一オリジンで束ねる想定（ファイル内コメントより。ローカルでの動作は未確認）。
- `.env`（`.gitignore` 対象）: 秘密情報。**内容を表示・共有しないこと。** 必要な環境変数の名前:
  `GEMINI_API_KEY` / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `ADMIN_USER` / `ADMIN_PASSWORD`

## データの流れ

```text
ユーザー入力
  -> src/App.jsx（ChattingPhase が messages を保持）
  -> src/bot/geminiBot.js（sendToGemini / sendToGeminiOpportunistic）
  -> fetch('/api/chat')
       guided/free:   sessionId, activeCode, currentStep, userMessage, history, condition
       opportunistic: sessionId, activeCode, userMessage, history, condition, mentalModel, openQuestions
  -> api/chat.js
  -> api/_lib/gemini.js（history から chat を都度構築 -> Gemini API）
  -> { reply, advance, move, note, mentalModel, openQuestions }
       ├─ Supabase にログ保存（move / note 含む）
       └─ クライアントへ { reply, advance, mentalModel, openQuestions }
  -> React 側でメッセージ追加・ステップ or mentalState 更新
```

ログの流れ:

```text
src/utils/logger.js -> fetch('/api/log') -> api/log.js -> Supabase chat_logs
api/chat.js -> insertLog -> Supabase chat_logs  （chat イベントはサーバー側で保存）
閲覧: /api/admin
```

主なイベント種別: `session_start`（クライアント）/ `chat`（サーバー）/ `result_shown`（クライアント、guided）/
`chat_error`（サーバー。Gemini 呼び出しの失敗。管理画面の生ログで event_type から絞り込める）。

- 以前あった `step_change` / `mental_state_change` は **廃止した**（`chat` ログと重複するため）。過去のログには残っており、生ログ表では選んで見られる。
  guided のステップ遷移は `chat` の `currentStep`（送信時点）と `advance` から、opportunistic の状態推移は `chat` の `mentalModel` / `openQuestions`（返答後の状態）の並びから導出する。
- `chatReadyMs`（チャット構築時間。数ミリ秒で意味が無い）は記録しなくなった。

チャット送信に失敗した場合、`src/App.jsx` は失敗した発言を `messages` から外して入力欄に戻す（応答の無い user 発言が履歴に残らないようにするため）。

## 教材コード（`src/data/codeLibrary.js`）

プリセット7問（難易度順）: `sum_list`(1) / `max_value`(1) / `multiples_label`(1) / `bubble_sort`(2) /
`recursion_calc`(2) / `gcd_euclid`(3) / `misleading_find_max`(2)。すべて Python。

各コードオブジェクトのフィールド（詳細はファイル冒頭のコメント）:

- 共通: `id, title, language, filename, source, code, tutorHints, expectedOutput`
- guided 用（任意）: `stepFocus`（ステップ別の着目観点の上書き）。`tutorHints` / `stepFocus` を持つのは現状 `bubble_sort` のみ。他は `tutorHints: null`・`stepFocus` 省略で、guided で動かすと汎用フォーカスにフォールバックする。
- opportunistic 用（任意）: `reference`（`{why, how}`。チューターだけが知る正解。mentalModel を confirmed にしてよいかの基準）/
  `landmarks`（`[{target, note}]`。ユーザーが自発的に触れそうな手がかり）/ `traps`（よくある誤解）/
  `difficulty`（1〜3）/ `tags`。`landmarks` / `traps` は各2〜4個までにする（多いと誘導的になり日和見の自由度を潰す）。
- ユーザー貼付コード（`createUserCode()`）にはこれらが無く、AI がコードから自力で判断する。

新しい問題を追加するとき:

- `expectedOutput` は手計算またはローカル実行で必ず検算する。
- `title` は答えを言い当てない書き方にする（名前と挙動のずれ・目的不明を見たい問題では特に）。
- `reference` に書いた内容はユーザーに言わせる側の基準であり、チューターは直接言わない設計。
- 同じ構造の問題を続けて解くと罠が効きにくくなる（例: `max_value` の後の `misleading_find_max`）。

## opportunistic 条件の設計メモ

- 次の一手の優先順位: (1) ユーザーの自発的な言及への深掘り（`bottom_up`）→ (2) 保留中の問いの再訪（`revisit`）→
  (3) 手薄な why/how へのトップダウン（`top_down`）→ (4) 詰まったときの支援 → (5) 上限件数での整理 → (6) 指摘・反論への対応（`correct`）
- 「わからない」への対応は、軽い順に `narrow`（問いを絞る）→ `trace`（小さな入力で追わせる）→ `switch`（別の観点へ）。
  **別のコードを AI に作らせて示すことはしない**（難易度・内容を統制できず、評価の交絡になるため）。必要になった場合は問題ごとに事前に手書きした簡略版を用意する方針（未実装）。
- `mentalModel` の `confirmed` は、ユーザー自身の説明が参照情報（無ければコードから判断した内容）と一致し、かつコード上の根拠への言及を伴うときだけ。
  名前を繰り返しただけ（「バブルソート」とだけ言った等）は `conjectured` 止まり。
- 行番号は使わせず、変数名・式・関数名を引用して指させている（モデルにはコードを行番号なしで渡しているため、行番号は推測になる）。
  UI には行番号が表示されるので、コードに行番号を付けて渡して行番号で指させる案もあるが未実装。
- `move` / `note` は分析用のタグ（ユーザーには見せない）。`move` の値: `bottom_up / revisit / top_down / narrow / trace / switch / correct / other`。
- 参照情報（`reference` / `landmarks` / `traps`）はユーザーに直接言わないルールでプロンプトに入れている。

## 実行・確認コマンド

プロジェクトルートは `chatbot/` です。

```powershell
npm run dev      # Vite フロントのみ（/api は動かない）
npm run build    # ビルド確認（構文エラーの検出にも使う）
npm run preview  # ビルド結果のプレビュー
```

`api/` を含めて動かすには Vercel 環境（`vercel dev` またはデプロイ）が必要な想定。
`npm run build` はサンドボックス制限で失敗することがある。その場合は権限付きで再実行が必要になる場合がある。

## 変更時の方針

- まずこの `AGENTS.md` を読んで全体像を把握する。その後、変更するファイルと直接の依存先だけを読む。
- 変更範囲を小さく保つ。
- 条件（condition）の追加・既定値の変更: `src/utils/condition.js`。表示名は `CONDITION_LABELS` が `condition.js`（フロント）と `api/_lib/adminView.js`（管理画面）の両方にある。
- チューターの振る舞い: `api/_lib/gemini.js`（条件ごとの `TUTOR_RULES*` と `buildSystemPrompt()`）。変更したら `PROMPT_VERSION` も更新する。
- API の仕様を変える場合: フロントの `fetch`（`src/bot/geminiBot.js`）と `api/chat.js` の両方を確認する。
- ログに項目を足す場合: `api/chat.js`（`buildLogContext()` または `insertLog` 呼び出し）または `src/App.jsx` の `logEvent` 呼び出しに足す。`payload` は JSONB のためテーブル変更は不要。
  管理画面に表示したい場合は `api/_lib/adminView.js` も直す。
- 教材コードの追加・変更: `src/data/codeLibrary.js`。
- 画面: `src/App.jsx` と `src/styles/global.css`。
- `sessionId` の発行は `handleStart()` で行う前提を崩さないこと（ログの会話単位が `sessionId` なので、コードを切り替えても同じ ID を使い回すと別のコードのログが混ざる）。
  過去には、サーバー内で `sessionId` ごとに `chat` を保持していた時代に、別コードへ切り替えても前のコードの内容で会話が続く不具合があった。現行のステートレス構成では再発しないが、ログの整合のために維持する。

## 注意点

- `.env` の中身や API キーを出力しないこと。`SUPABASE_SERVICE_ROLE_KEY` はサーバー側専用で、フロントのコードやレスポンスに含めないこと。
- **`activeCode` はクライアントから丸ごと送られ、`codeLibrary.js` はフロントのバンドルにも含まれる。** そのため `reference` / `landmarks` / `traps` / `tutorHints` は、ブラウザの開発者ツールで参加者から見えうる。
  参加者に見えると困る実験にする場合は、サーバー側で `id` から教材を引く形に変更する必要がある（未対応）。
- `logs/`, `dist/`, `node_modules/`, `server_legacy/` は通常、調査対象から外してよい。
- 日本語文字列が文字化けして見える場合がある。表示だけの問題か、ソース内容自体の問題かを確認してから修正すること。
- ユーザーが貼り付けたコードは Supabase のログには `codeId` と `source` のみ記録される（コード本文は `session_start` では保存しない）。ただしチャットの `userMessage` / `reply` には内容が含まれうる。

## よくある修正箇所

- opportunistic の次の一手の選び方・「わからない」対応: `api/_lib/gemini.js` の `TUTOR_RULES_OPPORTUNISTIC`
- 参照情報の渡し方: `api/_lib/gemini.js` の `buildReferenceBlock()`
- guided の進行ルール・ステップ名: `src/bot/geminiBot.js`、`api/_lib/gemini.js`（`TUTOR_RULES` / `STEP_FOCUS`）
- 初期メッセージ: `src/bot/geminiBot.js` の `getInitialBotMessage()`
- コード選択画面: `src/App.jsx`（`SelectionPhase`）、`src/data/codeLibrary.js`
- チャット画面: `src/App.jsx`（`ChattingPhase`）、`src/styles/global.css`
- ログの内容・保存: `src/utils/logger.js`、`api/log.js`、`api/chat.js`、`api/_lib/supabase.js`
- ログの見え方: `api/_lib/adminView.js`（表示・集計）、`api/admin.js`（取得・振り分け）

## 期待するエージェントの振る舞い

- 大きな探索を始める前に、このファイルを確認する。
- 変更範囲を小さく保つ。
- 未使用に見えるファイルでも、削除前には必ず参照検索する。
- API キー、ログ、ユーザー入力コードの扱いに注意する。
- 変更後は可能なら `npm run build` で確認する。
- 実装や仕様を変えたら、この `AGENTS.md` も合わせて更新する（特に「実験条件」「教材コード」「opportunistic 条件の設計メモ」）。
