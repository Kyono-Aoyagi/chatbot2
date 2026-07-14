import { insertLog } from './_lib/supabase.js'

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
    const event = req.body ?? {}
    await insertLog(event)
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[api/log error]', error)
    return res.status(500).json({ error: error.message })
  }
}
