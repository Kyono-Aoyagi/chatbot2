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
 *   expectedOutput: string|undefined — 事前に実行しておいた実行結果（標準出力）。
 *                    指定があるプリセットのみ、summaryステップ完了後に実行結果パネルで表示する。
 *   stepFocus:   object|undefined — ステップ単位の着目観点の上書き（任意）
 *                { [stepId]: string } の形。指定したステップだけ、
 *                server側の汎用STEP_FOCUSより優先して使われる。
 *                未指定のステップは汎用のデフォルトにフォールバックする。
 *                （例: ループの変数名や状態変数名など、コード固有の具体的な観点を書く）
 *
 *   --- 以下は opportunistic 条件用（すべて任意。ユーザー貼付コードでは未指定） ---
 *   reference:   { why: string, how: string }|undefined — チューターだけが知る正解。
 *                mentalModel を confirmed にしてよいかの判断基準になる。ユーザーには直接言わない。
 *   landmarks:   Array<{ target: string, note: string }>|undefined — ユーザーが自発的に触れそうな局所的手がかり。
 *                触れられたら深掘りに使う。詰まったときの「見るべき場所」の候補にもなる。各2〜4個まで。
 *   traps:       string[]|undefined — よくある誤解・つまずきどころ。兆候が見えたときだけ使う。各2〜4個まで。
 *   difficulty:  1|2|3|undefined — 主観的な難易度（ログを問題横断で見るときの整理用）
 *   tags:        string[]|undefined — 問題の性質（loop, recursion, bug, misleading_name など）。同上。
 * }
 */

