// 旧キー('code-reading-tutor.condition')にはランダム割り当ての結果(guided/free)が
// 残っているブラウザがあるため、キーを変えて古い割り当てを無視する。
// （デフォルトを opportunistic にしても、旧キーを読むと以前の条件に固定されてしまうのを防ぐ）
const STORAGE_KEY = 'code-reading-tutor.condition.v2'

const VALID_CONDITIONS = ['guided', 'free', 'opportunistic']

// デフォルトの条件。URLで指定が無く、保存済みの指定も無いときに使う。
export const DEFAULT_CONDITION = 'opportunistic'

// 条件を解決する。
// 優先順位:
//   1. URLクエリパラメータ ?c=guided|free|opportunistic
//      （最優先。指定した条件はlocalStorageに保存され、同じブラウザで途中リロードしてもぶれない）
//   2. localStorageに保存済みの指定（上記v2キー。1.で明示的に指定されたものだけが入る）
//   3. どちらもなければ DEFAULT_CONDITION（opportunistic）
//
// ランダム割り当ては廃止した。guided/free を比較する実験を再開する場合は、
// 参加者ごとに ?c=guided / ?c=free 付きのリンクを研究者側で配布する運用にすること。
export function resolveCondition() {
  const params = new URLSearchParams(window.location.search)
  const fromUrl = params.get('c')
  if (VALID_CONDITIONS.includes(fromUrl)) {
    window.localStorage.setItem(STORAGE_KEY, fromUrl)
    return fromUrl
  }

  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (VALID_CONDITIONS.includes(stored)) {
    return stored
  }

  return DEFAULT_CONDITION
}

export const CONDITION_LABELS = {
  guided: '段階的ガイドモード',
  free: '自由質問モード',
  opportunistic: '日和見モード',
}
