# ghostvvriter

Content creation engine for [Visualize Value](https://visualizevalue.com). An MCP server that generates articles from Jack Butcher's tweet archive and visual library.

No searching. No setup. Connect it and say "write me an article."

## Install

```bash
npx ghostvvriter
```

### Claude Code

```bash
claude mcp add ghostvvriter -- npx ghostvvriter
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ghostvvriter": {
      "command": "npx",
      "args": ["ghostvvriter"]
    }
  }
}
```

## How it works

One command: `vvrite`

1. Call `vvrite` with no arguments
2. Pick from 3 article concepts
3. Article saves to `~/ghostvvriter/` and opens in your browser

The tool loads a randomized sample of ~250 tweets (top performers, mid-tier, deep cuts) alongside ~150 VV visuals. The AI finds the interesting idea clusters. Every call shuffles the sample — you never get the same suggestions twice.

You don't need to know what to look for. The archive surfaces the ideas.

## Built by

[Visualize Value](https://visualizevalue.com) · [Jack Butcher](https://x.com/jackbutcher)

## License

MIT
