const ACCESS_CODE = process.env.ACCESS_CODE

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

  const { accessCode } = req.body ?? {}

  // ACCESS_CODEが未設定の場合は機能を無効化（誰でも通す）。
  // 設定を忘れて全員締め出す事故を防ぐためのフェイルセーフ。
  if (!ACCESS_CODE) {
    console.warn('[verify-access] ACCESS_CODE が未設定です。アクセス制限は無効化されています。')
    return res.status(200).json({ ok: true })
  }

  const ok = typeof accessCode === 'string' && accessCode === ACCESS_CODE
  return res.status(ok ? 200 : 401).json({ ok })
}
