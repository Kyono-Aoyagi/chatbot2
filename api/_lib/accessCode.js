const ACCESS_CODE = process.env.ACCESS_CODE

// 合言葉が正しいかを確認する。ACCESS_CODEが未設定の場合はチェックをスキップする
// （設定忘れで全員締め出す事故を防ぐためのフェイルセーフ）。
export function isAccessCodeValid(accessCode) {
  if (!ACCESS_CODE) return true
  return typeof accessCode === 'string' && accessCode === ACCESS_CODE
}
