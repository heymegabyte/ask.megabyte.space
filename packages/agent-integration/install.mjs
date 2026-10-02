#!/usr/bin/env node
/**
 * install.mjs — idempotent Ask integration installer.
 *
 * Detects the host agent, writes the skill to the host's expected path (plus the
 * universal portable copy), wires host automation where supported, and records a
 * manifest of every created file + managed block to `.ask/local/manifest.json`
 * so `node bin/ask.mjs uninstall` can reverse everything.
 *
 * Node built-ins only. Safe to re-run — converges, never clobbers user edits.
 *
 * Usage:
 *   node install.mjs [--host <claude-code|codex|cursor|gemini|opencode|generic>]
 *                    [--json]
 *
 * Host detection order: --host flag > env signals > generic (portable skill only).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = HERE;
const PROJECT_ROOT = process.cwd();

const MANIFEST_FILE = join('.ask', 'local', 'manifest.json');

function abs(p) {
  return join(PROJECT_ROOT, p);
}

function loadManifest() {
  const full = abs(MANIFEST_FILE);
  if (existsSync(full)) {
    try {
      const m = JSON.parse(readFileSync(full, 'utf8'));
      m.files = Array.isArray(m.files) ? m.files : [];
      m.managedBlocks = Array.isArray(m.managedBlocks) ? m.managedBlocks : [];
      return m;
    } catch {
      /* fall through */
    }
  }
  return {
    schema: 1,
    createdAt: new Date().toISOString(),
    files: [],
    managedBlocks: [],
    host: null,
  };
}

function saveManifest(m) {
  const full = abs(MANIFEST_FILE);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(m, null, 2) + '\n');
}

function trackCreated(relPath) {
  const m = loadManifest();
  if (!m.files.includes(relPath)) {
    m.files.push(relPath);
    saveManifest(m);
  }
}

/** Copy a file only if the destination does not already exist; track if created. */
function copyIfAbsent(srcRel, destRel) {
  const src = join(PKG_ROOT, srcRel);
  const dest = abs(destRel);
  mkdirSync(dirname(dest), { recursive: true });
  const preexisted = existsSync(dest);
  cpSync(src, dest);
  if (!preexisted) trackCreated(destRel);
  return destRel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Host detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Supported host matrix. `skillPath` is where that host discovers project skills;
 * `automation` names whether the host can run event hooks we generate.
 */
const HOSTS = {
  'claude-code': {
    label: 'Claude Code',
    skillPath: '.claude/skills/ask-project/SKILL.md',
    automation: 'hooks',
    adapter: './adapters/claude-code.mjs',
  },
  codex: {
    label: 'Codex',
    skillPath: '.codex/skills/ask-project/SKILL.md',
    automation: 'hooks-if-supported',
  },
  cursor: {
    label: 'Cursor',
    skillPath: '.cursor/rules/ask-project.md',
    automation: 'hooks-if-supported',
  },
  gemini: {
    label: 'Gemini CLI',
    skillPath: '.gemini/skills/ask-project/SKILL.md',
    automation: 'hooks-if-supported',
  },
  opencode: {
    label: 'OpenCode',
    skillPath: '.opencode/skills/ask-project/SKILL.md',
    automation: 'hooks-if-supported',
  },
  generic: {
    label: 'Generic (HTTP fallback)',
    skillPath: '.ask/SKILL.md',
    automation: 'manual',
  },
};

function detectHost(flag) {
  if (flag && HOSTS[flag]) return flag;
  if (flag && !HOSTS[flag]) {
    process.stderr.write(`ask ! unknown --host "${flag}"; falling back to detection.\n`);
  }
  if (existsSync(abs('.claude')) || process.env.CLAUDECODE || process.env.CLAUDE_CODE)
    return 'claude-code';
  if (existsSync(abs('.cursor')) || process.env.CURSOR) return 'cursor';
  if (existsSync(abs('.codex')) || process.env.CODEX_SANDBOX) return 'codex';
  if (existsSync(abs('.gemini')) || process.env.GEMINI_CLI) return 'gemini';
  if (existsSync(abs('.opencode'))) return 'opencode';
  return 'generic';
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') args.json = true;
    else if (t === '--host') args.host = argv[++i];
  }
  return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// Install
// ─────────────────────────────────────────────────────────────────────────────

async function installForHost(hostKey) {
  const host = HOSTS[hostKey];
  const created = [];

  // Always write the portable copy under .ask/ so any agent (even unknown) can read it.
  created.push(copyIfAbsent('SKILL.md', '.ask/SKILL.md'));

  // Write the host-specific skill path (unless it IS the portable path).
  if (host.skillPath !== '.ask/SKILL.md') {
    created.push(copyIfAbsent('SKILL.md', host.skillPath));
  }

  // Claude Code: run the full adapter (host skill already covered; adds hooks + settings).
  let automation = host.automation;
  if (hostKey === 'claude-code') {
    const mod = await import('./adapters/claude-code.mjs');
    const r = mod.install();
    created.push(r.hook, r.settings);
    automation = `hooks (SessionStart, UserPromptSubmit, PostToolUse≥${r.throttleSeconds}s, Stop)`;
  }

  // Record host into the manifest for uninstall + status.
  const m = loadManifest();
  m.host = hostKey;
  saveManifest(m);

  return {
    hostKey,
    label: host.label,
    skillPath: host.skillPath,
    automation,
    created: [...new Set(created)],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const hostKey = detectHost(args.host);
  const result = await installForHost(hostKey);

  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + '\n');
    return;
  }

  process.stderr.write(`ask ✓ installed for ${result.label}\n`);
  process.stderr.write(`  skill     → ${result.skillPath}\n`);
  process.stderr.write(`  portable  → .ask/SKILL.md\n`);
  process.stderr.write(`  automation→ ${result.automation}\n`);
  process.stderr.write(`\nNext: node bin/ask.mjs connect <roomUrl>  →  node bin/ask.mjs sync\n`);
  if (hostKey === 'generic') {
    process.stderr.write(
      `\nThis host has no verified hook support — run \`node bin/ask.mjs sync\` on a\n` +
        `cadence yourself (e.g. at session start + checkpoints). The skill explains the loop.\n`,
    );
  }
}

export { HOSTS, detectHost, installForHost };

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  await main();
}
