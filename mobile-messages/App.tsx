import { StatusBar } from 'expo-status-bar';
import {
  AudioModule,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  ImageSourcePropType,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import {
  getCurrentGroup,
  getCurrentProgramme,
  isProgrammeActive,
  PROGRAMME_GROUPS,
  ProgrammeGroup,
} from './src/programs';

const STREAM_URL = 'https://stream.zeno.fm/5ct6gd3f0rhvv';
const MESSAGES_URL = 'https://studio.ellevie.fr/envoyer?source=app&appVersion=1.4.0';
const PUSH_PREFERENCE_KEY = 'ellevie:listener-push-enabled';
const PUSH_CHANNEL_ID = 'studio-replies';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const MICROPHONE_BRIDGE_JS = `
  (function () {
    if (window.__ellevieMicrophoneBridgeInstalled) return true;
    window.__ellevieMicrophoneBridgeInstalled = true;
    window.__ellevieMicrophonePermissionGranted = false;
    document.addEventListener('click', function (event) {
      var target = event.target;
      var button = target && target.closest ? target.closest('#record-button') : null;
      if (!button || window.__ellevieMicrophonePermissionGranted) return;
      event.preventDefault();
      event.stopPropagation();
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'requestMicrophone' }));
      }
    }, true);
    true;
  })();
`;

async function requestExpoPushToken(): Promise<string> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
      name: 'Réponses du studio',
      description: 'Réponses privées envoyées par le studio Ellevie',
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
  if (!permission.granted) {
    throw new Error('permission-denied');
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    throw new Error('project-id-missing');
  }
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

const COLORS = {
  red: '#EF003D',
  redBright: '#FF160D',
  redHot: '#FF0057',
  redDeep: '#B6002D',
  ink: '#23181B',
  cream: '#FFF7F3',
  white: '#FFFFFF',
  pink: '#FFD5DF',
  muted: '#77676C',
  line: '#E9D9DC',
};

type Tab = 'direct' | 'messages' | 'programmes' | 'animatrices';

const HOSTS: {
  name: string;
  moment: string;
  quote: string;
  image: ImageSourcePropType;
  tone: string;
}[] = [
  {
    name: 'Nora',
    moment: 'Matin',
    quote: '« Un réveil en douceur, une journée pleine d’énergie. »',
    image: require('./assets/nora.webp'),
    tone: COLORS.red,
  },
  {
    name: 'Sofia',
    moment: 'Après-midi',
    quote: '« Vos chansons préférées, sans jamais se presser. »',
    image: require('./assets/sofia.webp'),
    tone: '#E33A51',
  },
  {
    name: 'Maya',
    moment: 'Soir',
    quote: '« Des histoires pour accompagner le calme du soir. »',
    image: require('./assets/maya.webp'),
    tone: COLORS.redDeep,
  },
];

function BrandHeader() {
  return (
    <View style={styles.header}>
      <Image
        source={require('./assets/ellevie-logo.webp')}
        style={styles.headerLogo}
        accessibilityLabel="Logo ellevie Radio"
      />
      <View style={styles.headerCopy}>
        <Text style={styles.headerName}>ellevie</Text>
        <Text style={styles.headerTagline}>LADY’S FIRST</Text>
      </View>
      <View style={styles.liveBadge}>
        <View style={styles.liveDot} />
        <Text style={styles.liveBadgeText}>DIRECT</Text>
      </View>
    </View>
  );
}

function DirectScreen({ onListen, playing }: { onListen: () => void; playing: boolean }) {
  const programme = getCurrentProgramme();

  return (
    <View>
      <View style={styles.hero}>
        <View style={[styles.heroOrb, styles.heroOrbOne]} />
        <View style={[styles.heroOrb, styles.heroOrbTwo]} />
        <Text style={styles.eyebrowLight}>LADY’S FIRST</Text>
        <Text style={styles.heroTitle}>La musique qui vous</Text>
        <Text style={styles.heroAccent}>accompagne.</Text>
        <Text style={styles.heroIntro}>
          En route, au travail ou pendant ce moment rien qu’à vous. Votre radio feel good,
          partout avec vous.
        </Text>

        <View style={styles.moodRow}>
          {['Feel good', 'Pop', 'Histoires'].map((mood) => (
            <View key={mood} style={styles.moodPill}>
              <Text style={styles.moodText}>{mood}</Text>
            </View>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Mettre ellevie en pause' : 'Écouter ellevie en direct'}
          onPress={onListen}
          style={({ pressed }) => [styles.heroButton, pressed && styles.pressed]}
        >
          <Text style={styles.heroButtonIcon}>{playing ? 'Ⅱ' : '▶'}</Text>
          <Text style={styles.heroButtonText}>{playing ? 'Mettre en pause' : 'Écouter en direct'}</Text>
        </Pressable>
      </View>

      <View style={styles.contentSection}>
        <Text style={styles.eyebrowRed}>EN CE MOMENT</Text>
        <View style={styles.nowCard}>
          <Image source={require('./assets/ellevie-logo.webp')} style={styles.nowArtwork} />
          <View style={styles.nowCopy}>
            <Text style={styles.nowTime}>{programme.time}</Text>
            <Text style={styles.nowTitle}>{programme.title}</Text>
            <Text style={styles.nowSubtitle}>En direct sur ellevie Radio</Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, styles.sectionTitleSpacing]}>Votre radio, votre rythme.</Text>
        <Text style={styles.bodyText}>
          Une sélection pop chaleureuse, des voix familières et la bonne énergie pour chaque
          moment de la journée.
        </Text>
      </View>
    </View>
  );
}

function ProgrammesScreen() {
  const currentGroup = getCurrentGroup();
  const [selectedId, setSelectedId] = useState<ProgrammeGroup['id']>(currentGroup.id);
  const selectedGroup =
    PROGRAMME_GROUPS.find((group) => group.id === selectedId) ?? PROGRAMME_GROUPS[0];

  return (
    <View style={styles.page}>
      <Text style={styles.eyebrowRed}>VOTRE SEMAINE SUR ELLEVIE</Text>
      <Text style={styles.pageTitle}>Grille des programmes</Text>
      <Text style={styles.pageIntro}>Retrouvez le rythme d’Ellevie à chaque moment de la semaine.</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dayTabs}
      >
        {PROGRAMME_GROUPS.map((group) => {
          const selected = group.id === selectedGroup.id;
          return (
            <Pressable
              key={group.id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setSelectedId(group.id)}
              style={[styles.dayTab, selected && styles.dayTabSelected]}
            >
              <Text style={[styles.dayTabText, selected && styles.dayTabTextSelected]}>
                {group.shortLabel}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.scheduleDay}>{selectedGroup.title}</Text>
      <View style={styles.scheduleList}>
        {selectedGroup.programmes.map((item) => {
          const active = selectedGroup.id === currentGroup.id && isProgrammeActive(item);
          return (
            <View key={`${selectedGroup.id}-${item.time}`} style={[styles.slot, active && styles.slotActive]}>
              <View style={[styles.slotMarker, active && styles.slotMarkerActive]} />
              <View style={styles.slotCopy}>
                <Text style={[styles.slotTime, active && styles.slotTimeActive]}>{item.time}</Text>
                <Text style={[styles.slotTitle, active && styles.slotTitleActive]}>{item.title}</Text>
                {active && <Text style={styles.onAirText}>● EN DIRECT</Text>}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

type MessagesScreenProps = {
  pushEnabled: boolean;
  pushBusy: boolean;
  pushStatus: string;
  pushToken: string | null;
  onTogglePush: (enabled: boolean) => void;
};

function MessagesScreen({
  pushEnabled,
  pushBusy,
  pushStatus,
  pushToken,
  onTogglePush,
}: MessagesScreenProps) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const webViewRef = useRef<WebView>(null);

  const sendPushStateToWeb = useCallback(() => {
    webViewRef.current?.postMessage(JSON.stringify({
      type: 'setListenerPushToken',
      enabled: pushEnabled,
      token: pushToken,
      platform: Platform.OS,
    }));
  }, [pushEnabled, pushToken]);

  useEffect(() => {
    if (!loading) sendPushStateToWeb();
  }, [loading, sendPushStateToWeb]);

  const handleWebMessage = async (event: WebViewMessageEvent) => {
    let message: { type?: string; enabled?: boolean; error?: string } = {};
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (message.type === 'listenerReady') {
      sendPushStateToWeb();
      return;
    }
    if (message.type !== 'requestMicrophone') return;

    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Microphone non autorisé',
        'Activez le microphone dans les paramètres Android pour envoyer un message vocal.',
      );
      return;
    }
    webViewRef.current?.injectJavaScript(`
      window.__ellevieMicrophonePermissionGranted = true;
      window.dispatchEvent(new Event('ellevieMicrophonePermissionGranted'));
      setTimeout(function () {
        var button = document.getElementById('record-button');
        if (button) button.click();
      }, 0);
      true;
    `);
  };

  const retry = () => {
    setFailed(false);
    setLoading(true);
    setReloadKey((value) => value + 1);
  };

  return (
    <View style={styles.messagesScreen}>
      <View style={styles.messagesPageHeader}>
        <View style={styles.messagesTitleBlock}>
          <Text style={styles.messagesPageTitle}>MESSAGES</Text>
          <Text style={styles.notificationStatus}>{pushStatus}</Text>
        </View>
        <View style={styles.notificationToggle}>
          <Text style={styles.notificationToggleLabel}>Notifications</Text>
          <Switch
            accessibilityLabel="Activer ou désactiver les notifications de réponse"
            disabled={pushBusy}
            onValueChange={onTogglePush}
            value={pushEnabled}
            trackColor={{ false: '#D7C9CD', true: '#F888A4' }}
            thumbColor={pushEnabled ? COLORS.red : '#F5F0F1'}
          />
        </View>
      </View>

      <View style={styles.messagesWebviewFrame}>
        {failed ? (
          <View style={styles.messagesError}>
            <Text style={styles.messagesErrorTitle}>Impossible d’ouvrir les messages</Text>
            <Text style={styles.messagesErrorText}>
              Vérifiez votre connexion internet, puis réessayez.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Réessayer d’ouvrir les messages"
              onPress={retry}
              style={({ pressed }) => [styles.messagesRetry, pressed && styles.pressed]}
            >
              <Text style={styles.messagesRetryText}>Réessayer</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <WebView
              ref={webViewRef}
              key={reloadKey}
              source={{ uri: MESSAGES_URL }}
              originWhitelist={['https://*']}
              javaScriptEnabled
              domStorageEnabled
              thirdPartyCookiesEnabled
              sharedCookiesEnabled
              mixedContentMode="never"
              setSupportMultipleWindows={false}
              mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
              allowsBackForwardNavigationGestures
              injectedJavaScriptBeforeContentLoaded={MICROPHONE_BRIDGE_JS}
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
              style={styles.messagesWebview}
              accessibilityLabel="Conversation avec le studio Ellevie"
            />
            {loading && (
              <View style={styles.messagesLoading} pointerEvents="none">
                <Text style={styles.messagesLoadingText}>Connexion au studio…</Text>
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

function AnimatricesScreen() {
  const [showPrivacy, setShowPrivacy] = useState(false);

  return (
    <View style={styles.page}>
      <Text style={styles.eyebrowRed}>NOS VOIX</Text>
      <Text style={styles.pageTitle}>Familières dès le premier mot.</Text>
      <Text style={styles.pageIntro}>
        Proches, curieuses et toujours avec la bonne chanson au bon moment.
      </Text>

      <View style={styles.hostList}>
        {HOSTS.map((host) => (
          <View key={host.name} style={[styles.hostCard, { backgroundColor: host.tone }]}>
            <Image source={host.image} style={styles.hostImage} />
            <View style={styles.hostCopy}>
              <Text style={styles.hostMoment}>{host.moment.toUpperCase()}</Text>
              <Text style={styles.hostName}>{host.name}</Text>
              <Text style={styles.hostQuote}>{host.quote}</Text>
            </View>
          </View>
        ))}
      </View>

      <Pressable
        accessibilityRole="link"
        onPress={() => Linking.openURL('https://ellevie.fr')}
        style={({ pressed }) => [styles.websiteButton, pressed && styles.pressed]}
      >
        <Text style={styles.websiteButtonText}>Visiter ellevie.fr</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showPrivacy }}
        onPress={() => setShowPrivacy((visible) => !visible)}
        style={({ pressed }) => [styles.privacyButton, pressed && styles.pressed]}
      >
        <Text style={styles.privacyButtonText}>
          {showPrivacy ? 'Fermer la confidentialité' : 'Confidentialité'}
        </Text>
      </Pressable>

      {showPrivacy && (
        <View style={styles.privacyCard}>
          <Text style={styles.privacyTitle}>Respect de votre vie privée</Text>
          <Text style={styles.privacyText}>
            L’application ellevie Radio ne demande aucun compte. Pour diffuser le direct, elle se
            connecte au service de streaming Zeno Media, qui peut recevoir des données techniques
            comme l’adresse IP et l’heure de connexion selon sa propre politique.
          </Text>
          <Text style={styles.privacyText}>
            Lorsque vous écrivez au studio, votre prénom, votre message et une empreinte technique
            anonymisée de sécurité sont conservés au maximum 30 jours. Les messages ne sont pas
            publics. L’application n’utilise ni publicité personnalisée, ni géolocalisation, ni
            carnet d’adresses. Le microphone n’est utilisé que lorsque vous choisissez d’enregistrer
            un message vocal. Les notifications de réponse sont facultatives et peuvent être
            désactivées dans l’onglet Messages. Pour toute question : contact@ellevie.fr.
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => Linking.openURL('mailto:contact@ellevie.fr')}
            style={styles.contactLink}
          >
            <Text style={styles.contactLinkText}>Contacter ellevie</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

type PlayerBarProps = {
  playing: boolean;
  buffering: boolean;
  error: string | null;
  volume: number;
  onToggle: () => void;
  onVolume: (value: number) => void;
};

function PlayerBar({
  playing,
  buffering,
  error,
  volume,
  onToggle,
  onVolume,
}: PlayerBarProps) {
  const status = error
    ? 'Direct indisponible'
    : buffering
      ? 'Connexion…'
      : playing
        ? 'Vous écoutez le direct'
        : 'Prête à écouter';

  return (
    <View style={styles.playerBar}>
      <Image source={require('./assets/ellevie-logo.webp')} style={styles.playerLogo} />
      <View style={styles.playerCopy}>
        <Text style={styles.playerLive}>● EN DIRECT</Text>
        <Text style={styles.playerName}>ellevie Radio</Text>
        <Text numberOfLines={1} style={styles.playerStatus}>{status}</Text>
      </View>
      <View style={styles.volumeControl} accessibilityLabel={`Volume ${Math.round(volume * 100)} pour cent`}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Baisser le volume"
          onPress={() => onVolume(Math.max(0, volume - 0.1))}
          style={styles.volumeButton}
        >
          <Text style={styles.volumeButtonText}>−</Text>
        </Pressable>
        <View style={styles.volumeRail}>
          <View style={[styles.volumeFill, { width: `${Math.round(volume * 100)}%` }]} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Augmenter le volume"
          onPress={() => onVolume(Math.min(1, volume + 0.1))}
          style={styles.volumeButton}
        >
          <Text style={styles.volumeButtonText}>+</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Mettre ellevie en pause' : 'Écouter ellevie en direct'}
        accessibilityState={{ selected: playing }}
        onPress={onToggle}
        style={({ pressed }) => [styles.playerToggle, pressed && styles.pressed]}
      >
        <Text style={styles.playerToggleText}>{playing ? 'Ⅱ' : '▶'}</Text>
      </Pressable>
    </View>
  );
}

function TabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'direct', icon: '●', label: 'Accueil' },
    { id: 'messages', icon: '✉', label: 'Messages' },
    { id: 'programmes', icon: '▤', label: 'Programmes' },
    { id: 'animatrices', icon: '♥', label: 'Animatrices' },
  ];

  return (
    <View style={styles.tabBar} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.id)}
            style={styles.tabButton}
          >
            <Text style={[styles.tabIcon, selected && styles.tabActive]}>{tab.icon}</Text>
            <Text style={[styles.tabLabel, selected && styles.tabActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function RadioApp() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('direct');
  const [volume, setVolume] = useState(0.8);
  const [localError, setLocalError] = useState<string | null>(null);
  const [playbackRequested, setPlaybackRequested] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushStatus, setPushStatus] = useState('Notifications désactivées');
  const [pushToken, setPushToken] = useState<string | null>(null);
  const player = useAudioPlayer(STREAM_URL, { updateInterval: 500 });
  const playerStatus = useAudioPlayerStatus(player);

  const currentProgramme = useMemo(() => getCurrentProgramme(new Date(clock)), [clock]);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => setLocalError('La lecture en arrière-plan n’a pas pu être activée.'));
  }, []);

  useEffect(() => {
    player.volume = volume;
  }, [player, volume]);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const enablePushNotifications = useCallback(async (interactive: boolean) => {
    setPushBusy(true);
    setPushStatus('Activation…');
    try {
      const token = await requestExpoPushToken();
      setPushToken(token);
      setPushEnabled(true);
      setPushStatus('Notifications activées');
      await AsyncStorage.setItem(PUSH_PREFERENCE_KEY, 'true');
    } catch (error) {
      setPushEnabled(false);
      const denied = error instanceof Error && error.message === 'permission-denied';
      setPushStatus(denied ? 'Autorisation refusée' : 'Notifications indisponibles');
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
        setPushStatus('Notifications désactivées');
      })
      .catch(() => setPushStatus('Notifications désactivées'));
  }, [enablePushNotifications]);

  useEffect(() => {
    const openMessages = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const data = response.notification.request.content.data;
      if (data?.screen === 'messages' || data?.type === 'studioReply') setTab('messages');
    };
    Notifications.getLastNotificationResponseAsync().then(openMessages).catch(() => null);
    const subscription = Notifications.addNotificationResponseReceivedListener(openMessages);
    return () => subscription.remove();
  }, []);

  const togglePushNotifications = useCallback((enabled: boolean) => {
    if (enabled) {
      void enablePushNotifications(true);
      return;
    }
    setPushEnabled(false);
    setPushStatus('Notifications désactivées');
    AsyncStorage.setItem(PUSH_PREFERENCE_KEY, 'false').catch(() => null);
  }, [enablePushNotifications]);

  useEffect(() => {
    if (!playerStatus.playing) return;
    player.updateLockScreenMetadata({
      title: currentProgramme.title,
      artist: 'ellevie Radio',
      albumTitle: 'Lady’s First',
      artworkUrl: 'https://ellevie.fr/assets/ellevie-logo.webp',
    });
  }, [currentProgramme.title, player, playerStatus.playing]);

  useEffect(() => {
    if (playerStatus.error) setLocalError(playerStatus.error);
    if (playerStatus.playing) {
      setLocalError(null);
      setPlaybackRequested(false);
    }
  }, [playerStatus.error, playerStatus.playing]);

  const togglePlayback = () => {
    try {
      setLocalError(null);
      if (playerStatus.playing) {
        player.pause();
        setPlaybackRequested(false);
        return;
      }

      setPlaybackRequested(true);
      player.setActiveForLockScreen(true, {
        title: currentProgramme.title,
        artist: 'ellevie Radio',
        albumTitle: 'Lady’s First',
        artworkUrl: 'https://ellevie.fr/assets/ellevie-logo.webp',
      }, {
        isLiveStream: true,
        showSeekBackward: false,
        showSeekForward: false,
      });
      player.play();
    } catch {
      setPlaybackRequested(false);
      setLocalError('Le direct ne peut pas être lu pour le moment.');
    }
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.app}>
      <StatusBar style="dark" />
      {tab !== 'messages' && <BrandHeader />}
      {tab === 'messages' ? (
        <MessagesScreen
          pushEnabled={pushEnabled}
          pushBusy={pushBusy}
          pushStatus={pushStatus}
          pushToken={pushToken}
          onTogglePush={togglePushNotifications}
        />
      ) : (
        <ScrollView
          key={tab}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {tab === 'direct' && <DirectScreen onListen={togglePlayback} playing={playerStatus.playing} />}
          {tab === 'programmes' && <ProgrammesScreen />}
          {tab === 'animatrices' && <AnimatricesScreen />}
        </ScrollView>
      )}
      <View style={[styles.bottomDock, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {tab !== 'messages' && (
          <PlayerBar
            playing={playerStatus.playing}
            buffering={playbackRequested || (playerStatus.playing && playerStatus.isBuffering)}
            error={localError}
            volume={volume}
            onToggle={togglePlayback}
            onVolume={setVolume}
          />
        )}
        <TabBar active={tab} onChange={setTab} />
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <RadioApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: COLORS.cream },
  header: {
    minHeight: 82,
    paddingHorizontal: 18,
    paddingVertical: 8,
    backgroundColor: COLORS.white,
    borderBottomColor: COLORS.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLogo: { width: 66, height: 66, borderRadius: 18 },
  headerCopy: { flex: 1, marginLeft: 11 },
  headerName: { color: COLORS.red, fontSize: 26, fontWeight: '900', letterSpacing: -1.2 },
  headerTagline: { color: COLORS.redDeep, fontSize: 10, fontWeight: '800', letterSpacing: 1.8 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF0F3',
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 999,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.red },
  liveBadgeText: { color: COLORS.redDeep, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  hero: {
    minHeight: 470,
    paddingHorizontal: 24,
    paddingTop: 42,
    paddingBottom: 38,
    backgroundColor: COLORS.red,
    overflow: 'hidden',
  },
  heroOrb: { position: 'absolute', borderRadius: 999, borderWidth: 1, borderColor: '#FFFFFF44' },
  heroOrbOne: { width: 330, height: 330, right: -145, top: -120, backgroundColor: '#FF005733' },
  heroOrbTwo: { width: 260, height: 260, left: -155, bottom: -150, backgroundColor: '#B6002D33' },
  eyebrowLight: { color: COLORS.white, fontSize: 12, fontWeight: '900', letterSpacing: 2.1, marginBottom: 16 },
  eyebrowRed: { color: COLORS.red, fontSize: 11, fontWeight: '900', letterSpacing: 1.8, marginBottom: 10 },
  heroTitle: { color: COLORS.white, fontSize: 42, lineHeight: 44, fontWeight: '900', letterSpacing: -2.1 },
  heroAccent: {
    color: COLORS.pink,
    fontSize: 46,
    lineHeight: 49,
    fontFamily: 'serif',
    fontStyle: 'italic',
    fontWeight: '600',
    letterSpacing: -2.1,
    marginBottom: 22,
  },
  heroIntro: { color: COLORS.white, fontSize: 16, lineHeight: 25, maxWidth: 560, opacity: 0.96 },
  moodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 22 },
  moodPill: { borderRadius: 999, borderWidth: 1, borderColor: '#FFFFFF66', paddingHorizontal: 13, paddingVertical: 7 },
  moodText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  heroButton: {
    marginTop: 30,
    minHeight: 58,
    paddingHorizontal: 21,
    borderRadius: 999,
    backgroundColor: COLORS.white,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 12,
    shadowColor: COLORS.redDeep,
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 9 },
    elevation: 6,
  },
  heroButtonIcon: { color: COLORS.red, fontSize: 20 },
  heroButtonText: { color: COLORS.redDeep, fontSize: 16, fontWeight: '900' },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  contentSection: { paddingHorizontal: 20, paddingVertical: 34 },
  nowCard: {
    padding: 12,
    borderRadius: 24,
    backgroundColor: COLORS.white,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
    shadowColor: '#520014',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  nowArtwork: { width: 94, height: 94, borderRadius: 19 },
  nowCopy: { flex: 1, marginLeft: 15 },
  nowTime: { color: COLORS.red, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  nowTitle: { color: COLORS.ink, fontSize: 20, lineHeight: 24, fontWeight: '900', marginTop: 5 },
  nowSubtitle: { color: COLORS.muted, fontSize: 13, marginTop: 6 },
  sectionTitle: { color: COLORS.ink, fontSize: 28, lineHeight: 32, fontWeight: '900', letterSpacing: -1.1 },
  sectionTitleSpacing: { marginTop: 34 },
  bodyText: { color: COLORS.muted, fontSize: 15, lineHeight: 24, marginTop: 11, marginBottom: 22 },
  messagesScreen: { flex: 1, backgroundColor: COLORS.white },
  messagesPageHeader: {
    minHeight: 82,
    paddingHorizontal: 20,
    backgroundColor: COLORS.white,
    borderBottomColor: COLORS.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  messagesTitleBlock: { flex: 1, paddingRight: 12 },
  messagesPageTitle: {
    color: COLORS.ink,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  notificationStatus: { color: COLORS.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  notificationToggle: { alignItems: 'center', justifyContent: 'center' },
  notificationToggleLabel: { color: COLORS.ink, fontSize: 10, fontWeight: '800', marginBottom: 1 },
  messagesWebviewFrame: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: COLORS.white,
  },
  messagesWebview: { flex: 1, backgroundColor: COLORS.white },
  messagesLoading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
  },
  messagesLoadingText: { color: COLORS.redDeep, fontSize: 14, fontWeight: '800' },
  messagesError: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  messagesErrorTitle: {
    color: COLORS.ink,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '900',
    textAlign: 'center',
  },
  messagesErrorText: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 9,
  },
  messagesRetry: {
    minHeight: 48,
    paddingHorizontal: 24,
    borderRadius: 999,
    backgroundColor: COLORS.red,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  messagesRetryText: { color: COLORS.white, fontSize: 14, fontWeight: '900' },
  page: { paddingHorizontal: 20, paddingTop: 32, paddingBottom: 42 },
  pageTitle: { color: COLORS.ink, fontSize: 34, lineHeight: 38, fontWeight: '900', letterSpacing: -1.5 },
  pageIntro: { color: COLORS.muted, fontSize: 15, lineHeight: 23, marginTop: 12, marginBottom: 24 },
  dayTabs: { gap: 8, paddingBottom: 4 },
  dayTab: { paddingVertical: 11, paddingHorizontal: 17, borderRadius: 999, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line },
  dayTabSelected: { backgroundColor: COLORS.red, borderColor: COLORS.red },
  dayTabText: { color: COLORS.ink, fontSize: 13, fontWeight: '800' },
  dayTabTextSelected: { color: COLORS.white },
  scheduleDay: { color: COLORS.ink, fontSize: 19, fontWeight: '900', marginTop: 27, marginBottom: 13 },
  scheduleList: { gap: 10 },
  slot: {
    minHeight: 79,
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.line,
    overflow: 'hidden',
  },
  slotActive: { backgroundColor: '#FFF0F4', borderColor: COLORS.red },
  slotMarker: { width: 5, backgroundColor: '#E9D9DC' },
  slotMarkerActive: { backgroundColor: COLORS.red },
  slotCopy: { flex: 1, paddingHorizontal: 15, paddingVertical: 12 },
  slotTime: { color: COLORS.muted, fontSize: 12, fontWeight: '800' },
  slotTimeActive: { color: COLORS.redDeep },
  slotTitle: { color: COLORS.ink, fontSize: 17, lineHeight: 21, fontWeight: '800', marginTop: 4 },
  slotTitleActive: { color: COLORS.redDeep },
  onAirText: { color: COLORS.red, fontSize: 9, fontWeight: '900', letterSpacing: 0.8, marginTop: 5 },
  hostList: { gap: 15 },
  hostCard: { minHeight: 180, borderRadius: 25, overflow: 'hidden', flexDirection: 'row', alignItems: 'stretch' },
  hostImage: { width: '43%', minHeight: 180, resizeMode: 'cover' },
  hostCopy: { flex: 1, justifyContent: 'center', paddingHorizontal: 17, paddingVertical: 18 },
  hostMoment: { color: COLORS.white, opacity: 0.78, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  hostName: { color: COLORS.white, fontSize: 30, fontWeight: '900', letterSpacing: -1, marginTop: 4 },
  hostQuote: { color: COLORS.white, fontSize: 13, lineHeight: 19, marginTop: 8, opacity: 0.96 },
  websiteButton: { minHeight: 52, borderRadius: 999, borderWidth: 2, borderColor: COLORS.red, alignItems: 'center', justifyContent: 'center', marginTop: 26 },
  websiteButtonText: { color: COLORS.red, fontSize: 15, fontWeight: '900' },
  privacyButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  privacyButtonText: { color: COLORS.muted, fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
  privacyCard: { marginTop: 8, padding: 18, borderRadius: 20, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line },
  privacyTitle: { color: COLORS.ink, fontSize: 18, fontWeight: '900', marginBottom: 10 },
  privacyText: { color: COLORS.muted, fontSize: 13, lineHeight: 20, marginBottom: 10 },
  contactLink: { alignSelf: 'flex-start', paddingVertical: 5 },
  contactLinkText: { color: COLORS.red, fontSize: 13, fontWeight: '900' },
  bottomDock: { backgroundColor: COLORS.white, borderTopColor: COLORS.line, borderTopWidth: StyleSheet.hairlineWidth },
  playerBar: { minHeight: 84, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: COLORS.redDeep, flexDirection: 'row', alignItems: 'center' },
  playerLogo: { width: 57, height: 57, borderRadius: 16, borderWidth: 1, borderColor: '#FFFFFF55' },
  playerCopy: { flex: 1, marginLeft: 10, minWidth: 80 },
  playerLive: { color: COLORS.pink, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  playerName: { color: COLORS.white, fontSize: 14, fontWeight: '900', marginTop: 2 },
  playerStatus: { color: COLORS.white, opacity: 0.76, fontSize: 10, marginTop: 2 },
  volumeControl: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 6 },
  volumeButton: { width: 25, height: 32, alignItems: 'center', justifyContent: 'center' },
  volumeButtonText: { color: COLORS.white, fontSize: 20, fontWeight: '700' },
  volumeRail: { width: 36, height: 4, borderRadius: 3, overflow: 'hidden', backgroundColor: '#FFFFFF44' },
  volumeFill: { height: 4, borderRadius: 3, backgroundColor: COLORS.white },
  playerToggle: { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center' },
  playerToggleText: { color: COLORS.redDeep, fontSize: 19, fontWeight: '900', marginLeft: 2 },
  tabBar: { minHeight: 62, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white },
  tabButton: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 7 },
  tabIcon: { color: '#B6A7AB', fontSize: 16, lineHeight: 18, fontWeight: '900' },
  tabLabel: { color: '#8E7E82', fontSize: 10, fontWeight: '800', marginTop: 3 },
  tabActive: { color: COLORS.red },
});
