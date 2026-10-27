# AGENTS.md

この文書は現行実装に沿った作業案内です。コードと食い違う説明を見つけた場合は、コードを正としてこの文書も更新してください。

## プロジェクト概要

Python等のコード読解をチャット形式で支援する研究用プロトタイプです。

- フロントエンド: React 18 + Vite（`src/`）
- API: Vercelサーバーレス関数（`api/`）。リクエスト間の状態は保持しません。
- LLM: Google Gemini（`api/_lib/gemini.js`）
- ログ: Supabase `chat_logs`。未設定時はサーバーログにフォールバックします。
- 現在の主なモード: `opportunistic`、`guided`、`free`

## opportunisticの状態と終了

`src/App.jsx` がチューター状態を保持し、各チャット要求でAPIに送ります。サーバーは受信状態を問題定義に合わせて正規化し、更新後の状態を返します。

`tutorState` の主な項目（`api/_lib/tutorState.js`）:

- `mentalModel`: `{ why, how }`。各状態は `unresolved | conjectured | confirmed`。
- `mentalModelEvidence`: confirmed 判定の根拠となる学習者発話の引用。
- `expectationStates`: 問題の説明期待ごとの `missing | partial | covered` と発話根拠。
- `trapStates`: `untouched | triggered | cleared`。
- `focus`, `phase`（`reading | done`）, `pendingWrapUp`。

why はコード全体の目的・入力・出力、how は処理の流れ・条件・変数更新による実現方法を指します。`opportunisticPrompt.js` は毎ターン状態を判定するよう指示します。自己申告、疑問形の推測、チューター説明への単純な同意だけでは confirmed にしません。confirmed の根拠は実際のユーザー発話に含まれる必要があり、サーバー側で引用の存在を検証します。正誤の意味判断そのものはLLMを含むため、ログ分析・人手採点で別途確認してください。

読解終了のサーバー条件（`evaluateCompletion()`）:

1. why と how がともに confirmed。
2. すべての期待が covered。
3. triggered の罠が残っていない。

`untouched` の罠は終了を妨げません。LLMが終了を求めても条件未達なら終了させません。参加者の「理解できた」ボタンは自己申告として別にログし、条件未達なら `closed_with_gaps` と理由を記録します。why/how等の内部状態は参加者画面に表示しません。

## ログと管理画面

- `api/chat.js`: 各ターンの発話・応答・状態スナップショット・根拠・所要時間・プロンプト版を記録。
- `api/log.js`: `session_start` 等のクライアントイベントを記録し、自己申告終了の状態を検算。
- `api/_lib/adminView.js`: セッション集計と会話詳細を描画。opportunisticの会話詳細ではwhy/how状態の変化と根拠を表示します。
- `api/admin.js`: 管理画面ルート（Basic認証設定が必要）。
- Supabaseの `payload` はJSONBです。追加フィールドに通常テーブル変更は不要です。
- ログに由来する文字列をHTMLへ出す場合は必ず `escapeHtml()` を通してください。

## 主要ファイル

- `src/App.jsx`: 画面とクライアント状態。参加者に内部判定を表示しないこと。
- `src/bot/geminiBot.js`: API通信と初期状態。
- `src/data/codeLibrary.js`: プリセットコード、`reference`（why/howの正解基準）、`landmarks`、`traps`。
- `api/chat.js`: チャットAPIとターンごとのログ。
- `api/_lib/gemini.js`: Gemini呼び出し、JSON解析、`PROMPT_VERSION`。
- `api/_lib/opportunisticPrompt.js`: opportunisticシステムプロンプト。
- `api/_lib/tutorState.js`: 状態の正規化、発話根拠の検証、終了判定。
- `api/_lib/adminView.js`: 管理画面の集計・HTML。
- `src/utils/logger.js`, `api/log.js`: クライアントイベントの記録。

## プロンプト・教材変更時

- `opportunisticPrompt.js` またはモデル出力の意味・判定基準を変えたら、`api/_lib/gemini.js` の `PROMPT_VERSION` を更新してください。
- 変更は一度に一箇所ずつ行い、比較できるようGit差分と版IDを残してください。
- `reference.why/how` はチューターの判定基準です。参加者に正解として直接提示しないでください。
- `traps` はよくある誤解です。未言及の罠を機械的に質問して網羅させず、誤解が現れたときに扱います。
- 研究上のwhy/how評価では、LLMの自己判定ログと独立した説明ルーブリックによる採点を区別してください。
- Letovskyのモデルを厳密に実装したとは表現せず、文献確認済みの範囲で「着想を得た」と記述してください。

## 個人情報・秘密情報

- `.env` の値や認証情報を表示・記録・コミットしないでください。
- 研究ログには匿名参加者IDを使い、本人特定情報との対応表は別管理してください。
- 参加者のコード本文を追加ログに保存する場合は、研究計画と同意範囲を確認してください。

## 実行

作業ディレクトリは `chatbot/` です。

```powershell
npm run dev
npm run build
npm run preview
```

Vite単独では `/api` は動作しません。APIを含むローカル確認にはVercelの実行環境が必要です。環境変数名は `GEMINI_API_KEY`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`ADMIN_USER`、`ADMIN_PASSWORD` です。値は表示しないでください。
