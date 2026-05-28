# Requirements: DJ Utils

**Defined:** 2026-05-28
**Core Value:** Permettre à un DJ de passer de "bibliothèque en désordre" à "collection propre et taguée" sans quitter une seule interface.

## v1 Requirements

### Foundation

- [ ] **FOUND-01**: L'app démarre et affiche une interface de navigation entre les trois outils (Analyser, Convertir, Tagger)
- [ ] **FOUND-02**: L'utilisateur peut sélectionner un dossier racine depuis l'interface
- [ ] **FOUND-03**: L'app persiste le dossier sélectionné entre les sessions

### Analyse

- [ ] **SCAN-01**: L'utilisateur peut lancer un scan d'un répertoire et obtenir la liste de tous les fichiers audio avec format, bitrate, taille en Mo
- [ ] **SCAN-02**: Chaque fichier affiche sample rate et durée en plus du format/bitrate/taille
- [ ] **SCAN-03**: Chaque fichier affiche un indicateur visuel si Genre, BPM et Key sont déjà remplis dans les tags
- [ ] **SCAN-04**: L'utilisateur peut exporter la liste analysée en CSV
- [ ] **SCAN-05**: Le scan est non-bloquant — l'UI reste réactive pendant l'analyse (worker thread + résultats en streaming)

### Conversion

- [ ] **CONV-01**: L'utilisateur peut sélectionner des fichiers depuis l'analyse et lancer une conversion batch
- [ ] **CONV-02**: Le format cible et le bitrate sont configurables (MP3 320kbps par défaut)
- [ ] **CONV-03**: Une barre de progression par fichier et globale est affichée pendant la conversion
- [ ] **CONV-04**: Les erreurs de conversion sont listées par fichier sans interrompre les autres
- [ ] **CONV-05**: La conversion peut être reprise là où elle s'est arrêtée si interrompue
- [ ] **CONV-06**: Les tags existants (ID3/MP4) sont préservés lors de la conversion

### Tagger

- [ ] **TAGG-01**: L'utilisateur peut charger un dossier dans le tagger — seuls les fichiers avec tags incomplets apparaissent dans la file
- [ ] **TAGG-02**: Chaque carte affiche le nom du fichier, les tags existants, et joue automatiquement un extrait audio de 30s au chargement
- [ ] **TAGG-03**: L'utilisateur peut passer au fichier suivant (Skip) ou valider et sauvegarder les tags (Keep) via boutons ou raccourcis clavier (→ / ←)
- [ ] **TAGG-04**: Des boutons de genre rapides configurables (ex: House, Techno, Afro, Melodic...) sont disponibles, activables en 1 clic ou touches 1-9
- [ ] **TAGG-05**: BPM et Clé musicale sont saisissables inline sur la carte sans ouvrir de modal
- [ ] **TAGG-06**: Genre, Artiste, Titre, Commentaire sont éditables inline sur la carte
- [ ] **TAGG-07**: Énergie / Rating (1-5) est saisissable et écrit dans POPM (compatible Rekordbox stars)
- [ ] **TAGG-08**: Si le champ Artiste est vide et que le Titre contient un séparateur reconnu (` - `, ` -- `, ` – `), l'app propose deux options de split Artiste/Titre avec validation en 1 clic
- [ ] **TAGG-09**: L'utilisateur peut annuler la dernière action Keep/Skip (undo 1 niveau)
- [ ] **TAGG-10**: La position dans la file est sauvegardée — l'app reprend au même fichier lors de la prochaine ouverture

### Tag Writing

- [ ] **TAGS-01**: Les tags sont écrits directement dans les fichiers audio (ID3v2.3 pour MP3, atoms MP4 pour M4A/AAC/AIFF)
- [ ] **TAGS-02**: L'écriture utilise un pattern atomic (write-to-temp + rename) pour éviter la corruption de fichiers
- [ ] **TAGS-03**: Les tags écrits sont compatibles Rekordbox (ID3v2.3, UTF-16, BPM entier, TKEY notation Camelot)

### Distribution

- [ ] **DIST-01**: L'app est distribuable via installeur .dmg (macOS) et .exe (Windows) sans nécessiter d'installation préalable
- [ ] **DIST-02**: FFmpeg est bundlé dans l'installeur — aucune dépendance système requise

## v2 Requirements

### Tagger avancé

- **TAGG-V2-01**: Détection BPM automatique (aubio ou librosa via subprocess)
- **TAGG-V2-02**: Détection de clé musicale automatique (Essentia ou KeyFinder)
- **TAGG-V2-03**: Undo multi-niveaux (historique complet de la session)
- **TAGG-V2-04**: Mode batch-tag — appliquer un genre/tag à une sélection multiple

### Analyse avancée

- **SCAN-V2-01**: Détection des doublons (par fingerprint audio ou hash)
- **SCAN-V2-02**: Filtres et tri dans la vue bibliothèque (par format, bitrate, état des tags)

### Distribution

- **DIST-V2-01**: Auto-update intégré (electron-updater)
- **DIST-V2-02**: Export XML Rekordbox (collection complète)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Export XML Rekordbox | Tags dans fichiers suffisent pour v1 — Rekordbox lit les ID3 nativement |
| Hébergement web / upload cloud | Accès filesystem local requis, Electron est plus adapté |
| Linux | Trop peu d'utilisateurs dans le public cible DJ |
| Détection BPM auto en v1 | Complexité élevée (libs natives), saisie manuelle suffit pour v1 |
| Cue points / loop markers | Stockés uniquement dans la BDD Rekordbox interne, pas en ID3 standard |
| Streaming / lecture complète | Hors scope — l'app est un outil de tagging, pas un player |
| Sync avec Rekordbox API | API propriétaire non documentée publiquement |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Pending |
| FOUND-02 | Phase 1 | Pending |
| FOUND-03 | Phase 1 | Pending |
| SCAN-01 | Phase 2 | Pending |
| SCAN-02 | Phase 2 | Pending |
| SCAN-03 | Phase 2 | Pending |
| SCAN-04 | Phase 2 | Pending |
| SCAN-05 | Phase 2 | Pending |
| CONV-01 | Phase 3 | Pending |
| CONV-02 | Phase 3 | Pending |
| CONV-03 | Phase 3 | Pending |
| CONV-04 | Phase 3 | Pending |
| CONV-05 | Phase 3 | Pending |
| CONV-06 | Phase 3 | Pending |
| TAGG-01 | Phase 4 | Pending |
| TAGG-02 | Phase 4 | Pending |
| TAGG-03 | Phase 4 | Pending |
| TAGG-04 | Phase 4 | Pending |
| TAGG-05 | Phase 4 | Pending |
| TAGG-06 | Phase 4 | Pending |
| TAGG-07 | Phase 4 | Pending |
| TAGG-08 | Phase 4 | Pending |
| TAGG-09 | Phase 4 | Pending |
| TAGG-10 | Phase 4 | Pending |
| TAGS-01 | Phase 5 | Pending |
| TAGS-02 | Phase 5 | Pending |
| TAGS-03 | Phase 5 | Pending |
| DIST-01 | Phase 6 | Pending |
| DIST-02 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-28*
*Last updated: 2026-05-28 after initial definition*
