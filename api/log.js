import { isAccessCodeValid } from './_lib/accessCode.js'
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const { accessCode, ...event } = req.body ?? {}

    if (!isAccessCodeValid(accessCode)) {
      return res.status(401).json({ error: '合言葉が正しくありません。' })
    }

    const entry = { timestamp: new Date().toISOString(), ...event }

    // NOTE: サーバーレス環境なのでファイルには書き込まない（再起動で消えるため）。
    // 今はVercelのLogsタブで確認できるだけ。分析・永続化が必要になったら
    // ここをSupabase等の外部ストレージへの書き込みに差し替える。
    console.log(JSON.stringify(entry))

    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[api/log error]', error)
    return res.status(500).json({ error: error.message })
  }
}
