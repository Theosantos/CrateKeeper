import type { Preset } from '../../shared/ipc-types'

/**
 * Locked preset registry (D-CONV-FORMAT). Exactly 5 entries in declared order.
 *
 * AAC uses the native `aac` encoder (NOT `libfdk_aac`) — ffmpeg-static ships
 * without libfdk for GPL licensing reasons (RESEARCH Pitfall 2). Native aac
 * is acceptable quality for DJ use at 256 kbps.
 */
export const PRESETS: ReadonlyArray<Preset> = [
  {
    slug: 'mp3-320',
    label: 'MP3 320 kbps (CBR)',
    codec: 'libmp3lame',
    bitrateKbps: 320,
    vbrQuality: null,
    sampleRate: null,
    extension: '.mp3'
  },
  {
    slug: 'mp3-v0',
    label: 'MP3 V0 (VBR ~245 kbps)',
    codec: 'libmp3lame',
    bitrateKbps: null,
    vbrQuality: 0,
    sampleRate: null,
    extension: '.mp3'
  },
  {
    slug: 'aac-256',
    label: 'AAC 256 kbps',
    // NOTE: native aac encoder, NOT libfdk_aac — see RESEARCH Pitfall 2.
    codec: 'aac',
    bitrateKbps: 256,
    vbrQuality: null,
    sampleRate: null,
    // ADTS container — RESEARCH Pitfall 7 locks Custom-target to .aac (not .m4a) for v1.
    extension: '.aac'
  },
  {
    slug: 'flac',
    label: 'FLAC (lossless)',
    codec: 'flac',
    bitrateKbps: null,
    vbrQuality: null,
    sampleRate: null,
    extension: '.flac'
  },
  {
    slug: 'wav',
    label: 'WAV 16-bit',
    codec: 'pcm_s16le',
    bitrateKbps: null,
    vbrQuality: null,
    sampleRate: null,
    extension: '.wav'
  }
]

/**
 * Build the ffmpeg argv array for converting `src` to `out` using `preset`.
 *
 * Order matters for ffmpeg:
 *   1. global flags (-hide_banner, -loglevel, -stats, -y)
 *   2. input (-i src)
 *   3. codec + bitrate/VBR + sample rate
 *   4. metadata flags (-map_metadata 0, optionally -id3v2_version 3 for .mp3)
 *   5. output path LAST
 *
 * `-id3v2_version 3` is the Rekordbox-compat lock (CONV-06) and is appended
 * ONLY when the target extension is `.mp3`. FLAC/WAV/AAC targets do not carry
 * ID3 frames natively.
 */
export function buildFfmpegArgs(src: string, out: string, preset: Preset): string[] {
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-stats', '-y', '-i', src]

  args.push('-c:a', preset.codec)

  if (preset.bitrateKbps !== null) {
    args.push('-b:a', `${preset.bitrateKbps}k`)
  } else if (preset.vbrQuality !== null) {
    args.push('-q:a', String(preset.vbrQuality))
  }

  if (preset.sampleRate !== null) {
    args.push('-ar', String(preset.sampleRate))
  }

  args.push('-map_metadata', '0')
  if (preset.extension === '.mp3') {
    args.push('-id3v2_version', '3')
  }

  args.push(out)
  return args
}

/** Linear lookup by slug. Returns undefined when no preset matches. */
export function getPresetBySlug(slug: string): Preset | undefined {
  return PRESETS.find((p) => p.slug === slug)
}

/** Trivial slug accessor — used by the controller to compose outputDir. */
export function presetSlugOf(preset: Preset): string {
  return preset.slug
}
