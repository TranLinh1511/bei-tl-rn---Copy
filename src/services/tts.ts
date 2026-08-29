import * as Speech from 'expo-speech';
import TrackPlayer, { Capability, AppKilledPlaybackBehavior, RepeatMode } from 'react-native-track-player';
import BackgroundTimer from 'react-native-background-timer';
import { getGermanExample, getReducedTarget } from '@/utils/grading';
import type { Question, ExerciseType } from '@/utils/questionBuilder';

/**
 * TTS — ported from index.html's speakText()/speakForMode()/_speakLang().
 *
 * DELIBERATE DEVIATION: the original's PRIMARY path scrapes an undocumented
 * endpoint (translate.googleapis.com/translate_tts) via fetch+AudioContext
 * (desktop) or an <audio> element (mobile WebView), only falling back to
 * the real Web Speech API if that request fails. That endpoint is
 * unofficial, unthrottled-but-rate-limitable, and not something to depend
 * on in a shipped app. `expo-speech` wraps each platform's real native TTS
 * engine (AVSpeechSynthesizer on iOS, TextToSpeech on Android) — it IS the
 * proper equivalent of the original's *fallback* (Web Speech API), and is
 * more reliable than the primary path was. Behavior contract (what speaks,
 * when, controlled by which setting) is kept identical; only the audio
 * backend differs.
 */
let soundEnabledRef = true;

/**
 * "Trình phát nền" cho Nghe từ vựng, dựng trên react-native-track-player.
 *
 * TẠI SAO ĐỔI SANG TRACK-PLAYER (thay cho mồi câm qua expo-av trước đó):
 * expo-speech gọi thẳng công cụ TTS gốc của hệ điều hành — nó không đứng
 * sau một audio-session mà Android công nhận là "đang phát media thật".
 * expo-av's staysActiveInBackground chỉ cấu hình audio-session, KHÔNG dựng
 * foreground service + thông báo — nên khi khoá màn hình, Android vẫn có
 * thể Doze/điều tiết mạnh tiến trình JS, khiến timer điều phối
 * từ→nghĩa→ví dụ trong useListenMode bị treo giữa chừng.
 *
 * react-native-track-player thì khác: nó chạy một foreground service THẬT
 * kèm thông báo media-style (như một trình phát nhạc) — loại service này
 * được Android miễn trừ khỏi Doze khi đang active. Ở đây nó chỉ phát một
 * track câm (silence.mp3) lặp vô hạn để "giữ chỗ" service đó; giọng đọc
 * thật vẫn hoàn toàn do expo-speech đảm nhiệm như cũ. Đổi lại có thêm:
 *  - Thông báo thật trên thanh trạng thái + màn hình khoá, có nút
 *    play/pause/tiếp/trước — bấm vào đó điều khiển thẳng "Nghe từ vựng"
 *    (nối qua listenPlaybackBridge.ts, vì playbackService.ts chạy ngoài
 *    cây React — xem file đó).
 *
 * NHƯNG foreground service KHÔNG giữ CPU thức — nó chỉ giữ cho tiến trình
 * không bị hệ thống giết. Khi khoá màn hình, CPU vẫn có thể đi ngủ (Doze /
 * trình quản lý pin của hãng máy như MIUI, EMUI...), lúc đó toàn bộ
 * setTimeout/watchdog điều phối từ→nghĩa→ví dụ trong useListenMode bị
 * treo cứng: mảnh đang đọc thì vẫn đọc xong (vì lệnh gọi TTS đã "bắn" sang
 * native rồi), nhưng callback onDone quay lại JS để đọc tiếp thì không
 * chạy nữa — nghe như "đọc được 1 từ rồi im".
 *
 * Vì vậy cần thêm react-native-background-timer: start()/stop() của nó
 * giữ một PARTIAL_WAKE_LOCK thật (PowerManager) trong lúc "Nghe từ vựng"
 * đang phát, để CPU không ngủ; và setTimeout()/clearTimeout() của nó được
 * dùng thay cho setTimeout gốc trong useListenMode.ts, vì lịch native của
 * nó không bị JS-thread throttle như setTimeout gốc.
 */
