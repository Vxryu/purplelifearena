# Purple Arena Online

Quatre modes en ligne, un seul serveur.

| Mode | Description |
|------|-------------|
| **Deathmatch** | Joueur contre joueur, parties de 1:30, +10 coins par kill. Pas de bhop. Tout le monde a le fusil d'assaut. |
| **Campagne** | Coop, 10 niveaux et 4 boss (niveaux 3, 5, 7, 10) dans une **très grande forêt sombre** (lanterne, brouillard, étoiles). La forêt change à chaque niveau. Si toute l'équipe tombe, le niveau recommence. |
| **Endless** | Coop, vagues infinies, une seule vie, boss toutes les 5 vagues. **La map change à chaque vague** : Arena, Forêt, Usine, Grotte de cristaux, Ruines inondées, puis ça recommence avec de nouvelles variantes. |
| **Parkour** | 20 niveaux chronométrés avec **bhop**. Ambiances : forêt de nuit (1-4), docks sous l'eau (5-8), usine (9-12), grotte (13-16), ciel néon (17-20). La difficulté monte : plateformes plus petites, sauts plus longs, obstacles, plus de checkpoints. |

## Parkour
- Maintiens **Espace** pour enchaîner les sauts (bhop). En l'air, tourne la souris et appuie sur **A** ou **D** pour prendre de la vitesse.
- **R** : recommencer le niveau. **N** : niveau suivant (débloqué quand tu finis le précédent).
- Tomber dans le vide te ramène au dernier checkpoint. Le chrono démarre quand tu quittes la plateforme de départ et ne s'arrête pas quand tu tombes.
- **Au départ** : un tableau affiche les meilleurs temps du niveau. **À l'arrivée** : un tableau qui flotte affiche le classement et ton temps.
- Les temps sont enregistrés dans `scores.json` à côté du serveur. Sur un PC, ils sont conservés. Sur Render gratuit, ils sont effacés à chaque redéploiement (utilise la variable `DATA_DIR` avec un disque persistant si tu veux les garder).

## Coins et armes
Chaque mob tué rapporte des coins (les boss beaucoup plus). Boutique dans le menu, section "Weapons" : SMG 250, Shotgun 500, Sniper 800, LMG 1500. Elles servent en Campagne et en Endless.
Coins et armes sont sauvegardés dans le navigateur du joueur (localStorage) : prévu pour jouer entre amis.

## Héberger sur ton PC
1. Installe Node.js (https://nodejs.org, version LTS).
2. Double-clique sur **start.bat** (installe les dépendances la première fois, puis lance le serveur sur http://localhost:3000).
3. Pour que tes amis jouent : double-clique sur **tunnel.bat** (il faut `cloudflared`, installé avec `winget install Cloudflare.cloudflared`) et donne-leur l'adresse `https://....trycloudflare.com` qui s'affiche. Elle change à chaque lancement.

Pour mettre à jour le jeu : remplace les fichiers, arrête le serveur (Ctrl+C) et relance start.bat.

## Héberger sur Render
Envoie `server.js`, `maps.js`, `public/index.html`, `package.json` et `README.md` sur GitHub (tous ensemble). Render redéploie tout seul, l'URL ne change pas.

## Notes techniques
- Les maps sont générées par le serveur (`maps.js`) et envoyées aux joueurs : une seule source de vérité, plus de spawns dans les décors.
- Les niveaux de parkour sont générés avec une graine fixe par niveau. Chacun a été testé avec un robot qui simule la physique du jeu : tous les sauts sont faisables à vitesse normale, sans bhop obligatoire.
- Le serveur vérifie les checkpoints, la ligne d'arrivée et un temps minimum avant d'enregistrer un score.
