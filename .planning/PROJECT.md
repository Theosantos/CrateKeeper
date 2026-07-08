# CrateKeeper (DJ Utils)

## What This Is

CrateKeeper est une app desktop (Electron, Mac + Windows) pensée pour les DJs qui veulent reprendre le contrôle de leur bibliothèque musicale. Elle regroupe trois outils : analyse batch des fichiers audio, conversion vers des formats/bitrates cibles, et une interface de catégorisation gamifiée style Tinder pour tagger les sons non-classifiés avec des métadonnées compatibles Rekordbox. **Shippé en v1.0** (installeurs macOS `.dmg` + Windows `.exe`, FFmpeg embarqué).

## Core Value

Permettre à un DJ de passer de "bibliothèque en désordre" à "collection propre et taguée" sans quitter une seule interface.

## Current State

**Shippé : v1.0** (2026-06-24) — publié en GitHub Release sur `Theosantos/CrateKeeper` : `.dmg` macOS Universal + `.exe` Windows NSIS, non signés, FFmpeg fat embarqué, vérification de mise à jour cross-platform. Patch v1.0.1 (icône dédiée + correctifs de code review) publié via CI.

- **Codebase :** ~17,4k LOC TypeScript sur 6 phases / 17 plans ; 554 tests verts.
- **Stack :** electron-vite 5 + Electron 39 + React 19 + TS 5, better-sqlite3, ffmpeg-static, node-id3, Zustand, Framer Motion, Vitest. Packaging electron-builder 26 ; release via GitHub Actions (tag `v*` → build + publish mac & win).
- **Reporté (vérification humaine) :** UAT manuel Rekordbox/Mp3tag/crash-safety (05-HUMAN-UAT), smoke-test d'installation sur matériel Windows (06-HUMAN-UAT). Tracés, non-bloquants.

## Requirements

### Validated

- [x] Analyser un répertoire et afficher format/taille/bitrate de chaque fichier audio — v1.0 (Phase 2)
- [x] Convertir des fichiers audio en batch vers un format/bitrate configurable (MP3 320 par défaut) — v1.0 (Phase 3)
- [x] Interface Tinder-style avec lecture d'un extrait au chargement — v1.0 (Phase 4 ; l'extrait 30s fixe a évolué en waveform pleine-piste décodée côté main via ffmpeg après crash natif du renderer)
- [x] Boutons Garder / Skip sur chaque son — v1.0 (Phase 4)
- [x] Tags rapides prédéfinis (genres configurables) — v1.0 (Phase 4)
- [x] Saisie inline de commentaires + artiste/titre — v1.0 (Phase 4/5) — ⚠️ ajusté : BPM & clé retirés de l'édition (Rekordbox les détecte ; colonnes conservées en base pour forward-compat)
- [x] Écriture des tags directement dans les fichiers (ID3v2.3 / MP4) — v1.0 (Phase 5 ; TAGS-01/02/03 ; write engine + batch apply + UI "Appliquer". UAT Rekordbox/Mp3tag/crash-safety dans 05-HUMAN-UAT.md)
- [x] Distribution via installeur .dmg (macOS) et .exe (Windows) — v1.0 (Phase 6 ; DIST-01/DIST-02 ; universal `.dmg` + NSIS `.exe` FFmpeg embarqué, GitHub Release, updater cross-platform. Install Windows-hardware dans 06-HUMAN-UAT.md)

### Active

(Aucun — v1.0 shippé. Les requirements du prochain milestone seront définis via `/gsd-new-milestone`.)

### Out of Scope

- Export XML Rekordbox — les tags dans les fichiers suffisent (confirmé en v1)
- Hébergement distant / upload cloud — accès filesystem local requis, Electron plus adapté
- Détection BPM automatique — trop complexe ; en v1 l'édition BPM/clé a même été retirée du Tagger (Rekordbox détecte)
- Linux — trop peu d'utilisateurs dans le public cible DJ (target electron-builder non invoqué)
- Signature / notarisation du code — reporté à v2 ; build v1 non signé (`identity: null`), mais `build/entitlements.mac.plist` conservé donc activer la notarisation reste un changement de config

## Context

- L'utilisateur est DJ et partage l'app avec des amis DJs (pas nécessairement devs) — d'où les docs de premier lancement (clic droit → Ouvrir / SmartScreen → Run anyway) et le pipeline CI qui gère le build Windows que le maintainer (Mac-only) ne peut pas cross-compiler.
- Bibliothèque de quelques milliers de fichiers — scan et conversion tournent sur worker threads (UI non-bloquante).
- Rekordbox est le logiciel de référence : tags ID3v2.3 (pas v2.4) + MP4, écrits atomiquement.
- L'interface de catégorisation (Tinder swipe + waveform) reste le différenciateur.
- Distribution non signée acceptée en v1 (risque assumé, D-01) ; la waveform est décodée côté main via ffmpeg car `decodeAudioData` de pistes complètes crashait le renderer.

## Constraints

- **Plateforme**: Electron (Mac + Windows) — accès filesystem natif + distribution simple pour non-devs
- **Tags**: ID3v2.3 (MP3) et MP4 tags — compatibilité Rekordbox obligatoire
- **Conversion**: FFmpeg en backend — standard industrie, gère tous les formats audio ; binaire embarqué (asarUnpack), fat sur macOS Universal
- **Volume**: Quelques milliers de fichiers — analyse et conversion non-bloquantes (worker threads)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Electron vs web hébergé | Accès filesystem natif, distribution .dmg/.exe pour amis non-devs | ✓ Electron |
| Electron + Node.js vs backend Python | Stack cohérente, libs Node audio solides, pas de process Python à bundler | ✓ Node.js pur |
| Tags dans les fichiers vs XML Rekordbox | Simplicité v1, tags ID3 reconnus nativement | ✓ Tags fichiers |
| FFmpeg pour la conversion | Standard industrie, tous formats, performant | ✓ ffmpeg-static |
| Waveform décodée côté main (ffmpeg) vs renderer | `decodeAudioData` de pistes complètes crashait le renderer nativement | ✓ Phase 4 |
| BPM/clé non éditables dans le Tagger | Rekordbox les détecte ; colonnes gardées pour forward-compat | ✓ décision utilisateur |
| Build macOS Universal via fat ffmpeg (lipo) + `x64ArchFiles` | @electron/universal refuse de merger les binaires identiques entre arches (fixture test better-sqlite3) | ✓ Phase 6 |
| Build v1 non signé (`identity: null`) | Vélocité v1 ; signing-ready via entitlements plist conservé | ✓ risque assumé, signing en v2 |
| Release via CI (tag → build+publish mac & win) | Maintainer Mac-only ; NSIS non cross-compilable depuis macOS | ✓ GitHub Actions |
| Update macOS notify-only (pas de Squirrel.Mac) | Squirrel.Mac exige la signature ; Windows auto-update via electron-updater NSIS | ✓ D-06/D-07/D-08 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition:**
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context / Current State with current state

---
*Last updated: 2026-06-24 after v1.0 milestone completion (Phases 1–6, MVP shipped)*
