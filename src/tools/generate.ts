import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { dataDir } from '../paths.js'

type Tweet = {
  id: string
  text: string
  date: string
  likes: number
  rts: number
}

type Visual = {
  id: string
  schema: string
  data: {
    text: string | null
    source: string | null
    image: { id: string; cdn: string; path: string; type: string }
    tags: string[]
  }
  publishedAt: string
}

let tweetsCache: Tweet[] | null = null
let visualsCache: Visual[] | null = null

function loadTweets(): Tweet[] {
  if (tweetsCache) return tweetsCache
  const raw = readFileSync(join(dataDir, 'tweet-index.json'), 'utf-8')
  tweetsCache = JSON.parse(raw)
  return tweetsCache!
}

function loadVisuals(): Visual[] {
  if (visualsCache) return visualsCache
  const raw = readFileSync(join(dataDir, 'visual-index.json'), 'utf-8')
  visualsCache = JSON.parse(raw)
  return visualsCache!
}

function loadDescriptions(): Record<string, string> {
  try {
    const raw = readFileSync(join(dataDir, 'visual-descriptions.json'), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function imageUrl(img: { id: string; cdn: string; path: string; type: string }): string {
  return `https://${img.cdn}.cdn.vv.xyz/${img.path}/${img.id}.${img.type}`
}

function shuffleSample<T>(arr: T[], n: number): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

function esc(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function registerGenerateTools(server: McpServer) {
  server.tool(
    'vvriter',
    `The only tool. Two modes:

**Mode 1 — Suggest:** Call with no arguments (or just a topic). Returns a randomized sample of Jack Butcher's tweet archive and VV visuals. You read through it, find the interesting idea clusters, and present 3 numbered options to the user.

**Mode 2 — Generate:** Call with title, angle, tweet_ids, and visual_ids. Writes the article, saves it as a styled HTML file to ~/vvriter/, and returns the file path. Then open it in the browser.

Flow: vvriter() → user picks a number → vvriter(title, angle, ids) → open file`,
    {
      topic: z
        .string()
        .optional()
        .describe('Optional topic to bias the sample. Usually omitted.'),
      title: z
        .string()
        .optional()
        .describe('Article title (triggers generate mode)'),
      angle: z
        .string()
        .optional()
        .describe('One-sentence thesis'),
      tweet_ids: z
        .array(z.string())
        .optional()
        .describe('Tweet IDs to include'),
      visual_ids: z
        .array(z.string())
        .optional()
        .describe('Visual IDs to include'),
    },
    async ({ topic, title, angle, tweet_ids, visual_ids }) => {
      const allTweets = loadTweets()
      const allVisuals = loadVisuals()
      const profile = readFileSync(join(dataDir, 'writing-profile.md'), 'utf-8')
      const descriptions = loadDescriptions()

      // ── MODE 2: GENERATE ──────────────────────────────────────
      if (title && angle && tweet_ids?.length && visual_ids?.length) {
        const tweetMap = new Map(allTweets.map((t) => [t.id, t]))
        const visualMap = new Map(allVisuals.map((v) => [v.id, v]))

        const selectedTweets = tweet_ids.map((id) => tweetMap.get(id)).filter(Boolean) as Tweet[]
        const selectedVisuals = visual_ids.map((id) => visualMap.get(id)).filter(Boolean) as Visual[]

        const tweetBlock = selectedTweets
          .map((t, i) => {
            const embedHtml = `<blockquote class="twitter-tweet" data-conversation="none"><p>${esc(t.text)}</p>&mdash; <a href="https://x.com/jackbutcher/status/${t.id}">@jackbutcher</a></blockquote>`
            return `[TWEET_${i + 1}] "${t.text}" (${t.likes.toLocaleString()} likes)\nEmbed HTML: ${embedHtml}`
          })
          .join('\n\n')

        const visualBlock = selectedVisuals
          .map((v, i) => {
            const desc = descriptions[v.id]
            const url = imageUrl(v.data.image)
            const figureHtml = `<figure><img src="${url}" alt="${esc(v.data.text || '')}" />${v.data.text ? `<figcaption>${esc(v.data.text)}</figcaption>` : ''}</figure>`
            return [
              `[VISUAL_${i + 1}] "${v.data.text || '(no text)'}"`,
              desc ? `  Context: ${desc}` : null,
              `  Figure HTML: ${figureHtml}`,
            ].filter(Boolean).join('\n')
          })
          .join('\n\n')

        // Prepare output directory
        const outDir = join(homedir(), 'vvriter')
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        const filepath = join(outDir, `${slug}.html`)

        const parts = [
          `# Write: "${title}"`,
          '',
          `## Voice (match exactly)`,
          profile,
          '',
          `**Title:** ${title}`,
          `**Angle:** ${angle}`,
          '',
          `## Tweets (use the embed HTML inline)`,
          tweetBlock,
          '',
          `## Visuals (use the figure HTML inline)`,
          visualBlock,
          '',
          `## Instructions`,
          `- Short paragraphs, no fluff, no transition words, no hedging`,
          `- Open with the idea, not a preamble`,
          `- Place tweet embeds inline using the provided blockquote HTML`,
          `- Place visual figures inline using the provided figure HTML`,
          `- Do NOT use placeholder markers — write actual HTML`,
          `- End sharp — no summary`,
          `- 500-1000 words`,
          '',
          `## IMPORTANT: After writing the article`,
          `Save the complete article as an HTML file. Use this template:`,
          '',
          '```html',
          `<!DOCTYPE html>`,
          `<html lang="en">`,
          `<head>`,
          `  <meta charset="utf-8" />`,
          `  <meta name="viewport" content="width=device-width, initial-scale=1" />`,
          `  <title>${esc(title)}</title>`,
          `  <style>`,
          `    * { margin: 0; padding: 0; box-sizing: border-box; }`,
          `    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 680px; margin: 0 auto; padding: 48px 24px 96px; line-height: 1.7; color: #111; background: #fff; }`,
          `    h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; margin-bottom: 48px; }`,
          `    p { margin-bottom: 24px; font-size: 17px; }`,
          `    figure { margin: 40px 0; }`,
          `    figure img { width: 100%; display: block; border-radius: 4px; }`,
          `    figcaption { margin-top: 8px; font-size: 14px; color: #666; }`,
          `    blockquote.twitter-tweet { border-left: 3px solid #ddd; padding: 16px 20px; margin: 32px 0; font-size: 16px; color: #333; }`,
          `    blockquote.twitter-tweet p { margin-bottom: 8px; }`,
          `    blockquote.twitter-tweet a { color: #666; font-size: 14px; text-decoration: none; }`,
          `    a { color: #111; }`,
          `    footer { margin-top: 64px; padding-top: 32px; border-top: 1px solid #ddd; font-size: 14px; color: #666; }`,
          `    @media (prefers-color-scheme: dark) { body { background: #111; color: #eee; } blockquote.twitter-tweet { border-color: #333; color: #ccc; } blockquote.twitter-tweet a { color: #888; } figcaption { color: #888; } footer { border-color: #333; color: #888; } }`,
          `  </style>`,
          `</head>`,
          `<body>`,
          `  <h1>${esc(title)}</h1>`,
          `  <!-- YOUR ARTICLE HTML HERE -->`,
          `  <footer>Written by <a href="https://visualizevalue.com" style="color:inherit;text-decoration:underline;">Visualize Value</a></footer>`,
          `  <script async src="https://platform.twitter.com/widgets.js"></script>`,
          `</body>`,
          `</html>`,
          '```',
          '',
          `Write the file to: ${filepath}`,
          `Then run: open ${filepath}`,
        ].join('\n')

        return { content: [{ type: 'text' as const, text: parts }] }
      }

      // ── MODE 1: SUGGEST ───────────────────────────────────────
      const seen = new Set<string>()

      const tier1 = allTweets.slice(0, 50)
      tier1.forEach((t) => seen.add(t.id))

      const tier2 = shuffleSample(allTweets.slice(50, 500), 75)
      tier2.forEach((t) => seen.add(t.id))

      const tier3 = shuffleSample(allTweets.slice(500, 2000), 50)
      tier3.forEach((t) => seen.add(t.id))

      const candidateTweets = [...tier1, ...tier2, ...tier3]

      if (topic) {
        const terms = topic.toLowerCase().split(/\s+/)
        const topicMatches = allTweets
          .filter((t) => {
            if (seen.has(t.id)) return false
            const lower = t.text.toLowerCase()
            return terms.some((term) => lower.includes(term))
          })
          .slice(0, 75)
        topicMatches.forEach((t) => {
          seen.add(t.id)
          candidateTweets.push(t)
        })
      }

      const tweetList = candidateTweets
        .map((t, i) => `[T${i}] "${t.text}" — ${t.likes} likes (id:${t.id})`)
        .join('\n')

      const visualsWithText = allVisuals.filter((v) => v.data.text)
      const sampledVisuals = shuffleSample(visualsWithText, Math.min(150, visualsWithText.length))
      const visualList = sampledVisuals
        .map((v, i) => `[V${i}] "${v.data.text}" (id:${v.id})`)
        .join('\n')

      const voiceSummary = [
        `## Voice (condensed)`,
        `Direct. Declarative. No hedging. Every word earns its place. Talks to "you" not "I." Punctuation is structural, not emotional. 57% of tweets under 10 words.`,
        ``,
        `**Structures:** Parallel declarations ("Good marketing finds customers. Great marketing creates customers."), reframes, paradoxes, conditional reveals, chiasmus, circular loops, negation flips.`,
        ``,
        `**Devices:** Alliterative contrasts (default/design, labor/leverage), matched meter, internal rhyme, monosyllabic endings, colon as pivot, drop the period, land on a noun.`,
        ``,
        `**Themes:** Leverage (build once sell twice), simplicity over complexity, action over theory, consistency and compounding, ownership over renting, time as non-renewable, focus narrows to expand.`,
        ``,
        `**Never:** Self-reference, diary, engagement farming, performed vulnerability, cliches, hedging, em dashes, jargon, news, pop culture. The voice reads as observations about reality, not opinions from a personality.`,
      ].join('\n')

      const parts = [
        `# Raw Material`,
        '',
        voiceSummary,
        '',
        `## Tweets — ${candidateTweets.length} samples`,
        tweetList,
        '',
        `## Visuals — ${sampledVisuals.length} illustrations`,
        visualList,
        '',
        `## Create`,
        `Find the stories hiding in here. Connect tweets that share an underlying principle. Match with visuals whose captions reinforce the argument.`,
        ``,
        `Create exactly 3 article concepts.`,
        ``,
        `## Present to the user`,
        `Show 3 numbered options. For each:`,
        `- **Number and title**`,
        `- **Angle** — one sentence`,
        `- Brief preview (2-3 sentences)`,
        ``,
        `Keep it scannable. Don't dump tweet lists.`,
        ``,
        `Track the tweet IDs and visual IDs for each option internally. When the user picks a number, immediately call vvriter again with title, angle, tweet_ids, and visual_ids. Then write the HTML file and open it. The whole flow: pick a number → article appears in browser.`,
      ].join('\n')

      return { content: [{ type: 'text' as const, text: parts }] }
    }
  )
}
