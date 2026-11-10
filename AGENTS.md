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
- `expectationStates`: 問題の説明期待ごとの `dimension`（`why | how | both`）、`missing | partial | covered`、発話根拠。
- `trapStates`: `untouched | triggered | cleared`。理解確認のために尋ねた罠へ正答した場合も `cleared` にできます。
- `focus`, `phase`（`reading | done`）, `pendingWrapUp`。

why/how はLLMが会話を見て付ける補助的な自己申告です。終了条件にも研究上の説明品質の判定にも使いません。正しさの意味判定はLLMに依存するため、参考ログとしてのみ扱います。

読解終了のサーバー条件（`evaluateCompletion()`）:

1. 問題ごとの確認ポイントが1つ以上定義されている。
2. すべての確認ポイントが covered。

罠状態と `move` は会話過程の参考ログで、終了条件にもRQ1/RQ2の成果判定にも使いません。LLMが終了を申告しても確認ポイントが未達ならサーバーが終了を拒否し、未確認のポイントを尋ねる文へ置き換えます。参加者の「理解できた」ボタンは自己申告として別にログし、未達なら `closed_with_gaps` と理由を記録します。内部状態は参加者画面に表示しません。

読解完了後でも、学習者が理解確認の不足を明示した場合は、追加確認のため `reopen` を受け付けます。

## ログと管理画面

- `api/chat.js`: 各ターンの発話・応答・状態スナップショット・根拠・所要時間・プロンプト版・モデル使用量・研究条件メタデータを記録。
- `api/log.js`: `session_start` 等のクライアントイベントを記録し、自己申告終了の状態を検算。
- `api/_lib/adminView.js`: セッション集計と会話詳細を描画。opportunisticの会話詳細ではwhy/how状態の変化と根拠を表示します。
- `api/admin.js`: 管理画面ルート（Basic認証設定が必要）。
- Supabaseの `payload` はJSONBです。追加フィールドに通常テーブル変更は不要です。
- `src/utils/logger.js` はURLから任意の匿名研究条件（`participantId`, `round`, `setId`, `order`, `isTest`）を読み、セッションとターンのログへ渡します。氏名などの個人情報をURLやログに入れないこと。
- `scripts/score-study-logs.mjs` はSupabase JSON/JSONL出力から学習者発言だけを取り出し、問題ごとの期待を使って独立したAI採点を行います。出力には網羅性/正確性の要素別点数、発言引用、採点版、モデル、使用量を含めます。セッションIDから約20%を再現可能な方法で人手照合候補にします。AIの点数は確定評価ではありません。
- 実行例: `node scripts/score-study-logs.mjs <Supabase JSON/JSONL export> <output.json>`。`GEMINI_API_KEY` は環境変数から読み、ログや出力へ含めません。
- ボットなし事後課題は `assessment_response` イベント（`codeId`, `responseText`, `studyContext`）としてログに含めると、同じ採点スクリプトの対象になります。
- ログに由来する文字列をHTMLへ出す場合は必ず `escapeHtml()` を通してください。

## 主要ファイル

- `src/App.jsx`: 画面とクライアント状態。参加者に内部判定を表示しないこと。
- `src/bot/geminiBot.js`: API通信と初期状態。
- `src/data/codeLibrary.js`: プリセットコード、`reference`（why/howの正解基準）、`landmarks`、`traps`。
- `api/chat.js`: チャットAPIとターンごとのログ。
- `api/_lib/gemini.js`: Gemini呼び出し、JSON解析、`PROMPT_VERSION`。
- `api/_lib/opportunisticPrompt.js`: opportunisticシステムプロンプト。
- `api/_lib/tutorState.js`: 状態の正規化、発話根拠の検証、会話上の終了判定。状態を研究成果として解釈しない。
- `api/_lib/adminView.js`: 管理画面の集計・HTML。
- `src/utils/logger.js`, `api/log.js`: クライアントイベントの記録。

## プロンプト・教材変更時

- `opportunisticPrompt.js` またはモデル出力の意味・判定基準を変えたら、`api/_lib/gemini.js` の `PROMPT_VERSION` を更新してください。
- 変更は一度に一箇所ずつ行い、比較できるようGit差分と版IDを残してください。
- `reference.why/how` はチューターの判定基準です。参加者に正解として直接提示しないでください。
- 「わからない」の反復だけで解説を開示しないこと。支援は見る場所を絞る、問いを二択や小さなトレースに分ける順に具体化し、通常の返答は反応1文＋問い1文を目安にします。学習者が明示的に説明を求めた場合も未確認の一点だけを短く説明します。
- 「これはこういうこと？」「こう説明していい？」という学習者自身の説明案には、説明を代行せず、正誤を短く返して本人の言葉を促します。
- `expectations` は `{dimension:'why'|'how'|'both', text:string}` の配列で定義し、終了前に確認する重要ポイントを問題ごとに明示してください。全trapを一律に質問する代わりに、学習目的に直結する設計理由や典型的な誤解を期待項目に含めます。
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
