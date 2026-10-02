/** Opaque id + token generation. Workers expose a global Web Crypto. */

const hex = (): string => crypto.randomUUID().replace(/-/g, '');

export const newRoomId = (): string => `rm_${hex()}`;
export const newQuestionId = (): string => `q_${hex()}`;
export const newAnswerId = (): string => `a_${hex()}`;
export const newDecisionId = (): string => `d_${hex()}`;
export const newReceiptId = (): string => `rcpt_${hex()}`;
export const newParticipantId = (): string => `p_${hex()}`;
export const newInstallId = (): string => `ai_${hex()}`;
export const newEventId = (): string => `e_${hex()}`;

/** High-entropy secret (owner capability / agent token). 256 bits, url-safe base64. */
export function newSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** SHA-256 verifier for a capability — only the verifier is stored server-side (§4). */
export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
