# Vérifications de la livraison

Date : 22 novembre 2026. Environnement de vérification : Windows, Node.js v20.15.1, npm 10.7.0.

## Windows clone setup checks — 24 November 2026

The added `setup` and `doctor` commands were verified in a fresh copy with spaces in its Windows folder path, without environment values or third-party dependency installation. Checks passed for repeatable setup, preservation of an existing manifest ID, optional numeric ID configuration, invalid argument rejection, and generated-file consistency. The setup command did not create credentials; those remain generated only by bridge startup.

Connection diagnostics were checked against a temporary authenticated loopback server: missing startup configuration (exit 1), running bridge without a connected plugin (exit 2), a compatible connected plugin (exit 0), and a wrong authentication key (exit 1). Neither generated key appeared in diagnostic output. The plugin session in that connection test was simulated; this does not claim automated Figma Desktop installation or pairing.

## Vérifications réussies

- `npm run build` : génération de `plugin/code.js` et `plugin/ui.html` sans dépendance externe.
- `npm run check` : fichiers générés identiques aux sources attendues.
- `npm test` pour la version 1.1.1 : **47 tests réussis, 0 échec**.
- Démarrage réel du serveur dans un dossier temporaire distinct du projet livré : génération des clés, écriture des identifiants agent, connexion d’un client plugin simulé et arrêt du processus.
- Client CLI réel : commandes `session`, `send` et `status` avec HTTP sur 127.0.0.1 et résultat authentifié.
- Correctif 1.0.1 vérifié dans Figma Desktop 126.12.7 : l’interface affiche la page ouverte et l’identifiant du calque sélectionné après rechargement automatique. La connexion du plugin précédent au vrai pont avait également été confirmée avant la correction, malgré l’absence de retour visuel.

Les tests automatisés couvrent : opérations autorisées et refus de code/champs inconnus, bornes des valeurs, clés de prototype interdites, séparation des secrets, origines et Host, session/page, limite de corps, expiration, absence de redistribution, résultats idempotents, textes/polices vides ou manquantes, calques verrouillés, Auto Layout, mutations partielles, composants/instances/propriétés, absence de divulgation d’un nœud déplacé hors page et interface affichant les commandes comme texte.

Le test de bout en bout exécute le **code du plugin généré**, son interface étant simulée, contre le **vrai serveur HTTP**. Il vérifie une lecture, l’attente de validation, l’application d’un texte, le refus d’une autre commande et le renvoi d’un accusé perdu sans deuxième mutation.

Les extensions testées couvrent aussi les six nouvelles opérations, les détails de `getNodes`, les curseurs périmés, les créations dans un parent/index valides, les polices indisponibles avant toute création, le refus sans nœud parasite, le nettoyage d’un nouveau nœud en échec et le retour de son ID si le nettoyage échoue. Le test de bout en bout vérifie qu’une création ne démarre ni avant validation ni après refus, puis qu’elle réussit après approbation. Les copies de dégradés/aliases/styles compatibles, le refus des surcharges et la conservation des textes lors du redimensionnement sont couverts.

Le mode automatique 1.1.1 est également testé avec le vrai transport HTTP et l’API Figma simulée : texte et cadre appliqués sans clic, verrouillages toujours refusés, bascule automatique/manuelle, maintien de la validation pour un lot déjà en attente, rejet d’un réglage de mode mal formé et refus d’une mutation si la page change pendant le chargement de police. Les tests de validation préalable cités plus haut utilisent explicitement le mode manuel.

## Limites de ces vérifications

L’API Figma est simulée dans les tests automatisés. La lecture de sélection et l’affichage de la page ont ensuite été vérifiés sur un document réel dans Figma Desktop. Aucun test de mutation d’un vrai document n’a été effectué ; poursuivre avec [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) pour vérifier les écritures et les restrictions d’un composant réel.

Les mutations réelles du portfolio sont réservées à l’autre conversation, selon le choix de l’utilisateur. Le mode automatique a ensuite été ajouté à sa demande explicite ; les commandes doivent toujours être précédées d’une inspection et suivies d’une relecture des effets.

Le manifeste est livré sans ID privé attribué par Figma. Si Figma demande cet ID à l’import, le README explique comment en obtenir un et le renseigner avec le script de configuration.

## Correction de l’interface 1.0.1

Le filtre initial exigeait que les messages proviennent du parent immédiat de l’iframe. Figma Desktop utilise plusieurs fenêtres hôtes imbriquées ; ses réponses valides étaient donc ignorées. Le correctif accepte les fenêtres ancêtres hôtes avec une origine Figma connue ou opaque, tout en refusant une fenêtre étrangère et une origine tierce. Le test de l’interface reproduit cette structure à trois ancêtres. Une étiquette « Interface 1.0.1 » permet de reconnaître la version corrigée.
