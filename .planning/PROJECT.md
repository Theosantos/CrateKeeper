# DJ Utils

## What This Is

DJ Utils est une app desktop (Electron, Mac + Windows) pensée pour les DJs qui veulent reprendre le contrôle de leur bibliothèque musicale. Elle regroupe trois outils : analyse batch des fichiers audio, conversion vers des formats/bitrates cibles, et une interface de catégorisation gamifiée style Tinder pour tagger les sons non-classifiés avec des métadonnées compatibles Rekordbox.

## Core Value

Permettre à un DJ de passer de "bibliothèque en désordre" à "collection propre et taguée" sans quitter une seule interface.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Analyser un répertoire et afficher format/taille/bitrate de chaque fichier audio
- [ ] Convertir des fichiers audio en batch vers un format/bitrate configurable (MP3 320 kbps par défaut)
- [ ] Interface Tinder-style avec lecture d'un extrait automatique au chargement
- [ ] Boutons Garder / Skip sur chaque son
- [ ] Tags rapides prédéfinis (genres configurables)
- [ ] Saisie inline de BPM, clé musicale, commentaires, artiste/titre
- [ ] Écriture des tags directement dans les fichiers (ID3 / MP4)
- [ ] Distribution via installeur .dmg (macOS) et .exe (Windows)

### Out of Scope

- Export XML Rekordbox — les tags dans les fichiers suffisent pour l'instant
- Hébergement distant / upload cloud — accès au filesystem local requis, Electron est plus adapté
- Détection BPM automatique — trop complexe pour v1, saisie manuelle suffit
- Linux — trop peu d'utilisateurs dans le public cible DJ

## Context

- L'utilisateur est DJ et veut partager l'app avec des amis DJs (pas nécessairement devs)
- Bibliothèque de quelques milliers de fichiers — la perf sur l'analyse/conversion est importante
- Rekordbox est le logiciel de référence dans l'écosystème : les tags doivent être compatibles (ID3v2 standard)
- Electron permet l'accès natif au filesystem sans les limitations du browser
- L'interface de catégorisation est le différenciateur — les outils batch existent, mais l'UX Tinder pour tagger n'existe pas

## Constraints

- **Plateforme**: Electron (Mac + Windows) — accès filesystem natif + distribution simple pour non-devs
- **Tags**: ID3v2 (MP3) et MP4 tags — compatibilité Rekordbox obligatoire
- **Conversion**: FFmpeg en backend — standard industrie, gère tous les formats audio
- **Volume**: Quelques milliers de fichiers — analyse et conversion doivent être non-bloquantes (worker threads)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Electron vs web hébergé | Accès filesystem natif, distribution simple (.dmg/.exe) pour amis non-devs | ✓ Electron |
| Electron + Node.js vs Electron + Python backend | Stack cohérente, pas de process Python à bundler, libs Node audio solides | ✓ Node.js pur |
| Tags dans les fichiers vs XML Rekordbox | Simplicité v1, tags ID3 reconnus nativement | ✓ Tags fichiers |
| FFmpeg pour la conversion | Standard industrie, supporte tous formats, performant | ✓ ffmpeg-static |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-28 after initialization*
