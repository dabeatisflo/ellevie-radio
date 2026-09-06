# Sécurité et modération

## Principes appliqués

- Aucun envoi de fichier : l'API accepte uniquement un petit objet JSON et refuse les requêtes de plus de 12 Ko.
- Le message est limité à 500 caractères et le prénom à 40 caractères.
- Turnstile est obligatoirement validé par le serveur.
- Une limite grossière protège la vérification, puis des limites strictes s'appliquent aux messages acceptés.
- Les liens, coordonnées, messages répétitifs, menaces, spam et termes inappropriés sont mis en quarantaine.
- Les doublons du même expéditeur dans une fenêtre d'une heure ne sont pas enregistrés une seconde fois.
- L'interface studio insère le contenu avec `textContent` et n'interprète jamais le message comme du HTML.
- Les écritures exigent une origine autorisée et les cookies de session sont `HttpOnly` et `SameSite=Strict`.
- Les secrets sont fournis comme secrets Cloudflare, jamais dans le dépôt ou dans le navigateur.
- Les données expirées sont supprimées quotidiennement.

## Limites connues

Un filtre automatique sans service d'intelligence artificielle ne peut pas comprendre parfaitement toutes les formulations. Les messages suspects sont donc isolés et ne sont jamais publiés automatiquement. L'équipe du studio reste responsable de la décision de lire un message à l'antenne.

Le blocage d'un expéditeur utilise une empreinte pseudonyme de son adresse réseau et de son navigateur. Une personne déterminée peut changer de réseau ou d'appareil. Turnstile et les limites d'envoi réduisent ce risque sans pouvoir le supprimer entièrement.

## Avant la production

- Utiliser un mot de passe studio unique d'au moins 16 caractères.
- Générer un secret d'empreinte aléatoire d'au moins 32 caractères.
- Créer de vraies clés Turnstile limitées au domaine retenu.
- Remplacer l'identifiant D1 nul.
- Vérifier les origines autorisées.
- Ajouter une adresse de contact réelle à la page de confidentialité.
- Effectuer un test d'envoi, de quarantaine, de session expirée et de suppression.
