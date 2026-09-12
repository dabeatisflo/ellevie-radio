import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

const STUDIO_URL = 'https://studio.ellevie.fr/studio?source=studio-app&appVersion=1.1.0';
const PUSH_PREFERENCE_KEY = 'ellevie:studio-push-enabled';
const PUSH_CHANNEL_ID = 'studio-messages';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function requestExpoPushToken(): Promise<string> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
      name: 'Nouveaux messages studio',
      description: 'Nouveaux messages texte et vocaux reçus par Ellevie',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 180, 250],
      lightColor: '#EF003D',
      sound: 'default',
    });
  }

  const currentPermission = await Notifications.getPermissionsAsync();
  const permission = currentPermission.granted
    ? currentPermission
    : await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('permission-denied');

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('project-id-missing');
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

function StudioApp() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushStatus, setPushStatus] = useState('Désactivées');
  const [pushToken, setPushToken] = useState<string | null>(null);

  const sendPushStateToWeb = useCallback(() => {
    webViewRef.current?.postMessage(JSON.stringify({
      type: 'setStudioPushToken',
      enabled: pushEnabled,
      token: pushToken,
      platform: Platform.OS,
    }));
  }, [pushEnabled, pushToken]);

  const enablePushNotifications = useCallback(async (interactive: boolean) => {
    setPushBusy(true);
    setPushStatus('Activation…');
    try {
      const token = await requestExpoPushToken();
      setPushToken(token);
      setPushEnabled(true);
      setPushStatus('Activées');
      await AsyncStorage.setItem(PUSH_PREFERENCE_KEY, 'true');
    } catch (error) {
      setPushEnabled(false);
      const denied = error instanceof Error && error.message === 'permission-denied';
      setPushStatus(denied ? 'Refusées' : 'Indisponibles');
      await AsyncStorage.setItem(PUSH_PREFERENCE_KEY, 'false');
      if (interactive) {
        Alert.alert(
          denied ? 'Notifications non autorisées' : 'Activation impossible',
          denied
            ? 'Vous pouvez autoriser les notifications dans les paramètres Android.'
            : 'Vérifiez votre connexion internet, puis réessayez.',
        );
      }
    } finally {
      setPushBusy(false);
    }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(PUSH_PREFERENCE_KEY)
      .then((saved) => {
        if (saved === 'true') return enablePushNotifications(false);
        setPushStatus('Désactivées');
      })
      .catch(() => setPushStatus('Désactivées'));
  }, [enablePushNotifications]);

  useEffect(() => {
    if (!loading) sendPushStateToWeb();
  }, [loading, sendPushStateToWeb]);

  useEffect(() => {
    const openStudio = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const data = response.notification.request.content.data;
      if (data?.screen === 'studio') setReloadKey((value) => value + 1);
    };
    Notifications.getLastNotificationResponseAsync().then(openStudio).catch(() => null);
    const subscription = Notifications.addNotificationResponseReceivedListener(openStudio);
    return () => subscription.remove();
  }, []);

  const togglePushNotifications = useCallback((enabled: boolean) => {
    if (enabled) {
      void enablePushNotifications(true);
      return;
    }
    setPushEnabled(false);
    setPushStatus('Désactivées');
    AsyncStorage.setItem(PUSH_PREFERENCE_KEY, 'false').catch(() => null);
  }, [enablePushNotifications]);

  const handleWebMessage = (event: WebViewMessageEvent) => {
    let message: { type?: string; enabled?: boolean; error?: string } = {};
    try { message = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (message.type === 'studioReady') {
      sendPushStateToWeb();
    } else if (message.type === 'studioPushStatus' && message.error) {
      setPushStatus('Synchronisation en attente');
    }
  };

  const retry = () => {
    setFailed(false);
    setLoading(true);
    setReloadKey((value) => value + 1);
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.app}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Image source={require('./assets/ellevie-logo.webp')} style={styles.logo} />
        <View style={styles.titleBlock}>
          <Text style={styles.title}>ellevie Studio</Text>
          <Text style={styles.subtitle}>MESSAGES EN DIRECT</Text>
        </View>
        <View style={styles.pushControl}>
          <Text style={styles.pushLabel}>Notifications</Text>
          <View style={styles.pushRow}>
            <Text style={styles.pushStatus}>{pushStatus}</Text>
            <Switch
              accessibilityLabel="Activer ou désactiver les notifications de nouveaux messages"
              disabled={pushBusy}
              onValueChange={togglePushNotifications}
              value={pushEnabled}
              trackColor={{ false: '#8E6872', true: '#FF95B0' }}
              thumbColor={pushEnabled ? '#FFFFFF' : '#E7DCE0'}
            />
          </View>
        </View>
      </View>

      <View style={[styles.webFrame, { paddingBottom: Math.max(insets.bottom, 0) }]}>
        {failed ? (
          <View style={styles.errorPanel}>
            <Text style={styles.errorTitle}>Studio indisponible</Text>
            <Text style={styles.errorText}>Vérifiez votre connexion internet, puis réessayez.</Text>
            <Pressable onPress={retry} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryText}>Réessayer</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <WebView
              ref={webViewRef}
              key={reloadKey}
              source={{ uri: STUDIO_URL }}
              originWhitelist={['https://*']}
              javaScriptEnabled
              domStorageEnabled
              thirdPartyCookiesEnabled
              sharedCookiesEnabled
              mixedContentMode="never"
              setSupportMultipleWindows={false}
              onMessage={handleWebMessage}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setFailed(true);
              }}
              onHttpError={({ nativeEvent }) => {
                if (nativeEvent.statusCode >= 500) {
                  setLoading(false);
                  setFailed(true);
                }
              }}
              style={styles.webView}
            />
            {loading && (
              <View style={styles.loadingPanel} pointerEvents="none">
                <Text style={styles.loadingText}>Connexion au studio…</Text>
              </View>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StudioApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#8E0025' },
  header: {
    minHeight: 80,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#A8002A',
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D8476B',
  },
  logo: { width: 56, height: 56, borderRadius: 15 },
  titleBlock: { flex: 1, minWidth: 92, marginLeft: 10 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  subtitle: { color: '#FFD4DF', fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 2 },
  pushControl: { alignItems: 'flex-end' },
  pushLabel: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  pushRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pushStatus: { color: '#FFD4DF', fontSize: 9, maxWidth: 86, textAlign: 'right' },
  webFrame: { flex: 1, backgroundColor: '#F7F2F4' },
  webView: { flex: 1, backgroundColor: '#F7F2F4' },
  loadingPanel: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F2F4',
  },
  loadingText: { color: '#A8002A', fontSize: 14, fontWeight: '800' },
  errorPanel: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  errorTitle: { color: '#2A171C', fontSize: 22, fontWeight: '900' },
  errorText: { color: '#74636A', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  retryButton: { marginTop: 20, minHeight: 48, paddingHorizontal: 24, borderRadius: 24, backgroundColor: '#EF003D', alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#FFFFFF', fontWeight: '900' },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
});
