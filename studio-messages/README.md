# Ellevie Studio Messages

Service séparé pour envoyer des messages texte à l'équipe d'Ellevie Radio. Ce projet ne modifie ni le site public existant, ni l'application mobile existante.

## Fonctionnalités

- Formulaire conversationnel en français, prévu pour une future intégration dans l'application.
- Texte uniquement : aucune photo, vidéo, pièce jointe ou note vocale.
- Vérification anti-robot Cloudflare Turnstile, validée côté serveur.
- Limitation à un envoi toutes les deux minutes et dix envois par jour par empreinte anonymisée.
- Détection de liens, spam, menaces, répétitions et langage inapproprié.
- Messages suspects isolés dans la rubrique « À vérifier ».
- Tableau de bord studio privé avec actualisation toutes les cinq secondes.
- Actions Lu, Archivé et Bloqué.
- Sessions studio `HttpOnly`, `SameSite=Strict`, expiration après 12 heures.
- Aucun mot de passe ni secret dans le JavaScript public.
- Suppression automatique des messages après 30 jours.
- Aucun stockage de l'adresse IP brute dans la boîte de réception.
- En-têtes CSP, HSTS, anti-framing et anti-MIME-sniffing.

## Architecture

- Cloudflare Worker : API, filtrage et authentification.
- Cloudflare D1 : messages, limites d'envoi et sessions.
- Cloudflare Turnstile : protection contre les robots.
- Static Assets : formulaire auditrice et écran privé du studio.

## Développement local

Prérequis : Node.js 20 ou plus récent.

1. Copier `.dev.vars.example` vers `.dev.vars`.
2. Remplacer les deux premiers secrets par des valeurs longues et uniques.
3. Installer les dépendances avec `npm install`.
4. Créer la base locale avec `npm run db:migrate:local`.
5. Démarrer avec `npm run dev`.
6. Ouvrir `http://localhost:8787/envoyer` et `http://localhost:8787/studio`.

La configuration locale utilise les clés de test officielles de Turnstile. Elles ne doivent jamais être utilisées en production.

## Déploiement Cloudflare

Avant tout déploiement :

1. Créer un compte Cloudflare gratuit.
2. Créer une base D1 nommée `ellevie-studio`.
3. Remplacer le `database_id` nul dans `wrangler.jsonc` par l'identifiant réel.
4. Créer un widget Turnstile pour le futur domaine du formulaire.
5. Remplacer `TURNSTILE_SITE_KEY` dans `wrangler.jsonc`.
6. Enregistrer les secrets avec `wrangler secret put` :
   - `ADMIN_PASSWORD`
   - `IP_HASH_SECRET`
   - `TURNSTILE_SECRET_KEY`
7. Appliquer la migration distante avec `npm run db:migrate:remote`.
8. Déployer avec `npm run deploy`.

Le domaine `studio.ellevie.fr` ne doit être configuré qu'après validation explicite du propriétaire. Le mot de passe studio doit comporter au moins 16 caractères et ne doit être réutilisé nulle part ailleurs.

## Intégration mobile ultérieure

Après validation du service déployé, l'application pourra ouvrir la route `/envoyer?source=app` dans une WebView sécurisée. Cela garde le contrôle Turnstile dans un environnement navigateur. Aucune modification de l'application n'est incluse dans ce projet.

## Notes de confidentialité

La page `/confidentialite` décrit les données traitées et les durées de conservation. Avant la mise en production, il faudra ajouter les coordonnées réelles du responsable du traitement et une adresse de contact pour les demandes d'accès ou de suppression.
