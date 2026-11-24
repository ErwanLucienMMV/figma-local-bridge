# Protocole HTTP v1 — révision 1.1.0

Adresse du client agent : `http://127.0.0.1:38475`. Adresse du plugin : `http://localhost:38475`. Le processus serveur reste lié uniquement à 127.0.0.1. Toutes les requêtes de données exigent `Authorization: Bearer <clé-du-rôle>`. Les POST exigent `Content-Type: application/json`. Aucun cookie ni secret dans une URL. Les query strings sont refusées.

Le contrat exécutable est `src/protocol.cjs` : il est utilisé côté serveur et intégré au plugin par la génération. Les champs supplémentaires sont refusés. Les exemples ci-dessous contiennent des valeurs fictives à remplacer, pas des secrets.

## API agent

| Méthode et route | Réponse |
| --- | --- |
| `GET /agent/session` | `{ "session": null }` ou `{ "session": { "sessionId", "pageId", "pageName", "documentName", "lastSeen" } }` |
| `GET /agent/capabilities` | Révision, liste des 14 opérations, groupes de détails et limites. La session contient aussi `protocolRevision` et `supportedOperations` |
| `POST /agent/commands` | 202, `{ "commandId", "status": "queued", "deadline" }` |
| `GET /agent/commands/COMMAND_ID` | Statut, échéance, horodatages et éventuel `result` |

Corps complet d’une commande :

```json
{
  "version": 1,
  "commandId": "nouvel-identifiant-unique",
  "sessionId": "identifiant-renvoye-par-le-pont",
  "pageId": "1:1",
  "operations": [
    { "type": "setText", "nodeId": "1:2", "text": "Continuer" },
    { "type": "setFill", "nodeId": "1:2", "color": "#2563EB", "opacity": 1 }
  ]
}
```

Le CLI attend seulement `{ "operations": [...] }` dans le fichier : il obtient session/page et génère lui-même un `commandId` UUID. Une commande manuelle doit fournir tous les champs ci-dessus. Un `commandId` ne peut pas être réutilisé pendant la vie du pont, même après expiration ou refus. Les identifiants acceptent 1 à 128 caractères alphanumériques, `:`, `_`, `-`, avec un premier caractère alphanumérique.

## Opérations

| Type | Champs requis en plus de `type` | Champs facultatifs / restrictions |
| --- | --- | --- |
| `getSelection` | aucun | 50 nœuds au maximum, indicateur `truncated` |
| `getNodes` | `nodeIds` | 1 à 50 IDs sur la page autorisée ; `details` facultatif, alors 5 IDs maximum |
| `getChildren` | `nodeId` | `limit` 1 à 10, défaut 10 ; `cursor` renvoyé par le résultat précédent |
| `resizeNode` | `nodeId` | `width` et/ou `height` entre 0.01 et 100 000 ; FRAME/RECTANGLE/ELLIPSE/TEXT ordinaires |
| `setLayout` | `nodeId`, `layout` | Objet fermé de réglages, détaillé ci-dessous |
| `createFrame` | `parentId`, `name`, `width`, `height` | `index`, paire `x`/`y`, `layout` facultatifs ; parent PAGE/FRAME ordinaire |
| `createText` | `parentId`, `name`, `text`, `width` | Police explicite ou `typographySourceId`, autres champs détaillés ci-dessous |
| `copyAppearance` | `sourceId`, `targetId`, `properties` | Liste sans doublon parmi fills/strokes/corners/effects/opacity/typography |
| `setText` | `nodeId`, `text` | TEXT seulement ; texte de 0 à 10 000 caractères |
| `setFill` | `nodeId`, `color` | couleur `#RRGGBB` ; `opacity` entre 0 et 1, défaut 1 |
| `setPosition` | `nodeId`, `x`, `y` | nombres finis entre -1 000 000 et 1 000 000, relatifs au parent |
| `createComponent` | `nodeId` | `name`, 1 à 200 caractères ; seule opération du lot |
| `createInstance` | `componentId`, `x`, `y` | `name`, 1 à 200 caractères ; instance ajoutée directement à la page |
| `setInstanceProperties` | `nodeId`, `properties` | 1 à 20 clés existantes ; valeurs string ≤ 1 000 caractères ou boolean ; types TEXT/BOOLEAN/VARIANT |

`getSelection`, `getNodes` et `getChildren` sont exécutées automatiquement. Depuis le plugin 1.1.1, les mutations sont aussi appliquées automatiquement par défaut après prévalidation. Le mode manuel reste disponible dans l’UI locale et impose alors le clic Appliquer pour chaque nouveau lot. Le protocole HTTP et sa révision restent 1.1.0 : aucun champ d’une commande ne choisit ce mode. L’ajout d’un type requiert un changement explicite du validateur et du moteur ; un type ou champ inconnu retourne une erreur.

### Navigation et détails

