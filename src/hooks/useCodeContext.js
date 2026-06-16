import { useCallback, useState } from 'react'
import { logEvent } from '../utils/logger'

const SAMPLE_CODE = `# サンプル: バブルソート
def bubble_sort(numbers):
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
print(bubble_sort(values))
`

export function useCodeContext(sessionId) {
  const [code, setCode] = useState(SAMPLE_CODE)
  const [language, setLanguageState] = useState('python')
  const [selectedText, setSelectedText] = useState('')

  const loadCode = useCallback((newCode, lang = language) => {
    setCode(newCode)
    setLanguageState(lang)
    setSelectedText('')
    logEvent(sessionId, 'code_load', {
      language: lang,
      length: newCode.length,
    })
  }, [language, sessionId])

  const setLanguage = useCallback((lang) => {
    setLanguageState(lang)
    logEvent(sessionId, 'language_change', { language: lang })
  }, [sessionId])

  const handleSelection = useCallback((text) => {
    const normalized = text.trim()
    setSelectedText(normalized)
    if (normalized) {
      logEvent(sessionId, 'code_select', {
        selectedText: normalized,
        length: normalized.length,
      })
    }
  }, [sessionId])

  return {
    code,
    language,
    selectedText,
    loadCode,
    setLanguage,
    handleSelection,
  }
}
