/**
 * コードオブジェクトの統一型
 *
 * {
 *   id:          string   — プリセットは固定ID、ユーザー貼付は 'user_<timestamp>'
 *   title:       string   — 表示用タイトル
 *   language:    string   — 'python' | 'javascript' | etc.
 *   filename:    string   — コードペインに表示するファイル名
 *   source:      string   — 'preset' | 'user_input'
 *   code:        string   — コード本文
 *   tutorHints:  string|null — AIへの補足指示（なければAIが自力で読む）
 * }
 */

export const PRESET_CODES = [
  {
    id: 'bubble_sort',
    title: 'バブルソート',
    language: 'python',
    filename: 'bubble_sort.py',
    source: 'preset',
    code: `def bubble_sort(numbers):
    n = len(numbers)
    for i in range(n):
        swapped = False
        for j in range(0, n - i - 1):
            if numbers[j] > numbers[j + 1]:
                numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]
                swapped = True
        if not swapped:
            break
    return numbers


values = [64, 34, 25, 12, 22, 11, 90]
sorted_values = bubble_sort(values)
print(sorted_values)`,
    tutorHints: `
- 二重ループの外側（i）と内側（j）が別の役割を持っていることに気づかせる
- swapped 変数による早期終了（最適化）がこのコードの核心なので、最終的にここに気づかせたい
- numbers[j] と numbers[j+1] の交換が「隣同士の比較と入れ替え」であることを自分の言葉で言わせる
`.trim(),
  },
]

/**
 * ユーザー貼付コードのオブジェクトを生成する
 *
 * @param {{ code: string, language: string, title: string }} params
 * @returns {object} 統一型コードオブジェクト
 */
export function createUserCode({ code, language, title }) {
  return {
    id: `user_${Date.now()}`,
    title: title.trim() || '無題のコード',
    language: language || 'unknown',
    filename: buildFilename(title, language),
    source: 'user_input',
    code: code.trim(),
    tutorHints: null, // AIがコードを読んで自力で対応する
  }
}

function buildFilename(title, language) {
  const ext = LANGUAGE_EXTENSIONS[language] ?? 'txt'
  const base = title.trim()
    ? title.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    : 'code'
  return `${base || 'code'}.${ext}`
}

const LANGUAGE_EXTENSIONS = {
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
  ruby: 'rb',
  java: 'java',
  go: 'go',
  rust: 'rs',
  c: 'c',
  cpp: 'cpp',
}
