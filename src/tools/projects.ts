import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFileSync } from 'fs'
import { join } from 'path'
import { dataDir } from '../paths.js'

type Project = {
  title: string
  year: string
  slug: string
  image: string
  summary: string
  description: string
  collaborators: string[]
  edition: string | null
  medium: string | null
  links: { label: string; href: string }[]
}

let cache: Project[] | null = null

function loadProjects(): Project[] {
  if (cache) return cache
  const raw = readFileSync(join(dataDir, 'projects.json'), 'utf-8')
  cache = JSON.parse(raw)
  return cache!
}

export function registerProjectTools(server: McpServer) {
  server.tool(
    'list_projects',
    'List all VV art projects with titles, years, and one-line summaries',
    {},
    async () => {
      const projects = loadProjects()
      const list = projects
        .map((p) => `**${p.title}** (${p.year}) — ${p.summary}`)
        .join('\n\n')

      return {
        content: [{ type: 'text' as const, text: `${projects.length} projects:\n\n${list}` }],
      }
    }
  )

  server.tool(
    'get_project',
    'Get full details for a VV art project — description, collaborators, medium, edition, links',
    {
      slug: z.string().describe('Project slug (e.g. "checks-originals", "self-checkout", "opepen-edition")'),
    },
    async ({ slug }) => {
      const projects = loadProjects()
      const p = projects.find((proj) => proj.slug === slug)
      if (!p) {
        const slugs = projects.map((proj) => proj.slug).join(', ')
        return {
          content: [{ type: 'text' as const, text: `Project "${slug}" not found. Available: ${slugs}` }],
        }
      }

      const parts = [
        `# ${p.title} (${p.year})`,
        p.description,
        p.medium ? `**Medium:** ${p.medium}` : null,
        p.edition ? `**Edition:** ${p.edition}` : null,
        p.collaborators.length > 0 ? `**Collaborators:** ${p.collaborators.join(', ')}` : null,
        p.links.length > 0
          ? `**Links:**\n${p.links.map((l) => `- [${l.label}](${l.href})`).join('\n')}`
          : null,
      ]
        .filter(Boolean)
        .join('\n\n')

      return { content: [{ type: 'text' as const, text: parts }] }
    }
  )

  server.tool(
    'search_projects',
    'Search VV art projects by keyword across titles, descriptions, and medium',
    {
      query: z.string().describe('Search term'),
    },
    async ({ query }) => {
      const projects = loadProjects()
      const q = query.toLowerCase()
      const matches = projects.filter((p) => {
        const haystack = `${p.title} ${p.summary} ${p.description} ${p.medium ?? ''} ${p.collaborators.join(' ')}`.toLowerCase()
        return haystack.includes(q)
      })

      if (matches.length === 0) {
        return { content: [{ type: 'text' as const, text: `No projects matching "${query}".` }] }
      }

      const formatted = matches
        .map((p) => `**${p.title}** (${p.year}) — ${p.summary}`)
        .join('\n\n')

      return {
        content: [{ type: 'text' as const, text: `${matches.length} projects matching "${query}":\n\n${formatted}` }],
      }
    }
  )
}
