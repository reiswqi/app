# Temps d'Abondance — application

Prototype navigable (HTML unique) de l'application « Temps d'Abondance ».

- `src.html` : source (contient le marqueur `__DAILY__`)
- `prieres.json` : les 104 prières quotidiennes
- `build.py` : assemble `src.html` + `prieres.json` en `temps-abondance.html`
- `temps-abondance.html` : fichier final, ouvrable dans le navigateur (a besoin du dossier `img/`)
- `img/` : couvertures et images

Pour reconstruire : `python3 build.py`