`getChildren` retourne `parentId`, `total`, `children`, `nextCursor`. Les résumés d’enfants incluent ID, parent, index, nom, type, position, dimensions, visibilité, verrouillage et nombre d’enfants ; ils n’exposent pas tout leur contenu texte. Aucun parcours récursif n’est fait. Le parent peut être la page autorisée. Le curseur encode le nombre d’enfants, l’offset et l’ID à la frontière précédente ; un changement de nombre ou de frontière le périme. Pour naviguer dans un arbre qui change, recommencer la pagination.

`getNodes.details` accepte une liste sans doublon parmi `structure`, `geometry`, `layout`, `appearance`, `text`. Le résultat `nodes[].details` contient les groupes demandés. Les propriétés mixtes portent `{ "$mixed": true }`, les propriétés absentes/non prises en charge `{ "$unsupported": true, "reason": "…" }`, les listes trop longues un objet `{ "$truncated": true, "total", "items" }`. La sérialisation est bornée à 32 éléments par liste, 64 champs par objet et une profondeur de 8 niveaux. Un résultat dépassant le plafond global de 12 000 unités de chaîne est refusé : inspecter moins de groupes/nœuds. Les textes tronqués sont signalés par `textTruncated` ou `charactersTruncated`.

### Dimensions et Auto Layout

`resizeNode` ne met pas les enfants à l’échelle. Une dimension HUG/FILL ou gérée par le redimensionnement automatique d’un texte est refusée ; régler FIXED explicitement au préalable si applicable. Le contenu d’un texte ne change pas. La taille finale doit être relue après le recalcul Figma.

`setLayout.layout` autorise uniquement :

