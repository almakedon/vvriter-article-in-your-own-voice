import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerGenerateTools } from './generate.js'
import { registerSlidesTools } from './slides.js'

export function registerTools(server: McpServer) {
  registerGenerateTools(server)
  registerSlidesTools(server)
}
