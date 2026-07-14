import { createClient } from '@supabase/supabase-js'

let SUPABASE_URL = (process.env.SUPABASE_URL ?? '').trim()
if (SUPABASE_URL) {
  // 末尾のスラッシュや、誤って含まれた /rest/v1 などのパスを除去する
  SUPABASE_URL = SUPABASE_URL.replace(/\/+$/, '').replace(/\/rest\/v1$/, '')
}
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()

// service_role キーはRLSを無視してテーブルにフルアクセスできるため、
// 絶対にフロントエンドのコードやレスポンスに含めないこと。サーバー側専用。
let client = null

export function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  }
  return client
}

// event: { sessionId, eventType, ...任意のフィールド }
export async function insertLog(event) {
  const supabase = getSupabase()

  if (!supabase) {
    // Supabase未設定でもアプリ本体は止めたくないので、フォールバックとしてconsole.logのみ行う
    console.warn('[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定のため保存をスキップしました。')
    console.log(JSON.stringify(event))
    return
  }

  const { sessionId, eventType, ...rest } = event

  const { error } = await supabase.from('chat_logs').insert({
    session_id: sessionId ?? null,
    event_type: eventType ?? 'unknown',
    payload: rest,
  })

  if (error) {
    console.error('[supabase] insert failed:', error.message)
  }
}
