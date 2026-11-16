import type { LicenseType, MediaAsset, MusicCategory } from '@statsopedia/shared-types';

import type { Tone } from './status';

export const MUSIC_CATEGORY_LABEL: Record<MusicCategory, string> = {
  corporate: 'Corporate',
  cinematic: 'Cinematic',
  technology: 'Technology',
  energetic: 'Energetic',
  ambient: 'Ambient',
  documentary: 'Documentary',
};

export const LICENSE_TYPE_LABEL: Record<LicenseType, string> = {
  royalty_free: 'Royalty-free',
  creative_commons: 'Creative Commons',
  public_domain: 'Public domain',
  commercial: 'Commercial license',
  original: 'Original work',
  other: 'Other',
};

/** Whether a track may be used in published (monetized) videos. */
export function commercialUse(asset: Pick<MediaAsset, 'commercialUse'>): {
  tone: Tone;
  label: string;
} {
  if (asset.commercialUse === true) return { tone: 'good', label: 'Commercial use' };
  if (asset.commercialUse === false) return { tone: 'critical', label: 'Non-commercial' };
  return { tone: 'warning', label: 'Use not recorded' };
}

/** "−14 LUFS · peak −1.2 dBTP" */
export function loudnessLabel(asset: Pick<MediaAsset, 'audio'>): string | null {
  if (!asset.audio) return null;
  const { integratedLufs, truePeakDbtp } = asset.audio;
  const parts = [
    integratedLufs === null ? 'silent' : `${integratedLufs.toFixed(1)} LUFS`,
    truePeakDbtp === null ? null : `peak ${truePeakDbtp.toFixed(1)} dBTP`,
  ];
  return parts.filter(Boolean).join(' · ').replaceAll('-', '−');
}
