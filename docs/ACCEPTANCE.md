# Recette manuelle dans Figma Desktop

À effectuer sur une copie de maquette modifiable. Cette liste accompagne les tests automatisés ; elle n’affirme pas qu’un essai réel dans Figma a déjà été réalisé.

Pour tester les scénarios de validation/refus des étapes ci-dessous, décocher d’abord « Appliquer automatiquement les modifications ». Le mode automatique est testé séparément à la fin.

1. Importer `plugin/manifest.json`. Si Figma demande un `id`, utiliser celui attribué à un nouveau plugin de développement puis `npm run configure -- ID`. Lancer le plugin et vérifier que l’interface s’affiche.
2. Exécuter `npm start`. Coller une mauvaise clé plugin et vérifier le refus. Coller la vraie clé et vérifier la page et la session affichées.
3. Créer un texte « Avant » et un rectangle, hors Auto Layout. Sélectionner le texte puis exécuter `node client/cli.mjs send examples/01-selection.json`. Vérifier que la réponse contient son ID et son texte.
4. Adapter l’exemple 02 à cet ID et l’envoyer. Vérifier que le texte ne change **pas avant** le clic Appliquer. Cliquer Appliquer, vérifier le nouveau texte et le statut `succeeded`.
5. Renvoyer une autre intention avec un nouvel ID via le CLI, cliquer Refuser et vérifier l’absence de changement et le statut `rejected`.
6. Adapter l’exemple 03 au rectangle. Appliquer et vérifier la couleur bleue, l’opacité et les coordonnées du parent. Utiliser Annuler dans Figma et observer le retour à l’état précédent.
7. Verrouiller le rectangle et essayer de le déplacer : vérifier un résultat `failed`, sans déplacement. Répéter avec un parent verrouillé, puis avec un enfant en Auto Layout non absolu.
8. Adapter l’exemple 04 au rectangle déverrouillé. Vérifier sa conversion en composant et récupérer `componentId`. Utiliser l’exemple 05 avec ce nouvel ID : vérifier l’instance créée et `instanceId`.
9. Dans Figma, préparer un composant ayant une propriété texte et une propriété booléenne, créer son instance, l’inspecter via l’exemple 07. Copier les noms exacts dans l’exemple 06 et vérifier les mises à jour. Si un composant à variantes est disponible, vérifier aussi une variante valide puis une valeur invalide.
10. Laisser un lot en attente puis changer de page. Vérifier la déconnexion et l’absence de mutation de la nouvelle page ; reconnecter puis relire la sélection.
11. Envoyer une commande puis arrêter le pont avant son accusé. Vérifier que le plugin indique la perte de connexion. Redémarrer, reconnecter avec la nouvelle clé et vérifier la maquette avant toute nouvelle intention : l’ancien historique a disparu.
12. Fermer le plugin ; après 30 secondes, demander `node client/cli.mjs session` et vérifier `session: null`. Arrêter le pont avec Ctrl+C.

Si le réseau local est bloqué par Figma, consulter sa console de développement et le tableau de dépannage du README. Ne pas élargir le manifeste à `*` ou exposer le pont publiquement pour résoudre ce problème.

## Extensions 1.1.0

13. Vérifier `node client/cli.mjs capabilities` et `session` : révision 1.1.0 des deux côtés. Parcourir les enfants de la page ou d’un frame avec l’exemple 08, puis paginer avec `nextCursor`. Vérifier qu’aucun calque ni sélection ne change.
14. Inspecter un frame puis un texte avec `getNodes.details` : comparer dimensions, orientation, marges, remplissages et polices à Figma. Les champs mixtes et non disponibles doivent être identifiés explicitement.
15. Sur deux encarts de test, noter les textes et leurs dimensions. Adapter l’exemple 10 après mesure des contenus, approuver le lot et relire les deux hauteurs. Vérifier que les textes sont identiques et visibles. Tester le refus d’un redimensionnement encore piloté par HUG/FILL.
16. Adapter l’exemple 11 à un parent Auto Layout vertical. Avant validation : aucun nouveau frame. Cliquer Refuser : toujours aucun frame. Envoyer une nouvelle intention puis Appliquer : le frame doit apparaître dans le bon parent avec un ID et un index retournés.
17. Dans ce nouveau frame, créer des TEXT par l’exemple 12 avec une typographie locale uniforme puis avec une police explicite. Les placeholders doivent rester exactement ceux demandés et éditables. Une police manquante doit bloquer la création avant tout nœud parasite.
18. Reprendre un encart sombre à dégradé via l’exemple 13. Vérifier les quatre coins, effets, contours, opacité et références de styles/variables prises en charge, sans changement de source/contenu/enfants. Une source à typographie mixte ou à style surchargé non reproductible doit être refusée, avec un message explicite.
19. Relire les parents, indices, hauteurs et contenus après recalcul, puis examiner une capture locale autorisée. L’export PNG n’est pas inclus dans cette version. Ne pas appliquer cette recette au portfolio réel sans approbation de chaque lot dans le plugin.

## Mode automatique 1.1.1

20. Sur la copie de test, cocher « Appliquer automatiquement les modifications ». Envoyer une modification de texte puis une création de frame. Vérifier que chaque résultat est reçu sans clic Appliquer, que la dernière commande est consultable et qu’Annuler dans Figma permet de revenir sur les changements.
21. Envoyer une commande sur un calque verrouillé : elle doit échouer sans mutation. Pendant une prévalidation de police, changer de page : la mutation doit être refusée. Aucune validation d’opération, page, police, limite ou expiration ne doit être retirée en mode automatique.
22. Revenir au mode manuel puis envoyer un lot : il doit attendre. Recocher le mode automatique pendant cette attente ne doit pas approuver rétroactivement ce lot. Valider ou refuser ce lot, puis vérifier qu’une nouvelle commande suit le nouveau mode.
