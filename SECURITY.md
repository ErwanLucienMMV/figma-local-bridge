# Modèle de sécurité

## Périmètre

Le pont relie un agent local explicitement autorisé et un plugin Figma ouvert sur le même ordinateur. Les secrets sont des capacités d’accès temporaires. Ce projet ne protège pas contre un logiciel malveillant exécuté sous le même compte, un administrateur local, un plugin modifié ou la compromission du processus Figma/Node.

Ne pas exposer ce service sur une interface réseau autre que 127.0.0.1, par redirection de port, proxy ou tunnel. HTTP est volontairement limité à la boucle locale ; il n’offre pas de chiffrement contre un processus privilégié capable d’inspecter la machine.

## Barrières mises en place

| Risque | Mesure |
| --- | --- |
| Accès réseau distant | Écoute 127.0.0.1 seulement ; vérification de remoteAddress et Host avec port exact |
| DNS rebinding | Host accepté uniquement pour localhost ou 127.0.0.1 sur le port lié ; secret Bearer obligatoire |
| Requête depuis un site tiers | Origin absent ou exact `null`, `https://figma.com`, `https://www.figma.com` pour l’API plugin ; toute Origin refusée pour l’API agent |
| Iframe Figma à origine opaque | CORS `*`, sans cookies ni credentials CORS, plus clé plugin de 256 bits ; une origine `null` n’est pas une preuve d’identité |
| Confusion des rôles | Deux secrets différents ; la clé agent ne peut distribuer/acquitter une commande, la clé plugin ne peut en soumettre |
| Exécution arbitraire | Liste fermée d’opérations, schéma strict, clés sensibles interdites ; aucun interpréteur de code ou chemin libre de propriété |
| Mauvais document | Session éphémère unique, page fixée et contrôlée lors de la résolution et de l’application ; changement de page = déconnexion |
| Rejeu | ID unique conservé jusqu’à l’arrêt du processus ; remise une seule fois ; accusés idempotents ; aucune reprise automatique après crash |
| Choix du mode d’application | Mode automatique demandé par l’utilisateur, activé par défaut ; mode manuel disponible dans l’UI locale ; contrôles de page/verrouillages/opérations inchangés |
| Création dans un mauvais parent | PAGE/FRAME ordinaires seulement, page et verrouillages revérifiés après prévalidation ; composants/instances exclus des nouvelles opérations |
| Nœud parasite après erreur | Validation des parents/polices avant création ; nettoyage limité au nouveau nœud de l’opération ; ID signalé si ce nettoyage échoue |
| Versions incompatibles | Révision annoncée par le plugin ; client et pont refusent les nouvelles opérations pour une ancienne session |
| Lecture excessive | Navigation non récursive paginée à 10 enfants, détails limités à 5 nœuds, marqueurs explicites de valeurs mixtes/indisponibles/tronquées |
| Saturation | Corps de 64 Kio, délais HTTP, 32 connexions et commandes actives, 200 requêtes par 10 s, historique limité à 2 048 IDs |
| Injection dans l’interface | Affichage via textContent, contrôle de la source parmi les ancêtres hôtes Figma et de l’origine Figma/opaque, pas d’HTML issu d’une commande |

Les OPTIONS sans secret servent seulement à la négociation CORS ; ils ne distribuent ni commande, ni données du document. Le CORS ne remplace pas l’authentification. L’en-tête de réseau privé éventuel n’est accordé qu’après contrôle Host/Origin.

Les changements sont prévalidés, mais une erreur d’API peut laisser une modification partielle. Le statut `unknown` décrit une incertitude de transport ; ce n’est pas une garantie d’absence d’effet. Vérifier le document avant toute tentative de remplacement.

En version 1.1.1, la connexion du plugin permet par défaut à l’agent authentifié de faire appliquer les commandes autorisées sans clic supplémentaire. Décochez « Appliquer automatiquement les modifications » pour remettre les prochains lots en validation manuelle. Cette préférence n’est jamais fournie par une commande HTTP de l’agent. Un lot commencé finit selon son mode initial ; un lot déjà en attente conserve sa validation manuelle. Le réglage est en mémoire, sans élargir l’accès à une autre page, au réseau ou aux opérations disponibles.

La version 1.1.0 ne propose toujours ni suppression de calque existant, ni duplication de sous-arbre, ni détachement d’instance, ni parcours complet du document, ni export vers un chemin arbitraire. L’API de nettoyage interne ne reçoit jamais d’ID de suppression fourni par une commande : elle ne manipule que la référence du nœud tout juste créé par l’opération en échec. Une création précédente réussie d’un lot n’est pas annulée automatiquement.

## Secrets et données

- Les secrets ne figurent ni dans les sources, ni dans les exemples, ni dans l’archive livrée. Ils sont renouvelés au démarrage, ne transitent jamais dans une URL et ne sont pas stockés dans le document Figma.
- La clé plugin est affichée dans le terminal de démarrage et saisie dans un champ mot de passe de l’UI. Éviter de partager le terminal ou ses captures. La fermeture de la session détruit la référence en mémoire du plugin ; les anciennes clés cessent de fonctionner à l’arrêt du serveur.
- `.local/agent.json` contient la clé agent en clair pour le client local. Il est ignoré par Git. Sur POSIX, le dossier/fichier sont créés avec modes 0700/0600. **Sous Windows, ces modes ne remplacent pas les ACL NTFS** : conserver le projet dans un dossier privé de votre compte et vérifier les droits dans Propriétés → Sécurité avant un usage sensible. Le programme ne modifie pas vos ACL automatiquement.
- Le fichier `.gitignore` exclut aussi les fichiers `.env` (hors modèles explicitement nommés `.example`), les noms courants de fichiers de clés/identifiants, les dossiers personnels `commands/`, `private/`, `screenshots/`, `recordings/`, `exports/`, `logs/` et le guide personnel `docs/PORTFOLIO.md`. Le guide reste disponible localement avec un chemin générique et ne doit pas être distribué dans une archive publique.
- Ces règles ne détectent pas les secrets écrits dans un fichier source autorisé et ne retirent pas un fichier déjà suivi par Git. Vérifier les changements indexés avant publication ; ne pas utiliser un ajout forcé pour inclure un fichier privé.
- Les commandes et résultats restent en mémoire jusqu’à l’arrêt ; aucun journal de contenu n’est écrit par le serveur. Le client affiche les résultats, qui peuvent inclure les textes sélectionnés. Un agent local peut ensuite transmettre ce contexte à son service : cela relève de sa configuration et de votre autorisation.
- Le fichier d’identifiants peut rester sur disque après l’arrêt, mais sa clé n’est plus utilisable par un pont redémarré. Le supprimer manuellement si vous archivez ou partagez le projet après usage.
- Aucun appel OpenAI, service cloud, télémétrie, CDN, import de bibliothèque ou téléchargement de police n’est effectué par ce projet. La synchronisation habituelle du document Figma dépend de Figma.

Pour étendre les opérations : modifier le validateur partagé et le moteur explicitement, ajouter des tests des limites, reconstruire. Ne jamais ajouter une commande générique `eval`, `script`, `shell`, `setProperty(path,value)` ou une URL contrôlée par l’agent.
