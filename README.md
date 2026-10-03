# claude-code-mods

Two small [Claude Code](https://claude.com/claude-code) mods (function-hook plugins) as a plugin marketplace.

## usage-bars

One row under the prompt, refreshed after every turn:

![usage-bars](docs/usage-bars.png)

| Group | Shows |
|---|---|
| `⎇` | git branch, `●` uncommitted files, `↑`/`↓` commits ahead of / behind upstream, `✓` when clean |
| `◆` | the model the main loop runs and its effort level |
| `ctx` | context-window fill over the last 8 turns, then the live % and tokens / window |
| `tok` | what each turn cost (bars), then live session figures, subagents included: `in` tokens read (cached or not), `out` tokens generated, the latest request's cache `hit` rate (yellow below 90 %, red below 50 %: the cache went cold) and the session cost in `$` as Claude Code prices it |
| `5h` / `7d` | your rate-limit windows: % used and time until reset (subscription accounts) |

Charts turn yellow from 60 % and red from 85 %. The row wraps on narrow terminals.

### What the numbers mean (and don't)

- **`$` is an estimate.** It is Claude Code's own figure (the one `/cost` shows): each response's reported token counts times the published per-model prices, so input, output, cache writes and cache reads are already weighted correctly. On the API that is close to your bill, but the Console's usage page is authoritative: server-tool fees (web search), 1-hour cache writes, fast mode, data-residency and other pricing modifiers, or Bedrock / Vertex prices can make the invoice differ.
- **On a subscription (Pro / Max) you are not billed per token.** Anthropic does not publish how the 5-hour and weekly limits are counted, so `$` is only a relative gauge of which turns were heavy. The `5h` / `7d` percentages are the official figures; they come straight from Anthropic's rate-limit data.
- **`in` is volume, not cost.** It counts cached and uncached input alike; a cache read costs a fraction of a fresh input token (for example 0.05x on Opus 5.5) and output costs 5x input. Only `$` applies those weights.
- **`in`, `out` and `hit` count what the mod has seen** since it loaded in a session; `$` covers the whole session.

## agent-watch

When a subagent starts, a narrow pane docks beside the transcript and follows each agent live: type, elapsed time, tool count, its latest tool calls (`›` running, `✓` / `✗` done) and the tail of what it is writing. Finished agents collapse to one line; the pane closes itself 20 s after the last one ends.

![agent-watch](docs/agent-watch.png)

The pane opens on its own from 144 terminal columns (a Claude Code rule for panes nobody asked for); on a narrower terminal run `/agents-pane`.

## Install

```
/plugin marketplace add AndreasOA/claude-code-mods
/plugin install usage-bars@ao-claude-mods
/plugin install agent-watch@ao-claude-mods
```

Restart Claude Code (or open a new session) to load them. `/plugin marketplace update ao-claude-mods` pulls new versions.

## Develop

Each plugin is `plugins/<name>/` with `hooks/register.tsx`, its state contract in `types/index.d.ts` and tests in `tests/`.

```
claude plugin validate plugins/usage-bars
claude plugin test plugins/usage-bars
claude --plugin-dir plugins/usage-bars   # load a working copy, hot-reloaded on save
```

The images in `docs/` are illustrations of the layout, not screenshots.

## License

MIT
