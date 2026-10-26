# Purple Arena Online

FPS multijoueur dans le navigateur (Three.js + serveur Node.js autoritaire). Deux modes, un seul serveur, aucune installation côté joueur : on ouvre un lien et on joue.

## Modes de jeu

| Mode | Description |
|------|-------------|
| **Deathmatch** | Joueur contre joueur, parties de 1:30. Fusil, sniper et couteau. **5 maps** qui s'alternent à la fin de chaque partie. |
| **Parkour** | **10 niveaux** (un biome chacun), **bhop**, classements par niveau. Tous les niveaux sont ouverts dès le début. |

## Contrôles

| Touche | Action |
|--------|--------|
| `ZQSD` / `WASD` | Se déplacer |
| `Shift` ou `Ctrl gauche` | Courir (Deathmatch) |
| `Espace` | Sauter (parkour : maintenir pour enchaîner les sauts) |
| `Clic gauche` | Tirer / frapper |
| `Clic droit` | Viser (lunette pour le sniper) · lancer le couteau |
| `1` `2` `3` ou molette | Fusil · sniper · couteau |
| `R` | Recharger (parkour : recommencer le niveau) |
| `E` | Dash |
| `Entrée` ou `T` | Chat global |
| `N` / `B` | Niveau suivant / précédent (parkour) |
| `V` | Changer de classement Daily / Monthly / All-time (parkour) |
| `F` | Plein écran |

> Sur certains navigateurs `Ctrl+W` ferme l'onglet : appuie sur `W` avant `Ctrl`, ou joue en plein écran (`F`).

## Téléphone et tablette

Les commandes tactiles apparaissent automatiquement sur mobile (écran tactile) ; sur PC rien ne change. Joue en **paysage** : le jeu se met en plein écran et un message te demande de tourner le téléphone si besoin.

- **Joystick à gauche** : se déplacer (à fond = courir). **Glisser sur la moitié droite** : regarder autour.
- **Deathmatch** : `FIRE`, `JUMP`, `AIM` (lancer quand le couteau est en main), `RELOAD`, `DASH`, choix de l'arme (Rifle / Sniper / Knife) et `Chat`.
- **Parkour** : gros bouton `JUMP` (maintenir pour le bhop), `Restart`, `◀ Level ▶`, classement Day / Month / All et `Chat`.
- `☰` ouvre le menu / la pause.

## Deathmatch

- **Maps** : Arena, Dust Bowl, Frostbite, Night Woods, Reactor. La suivante est annoncée sur l'écran de fin de partie.
- **Fusil** : arme de base, plus précise en visée.
- **Sniper** : un tir suffit à tuer, 1,6 s entre deux tirs, très imprécis sans lunette.
- **Couteau** : 2 coups de face, **1 coup dans le dos** (BACKSTAB). Clic droit pour le **lancer** (mort en un coup, il revient après 2,5 s).
- **Chat global** : visible par tous les joueurs de tous les modes.
- **Skins d'armes** : 10 skins débloqués par ton **total de kills** (toutes parties confondues). Chaque skin a son propre **son de tir** et sa propre **animation de kill**, visibles par tous.

| Skin | Kills requis | | Skin | Kills requis |
|------|-------------:|-|------|-------------:|
| Sandstorm | 25 | | Gold Rush | 450 |
| Frostbite | 60 | | Emerald | 650 |
| Woodland | 120 | | Neon Pulse | 900 |
| Crimson | 200 | | Void | 1 200 |
| Cobalt | 300 | | Legend | 1 600 |

## Parkour

1. Scorched Dunes (désert) · 2. Open Sea (mer) · 3. Whispering Forest (forêt) · 4. Frozen Peaks (glace) · 5. Crystal Cave (grotte)
6. Rusty Factory (usine) · 7. Molten Core (volcan) · 8. Abyssal Depths (abysses) · 9. Neon City (néon) · 10. Outer Space (espace)

