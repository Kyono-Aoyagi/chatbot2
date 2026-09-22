const STORAGE_KEY = 'code-reading-tutor.condition'

// 実験条件の割り当てを解決する。
// 優先順位:
//   1. URLクエリパラメータ ?c=guided|free
//      （研究者が参加者リストを事前にシャッフルして配布するリンクで指定する想定。最優先）
//   2. localStorageに保存済みの割り当て
//      （同じブラウザで途中リロードしても条件がぶれないようにするため）
//   3. どちらもなければ50/50でランダムに割り当てて保存する
//      （動作確認・開発用のフォールバック）
//
// 本番の実験では、ブラウザ単位のランダム割り当て（3.）に頼ると参加者間の
// 人数バランスが偶然偏る可能性があるため、?c=guided / ?c=free 付きのリンクを
// 研究者側で事前に用意して配布する運用を推奨する。
export function resolveCondition() {
  const params = new URLSearchParams(window.location.search)
  const fromUrl = params.get('c')
  // opportunistic は本番のguided/free比較実験には含めない、パイロット専用の条件。
  // ?c=opportunistic を明示的に付けたときだけ有効化する（50/50ランダム割当の対象外）。
  if (fromUrl === 'guided' || fromUrl === 'free' || fromUrl === 'opportunistic') {
    window.localStorage.setItem(STORAGE_KEY, fromUrl)
    return fromUrl
  }

  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'guided' || stored === 'free' || stored === 'opportunistic') {
    return stored
  }

  // 本番実験のランダム割当は guided/free の二択のまま変更しない。
  const assigned = Math.random() < 0.5 ? 'guided' : 'free'
  window.localStorage.setItem(STORAGE_KEY, assigned)
  return assigned
}

export const CONDITION_LABELS = {
  guided: '段階的ガイドモード',
  free: '自由質問モード',
  opportunistic: '日和見モード（パイロット）',
}