export const PRESET_CODES = [
  // ===== 難易度1: 初歩（opportunistic 用の中身のみ。guided 用の tutorHints / stepFocus は省略） =====
  {
    id: 'sum_list',
    title: '合計を求める',
    language: 'python',
    filename: 'sum_list.py',
    source: 'preset',
    code: `def total(numbers):
    result = 0
    for n in numbers:
        result += n
    return result


scores = [80, 65, 90, 75]
print(total(scores))`,
    expectedOutput: '310',
    tutorHints: null,
    reference: {
      why: '数値のリストの合計を求めて返す。',
      how: '変数 result を0で初期化し、リストの要素を1つずつ取り出して足し込んでいく。全部足し終えたら result を返す。',
    },
    landmarks: [
      { target: 'result = 0', note: '足し込み用の変数の初期値。なぜ0から始めるか' },
      { target: 'result += n', note: '繰り返しのたびに値が更新される（状態変化）' },
      { target: 'for n in numbers', note: '要素を1つずつ取り出している' },
    ],
    traps: [
      'n をリストの長さと勘違いする（ここでは取り出した要素の値）',
      'return をループの内側にあると読み違える（インデントの見落とし）',
    ],
    difficulty: 1,
    tags: ['loop', 'accumulator'],
  },
  {
    id: 'max_value',
    title: '最大値を探す',
    language: 'python',
    filename: 'max_value.py',
    source: 'preset',
    code: `def largest(numbers):
    best = numbers[0]
    for n in numbers:
        if n > best:
            best = n
    return best


temperatures = [21, 28, 19, 33, 25]
print(largest(temperatures))`,
    expectedOutput: '33',
    tutorHints: null,
    reference: {
      why: '数値のリストの中の最大値を返す。',
      how: '先頭の要素を仮の最大値 best として持ち、各要素と比べて、より大きいものが見つかるたびに best を更新する。最後に残った best を返す。',
    },
    landmarks: [
      { target: 'best = numbers[0]', note: '仮の最大値の初期化。なぜ先頭要素から始めるか' },
      { target: 'if n > best', note: '更新される条件。更新されない要素もある' },
      { target: 'best = n', note: '最大値の候補が入れ替わる（状態変化）' },
    ],
    traps: [
      'best が毎回更新されると思い込む（更新されない周回もある）',
      '最大値の位置（インデックス）を返すものだと勘違いする',
      'best の初期値が0でもよいと考える（負の数だけのリストで崩れる）',
    ],
    difficulty: 1,
    tags: ['loop', 'condition', 'tracking'],
  },
  {
    id: 'multiples_label',
    title: '倍数による出力の切り替え',
    language: 'python',
    filename: 'multiples.py',
    source: 'preset',
    code: `def label(n):
    if n % 15 == 0:
        return "FizzBuzz"
    elif n % 3 == 0:
        return "Fizz"
    elif n % 5 == 0:
        return "Buzz"
    else:
        return str(n)


for i in range(1, 16):
    print(label(i))`,
    expectedOutput: '1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz',
    tutorHints: null,
    reference: {
      why: '1から15までの各数について、15の倍数なら FizzBuzz、3の倍数なら Fizz、5の倍数なら Buzz、どれでもなければその数自体を出力する。',
      how: '関数 label が条件を上から順に判定し、最初に成立した分岐の値を返す。ループが1から15までを順に渡して出力する。15の判定を先頭に置くことで、3と5の両方の倍数を正しく扱える。',
    },
    landmarks: [
      { target: 'n % 15 == 0', note: '最初に判定される理由。順序に意味がある' },
      { target: 'elif の連鎖', note: '上から順に見て、最初に成立した分岐だけが実行される' },
      { target: 'range(1, 16)', note: '終端の16は含まれない' },
      { target: 'str(n)', note: '数を文字列に変換して返している（返り値の型を揃える）' },
    ],
    traps: [
      '15の判定を先頭に置く理由に気づかない（3の判定が先だと15が Fizz になる）',
      'range(1, 16) を1から16までと読む',
      'elif を独立した if と同じに考え、複数の分岐が実行されると思う',
    ],
    difficulty: 1,
    tags: ['condition', 'elif_chain', 'ordering'],
  },

  // ===== 難易度2: バブルソート =====
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
    // 事前に手元で実行しておいた結果をそのまま貼っている（静的埋め込み）。
    // summaryステップ完了後にのみ実行結果パネルに表示される。
    expectedOutput: '[11, 12, 22, 25, 34, 64, 90]',
    tutorHints: `
- 二重ループの外側（i）と内側（j）が別の役割を持っていることに気づかせる
- swapped 変数による早期終了（最適化）がこのコードの核心なので、最終的にここに気づかせたい
- numbers[j] と numbers[j+1] の交換が「隣同士の比較と入れ替え」であることを自分の言葉で言わせる
`.trim(),
    // このコード固有の具体的な観点（変数名など）は stepFocus で上書きする。
    // 未指定のステップ（purpose, input_output, summaryなど）は
    // server/gemini.js の汎用 STEP_FOCUS にフォールバックされる。
    stepFocus: {
      loop: '二重ループの外側（i）と内側（j）がそれぞれ何をしているか、役割の違いに注目させる。',
      state_change: 'swapped 変数がいつTrueになるか、何を記録している変数なのかを考えさせる。',
      early_stop: 'swapped による早期終了（最適化）がなぜ可能なのか、その理由を考えさせる。',
      condition: 'numbers[j] と numbers[j+1] の比較がどんなときに真になり、そのとき配列に何が起きるかを考えさせる。',
    },

    // --- opportunistic 条件用 ---
    reference: {
      why: '数値のリストを昇順に並べ替える（バブルソート）。整列済みのリストを返す。',
      how: '隣り合う要素を比較し、逆順なら入れ替える。1周ごとに最大値が末尾に確定していく。'
        + '1周で入れ替えが一度も起きなければ整列済みなので打ち切る。',
    },
    landmarks: [
      { target: 'swapped', note: '入れ替えの有無を記録するフラグ。早期終了の要' },
      { target: 'range(0, n - i - 1)', note: '周回ごとに内側の範囲が縮む。末尾は確定済みだから' },
      { target: 'numbers[j], numbers[j + 1] = ...', note: '隣同士の入れ替え' },
      { target: 'if not swapped: break', note: '外側ループが n 回回りきらないことがある' },
    ],
    traps: [
      '外側ループは必ず n 回まわると思い込む（早期終了で減る）',
      '内側の範囲が n - i - 1 である理由（末尾 i 個は確定済み）を見落とす',
      'リストの要素数を数え違える（values は7個）',
    ],
    difficulty: 2,
    tags: ['loop', 'nested', 'flag', 'early_exit'],
  },

  // ===== 構造・つまずきの種類を変えた問題（opportunistic 用の中身のみ） =====
  {
    id: 'recursion_calc',
    title: '再帰を使った計算',
    language: 'python',
    filename: 'recursion.py',
    source: 'preset',
    code: `def calc(n):
    if n <= 1:
        return 1
    return n * calc(n - 1)


print(calc(5))`,
    expectedOutput: '120',
    tutorHints: null,
    reference: {
      why: 'n の階乗（1 から n までの積）を求めて返す。',
      how: '関数が自分自身を n - 1 で呼び出し、その結果に n を掛ける。n が1以下になったら1を返して再帰を止め（基底ケース）、呼び出しから戻る過程で掛け算が積み上がっていく。',
    },
    landmarks: [
      { target: 'if n <= 1: return 1', note: '再帰の停止条件（基底ケース）' },
      { target: 'calc(n - 1)', note: '関数が自分自身を呼び、引数が1ずつ減っていく' },
      { target: 'n * calc(n - 1)', note: '掛け算は呼び出しから戻ってきたときに行われる' },
    ],
    traps: [
      'ループが無いので繰り返しが起きないと読み違える',
      '停止条件を見落とし、なぜ止まるのか説明できない',
      '掛け算が呼び出しの順に行われると思う（実際は戻るときに行われる）',
    ],
    difficulty: 2,
    tags: ['recursion', 'no_loop', 'base_case'],
  },
  {
    id: 'gcd_euclid',
    title: 'while を使った関数',
    language: 'python',
    filename: 'loop_func.py',
    source: 'preset',
    code: `def f(a, b):
    while b != 0:
        a, b = b, a % b
    return a


print(f(48, 18))`,
    expectedOutput: '6',
    tutorHints: null,
    reference: {
      why: '2つの整数の最大公約数を求めて返す。',
      how: 'a を b で割った余りを新しい b、元の b を新しい a として更新することを繰り返す（ユークリッドの互除法）。b が0になったときの a が答えになる。',
    },
    landmarks: [
      { target: 'while b != 0', note: '終了条件。b が0になると止まる' },
      { target: 'a, b = b, a % b', note: '2変数の同時更新。余りを取ることで値が小さくなっていく' },
      { target: 'return a', note: 'b が0になったときの a が返る' },
    ],
    traps: [
      '関数名 f から目的が推測できず、コードの中身に降りられない',
      'a, b = b, a % b を左から順に評価されると読む（a が先に変わると誤解する）',
      '余りを使う意味（値が小さくなり、必ず終わること）に気づかない',
    ],
    difficulty: 3,
    tags: ['while', 'opaque_name', 'simultaneous_assignment', 'gcd'],
  },
  {
    id: 'misleading_find_max',
    title: '値を探す関数',
    language: 'python',
    filename: 'search.py',
    source: 'preset',
    code: `def find_max(numbers):
    result = numbers[0]
    for n in numbers:
        if n < result:
            result = n
    return result


data = [42, 17, 58, 9, 31]
print(find_max(data))`,
    expectedOutput: '9',
    tutorHints: null,
    reference: {
      why: 'リストの中の最小値を返す。関数名は find_max だが、実際の挙動は最小値を求めるもので、名前と実装が食い違っている。',
      how: '先頭の要素を仮の値 result として持ち、より小さい要素が見つかるたびに更新する。最後に残った result を返す。',
    },
    landmarks: [
      { target: 'if n < result', note: '比較の向きが最大値探索と逆になっている' },
      { target: 'def find_max', note: '関数名が実際の挙動と合っていない' },
      { target: 'print(find_max(data))', note: '実際に出力される値と予想を比べられる' },
    ],
    traps: [
      '関数名を信じて最大値を返すものと読み込む',
      '比較演算子 < の向きを見落とす',
      '出力を 42 や 58 だと予想する',
    ],
    difficulty: 2,
    tags: ['bug', 'misleading_name', 'loop', 'condition'],
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