| Champs | Valeurs |
| --- | --- |
| `layoutMode` | `NONE`, `HORIZONTAL`, `VERTICAL` ; conteneur FRAME ordinaire |
| `layoutSizingHorizontal`, `layoutSizingVertical` | `FIXED`, `HUG`, `FILL` selon compatibilité du nœud et de son parent |
| `primaryAxisAlignItems` | `MIN`, `CENTER`, `MAX`, `SPACE_BETWEEN` |
| `counterAxisAlignItems` | `MIN`, `CENTER`, `MAX`, `BASELINE` ; BASELINE seulement horizontal |
| `itemSpacing`, `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft` | nombres entre 0 et 10 000 ; conteneur horizontal/vertical |
| `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | `null` ou nombres entre 0.01 et 100 000 ; min ≤ max, Auto Layout ou enfant direct |

Les changements de taille/mise en page sont réservés aux calques ordinaires, sans composant/instance parmi les ancêtres. FILL exige un parent Auto Layout et un enfant non absolu ; HUG un texte ou un conteneur Auto Layout. Les réglages précédents du même lot sont pris en compte à la prévalidation, puis les compatibilités sont recontrôlées à l’application. Aucun champ générique de propriété n’existe.

Par prudence, une nouvelle relation FILL avec un parent HUG sur le même axe (ou HUG avec un enfant FILL) est refusée pour éviter un changement implicite d’un autre calque. Les dimensions ou réglages déjà liés à des variables sont aussi refusés plutôt que de détacher silencieusement leurs liaisons.

### Créations et reprise d’apparence

`createFrame` crée un FRAME transparent non rognant, l’insère dans un parent PAGE/FRAME autorisé, applique ses dimensions initiales puis son éventuel `layout`. `index` est un entier entre 0 et le nombre d’enfants ; omis, l’ajout se fait à la fin. Les coordonnées `x` et `y` doivent être fournies ensemble et exigent un parent sans Auto Layout. `name` fait 1 à 200 caractères. Dimensions : 0.01 à 100 000.

`createText` partage ces règles d’insertion. Fournir **soit** `font: { "family", "style" }` avec `fontSize` 1 à 1 000, **soit** `typographySourceId` désignant un TEXT local à typographie uniforme. Dans ce dernier cas, `fontSize`, `lineHeight` et `letterSpacing` ne peuvent pas surcharger la source. `text` a au maximum 10 000 caractères. `textAutoResize` vaut `HEIGHT` par défaut ; `NONE` exige une `height` explicite. `HEIGHT` refuse `height` car elle est pilotée par le contenu. `textAlignHorizontal` facultatif : LEFT/CENTER/RIGHT/JUSTIFIED.

Avec police explicite seulement : `lineHeight` vaut `{ "unit": "AUTO" }` ou `{ "unit": "PIXELS"|"PERCENT", "value": nombre > 0 et ≤ 1000 }` ; `letterSpacing` vaut `{ "unit": "PIXELS"|"PERCENT", "value": nombre entre -100 et 100 }`. Les polices sont chargées avant création. Un TEXT réel éditable est produit.

`copyAppearance` copie uniquement les groupes demandés : peintures et leurs styles pour `fills`, peintures/épaisseurs/alignement/jointures/extrémités/tirets pour `strokes`, quatre rayons individuels et lissage pour `corners`, effets et style pour `effects`, opacité et variable pour `opacity`, typographie uniforme et style pour `typography` (deux TEXT requis). Les palettes/effets référencés doivent déjà exister dans le document. Les liaisons variables de peintures/effets sont conservées dans leurs valeurs ; les liaisons scalaires compatibles sont réappliquées avec les objets Variable locaux. Les liaisons typographiques de famille/style/poids et les listes de variables mixtes sont refusées. Les modes de variables du parent ne sont pas changés.

Un style avec surcharge non reproductible est refusé avant écriture ; aucune approximation silencieuse n’est produite. Les patterns et les valeurs mixtes non reconstituables sont également refusés. Aucun contenu, enfant ou ID source n’est copié.

Les créations renvoient `nodeId`, `frameId` ou `textId`, `parentId`, `index`, `width`, `height`. Les parents doivent déjà exister au début du lot ; utiliser des commandes séparées pour leurs enfants. En cas d’échec, le nœud de cette création est supprimé si possible. Si le nettoyage échoue, `results` contient l’ID `createdNodeId` et `cleanupFailed: true`, même si aucune opération n’est comptée comme terminée. Une création précédente réussie du lot reste en place : le lot n’est pas atomique.

L’export PNG `exportPreview` n’est **pas** une opération de cette version. Une capture locale autorisée peut assurer la vérification visuelle sans modifier le protocole ou accepter un chemin/une URL arbitraire.

## API plugin

Cette API est utilisée par le plugin livré ; elle n’a pas à être appelée par un agent.

| Route POST | Corps / comportement |
| --- | --- |
| `/plugin/register` | `{ "pageId", "pageName", "documentName", "protocolRevision": "1.1.0" }` ; crée l’unique session ; retourne `{ "sessionId", "pageId" }`. Révision omise/ancienne : huit opérations historiques seulement, sans détails enrichis |
| `/plugin/next` | `{ "sessionId", "ready": true ou false }` ; heartbeat, puis distribution éventuelle de `{ "job": { "command", "deadline" } }` ou `{ "job": null }` |
| `/plugin/result` | `{ "sessionId", "commandId", "result": { "status", ... } }` ; accusé de réception idempotent pour un résultat identique |
| `/plugin/disconnect` | `{ "sessionId" }` ; annule les commandes en file et marque les commandes distribuées sans résultat comme inconnues |

`ready: false` maintient la session pendant une validation/préparation sans distribuer de deuxième commande. Il n’existe qu’une commande distribuée non terminale par session. Les délais `deadline`, `createdAt`, etc. sont des millisecondes Unix sur la même machine.

## Statuts

```text
queued → dispatched → succeeded | failed | rejected
queued → expired | cancelled
dispatched → unknown
unknown → succeeded | failed | rejected   (accusé tardif, session encore active)
```

- `queued` : accepté, pas encore remis au plugin.
- `dispatched` : remis une fois ; peut attendre le clic utilisateur ou l’API Figma.
- `succeeded` : opérations terminées, résultat reçu par le pont.
- `failed` : erreur de prévalidation ou d’API, consulter `error` et les éventuels effets partiels.
- `rejected` : refus utilisateur ou délai local de validation dépassé avant exécution.
- `expired` : délai dépassé alors que la commande était encore en file.
- `cancelled` : déconnexion avant distribution.
- `unknown` : une commande a été distribuée, mais aucun résultat n’est disponible après son échéance ou la perte de sa session. **Elle peut avoir été appliquée.**

Exemple de statut réussi :

```json
{
  "commandId": "exemple",
  "status": "succeeded",
  "createdAt": 1000,
  "deadline": 121000,
  "dispatchedAt": 2000,
  "finishedAt": 3000,
  "result": {
    "status": "succeeded",
    "appliedCount": 1,
    "results": [{ "index": 0, "type": "setText", "nodeId": "1:2" }]
  }
}
```

Une conversion renvoie `componentId`, une instanciation `instanceId`, une lecture `nodes`. Les lectures ne comptent pas comme modifications dans un lot exclusivement en lecture. Dans un lot mixte, `appliedCount` dénombre les opérations terminées. Si un setter échoue, `partialPossible: true` avertit que même l’opération en échec peut avoir commencé à écrire ; aucune atomicité n’est promise.

## Erreurs et reprise

Les erreurs HTTP utilisent `{ "error": "message" }` : 400 JSON/champs invalides, 401 secret invalide, 403 hôte/origine interdits, 404 route/commande inconnue, 409 session/page/doublon/conflit, 413 corps excessif, 415 type de contenu incorrect, 429 file ou débit excessifs, 503 historique plein.

Après un timeout d’envoi, consulter le `commandId` imprimé **avant** le POST. Après un timeout d’accusé de réception, le plugin renvoie seulement le résultat déjà calculé ; il ne réapplique pas la commande. Après redémarrage, les anciens IDs et résultats ne sont plus connus : vérifier le document avant toute nouvelle demande. Les statuts expirés sont calculés lors de la prochaine requête au pont, sans tâche persistante.
