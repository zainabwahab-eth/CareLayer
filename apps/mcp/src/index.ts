#!/usr/bin/env node
// stdio entry point. stdout carries the MCP protocol, so log to stderr only.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const server = createServer();
await server.connect(new StdioServerTransport());
console.error('[mcp] CareLayer MCP server running on stdio');
