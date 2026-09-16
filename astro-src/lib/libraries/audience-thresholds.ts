// astro-src/lib/libraries/audience-thresholds.ts
//
// R7 LP.1: Audience threshold table for library filtering.
//
// Provides threshold presets for 4 audience profiles:
// novice, expert, reviewer, practitioner.

/** Audience profile types. */
export type AudienceProfile = 'novice' | 'expert' | 'reviewer' | 'practitioner';

/** Threshold values for a given audience profile. */
export interface AudienceThresholds {
  minRelevance: number;
  minQuality: number;
  maxResults: number;
}

/**
 * Get threshold values for a given audience profile.
 *
 * @param audience - The audience profile
 * @returns Threshold configuration object
 *
 * Thresholds:
 * - novice: low thresholds (accessibility focus)
 * - expert: high thresholds (quality focus)
 * - reviewer: very high thresholds (rigor focus)
 * - practitioner: mid thresholds (practicality focus)
 */
export function getThresholdsForAudience(
  audience: AudienceProfile
): AudienceThresholds {
  const thresholds: Record<AudienceProfile, AudienceThresholds> = {
    novice: {
      minRelevance: 0.50,
      minQuality: 0.45,
      maxResults: 50,
    },
    expert: {
      minRelevance: 0.75,
      minQuality: 0.70,
      maxResults: 20,
    },
    reviewer: {
      minRelevance: 0.80,
      minQuality: 0.75,
      maxResults: 15,
    },
    practitioner: {
      minRelevance: 0.60,
      minQuality: 0.55,
      maxResults: 30,
    },
  };

  return thresholds[audience];
}

/**
 * Get all available audience profiles.
 */
export function getAllAudienceProfiles(): AudienceProfile[] {
  return ['novice', 'expert', 'reviewer', 'practitioner'];
}

/**
 * Get a human-readable label for an audience profile.
 */
export function getAudienceLabel(audience: AudienceProfile): string {
  const labels: Record<AudienceProfile, string> = {
    novice: 'Novice (入门小白)',
    expert: 'Expert (深耕专家)',
    reviewer: 'Reviewer (专业审稿人)',
    practitioner: 'Practitioner (工业实践者)',
  };
  return labels[audience];
}