let playerSetupPromise: Promise<void> | null = null;
let keepAliveActive = false;
let wakeLockActive = false;

async function setupTrackPlayerOnce(): Promise<void> {
  if (playerSetupPromise) return playerSetupPromise;
  playerSetupPromise = (async () => {
    await TrackPlayer.setupPlayer({});
    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
      },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.Stop,
      ],
      compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
      notificationCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious],
    });
  })();
  return playerSetupPromise;
}

/**
 * Bắt đầu (hoặc tiếp tục) trình phát nền — gọi khi bấm play ở "Nghe từ
 * vựng". An toàn khi gọi nhiều lần liên tiếp.
 *
 * `sessionTitle` (tuỳ chọn): tên phiên đang phát (vd. tên phiên/thư mục
 * hiện tại, hoặc "Nhiều phiên" khi đang gộp) — hiển thị TĨNH trên thông
 * báo/khoá màn hình trong suốt lượt phát, KHÔNG đổi theo từng từ đang đọc
 * (khác bản trước: đổi title theo từng mảnh từ→nghĩa→ví dụ, trông giật
 * cục và không rõ nghĩa). `duration: 0` trên track câm để thanh tiến
 * trình hiện cố định 00:00–00:00 thay vì độ dài thật của silence.mp3
 * (~2s, bị lặp liên tục trông như đang phát 1 bài nhạc 2 giây).
 */
export async function startKeepAliveAudio(sessionTitle?: string) {
  const title = sessionTitle?.trim() || 'Nghe từ vựng';
  if (keepAliveActive) {
    // Đã đang phát — chỉ cập nhật lại tên phiên nếu người dùng mở "Nghe từ
    // vựng" với danh sách khác trong khi vẫn giữ trình phát nền sống.
    await TrackPlayer.updateNowPlayingMetadata({ title, artist: 'bei TL', duration: 0 }).catch(() => {});
    return;
  }
  // Giữ CPU thức trước — độc lập với track-player, để dù track-player có
  // lỗi/không dựng được, chuỗi setTimeout điều phối trong useListenMode
  // vẫn có cơ hội chạy tiếp khi khoá màn hình.
  try {
    BackgroundTimer.start();
    wakeLockActive = true;
  } catch {
    wakeLockActive = false;
  }
  try {
    await setupTrackPlayerOnce();
    const queue = await TrackPlayer.getQueue();
    if (!queue.length) {
      await TrackPlayer.add({
        url: require('../../assets/audio/silence.mp3'),
        title,
        artist: 'bei TL',
        duration: 0,
      });
    } else {
      await TrackPlayer.updateNowPlayingMetadata({ title, artist: 'bei TL', duration: 0 }).catch(() => {});
    }
    await TrackPlayer.setRepeatMode(RepeatMode.Track);
    await TrackPlayer.play();
    keepAliveActive = true;
  } catch {
    // Không nghiêm trọng — nếu trình phát nền không dựng được (ví dụ bản
    // build cũ chưa có module native này), TTS vẫn phát bình thường khi
    // app đang mở, chỉ kém tin cậy hơn khi khoá màn hình.
    keepAliveActive = false;
  }
}

/** Dừng hẳn trình phát nền + gỡ thông báo — gọi khi pause()/đóng "Nghe từ vựng" hoặc phát hết danh sách. */
export async function stopKeepAliveAudio() {
  if (wakeLockActive) {
    wakeLockActive = false;
    try {
      BackgroundTimer.stop();
    } catch {
      // ignore
    }
  }
  if (!keepAliveActive) return;
  keepAliveActive = false;
  try {
    await TrackPlayer.reset();
  } catch {
    // ignore
  }
}

/** Call once from SettingsContext when the user toggles the sound setting. */
export function setTtsSoundEnabled(enabled: boolean) {
  soundEnabledRef = enabled;
}

