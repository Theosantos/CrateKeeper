# CrateKeeper

Outils desktop pour DJ — analyser, convertir et tagger sa bibliothèque musicale (compatible Rekordbox), sans quitter une seule interface.

## Télécharger & Installer

Rendez-vous sur la page des **Releases** : **https://github.com/Theosantos/CrateKeeper/releases**

Téléchargez le bon fichier pour votre système :

| Système | Fichier à télécharger |
|---------|-----------------------|
| **macOS** (Apple Silicon **ou** Intel) | `CrateKeeper-1.0.0-universal.dmg` |
| **Windows** (64 bits) | `CrateKeeper-Setup-1.0.0.exe` |

> ℹ️ L'application n'est pas encore signée (version 1). Les étapes ci-dessous (clic droit → Ouvrir sur macOS, Run anyway sur Windows) sont donc **normales et attendues**. Ne les faites **que** pour l'application téléchargée depuis la page Releases officielle ci-dessus.

### macOS — premier lancement

1. Double-cliquez le fichier `.dmg` téléchargé pour l'ouvrir, puis glissez **CrateKeeper** dans le dossier **Applications**.
2. Dans **Applications**, faites un **clic droit** (ou Ctrl-clic / *right-click*) sur **CrateKeeper** → **Ouvrir** → **Ouvrir**.
3. ⚠️ Ne lancez **pas** l'app par un double-clic la première fois : une application non signée affiche alors un message trompeur « *CrateKeeper est endommagé* ». Le **clic droit → Ouvrir** contourne ce message proprement. Une fois ouverte ainsi la première fois, les lancements suivants se font normalement.

### Windows — premier lancement

1. Lancez `CrateKeeper-Setup-1.0.0.exe`.
2. Si l'écran bleu **Windows SmartScreen** apparaît, cliquez sur **Informations complémentaires** (*More info*) → **Exécuter quand même** (*Run anyway*).
3. Suivez l'installation (par utilisateur, sans mot de passe administrateur), puis lancez CrateKeeper.

Aucune installation supplémentaire (Homebrew, Node, FFmpeg…) n'est nécessaire : tout est embarqué dans l'application.

---

## Développement

### Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For Windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

### Release (CI)

Both installers are built and published by GitHub Actions (`.github/workflows/release.yml`):

- **Build only** (downloadable artifacts): Actions tab → *Release* → *Run workflow* (leave *publish* unchecked).
- **Build + publish** to a GitHub Release: push a version tag, e.g. `git tag v1.0.0 && git push origin v1.0.0`.