- La difficulté monte du niveau 1 au 10. Pas de checkpoints : une chute te ramène au départ.
- Le **chrono démarre quand tu quittes la plateforme verte de départ** et s'arrête sur la plateforme d'arrivée.
- **Classements** Daily / Monthly / All-time par niveau (jour et mois à l'heure de Paris), affichés sur un panneau au départ et sur un panneau flottant à l'arrivée.
- **Tutoriel bunny hop** : dans le menu, mode Parkour, bouton « Learn to bunny hop ». Un bot joue au ralenti, avec une caméra adoucie, en vue première personne sur une map à part (marcher, sauter, enchaîner les sauts, strafe en l'air, franchir un grand trou) pendant que les touches qu'il utilise s'allument (W A S D, Espace, souris) avec un compteur de vitesse. Ensuite tu peux essayer toi-même (`R` pour recommencer). Le tutoriel est local : il fonctionne sans serveur de jeu et n'enregistre aucun temps.
- **Affichage des touches (Parkour)** : un petit panneau en bas à droite montre W A S D, Espace et ta vitesse en direct. Désactivable dans le menu (« Keystrokes (parkour) »). Masqué sur mobile et dans le tutoriel.
- Les joueurs du **top 10** ont leur rang (`#1` à `#10`) au-dessus de la tête, et le meilleur temps affiche **WORLD RECORD HOLDER**.

## Lancer en local

Prérequis : [Node.js](https://nodejs.org) (version LTS).

```bash
npm install
npm start
```

Puis ouvre http://localhost:3000. Sous Windows, double-clique sur `start.bat`.

Pour jouer avec des amis depuis ton PC : `tunnel.bat` (nécessite `cloudflared`, installable avec `winget install Cloudflare.cloudflared`) donne une adresse `https://….trycloudflare.com` à partager. Elle change à chaque lancement.

## Héberger en ligne (Render)

1. Mets les fichiers du projet sur un dépôt GitHub (voir structure ci-dessous).
2. Sur [render.com](https://render.com) : **New → Web Service**, choisis le dépôt.
3. Build command : `npm install` · Start command : `npm start`.
4. L'URL reste la même à chaque mise à jour : Render redéploie à chaque push.

Le serveur répond sur `/healthz` (utile pour un ping de surveillance, par exemple UptimeRobot toutes les 5 min, car l'offre gratuite de Render s'endort après environ 15 minutes sans visite).

### Variables d'environnement

| Variable | Rôle | Défaut |
|----------|------|--------|
| `PORT` | Port d'écoute | `3000` |
| `DATA_DIR` | Dossier où est écrit `scores-v2.json` | dossier du serveur |

> Sur l'offre gratuite de Render le disque est éphémère : les classements sont effacés à chaque redéploiement. Pour les garder, utilise une offre avec disque persistant et pointe `DATA_DIR` dessus.

## Structure

```
server.js        serveur WebSocket autoritaire (salles, tirs, couteau, chrono parkour, scores, chat)
maps.js          génération des maps Deathmatch et des 10 niveaux de parkour
public/index.html  client complet (rendu Three.js, HUD, menu, sons)
package.json     dépendance : ws
start.bat        lancement Windows
tunnel.bat       tunnel Cloudflare pour partager son PC
```

Le serveur accepte aussi `index.html` à la racine du dépôt si le dossier `public/` n'est pas présent.

## Notes techniques

- **Serveur autoritaire** : il valide les déplacements, les tirs, les coups de couteau et les temps de parkour (ligne d'arrivée + temps minimum). Les maps sont générées côté serveur et envoyées aux clients.
- **Parkour** : chaque niveau est généré avec une graine fixe, puis testé avec un robot qui rejoue la physique du jeu. Tous les sauts sont faisables à vitesse normale, sans bhop obligatoire.
- **Skins et total de kills** : stockés dans le navigateur du joueur (`localStorage`), ils ne sont donc pas protégés contre la modification et ne suivent pas le joueur d'un navigateur à l'autre.
- **Chat** : 120 caractères maximum, un message toutes les 0,7 s, sans filtre de mots.
