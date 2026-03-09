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

export function registerGenerateTools(server: McpServer) {
  server.tool(
    'draft_tweet',
    'Get context for drafting a tweet in the VV voice. Returns the writing profile rules, top-performing tweets on the topic, and structural patterns to follow. The AI model then uses this context to draft.',
    {
      topic: z.string().describe('The topic or idea to tweet about'),
      style: z
        .enum(['observation', 'contrast', 'reframe', 'list', 'question', 'one-liner'])
        .optional()
        .describe('Preferred rhetorical style (optional)'),
    },
    async ({ topic, style }) => {
      const tweets = loadTweets()
      const profile = readFileSync(join(dataDir, 'writing-profile.md'), 'utf-8')

      // Find relevant tweets by topic
      const q = topic.toLowerCase()
      const topicTweets = tweets
        .filter((t) => t.text.toLowerCase().includes(q) && t.likes >= 50)
        .sort((a, b) => b.likes - a.likes)
        .slice(0, 10)

      // Also get overall top performers as reference
      const topPerformers = tweets
        .sort((a, b) => b.likes - a.likes)
        .slice(0, 15)

      const parts = [
        `# Draft context for: "${topic}"`,
        style ? `Requested style: ${style}` : null,
        '',
        '## Writing rules (follow these exactly)',
        profile,
        '',
        topicTweets.length > 0
          ? `## Top tweets on "${topic}" (${topicTweets.length} found)\n\n${topicTweets.map((t) => `"${t.text}" (${t.likes.toLocaleString()} likes)`).join('\n\n')}`
          : `## No existing tweets found on "${topic}" — use the top performers below for structural reference`,
        '',
        `## Top 15 performers (structural reference)\n\n${topPerformers.map((t) => `"${t.text}" (${t.likes.toLocaleString()} likes)`).join('\n\n')}`,
        '',
        '## Instructions',
        'Using the writing profile rules and reference tweets above, draft 5 tweet options.',
        'Each should be under 15 words. No hedging. No em dashes. Land on a noun.',
        'Vary the rhetorical pattern across the 5 options (contrast, reframe, paradox, conditional, declaration).',
      ]
        .filter((p) => p !== null)
        .join('\n')

      return { content: [{ type: 'text' as const, text: parts }] }
    }
  )

  server.tool(
    'apply_framework',
    'Apply a VV framework to a specific situation. Returns the framework and instructions for the AI to walk through the application.',
    {
      framework: z
        .enum([
          'productization-spectrum',
          'shuhari',
          'time-ladder',
          'train',
          'permissionless-apprentice',
          'proof-price-loop',
        ])
        .describe('Which framework to apply'),
      situation: z.string().describe('The situation, business, or problem to apply it to'),
    },
    async ({ framework, situation }) => {
      const content = readFileSync(join(dataDir, 'frameworks', `${framework}.md`), 'utf-8')

      const prompt = [
        `# Apply: ${framework}`,
        '',
        '## The Framework',
        content,
        '',
        '## The Situation',
        situation,
        '',
        '## Instructions',
        'Walk through each stage/step of the framework above and explain where this situation currently sits.',
        'Identify the specific next move. Be concrete and actionable.',
        'Use the VV voice: direct, declarative, no hedging. Short paragraphs.',
      ].join('\n')

      return { content: [{ type: 'text' as const, text: prompt }] }
    }
  )

  server.tool(
    'suggest_visual',
    'Given a concept or quote, find related VV visuals and suggest a visual approach. Returns matching visuals with their descriptions.',
    {
      concept: z.string().describe('The concept, quote, or idea to visualize'),
    },
    async ({ concept }) => {
      let descriptions: Record<string, string> = {}
      try {
        const raw = readFileSync(join(dataDir, 'visual-descriptions.json'), 'utf-8')
        descriptions = JSON.parse(raw)
      } catch {}

      // Search the VV API for matching visuals
      try {
        const res = await fetch('https://api.vv.xyz/visuals/all')
        if (!res.ok) throw new Error(`API ${res.status}`)
        const visuals: any[] = await res.json()

        const q = concept.toLowerCase()
        const matches = visuals
          .filter((v) => {
            const text = v.data.text?.toLowerCase() ?? ''
            const tags = v.data.tags?.join(' ').toLowerCase() ?? ''
            return text.includes(q) || tags.includes(q)
          })
          .slice(0, 5)

        const formatted = matches.map((v) => {
          const desc = descriptions[v.id] || null
          const url = `https://${v.data.image.cdn}.cdn.vv.xyz/${v.data.image.path}/${v.data.image.id}.${v.data.image.type}`
          return [
            v.data.text ? `"${v.data.text}"` : '(no text)',
            desc ? `Context: ${desc}` : null,
            `Image: ${url}`,
            v.data.tags?.length ? `Tags: ${v.data.tags.join(', ')}` : null,
          ]
            .filter(Boolean)
            .join('\n')
        })

        const parts = [
          `# Visual suggestions for: "${concept}"`,
          '',
          matches.length > 0
            ? `## ${matches.length} related visuals found\n\n${formatted.join('\n\n---\n\n')}`
            : '## No direct matches found',
          '',
          '## Approach suggestions',
          'Based on the VV visual style (black and white, minimal, typographic, symbolic):',
          '- What contrast or tension exists in this concept?',
          '- Can it be reduced to two opposing words or images?',
          '- What is the simplest possible visual representation?',
        ].join('\n')

        return { content: [{ type: 'text' as const, text: parts }] }
      } catch (e) {
        return {
          content: [{ type: 'text' as const, text: `Failed to search visuals: ${e}` }],
        }
      }
    }
  )
}
