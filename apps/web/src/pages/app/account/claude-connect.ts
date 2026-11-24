/** The hosted CareLayer MCP server (apps/mcp). Claude sends her token as a Bearer header. */
export const MCP_URL = import.meta.env.VITE_MCP_URL || 'https://mcp.carelayer.health/mcp';

/** The Claude Code command for a new connection (apps/mcp/README.md §2b). */
export function claudeCodeCommand(token: string) {
  return `claude mcp add --transport http carelayer ${MCP_URL} --header "Authorization: Bearer ${token}"`;
}
