# Claude Code tooling — installation report

Installed and verified on 2026-11-18, macOS 26.6.2 (Apple silicon). Everything is
user-level: nothing needed `sudo`, and no Greenr source file was changed.

## Result

| Tool | Version | Status | How it is set up |
|---|---|---|---|
| RTK (Rust Token Killer) | 1.2.0 | ✅ verified | Global `PreToolUse` hook on Bash (`rtk hook claude`) + 8-line `~/.claude/RTK.md` |
| Serena-Slim | — | ❌ not installed | Incompatible and unverifiable; see below |
| Serena (official, slim config) | 2.1.0 | ✅ verified | User-scope MCP server, `--context claude-code`, 2 tools |
| Claude-Mem | 16.0.0 | ✅ verified | Plugin + local worker (port 37701), Anthropic-plan provider, cloud sync off |
| Everything Claude Code (ECC) | 2.2.3 | ✅ verified (selective) | 8 skills + path-scoped TypeScript rules, no hooks, no agents |
| Playwright MCP | 0.0.86 | ✅ verified | User-scope MCP server, system Chrome, headless, isolated |

Prerequisites installed (none were present): Node.js 26.13.1 LTS (official tarball,
SHA-256 checked) in `~/.local/opt/node`; uv 0.13.9 (GitHub release, SHA-256 checked);
the Claude Code CLI 2.1.328 (official installer) in `~/.local/bin/claude`, needed by
Claude-Mem; Bun 1.4.4 (installed by Claude-Mem).

## Verification evidence

- **RTK**: simulated hook call rewrote `git status` → `rtk git status`; a real
  headless Claude Code session was rewritten too (`rtk gain` count rose). Output of
  `git status` here: 741 → 302 bytes (59 % smaller).
- **Serena**: MCP handshake in this repo; `get_symbols_overview` and
  `find_referencing_symbols` returned correct TypeScript results (language server
  working). `claude mcp list`: ✔ Connected.
- **Claude-Mem**: `doctor` all required checks pass. Cross-session test in a scratch
  project: session 1 recorded a decision; a NEW session, with file tools disabled,
  answered it correctly from injected memory.
- **ECC**: a real session listed all 8 skills; the TypeScript rules were absent
  before reading a `.ts` file and present after (path-scoped as intended).
- **Playwright**: MCP handshake, 25 tools, navigated headless Chrome to a real page.
  `claude mcp list`: ✔ Connected.

## Token-saving configuration

- MCP tool definitions are deferred by Claude Code's tool search, so they cost
  nothing until used. Serena exposes only 2 tools (~1.1 k tokens if loaded).
- RTK compresses shell output (59–63 % so far).
- Serena: answers capped at 30 000 chars (was 150 000); dashboard does not open a tab.
- Claude-Mem: mode `code--chill` (stores only what is costly to rediscover), 25
  observations + 5 session summaries injected (was 50 + 10), observer on Haiku,
  23 of 30 bundled skills disabled → always-on cost **~697 tokens** (was ~2 890).
- ECC: 8 relevant skills (~550 tokens of listing) instead of the full plugin's
  ~300 skills, ~70 agents and ~100 commands. TypeScript rules load only for `.ts/.tsx/.js`.
  ECC agents were left out: their "MUST BE USED" descriptions trigger costly sub-agents.
- Playwright: `--console-level error`, `--no-webmcp`; after navigation the page
  snapshot is saved to `~/.cache/playwright-mcp` and linked, not pasted into the chat.

## Decisions worth knowing

- **Serena-Slim was replaced by official Serena.** Its latest npm release ships
  only Windows binaries (cannot run on this Mac); older releases contain a
  prebuilt "mcpslim" bridge whose source is not published, from a single
  maintainer (~31 weekly downloads). Serena 2.1 already exposes just 2 tools,
  which achieves the same goal.
- **Claude-Mem uses your Anthropic plan** (`--provider claude`), so session
  content goes only to Anthropic, not to cmem.ai. Its anonymous telemetry was
  disabled. Your native Claude Code memory was left enabled.
- **ECC was copied selectively** from the pinned package rather than via its
  installer, which pulls in hundreds of extra files (137–756 operations).

## Files changed outside the project

Backups of the originals: `~/.claude/backups/pre-tooling-2026-11-18/`.

- `~/.claude/settings.json` — RTK hook, `enabledPlugins: claude-mem` (model settings kept)
- `~/.claude.json` — MCP servers `serena`, `playwright` (user scope)
- `~/.claude/CLAUDE.md` (`@RTK.md`), `~/.claude/RTK.md`
- `~/.claude/skills/{verification-loop,tdd-workflow,security-review,e2e-testing,react-native-patterns,postgres-patterns,database-migrations,strategic-compact}`
- `~/.claude/rules/ecc/typescript/` (5 files)
- `~/.zprofile`, `~/.zshrc` — PATH for `~/.local/bin`, Node and Bun (new files)
- `~/.serena/serena_config.yml`, `~/.claude-mem/settings.json`

Program folders added: `~/.local/{bin,opt,share}`, `~/.bun`, `~/.claude-mem`,
`~/.claude/plugins/{marketplaces,cache}/thedotmack`, `~/.cache/playwright-mcp`.

In this repo: `.serena/` (project config; its own `.gitignore` excludes the cache).

## Needs attention

1. **Quit VS Code completely (Cmd+Q) and reopen it.** Hooks and MCP servers need
   the new PATH; until then RTK and Claude-Mem hooks cannot find their commands.
   Then run `/mcp` in Claude Code: serena, playwright and claude-mem should be listed.
2. **Your Claude sign-in expires between Nov 22 and Nov 25.** Run `claude auth login`
   before then (Claude-Mem's observer uses the same login).
3. **`.serena/` is untracked** in this public repo. It holds no secrets; commit it
   or add `.serena/` to `.gitignore`.
4. Claude-Mem's observer uses some of your plan: Haiku, about 4–5 k tokens per
   observer turn in testing (mostly cache). To stop it: `claude plugin disable claude-mem@thedotmack`.
5. Test memories from verification exist under project `memtest-project`; they
   never appear in Greenr sessions.
6. ECC's `tdd-workflow` mentions an ECC-only helper script that does not exist here;
   harmless. Playwright is pinned to 0.0.86; update by editing the version in `~/.claude.json`.
7. Playwright saves a screenshot given an explicit file name relative to the project
   folder (only auto-named files go to `~/.cache/playwright-mcp`), found while testing
   it on Greenr's screens. Check for stray `.png` files before committing.

## Undo

`rtk init -g --uninstall` · `claude mcp remove serena -s user` ·
`claude mcp remove playwright -s user` · `npx claude-mem uninstall` ·
delete the ECC folders listed above · restore `~/.claude/backups/pre-tooling-2026-11-18/`.
