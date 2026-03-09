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

let tweetsCache: Tweet[] | null = null

function loadTweets(): Tweet[] {
  if (tweetsCache) return tweetsCache
  const raw = readFileSync(join(dataDir, 'tweet-index.json'), 'utf-8')
  tweetsCache = JSON.parse(raw)
  return tweetsCache!
}

// Topic synonyms for broader matching
const TOPIC_SYNONYMS: Record<string, string[]> = {
  leverage: ['leverage', 'compound', 'scale', 'multiply', 'systems', 'automation', 'sleep'],
  simplicity: ['simple', 'simplicity', 'clarity', 'complex', 'complexity', 'reduce', 'subtract', 'minimal'],
  action: ['start', 'ship', 'build', 'do', 'practice', 'iterate', 'try', 'begin'],
  consistency: ['consistent', 'daily', 'show up', 'every day', 'keep going', 'routine', 'habit'],
  ownership: ['own', 'ownership', 'equity', 'rent', 'build', 'asset'],
  time: ['time', 'hours', 'freedom', 'sleep', 'morning', 'patience', 'long game'],
  focus: ['focus', 'distract', 'attention', 'narrow', 'concentrate', 'noise'],
  value: ['value', 'price', 'worth', 'money', 'customer', 'sell', 'pay'],
  creativity: ['creative', 'create', 'art', 'design', 'idea', 'imagination', 'produce'],
  failure: ['fail', 'failure', 'mistake', 'risk', 'scared', 'fear', 'wrong'],
}

function expandQuery(query: string): string[] {
  const q = query.toLowerCase()
  const terms = [q]

  // Check if query matches a topic group
  for (const [topic, synonyms] of Object.entries(TOPIC_SYNONYMS)) {
    if (q.includes(topic) || synonyms.some((s) => q.includes(s))) {
      terms.push(...synonyms)
    }
  }

  return [...new Set(terms)]
}

export function registerTweetTools(server: McpServer) {
  server.tool(
    'search_tweets',
    "Search Jack Butcher's tweet archive by keyword. Expands search with related terms for broader topic matching. Returns tweets sorted by likes.",
    {
      query: z.string().describe('Search term to match against tweet text'),
      min_likes: z.number().optional().describe('Minimum likes threshold (default: 0)'),
      limit: z.number().optional().describe('Max results to return (default: 20)'),
      exact: z.boolean().optional().describe('If true, only match exact query (no topic expansion). Default: false'),
    },
    async ({ query, min_likes = 0, limit = 20, exact = false }) => {
      const tweets = loadTweets()
      const terms = exact ? [query.toLowerCase()] : expandQuery(query)

      const matches = tweets
        .filter((t) => {
          const text = t.text.toLowerCase()
          return terms.some((term) => text.includes(term)) && t.likes >= min_likes
        })
        .sort((a, b) => b.likes - a.likes)
        .slice(0, limit)

      if (matches.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `No tweets found matching "${query}" with ${min_likes}+ likes.` }],
        }
      }

      const expanded = exact ? '' : ` (expanded terms: ${terms.slice(1).join(', ')})`

      const formatted = matches
        .map((t) => `"${t.text}"\n  ${t.likes.toLocaleString()} likes, ${t.rts.toLocaleString()} RTs (${t.date})`)
        .join('\n\n')

      return {
        content: [
          {
            type: 'text' as const,
            text: `Found ${matches.length} tweets matching "${query}"${expanded}:\n\n${formatted}`,
          },
        ],
      }
    }
  )

  server.tool(
    'top_tweets',
    "Get Jack Butcher's top-performing tweets by likes. Great for understanding what resonates most.",
    {
      limit: z.number().optional().describe('Number of tweets to return (default: 25)'),
    },
    async ({ limit = 25 }) => {
      const tweets = loadTweets()
      const top = [...tweets].sort((a, b) => b.likes - a.likes).slice(0, limit)

      const formatted = top
        .map(
          (t, i) =>
            `${i + 1}. "${t.text}"\n   ${t.likes.toLocaleString()} likes, ${t.rts.toLocaleString()} RTs`
        )
        .join('\n\n')

      return {
        content: [{ type: 'text' as const, text: `Top ${limit} tweets:\n\n${formatted}` }],
      }
    }
  )

  server.tool(
    'tweet_stats',
    'Get aggregate stats about the tweet archive — total tweets, engagement distribution, best-performing topics.',
    {},
    async () => {
      const tweets = loadTweets()
      const total = tweets.length
      const totalLikes = tweets.reduce((s, t) => s + t.likes, 0)
      const sorted = [...tweets].sort((a, b) => b.likes - a.likes)

      // Word frequency in top 200 tweets
      const topTweets = sorted.slice(0, 200)
      const wordFreq: Record<string, number> = {}
      const stopWords = new Set(['the', 'a', 'an', 'is', 'it', 'to', 'of', 'in', 'and', 'or', 'for', 'on', 'at', 'by', 'if', 'you', 'your', 'that', 'this', 'be', 'are', 'was', 'not', 'but', 'do', 'can', 'will', 'from', 'with', 'as', 'have', 'has', 'than', 'more', 'its', 'all', 'no', 'so', 'what', 'when', 'who', 'how', 'just', 'get', 'got', 'about', 'them', 'they', 'their', 'out', 'up', 'one', 'every', 'most', 'dont', "don't", 'into'])
      for (const t of topTweets) {
        const words = t.text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/)
        for (const w of words) {
          if (w.length > 2 && !stopWords.has(w)) {
            wordFreq[w] = (wordFreq[w] || 0) + 1
          }
        }
      }
      const topWords = Object.entries(wordFreq)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20)
        .map(([word, count]) => `${word} (${count})`)
        .join(', ')

      const stats = [
        `# Tweet Archive Stats`,
        '',
        `**Total tweets:** ${total.toLocaleString()}`,
        `**Total likes:** ${totalLikes.toLocaleString()}`,
        `**Average likes:** ${Math.round(totalLikes / total).toLocaleString()}`,
        `**Top tweet:** "${sorted[0].text}" (${sorted[0].likes.toLocaleString()} likes)`,
        '',
        `**Engagement tiers:**`,
        `- 10,000+ likes: ${sorted.filter((t) => t.likes >= 10000).length} tweets`,
        `- 1,000+ likes: ${sorted.filter((t) => t.likes >= 1000).length} tweets`,
        `- 500+ likes: ${sorted.filter((t) => t.likes >= 500).length} tweets`,
        `- 100+ likes: ${sorted.filter((t) => t.likes >= 100).length} tweets`,
        '',
        `**Most common words in top 200 tweets:**`,
        topWords,
      ].join('\n')

      return { content: [{ type: 'text' as const, text: stats }] }
    }
  )
}
