/**
 * Memorable, pronounceable slug generation from curated dictionaries (§4).
 * Random internally, but the visible result looks intentional — never a UUID.
 * Uniqueness is enforced in storage; this only proposes candidates.
 */
import { LIMITS, RESERVED_SLUGS } from '@ask/contracts';

const ADJECTIVES = [
  'amber', 'azure', 'brave', 'bright', 'calm', 'cedar', 'clever', 'cobalt', 'copper', 'coral',
  'cosmic', 'crimson', 'crisp', 'dapper', 'dawn', 'deft', 'eager', 'ember', 'fair', 'fleet',
  'gentle', 'gilded', 'golden', 'granite', 'hazel', 'ivory', 'jade', 'keen', 'lively', 'lunar',
  'maple', 'mellow', 'merry', 'mint', 'misty', 'noble', 'olive', 'opal', 'plum', 'polar',
  'quiet', 'rapid', 'rising', 'royal', 'ruby', 'sage', 'scarlet', 'silver', 'sleek', 'solar',
  'spruce', 'stellar', 'sunny', 'swift', 'teal', 'tidy', 'topaz', 'velvet', 'vivid', 'warm',
];

const NOUNS = [
  'acorn', 'anchor', 'arbor', 'aurora', 'badge', 'beacon', 'brook', 'canyon', 'cedar', 'cipher',
  'comet', 'cove', 'crane', 'delta', 'dune', 'ember', 'falcon', 'fern', 'fjord', 'forge',
  'garden', 'glade', 'harbor', 'haven', 'heron', 'island', 'juniper', 'kernel', 'lantern', 'ledger',
  'maple', 'meadow', 'meridian', 'nimbus', 'oasis', 'orbit', 'otter', 'pine', 'prism', 'quartz',
  'quill', 'raven', 'reef', 'ridge', 'river', 'signal', 'slate', 'sparrow', 'summit', 'thistle',
  'tide', 'trellis', 'vale', 'vertex', 'willow', 'wren', 'zephyr', 'zenith', 'orchard', 'cobble',
];

/** Component substrings that must never appear in a generated slug. */
const OFFENSIVE_FRAGMENTS = ['ass', 'sex', 'nsfw', 'kill', 'die', 'fck', 'fuk', 'shit', 'cunt', 'rape'];

function pick<T>(arr: readonly T[]): T {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return arr[n[0]! % arr.length] as T;
}

/** Normalize a user-entered slug: lowercase, trim, collapse separators. */
export function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function isReserved(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug);
}

function isOffensive(slug: string): boolean {
  const flat = slug.replace(/-/g, '');
  return OFFENSIVE_FRAGMENTS.some((frag) => flat.includes(frag));
}

/** Validate a candidate for length, shape, reserved + offensive screening. */
export function isValidSlug(slug: string): boolean {
  if (slug.length < LIMITS.slugMin || slug.length > LIMITS.slugMax) return false;
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug)) return false;
  if (isReserved(slug)) return false;
  if (isOffensive(slug)) return false;
  return true;
}

/**
 * Generate a memorable candidate. `words=3` adds a second adjective instead of
 * numeric noise when a shorter name collides (§4).
 */
export function generateSlug(words: 2 | 3 = 2): string {
  for (let i = 0; i < 12; i += 1) {
    const parts = words === 3 ? [pick(ADJECTIVES), pick(ADJECTIVES), pick(NOUNS)] : [pick(ADJECTIVES), pick(NOUNS)];
    const slug = parts.join('-');
    if (isValidSlug(slug)) return slug;
  }
  // Extremely unlikely fallback — still word-based, never a UUID.
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${pick(NOUNS)}`;
}
