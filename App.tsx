import 'react-native-gesture-handler';
import React, { useCallback, useState } from 'react';
import { Text, TextInput } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider, useTheme } from '@/theme/ThemeContext';
import { AuthProvider } from '@/store/AuthContext';
import { DataStoreProvider } from '@/store/DataStore';
import { DialogsProvider } from '@/store/DialogsContext';
import { ToastProvider } from '@/store/ToastContext';
import { SettingsProvider } from '@/store/SettingsContext';
import { ListenModeProvider } from '@/store/ListenModeContext';
import ListenModeModal from '@/components/ListenModeModal';
import FloatingListenPlayer from '@/components/FloatingListenPlayer';
import RootNavigator from '@/navigation/RootNavigator';
import { warmUpSpeechAudioSession } from '@/services/tts';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * index.html: `body { font-family: "Syne", system-ui, sans-serif; }` — the
 * base font for ALL text, with "DM Mono" only on specific numeric/code-like
 * elements (inputs, stats bar, count badges — those already set fontFamily
 * explicitly in their own StyleSheets from earlier phases). RN has no
 * global stylesheet cascade, so this is the standard lightweight way to
 * apply one default font app-wide without touching every <Text>/<TextInput>
 * usage: override defaultProps once, here, at the entry point.
 */
// @ts-ignore — defaultProps exists at runtime even though newer RN types omit it
(Text as any).defaultProps = (Text as any).defaultProps || {};
(Text as any).defaultProps.style = [{ fontFamily: 'Syne' }, (Text as any).defaultProps.style];
// @ts-ignore
(TextInput as any).defaultProps = (TextInput as any).defaultProps || {};
(TextInput as any).defaultProps.style = [{ fontFamily: 'Syne' }, (TextInput as any).defaultProps.style];

function AppShell() {
  const { mode } = useTheme();
  // Làm nóng AVAudioSession của iOS NGAY khi app hiện lên, trước khi
  // người dùng kịp bấm nghe từ đầu tiên — xem warmUpSpeechAudioSession()
  // trong tts.ts để biết lý do (Android không cần, tự bỏ qua). Chạy 1 lần
  // duy nhất cho cả vòng đời app nhờ cờ isWarmedUp bên trong hàm đó, nên
  // gọi lại ở đây mỗi khi AppShell mount (hiếm khi xảy ra hơn 1 lần) vẫn
  // an toàn, không đọc lặp lại.
  React.useEffect(() => {
    warmUpSpeechAudioSession();
  }, []);
  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <RootNavigator />
      {/* Gắn ở gốc app, ngoài mọi navigator/màn hình, để "Nghe từ vựng" (modal
          + nút play thu nhỏ) không bao giờ bị unmount khi người dùng chuyển
          màn hình — xem ghi chú chi tiết trong ListenModeContext.tsx. */}
      <ListenModeModal />
      <FloatingListenPlayer />
    </>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    'DM Mono': require('./assets/fonts/DMMono-Regular.ttf'),
    'DM Mono Medium': require('./assets/fonts/DMMono-Medium.ttf'),
    Syne: require('./assets/fonts/Syne-Bold.ttf'),
  });

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded || fontError) await SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <DataStoreProvider>
              <SettingsProvider>
                <ToastProvider>
                  <DialogsProvider>
                    <ListenModeProvider>
                      <AppShell />
                    </ListenModeProvider>
                  </DialogsProvider>
                </ToastProvider>
              </SettingsProvider>
            </DataStoreProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
