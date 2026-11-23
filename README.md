# 🧊 Photo2STL

Application web qui génère un fichier **STL imprimable en 3D** à partir de **photos** et de **cotes** (mesures) saisies par l'utilisateur.
Tout est calculé dans le navigateur : aucune photo n'est envoyée sur un serveur, et l'application fonctionne hors ligne (three.js est inclus dans `vendor/`).

## Lancer l'application

```bash
npm start          # serveur statique sans dépendance → http://localhost:8080
npm test           # tests de la géométrie (Node ≥ 18)
```

Le dossier peut aussi être publié tel quel sur n'importe quel hébergement statique (Netlify…).

### Publication GitHub Pages

Le workflow `.github/workflows/pages.yml` lance les tests puis publie le site à chaque push sur `main` (ou sur la branche de développement). Il peut aussi être lancé à la main depuis l'onglet *Actions*.
À faire une seule fois : **Settings → Pages → Build and deployment → Source : « GitHub Actions »**.
Le site est ensuite servi à l'adresse `https://<utilisateur>.github.io/<dépôt>/`. Tous les chemins sont relatifs, donc ce sous-dossier fonctionne sans configuration.
Ouvrir `index.html` directement en `file://` ne fonctionne pas, car les modules ES exigent un serveur HTTP.

## Les trois modes

| Mode | Photos | Cotes | Pour quoi ? |
|---|---|---|---|
| **Silhouettes** | 1 à 3 vues : face, droite, dessus | largeur X, profondeur Y, hauteur Z (une seule suffit) | objets pleins, pièces mécaniques simples, figurines grossières ; **1 seule vue = extrusion** (pièce plate, logo, gabarit) |
| **Révolution** | 1 photo de profil | hauteur et/ou diamètre max | vases, bouteilles, boutons, pieds, pions… (objets symétriques autour d'un axe) |
| **Relief / Lithophanie** | 1 image | largeur, épaisseur min/max, cadre | lithophanies, bas-reliefs, plaques |

### Cotes et étalonnage

- **Saisie directe** : entrez une ou plusieurs dimensions réelles en mm. Les cotes manquantes sont déduites des proportions des silhouettes (ex. la hauteur saisie + la vue de face donnent la largeur, la vue de droite donne alors la profondeur).
- **📏 Étalonner** : cliquez deux points d'une distance connue sur la photo (deux graduations d'une règle posée à côté de l'objet, un trou de diamètre connu…) puis saisissez cette distance. L'échelle mm/px de la photo sert alors à dimensionner automatiquement. Si la mesure est prise sur une règle (case cochée par défaut), la règle est retirée du détourage.
- Les cotes saisies sont prioritaires sur l'étalonnage, qui est lui-même prioritaire sur les proportions.

### Détourage

Le fond est détecté automatiquement (couleur médiane du bord de la photo et seuil d'Otsu). Ajustez si besoin avec la **tolérance**, la **🎯 pipette** (cliquer sur le fond), **Contour ±px** (rogner une ombre ou épaissir), **Inverser** ou **Boucher les trous**. Si un autre élément (règle, ombre…) est détouré avec l'objet : **✂️ Zone de l'objet** (tracer un cadre) ou **👆 Choisir l'objet** (cliquer dessus).
**⟲ Réinitialiser** remet à zéro les réglages d'une photo ; le bouton sous « Générer » remet à zéro tout le mode en gardant les photos. Les PNG détourés (fond transparent) sont gérés directement.

## Conseils de prise de vue

1. Fond uni et contrasté, éclairage diffus (peu d'ombres portées).
2. Reculez et zoomez : moins de perspective, donc des silhouettes plus fidèles.
3. Visez perpendiculairement à chaque face.
4. Conventions : sur la **vue de droite**, l'avant de l'objet est à gauche de la photo ; sur la **vue de dessus**, l'avant est en bas. Sinon, cochez « Miroir ».

## Fonctionnement

- **Silhouettes** : *enveloppe visuelle* (visual hull). Chaque silhouette, mise à l'échelle des cotes, est extrudée selon son axe de vue. L'intersection est échantillonnée sur une grille de voxels avec des valeurs anti-crénelées, puis la surface est extraite par *Surface Nets* et lissée par un filtre de Taubin, qui préserve le volume.
- **Révolution** : la demi-largeur de la silhouette, ligne par ligne, donne un profil qui est tourné autour de l'axe Z (*lathe*), avec des bouchons en haut et en bas.
- **Relief** : la luminance devient une hauteur, et le solide est fermé par des parois latérales et un fond plat.

Les maillages produits sont **fermés (étanches) et orientés** (normales vers l'extérieur), ce que vérifient les tests. L'export se fait en STL binaire, en millimètres.

### Limites

L'enveloppe par silhouettes ne peut pas reproduire les **concavités invisibles en silhouette** (l'intérieur d'une tasse, une gorge sur une face…). Pour ces détails, retouchez le STL dans un logiciel de CAO (Fusion 360, FreeCAD, Blender…). Pour une numérisation fidèle d'un objet complexe, il faut passer par la photogrammétrie (dizaines de photos, logiciels dédiés comme Meshroom ou RealityScan).

## Structure

```
index.html           interface
css/style.css
js/app.js            orchestration de l'interface
js/slot.js           emplacement photo : chargement, détourage, étalonnage
js/viewer.js         aperçu 3D (three.js)
js/segmentation.js   détection objet/fond
js/masks.js          rééchantillonnage, échantillonnage bilinéaire
js/hull.js           enveloppe visuelle + déduction des cotes
js/revolution.js     solide de révolution
js/relief.js         relief / lithophanie
js/mesh.js           Surface Nets, lissage, lathe, champ de hauteur, contrôles d'étanchéité
js/stl.js            export STL binaire
vendor/three/        three.js r160 (licence MIT)
tests/               tests Node (node:test)
```
