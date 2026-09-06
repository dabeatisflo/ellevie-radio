# ellevie Radio Messages — application Android et iPhone

Version séparée de l’application mobile officielle d’**ellevie Radio**, réalisée avec Expo/React Native pour Android et iOS. Cette copie ne remplace ni l’application originale, ni le site public.

## Fonctionnalités de la version 1

- écoute du direct `https://stream.zeno.fm/5ct6gd3f0rhvv` ;
- lecture en arrière-plan ;
- commandes depuis l’écran verrouillé et le centre de contrôle ;
- lecteur persistant pendant la navigation dans l’application ;
- messages texte vers le studio dans une conversation intégrée ;
- aucun envoi de photo, vidéo, fichier ou note vocale ;
- réglage du volume ;
- grille complète des programmes ;
- présentation des animatrices ;
- interface entièrement en français ;
- politique de confidentialité consultable dans l’application ;
- aucun compte et aucun suivi publicitaire.

## Installation locale

Prérequis : Node.js 20 ou plus récent.

```bash
npm install
npx expo start
```

La lecture en arrière-plan et les commandes de l’écran verrouillé nécessitent une **development build** ou une build de production ; Expo Go ne permet pas de valider toute la configuration native.

## Vérifications

```bash
npm run check
npx expo-doctor
```

## Builds de test

Installer EAS CLI puis se connecter à un compte Expo :

```bash
npm install --global eas-cli
eas login
eas build --platform android --profile preview
eas build --platform ios --profile preview
```

La build Android `preview` produit un APK installable. Pour installer une build iPhone hors App Store, les appareils de test doivent être enregistrés dans le compte Apple Developer.

## Publication

Les identifiants d’application sont déjà préparés :

- Android : `fr.ellevie.radio.messages`
- iOS : `fr.ellevie.radio.messages`

Ces identifiants différents permettent d’installer cette version à côté de l’application originale sans l’écraser.

La publication nécessite les comptes propriétaires Google Play Console et Apple Developer d’Ellevie.

## Contenu exclu de cette version

- demandes de chansons ;
- minuterie de sommeil ;
- assistant IA Élodie.