/**
 * "Làm nóng" audio session ngay khi app mở, KHÔNG phát tiếng gì và KHÔNG
 * hiện thông báo media — chỉ gọi setupPlayer() một lần để iOS thiết lập
 * sẵn category "playback" cho audio session từ sớm.
 *
 * LÝ DO: expo-speech (AVSpeechSynthesizer) tự kích hoạt/tắt audio session
 * riêng cho MỖI lần gọi speak() nếu chưa có session nào đang "sống" — việc
 * bật/tắt session này tốn khoảng 0.5–2s, gây cảm giác "bấm phát âm phải
 * chờ một lúc mới nghe được", lặp lại ở MỌI lần bấm chứ không chỉ lần
 * đầu. Gọi setupPlayer() sớm (không cần play gì) giúp session đã ở trạng
 * thái sẵn sàng, nên các lệnh speak() sau đó không phải tốn thời gian
 * kích hoạt lại từ đầu.
 */
export async function warmUpAudioSession() {
  try {
    await setupTrackPlayerOnce();
  } catch {
    // Không nghiêm trọng — nếu lỗi, TTS vẫn hoạt động, chỉ có thể chậm hơn
    // ở lần gọi đầu tiên.
  }
}

/** index.html: speakText(text) — always German */
export function speakText(text: string) {
  if (!soundEnabledRef || !text?.trim()) return;
  Speech.stop();
  Speech.speak(text.trim(), {
    language: 'de-DE',
    rate: 0.85, // matches original utt.rate = 0.85
    pitch: 1,
  });
}

/**
 * index.html: speakForMode(q) — "Nghe" mode: what gets SPOKEN is always the
 * PROMPT (the thing the person is given), never the target they must type.
 *  - fullWord  ("nghe - nguyên từ"): mục tiêu là gõ NGUYÊN TỪ, nên phát âm
 *    thanh là NGHĨA tiếng Việt (vi-VN).
 *  - fullMeaning ("nghe - nghĩa"): mục tiêu là gõ NGHĨA, nên phát âm thanh
 *    là NGUYÊN TỪ tiếng Đức (de-DE).
 *  - fullSentence: giữ nguyên — luôn đọc câu ví dụ tiếng Đức.
 */
export function speakForMode(q: Question, effectiveType: Exclude<ExerciseType, 'mixedRandom'>, strictVocabCheck: boolean) {
  if (!q) return;
  if (effectiveType === 'fullSentence') {
    speakText(q.example ? getGermanExample(q.example) : q.fullDisplayGerman);
    return;
  }
  if (effectiveType === 'fullWord') {
    speakTextVi(q.meaning);
    return;
  }
  const reduced = getReducedTarget(q.fullDisplayGerman, strictVocabCheck);
  speakText(reduced !== null ? reduced : q.fullDisplayGerman);
}

/** Same as speakText but for Vietnamese (nghĩa) — used by "nghe - nguyên từ" mode. */
export function speakTextVi(text: string) {
  if (!soundEnabledRef || !text?.trim()) return;
  Speech.stop();
  Speech.speak(text.trim(), {
    language: 'vi-VN',
    rate: 0.85,
    pitch: 1,
  });
}

/**
 * Phát một đoạn văn bản đơn lẻ trong hàng đợi tuần tự dùng cho "Nghe từ
 * vựng" — không kiểm tra soundEnabledRef (chế độ nghe có công tắc riêng),
 * luôn gọi đúng một trong các callback khi kết thúc để bên gọi (hook
 * useListenMode) có thể nối sang mục tiếp theo.
 */
export function speakQueueItem(
  text: string,
  language: 'de-DE' | 'vi-VN',
  rate: number,
  callbacks: { onDone: () => void; onError?: () => void }
) {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    callbacks.onDone();
    return;
  }
  Speech.speak(trimmed, {
    language,
    rate,
    pitch: 1,
    onDone: callbacks.onDone,
    onStopped: () => {}, // dừng chủ động (pause/next/prev) — hook tự quản lý, không gọi tiếp ở đây
    onError: () => {
      callbacks.onError?.();
      callbacks.onDone();
    },
  });
}

export function stopSpeaking() {
  Speech.stop();
}
