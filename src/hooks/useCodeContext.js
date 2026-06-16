/**
 * コードパネルの状態管理フック
 * - コード文字列・言語・選択テキストを一元管理
 *
 * 将来の拡張:
 *  - 複数ファイルタブ
 *  - コードのバージョン履歴（diff表示）
 *  - ファイルアップロード対応
 */

import { useState, useCallback } from 'react'
import { logEvent } from '../utils/logger'

const SAMPLE_CODE = `# サンプル: バブルソート (Python)
def bubble_sort(arr):
    n = len(arr)
    for i in range(n):
        swapped = False
        for j in range(0, n - i - 1):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        if not swapped:
            break
    return arr

# 使用例
numbers = [64, 34, 25, 12, 22, 11, 90]
print(bubble_sort(numbers))
`

export function useCodeContext(sessionId) {
  const [code, setCode] = useState(SAMPLE_CODE)
  const [language, setLanguage] = useState('python')
  const [selectedText, setSelectedText] = useState('')

  const loadCode = useCallback((newCode, lang = 'unknown') => {
    setCode(newCode)
    setLanguage(lang)
    setSelectedText('')
    logEvent(sessionId, 'code_load', { language: lang, length: newCode.length })
  }, [sessionId])

  const handleSelection = useCallback((text) => {
    setSelectedText(text)
    if (text) {
      logEvent(sessionId, 'code_select', { selectedText: text })
    }
  }, [sessionId])

  return { code, language, selectedText, loadCode, handleSelection, setLanguage }
}
