import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFileSync } from 'fs'
import { join } from 'path'
import { dataDir } from '../paths.js'

type Lesson = {
  id: number
  title: string
  body: string
  video_url: string | null
}

type Module = {
  title: string
  lessons: Lesson[]
}

type Course = {
  title: string
  description: string
  free: boolean
  modules: Module[]
}

let coursesCache: Record<string, Course> | null = null

function loadCourses(): Record<string, Course> {
  if (coursesCache) return coursesCache
  const raw = readFileSync(join(dataDir, 'courses.json'), 'utf-8')
  coursesCache = JSON.parse(raw)
  return coursesCache!
}

export function registerCourseTools(server: McpServer) {
  server.tool(
    'list_courses',
    'List all available VV courses with titles, taglines, and lesson counts. All courses are free.',
    {},
    async () => {
      const courses = loadCourses()
      const list = Object.entries(courses)
        .map(([key, c]) => {
          const lessonCount = c.modules.reduce((sum, m) => sum + m.lessons.length, 0)
          return `**${c.title}** (${key})\n${c.description || ''}\n${lessonCount} lessons. Free.`
        })
        .join('\n\n')

      return {
        content: [{ type: 'text' as const, text: `VV Courses (all free):\n\n${list}` }],
      }
    }
  )

  server.tool(
    'get_course',
    'Get the full curriculum for a VV course — all modules and lesson titles',
    {
      course: z.string().describe('Course slug (e.g. "the-permissionless-apprentice", "the-fundamentals-of-value")'),
    },
    async ({ course }) => {
      const courses = loadCourses()
      const c = courses[course]
      if (!c) {
        const keys = Object.keys(courses).join(', ')
        return { content: [{ type: 'text' as const, text: `Course "${course}" not found. Available: ${keys}` }] }
      }

      const modules = c.modules
        .map(
          (m, i) =>
            `### Module ${i + 1}: ${m.title}\n${m.lessons.map((l, j) => `  ${j + 1}. ${l.title}`).join('\n')}`
        )
        .join('\n\n')

      const lessonCount = c.modules.reduce((sum, m) => sum + m.lessons.length, 0)

      return {
        content: [
          {
            type: 'text' as const,
            text: `# ${c.title}\n\n${c.description || ''}\n\n${lessonCount} lessons. Free.\n\n${modules}`,
          },
        ],
      }
    }
  )

  server.tool(
    'get_lesson',
    'Get the full content of a specific lesson by title. Search across all courses.',
    {
      title: z.string().describe('Lesson title or partial match (e.g. "Leverage", "Proof of Work")'),
    },
    async ({ title }) => {
      const courses = loadCourses()
      const q = title.toLowerCase()

      for (const [slug, course] of Object.entries(courses)) {
        for (const mod of course.modules) {
          for (const lesson of mod.lessons) {
            if (lesson.title.toLowerCase().includes(q)) {
              const parts = [
                `# ${lesson.title}`,
                `**Course:** ${course.title}`,
                `**Module:** ${mod.title}`,
                lesson.video_url ? `**Video:** ${lesson.video_url}` : null,
                '',
                lesson.body || '(No text content — this lesson is video-only)',
              ]
                .filter((p) => p !== null)
                .join('\n')

              return { content: [{ type: 'text' as const, text: parts }] }
            }
          }
        }
      }

      return {
        content: [{ type: 'text' as const, text: `No lesson found matching "${title}".` }],
      }
    }
  )

  server.tool(
    'search_lessons',
    'Search across all lesson content for a keyword. Returns matching lessons with excerpts.',
    {
      query: z.string().describe('Search term to match against lesson titles and content'),
      limit: z.number().optional().describe('Max results (default: 10)'),
    },
    async ({ query, limit = 10 }) => {
      const courses = loadCourses()
      const q = query.toLowerCase()
      const results: { course: string; module: string; title: string; excerpt: string }[] = []

      for (const [slug, course] of Object.entries(courses)) {
        for (const mod of course.modules) {
          for (const lesson of mod.lessons) {
            const haystack = `${lesson.title} ${lesson.body}`.toLowerCase()
            if (haystack.includes(q)) {
              // Extract excerpt around the match
              const idx = lesson.body.toLowerCase().indexOf(q)
              const start = Math.max(0, idx - 80)
              const end = Math.min(lesson.body.length, idx + q.length + 80)
              const excerpt = (start > 0 ? '...' : '') + lesson.body.slice(start, end) + (end < lesson.body.length ? '...' : '')

              results.push({
                course: course.title,
                module: mod.title,
                title: lesson.title,
                excerpt,
              })

              if (results.length >= limit) break
            }
          }
          if (results.length >= limit) break
        }
        if (results.length >= limit) break
      }

      if (results.length === 0) {
        return { content: [{ type: 'text' as const, text: `No lessons found matching "${query}".` }] }
      }

      const formatted = results
        .map((r) => `**${r.title}** (${r.course} > ${r.module})\n${r.excerpt}`)
        .join('\n\n---\n\n')

      return {
        content: [{ type: 'text' as const, text: `${results.length} lessons matching "${query}":\n\n${formatted}` }],
      }
    }
  )
}
