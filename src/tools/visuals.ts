import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFileSync } from 'fs'
import { join } from 'path'
import { dataDir } from '../paths.js'

const VV_API = 'https://api.vv.xyz'

type VVImage = {
  id: string
  cdn: string
  path: string
  type: string
}

type VVVisual = {
  id: string
  schema: string
  data: {
    text?: string
    source?: string
    image: VVImage
    tags?: string[]
  }
  publishedAt: string
}

let descriptionsCache: Record<string, string> | null = null

function loadDescriptions(): Record<string, string> {
  if (descriptionsCache) return descriptionsCache
  try {
    const raw = readFileSync(join(dataDir, 'visual-descriptions.json'), 'utf-8')
    descriptionsCache = JSON.parse(raw)
  } catch {
    descriptionsCache = {}
  }
  return descriptionsCache!
}

function imageUrl(img: VVImage): string {
  return `https://${img.cdn}.cdn.vv.xyz/${img.path}/${img.id}.${img.type}`
}

function formatVisual(v: VVVisual, descriptions: Record<string, string>): string {
  const desc = descriptions[v.id]
  const parts = [
    v.data.text ? `"${v.data.text}"` : '(no text)',
    v.data.source ? `— ${v.data.source}` : null,
    desc ? `\nContext: ${desc}` : null,
    `\nImage: ${imageUrl(v.data.image)}`,
    v.data.tags?.length ? `Tags: ${v.data.tags.join(', ')}` : null,
  ]
  return parts.filter(Boolean).join('\n')
}

export function registerVisualTools(server: McpServer) {
  server.tool(
    'get_daily_visual',
    "Get today's VV visual — the daily illustration from the Visualize Value library, with context description if available",
    {},
    async () => {
      const descriptions = loadDescriptions()
      try {
        const res = await fetch(`${VV_API}/visuals/daily`)
        if (!res.ok) throw new Error(`API returned ${res.status}`)
        const data = await res.json()
        const visual = data.post as VVVisual

        return {
          content: [
            {
              type: 'text' as const,
              text: `Daily VV Visual:\n\n${formatVisual(visual, descriptions)}\nPublished: ${visual.publishedAt}`,
            },
          ],
        }
      } catch (e) {
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch daily visual: ${e}` }],
        }
      }
    }
  )

  server.tool(
    'search_visuals',
    'Search VV visuals by text content, tags, or source. Returns matching visuals with image URLs and context descriptions.',
    {
      query: z.string().describe('Search term to match against visual text, tags, and descriptions'),
      limit: z.number().optional().describe('Max results (default: 10)'),
    },
    async ({ query, limit = 10 }) => {
      const descriptions = loadDescriptions()
      try {
        const res = await fetch(`${VV_API}/visuals/all`)
        if (!res.ok) throw new Error(`API returned ${res.status}`)
        const visuals: VVVisual[] = await res.json()

        const q = query.toLowerCase()
        const matches = visuals
          .filter((v) => {
            const text = v.data.text?.toLowerCase() ?? ''
            const tags = v.data.tags?.join(' ').toLowerCase() ?? ''
            const source = v.data.source?.toLowerCase() ?? ''
            const desc = descriptions[v.id]?.toLowerCase() ?? ''
            return text.includes(q) || tags.includes(q) || source.includes(q) || desc.includes(q)
          })
          .slice(0, limit)

        if (matches.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No visuals found matching "${query}".` }],
          }
        }

        const formatted = matches.map((v) => formatVisual(v, descriptions)).join('\n\n---\n\n')

        return {
          content: [
            {
              type: 'text' as const,
              text: `Found ${matches.length} visuals matching "${query}":\n\n${formatted}`,
            },
          ],
        }
      } catch (e) {
        return {
          content: [{ type: 'text' as const, text: `Failed to search visuals: ${e}` }],
        }
      }
    }
  )

  server.tool(
    'get_visual',
    'Get a specific VV visual by ID, with context description if available',
    {
      id: z.string().describe('Visual ID'),
    },
    async ({ id }) => {
      const descriptions = loadDescriptions()
      try {
        const res = await fetch(`${VV_API}/visuals/${id}`)
        if (!res.ok) throw new Error(`API returned ${res.status}`)
        const visual: VVVisual = await res.json()

        return {
          content: [
            {
              type: 'text' as const,
              text: `VV Visual ${id}:\n\n${formatVisual(visual, descriptions)}\nPublished: ${visual.publishedAt}`,
            },
          ],
        }
      } catch (e) {
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch visual: ${e}` }],
        }
      }
    }
  )
}
