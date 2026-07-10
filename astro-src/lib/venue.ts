// astro-src/lib/venue.ts
//
// 把论文的 `source` 字段(如 "icml-openreview")映射成人类可读的会议名
// (如 "ICML 2025")和接收状态。仅会议源返回 venue;非会议源返回空字符串 + null。
//
// 用法:
//   import { extractVenue } from './venue';
//   const { venue, accepted } = extractVenue("icml-openreview", "ICML-2025-Accepted");
//   // -> { venue: "ICML 2025", accepted: true }

export interface VenueInfo {
  venue: string;       // "ICML 2025" 或 ""(非会议论文)
  accepted: boolean;   // 仅会议论文有意义
}

/**
 * Map source-id (as emitted by `init_*.py --papers-table` / Supabase row `source`)
 * to a display name + flag whether it's a conference source.
 *
 * Keep this table in sync with sql/sources.yaml and src/maintain/init_*.py.
 */
const CONFERENCE_SOURCE_LABELS: Record<string, string> = {
  aaai: "AAAI",
  acl: "ACL",
  emnlp: "EMNLP",
  iclr_openreview: "ICLR",
  icml_openreview: "ICML",
  neurips_openreview: "NeurIPS",
};

/**
 * Extract venue + accepted from the raw `source` field of a paper row.
 *
 * - Non-conference source (arxiv / biorxiv / medrxiv / chemrxiv / etc.):
 *     returns { venue: "", accepted: false } so callers can short-circuit on
 *     venue.length === 0.
 * - Conference source without a tagged value (e.g. "icml-openreview"):
 *     returns the conference label with no year + accepted=false (caller can
 *     render "ICML" or hide the badge — picked to hide if no year).
 * - Conference source with a tagged value (e.g. "ICML-2025-Accepted"):
 *     parses tag and returns full "ICML 2025" + accepted flag.
 */
export function extractVenue(rawSource: string | undefined | null): VenueInfo {
  if (!rawSource) return { venue: "", accepted: false };
  const source = String(rawSource).trim();
  if (!source) return { venue: "", accepted: false };

  // Conference tagged value: "ICML-2025-Accepted" / "NeurIPS-2024-Public" / etc.
  // Pattern: <UPPER_TAG>-<YEAR>-<STATUS>
  const taggedMatch = source.match(/^([A-Z]+)-(\d{4})-(.+)$/);
  if (taggedMatch) {
    const [, tag, year, status] = taggedMatch;
    const normalized = String(tag).toUpperCase();
    // Find canonical label from CONFERENCE_SOURCE_LABELS by tag
    const label = Object.values(CONFERENCE_SOURCE_LABELS).find(
      (v) => v.toUpperCase() === normalized,
    );
    if (label) {
      const accepted =
        status.toLowerCase() === "accepted" ||
        status.toLowerCase() === "oral" ||
        status.toLowerCase() === "poster" ||
        status.toLowerCase() === "spotlight";
      return { venue: `${label} ${year}`, accepted };
    }
  }

  // Plain conference source id (no tag yet — pre-backfill state)
  const label = CONFERENCE_SOURCE_LABELS[source.toLowerCase()];
  if (label) {
    return { venue: label, accepted: false };
  }

  // Non-conference source — arxiv / biorxiv / medrxiv / chemrxiv / etc.
  return { venue: "", accepted: false };
}