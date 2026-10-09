# Claude Code session mods

Two mods for Claude Code (terminal or the desktop app's Code tab):

- **agent-monitor**: a line above the prompt that says which agents and subagents are running, as a tree, with each one's model, effort, status, elapsed time and prompt-cache hit rate. Idle it reads `Agents: none running · main <model> · <effort>`. `/agents` opens a pane with the full list and a legend.
- **usage-limits**: a line above the prompt with colored bars for the 5-hour limit, the weekly limit, the per-model weekly limit, context-window fill and prompt-cache hit rate. `/limits` opens a pane with the full bars and reset times.

Bars are green under 25%, yellow to 50%, orange to 75%, red past it. The cache bar runs the other way, since a high hit rate is good.

## Install (one time, about 2 minutes)

You need Claude Code installed and signed in. Open any terminal.

1. Add this repository as a plugin marketplace:

   ```bash
   claude plugin marketplace add <owner>/<repo>
   ```

   Answer `y` when it asks to add the marketplace.

2. Install both mods at the user scope (so they load in every session, desktop app included):

   ```bash
   claude plugin install agent-monitor@eugene-mods
   ```

   ```bash
   claude plugin install usage-limits@eugene-mods
   ```

   Pick **User** when it asks for a scope.

3. Start a new Claude Code session. The two lines appear above the prompt. In a session that was already open, type `/reload-plugins`.

If the terminal says `claude: command not found` but the desktop app works, the app's bundled binary is at a path like `~/Library/Application Support/Claude/claude-code/<version>/<hash>/claude.app/Contents/MacOS/claude` on macOS. Add a function to `~/.zshrc` so `claude` resolves:

```bash
claude() { "$HOME/Library/Application Support/Claude/claude-code/<version>/<hash>/claude.app/Contents/MacOS/claude" "$@"; }
```

## Alternative: load from a folder without installing

Clone the repository anywhere, then point Claude Code at the two mod folders. In `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/repo/agent-monitor:/path/to/repo/usage-limits"
  }
}
```

Every new session loads them, and edits to the folders hot-reload. On Windows separate the paths with `;`.

For a single terminal session only:

```bash
claude --plugin-dir /path/to/repo/agent-monitor --plugin-dir /path/to/repo/usage-limits
```

## Checking a mod

```bash
claude plugin validate /path/to/repo/agent-monitor
```

```bash
claude plugin test /path/to/repo/agent-monitor
```

## Uninstall

```bash
claude plugin uninstall agent-monitor@eugene-mods
```

## Layout

```
.claude-plugin/marketplace.json   lists the two mods
agent-monitor/
  .claude-plugin/plugin.json      name, version, types
  hooks/hooks.json                points at the module
  hooks/register.tsx              the mod
  hooks/register.test.tsx         its tests
  types/index.d.ts                its state contract
usage-limits/                     same shape
```
