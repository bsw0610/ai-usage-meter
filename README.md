# ai-usage-meter

English | [日本語](README.ja.md)

See your Codex and Antigravity usage limits while you work in Claude Code. This mod adds a small band above the prompt with how much of each limit you have used and when it resets.

![The band on the Claude Code desktop app in dark mode, with one row for ChatGPT Codex and one for Gemini in Antigravity](docs/band.png)

*Illustration with example values, drawn from the mod's own graphics in dark mode.*

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install ai-usage-meter --marketplace bsw0610/ai-usage-meter
```

Answer `y` to add the marketplace, then pick a scope.

Or run it from a shell:

```bash
claude plugin install ai-usage-meter --marketplace bsw0610/ai-usage-meter
```

## What you need

| Source | Requirement |
|---|---|
| Codex | The `codex` CLI and Node.js on your `PATH`. Without them, the mod falls back to your recent logs in `~/.codex/sessions`. |
| Antigravity | The `agy` CLI, signed in. Tested with 1.4.12. |

A source whose program isn't on the session's `PATH` gets no row, and its row comes back once the program is found. If neither is found, the band says so.

## Reading the band

| Part | Meaning |
|---|---|
| Logo or name | The source. The desktop shows the logo at every width; the terminal uses the name. |
| `5h` | The five-hour limit |
| `Wk` | The weekly limit |
| `Ar` | Antigravity's separate weekly limit for Gemini Argon |
| Bar and `%` | How much of the limit you have used |
| Time after `%` | Time until the limit resets |
| `—` | No value yet. With enough room, it also says `failed`, `not installed` or `stale`. |
| `↻` at the right end of the first row | Look up every source now. It spins until the lookups finish. |

| Used | Color |
|---|---|
| Up to 79% | Blue |
| 80–99% | Orange |
| 100% | Red and bold |

The band gives up detail as the window narrows: first the minutes, then the bars (all of them at once, so the Argon bar never goes alone), then the long names, and finally the reset times.

In a terminal, the same information is drawn with text:

```
Codex      5h ━━━━──────  41% 4h46m │ Wk ━━━━━━━━╸─  85% 21h13m                           ↻
Gemini(AG) 5h ━─────────  12% 2h31m │ Wk ━━━───────  30% 5d 18h │ Ar ╸───────── 3% 5d 18h
```

## Settings

| Option | Values | Default | Meaning |
|---|---|---|---|
| `language` | `en`, `ja`, `ko` | `en` | The language of the band |
| `sources` | `all`, `codex`, `gemini` | `all` | The sources to look up and show. A source turned off runs nothing. |

Set them when you install from a shell:

```bash
claude plugin install ai-usage-meter --marketplace bsw0610/ai-usage-meter --config language=ja --config sources=codex
```

To change them later, run `/plugin configure ai-usage-meter@claude-code-mods` in a terminal session, or edit `~/.claude/settings.json` and run `/reload-plugins` in the session:

```json
{
  "pluginConfigs": {
    "ai-usage-meter@claude-code-mods": {
      "options": { "language": "ja", "sources": "codex" }
    }
  }
}
```

## What it runs and keeps

- **Codex, every 3 minutes:** runs `codex app-server` and asks for the rate limits, keeping only the percentages, window lengths and reset times. If that fails, it reads your recent logs in `~/.codex/sessions`.
- **Antigravity, every 15 minutes:** runs `agy -p=/usage --output-format json`, with `agy`'s auto-update turned off for that run. After a failure it waits 30 minutes.
- **When you press `↻`:** both lookups run right away, whatever the interval, and the interval starts again from then.
- **Stored values:** usage values and the reason for the last failure are kept in Claude Code's plugin store on your computer, so open sessions can share one lookup.

The mod sends nothing anywhere itself. `codex` and `agy` contact their own services as usual.

## Known limits

- Plugin hooks in Claude Code are in early access and may change between releases.
- The desktop app hides the band while a next-step question box is open, and a new session shows it only after your first message.
- A session only draws the band while you are viewing it.
- The ChatGPT logo is black or white according to the color scheme the app reports, not the band's background, so it could be hard to see if the two ever differ.
- A plan with no five-hour limit shows `Wk` in the first column. This has only been tested with made-up responses, as has the signed-out `agy` case.
- If a plan reports neither a five-hour nor a weekly limit, its row shows `—` even when nothing is wrong.

## Development

```bash
claude plugin test ai-usage-meter
```

```bash
claude plugin validate ai-usage-meter
```

## Credits and trademarks

This is an independent project, not affiliated with or endorsed by OpenAI or Google. ChatGPT, Codex, Gemini and Antigravity are trademarks of their respective owners, and the logos are used only to identify each source. Logo artwork comes from [LobeHub Icons](https://github.com/lobehub/lobe-icons); see [THIRD_PARTY_NOTICES.md](ai-usage-meter/THIRD_PARTY_NOTICES.md).

## License

MIT. See [LICENSE](LICENSE). The license covers this project's own work and gives no rights to the trademarks named above.
