import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFileSync } from 'fs'
import { join } from 'path'
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

type Slide = {
  slideNumber: number
  lines: string[]
  type: 'text' | 'visual'
  imageUrl?: string
  visualId?: string
  tweetId?: string
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

function imageUrl(img: { id: string; cdn: string; path: string; type: string }): string {
  return `https://${img.cdn}.cdn.vv.xyz/${img.path}/${img.id}.${img.type}`
}

/**
 * Search tweets for a topic. Returns text-only tweets sorted by engagement.
 */
function searchTweets(topic: string, tweets: Tweet[]): Tweet[] {
  const terms = topic.toLowerCase().split(/\s+/).filter((t) => t.length > 1)

  return tweets
    .filter((t) => {
      if (t.text.includes('https://')) return false
      if (t.text.includes('@')) return false
      const lower = t.text.toLowerCase()
      return terms.some((term) => lower.includes(term))
    })
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 12)
}

/**
 * Search visuals for a topic. Scores by text + tag match.
 */
function searchVisuals(topic: string, visuals: Visual[]): Visual[] {
  const terms = topic.toLowerCase().split(/\s+/).filter((t) => t.length > 1)

  return visuals
    .map((v) => {
      const text = (v.data.text || '').toLowerCase()
      const tags = (v.data.tags || []).map((t) => t.toLowerCase())
      let score = 0
      for (const term of terms) {
        if (text.includes(term)) score += 3
        if (tags.some((t) => t.includes(term))) score += 2
      }
      return { visual: v, score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((s) => s.visual)
}

/**
 * Convert tweet text into display lines.
 */
function tweetToLines(text: string): string[] {
  const cleaned = text.replace(/https?:\/\/\S+/g, '').trim().toLowerCase()
  const parts = cleaned.split('\n').map((s) => s.trim()).filter(Boolean)
  if (parts.length > 1) return parts
  if (cleaned.length < 45) return [cleaned]

  // Split at period
  if (cleaned.includes('. ')) {
    return cleaned.split('. ').map((s) => s.replace(/\.$/, '').trim()).filter(Boolean)
  }

  // Split at midpoint
  const mid = Math.floor(cleaned.length / 2)
  const after = cleaned.indexOf(' ', mid)
  const before = cleaned.lastIndexOf(' ', mid)
  const splitAt = after >= 0 && (after - mid < mid - before) ? after : before
  if (splitAt > 0) return [cleaned.slice(0, splitAt).trim(), cleaned.slice(splitAt).trim()]
  return [cleaned]
}

/**
 * Build a slide deck from the archive for a given topic.
 * All content is real archive material — nothing generated.
 */
function buildSlides(topic: string): Slide[] {
  const allTweets = loadTweets()
  const allVisuals = loadVisuals()

  const matchedVisuals = searchVisuals(topic, allVisuals)
  const matchedTweets = searchTweets(topic, allTweets)

  if (matchedVisuals.length === 0 && matchedTweets.length === 0) {
    return [
      { slideNumber: 1, lines: [topic.toLowerCase()], type: 'text' },
      { slideNumber: 2, lines: ['no results in the archive'], type: 'text' },
    ]
  }

  const slides: Slide[] = []
  let num = 1

  // Title
  slides.push({ slideNumber: num++, lines: [topic.toLowerCase()], type: 'text' })

  // Interleave tweets and visuals
  const visuals = matchedVisuals.slice(0, 5)
  const tweets = matchedTweets.slice(0, 8)
  let tIdx = 0

  for (const visual of visuals) {
    // Tweet before visual
    if (tIdx < tweets.length) {
      const tweet = tweets[tIdx++]
      slides.push({
        slideNumber: num++,
        lines: tweetToLines(tweet.text),
        type: 'text',
        tweetId: tweet.id,
      })
    }

    // Visual
    slides.push({
      slideNumber: num++,
      lines: [visual.data.text || ''],
      type: 'visual',
      imageUrl: imageUrl(visual.data.image),
      visualId: visual.id,
    })
  }

  // Remaining tweets
  while (tIdx < tweets.length && slides.length < 18) {
    const tweet = tweets[tIdx++]
    slides.push({
      slideNumber: num++,
      lines: tweetToLines(tweet.text),
      type: 'text',
      tweetId: tweet.id,
    })
  }

  return slides
}

export function registerSlidesTools(server: McpServer) {
  server.tool(
    'slides',
    `Generate a slide deck from the VV archive.

Give it a topic (e.g. "leverage", "consistency", "time"). It searches the tweet archive and visual library, then returns an array of slides — each with text lines, type (text or visual), and image URLs for visual slides.

All content is real archive material. Nothing generated.

Returns JSON: { topic, slides: [{ slideNumber, lines, type, imageUrl?, visualId?, tweetId? }] }`,
    {
      topic: z.string().describe('The topic to search the archive for'),
    },
    async ({ topic }) => {
      const slides = buildSlides(topic)
      const result = { topic, slides }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      }
    },
  )
}
