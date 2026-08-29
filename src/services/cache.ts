import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Thin async wrapper mirroring the localStorage.getItem/setItem/removeItem
 * calls scattered through index.html (cache_sessions_*, vocab_*,
 * cache_mastered_*, cache_flagged_*, sessionFolders). Kept as plain
 * JSON string keys so the naming stays 1:1 with the original for easy
 * cross-reference — only the storage backend and sync→async shape differ.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort cache, never block the caller
  }
}

export async function cacheRemove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Xoá cache từ vựng/đã-thuộc/đã-gắn-cờ CỦA NHỮNG PHIÊN KHÔNG CÒN TỒN TẠI
 * NỮA (đã bị xoá) — dọn rác AsyncStorage tích tụ theo thời gian, mirrors
 * bootstrap()'s cleanup gốc.
 *
 * SỬA LỖI (2026-08-29): bản trước xoá VÔ ĐIỀU KIỆN mọi key khớp tiền tố,
 * kể cả của những phiên VẪN CÒN TỒN TẠI — nghĩa là mỗi lần mở app, cache
 * của chính phiên đang dùng cũng bị xoá sạch NGAY TRƯỚC KHI
 * activateSession() kịp đọc ra để hiện tạm, khiến app luôn phải đợi mạng
 * lại từ đầu dù đã có cache — làm mất tác dụng của toàn bộ cơ chế
 * cache-first. Giờ cần truyền vào danh sách id phiên THẬT (validSessionIds)
 * để chỉ xoá cache của phiên không còn trong danh sách đó, giữ lại cache
 * của phiên còn tồn tại.
 */
export async function clearStaleVocabCaches(validSessionIds: string[]): Promise<void> {
  try {
    const validSet = new Set(validSessionIds);
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter((k) => {
      const prefixes = ['vocab_', 'cache_mastered_', 'cache_flagged_'];
      const prefix = prefixes.find((p) => k.startsWith(p));
      if (!prefix) return false;
      const sid = k.slice(prefix.length);
      return !validSet.has(sid);
    });
    if (stale.length) await AsyncStorage.multiRemove(stale);
  } catch {
    // ignore
  }
}
