import type { Preset } from '../../../../shared/ipc-types'

/**
 * Locked preset registry (D-CONV-FORMAT). Exact mirror of
 * src/main/conversion/presets.ts so the renderer doesn't import main code.
 *
 * The main side re-validates everything sent over the bridge — this constant
 * is purely for UI rendering of the 5 radio options + their French labels.
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
    codec: 'aac',
    bitrateKbps: 256,
    vbrQuality: null,
    sampleRate: null,
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

/** Allowed codecs for Custom; mirrors main-side CUSTOM_CODEC_ALLOWLIST. */
export const CUSTOM_CODECS = [
  { codec: 'libmp3lame', label: 'MP3', extension: '.mp3' },
  { codec: 'aac', label: 'AAC', extension: '.aac' },
  { codec: 'flac', label: 'FLAC (lossless)', extension: '.flac' },
  { codec: 'pcm_s16le', label: 'WAV PCM 16-bit', extension: '.wav' },
  { codec: 'libopus', label: 'Opus', extension: '.opus' }
] as const

export type CustomCodec = (typeof CUSTOM_CODECS)[number]['codec']

/** Bitrate ignored for lossless codecs. */
export function isLosslessCodec(codec: string): boolean {
  return codec === 'flac' || codec === 'pcm_s16le'
}
