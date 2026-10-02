/**
 * Builds the "setup prompt" an owner pastes into their coding agent (§22).
 * It names the room URL, the immutable room id, and the live manifest URL/version
 * so the agent knows exactly where to post its questions and read answers.
 */
export interface SetupPromptInput {
  roomUrl: string;
  roomId: string;
  manifestUrl: string;
  manifestVersion: string;
}

export function buildSetupPrompt({ roomUrl, roomId, manifestUrl, manifestVersion }: SetupPromptInput): string {
  return [
    `You now have an Ask room for this project. Use it to raise the decisions and`,
    `clarifications you would normally guess at — I'll answer them there, live.`,
    ``,
    `Room: ${roomUrl}`,
    `Room ID: ${roomId}`,
    `Integration manifest: ${manifestUrl} (schema v${manifestVersion})`,
    ``,
    `How to use it:`,
    `1. Read the manifest above to discover the HTTP endpoints and the project`,
    `   skill for your agent (Claude Code, Codex, Cursor, Gemini CLI, OpenCode, or`,
    `   the generic HTTP helper).`,
    `2. At the start of a task — and at every real decision point — post the`,
    `   questions you'd otherwise assume answers to: single/multiple choice, short`,
    `   or long text, a number, a range, or a link. For each, include why it`,
    `   matters now and what different answers would change. Keep working on`,
    `   anything that isn't blocked.`,
    `3. Poll the room (or subscribe) for my answers and apply them, recording a`,
    `   receipt when you download, apply, or verify each one.`,
    ``,
    `Don't block the whole task on a single question — mark what truly blocks work`,
    `and proceed on the rest.`,
  ].join('\n');
}
