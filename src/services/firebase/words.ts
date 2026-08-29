import { getDocs, setDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { vocabCol, vocabDoc } from './paths';
import { cacheGet, cacheSet, cacheRemove } from '@/services/cache';
import type { VocabWord } from '@/types/models';

// In-memory cache, mirrors _cache.vocab (sid -> array). Kept fresh by the
// realtime onSnapshot listener in realtimeSync.ts once a session is active.
const _vocabCache: Record<string, VocabWord[]> = {};

export function getVocabCacheEntry(sid: string) {
  return _vocabCache[sid];
}
export function setVocabCacheEntry(sid: string, data: VocabWord[]) {
  _vocabCache[sid] = data;
}

/** index.html: invalidateVocabCache(sid) */
export async function invalidateVocabCache(sid: string): Promise<void> {
  await cacheRemove(`vocab_${sid}`);
  delete _vocabCache[sid];
}

/**
 * Đọc NHANH từ vựng đã cache của 1 phiên (bộ nhớ hoặc AsyncStorage), KHÔNG
 * đụng mạng — dùng để hiện tạm ngay khi mở/chuyển phiên trong lúc chờ dữ
 * liệu thật đồng bộ về qua realtime listener (xem activateSession trong
 * DataStore.tsx). Trả về null nếu chưa từng cache (phiên mở lần đầu).
 */
export async function peekCachedVocab(sid: string): Promise<VocabWord[] | null> {
  if (_vocabCache[sid]) return _vocabCache[sid];
  return cacheGet<VocabWord[]>(`vocab_${sid}`);
}

/** index.html: dbGetSessionVocab(sid) */
export async function dbGetSessionVocab(uid: string, sid: string): Promise<VocabWord[]> {
  if (_vocabCache[sid]) return _vocabCache[sid];

  const cached = await cacheGet<VocabWord[]>(`vocab_${sid}`);
  if (cached) {
    _vocabCache[sid] = cached;
    return cached;
  }

  const snap = await getDocs(query(vocabCol(uid, sid), orderBy('sortOrder', 'asc')));
  const result = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VocabWord);
  _vocabCache[sid] = result;
  await cacheSet(`vocab_${sid}`, result);
  return result;
}

/** index.html: dbAddWord(sid, word, order) */
export async function dbAddWord(uid: string, sid: string, word: VocabWord, order: number): Promise<void> {
  await setDoc(vocabDoc(uid, sid, word.id), {
    originalGerman: word.originalGerman,
    mainGerman: word.mainGerman,
    meaning: word.meaning,
    wordType: word.wordType || '',
    example: word.example || '',
    sortOrder: order || 0,
  });
  delete _vocabCache[sid];
  await invalidateVocabCache(sid);
}

/** index.html: dbUpdateWord(sid, id, g, main, m, wt, ex) */
export async function dbUpdateWord(
  uid: string,
  sid: string,
  id: string,
  originalGerman: string,
  mainGerman: string,
  meaning: string,
  wordType: string,
  example: string
): Promise<void> {
  await setDoc(
    vocabDoc(uid, sid, id),
    {
      originalGerman,
      mainGerman,
      meaning,
      wordType: wordType || '',
      example: example || '',
    },
    { merge: true }
  );
  delete _vocabCache[sid];
  await invalidateVocabCache(sid);
}

/** index.html: dbDeleteWord(sid, id) */
export async function dbDeleteWord(uid: string, sid: string, id: string): Promise<void> {
  await deleteDoc(vocabDoc(uid, sid, id));
  delete _vocabCache[sid];
  await invalidateVocabCache(sid);
}
