#!/usr/bin/env node

/**
 * MyGov MCP Server
 * Provides Model Context Protocol tools for searching government services via Typesense
 * Supports both MCP stdio (for external models) and HTTP bridge (for internal API)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import Typesense from "typesense";
import { z } from "zod";
import express from 'express';

// Initialize Typesense client
const typesenseClient = new Typesense.Client({
  nodes: [
    {
      host: process.env.TYPESENSE_HOST || "typesense",
      port: parseInt(process.env.TYPESENSE_PORT || "8108", 10),
      protocol: "http",
    },
  ],
  apiKey: process.env.TYPESENSE_API_KEY || "xyz123abc",
  connectionTimeoutSeconds: 10,
});

// Validation schemas
const SearchFragmentsSchema = z.object({
  query: z.string().describe("Search query for government services"),
  category: z.string().optional().describe("Filter by category (e.g., 'Health and caring')"),
  life_event: z.string().optional().describe("Filter by life event (e.g., 'Having a baby')"),
  provider: z.string().optional().describe("Filter by provider (e.g., 'Services Australia')"),
  state: z.string().optional().describe("Filter by state (e.g., 'NSW')"),
  per_page: z.number().min(1).max(50).default(5).describe("Number of results to return"),
});

const GetFacetsSchema = z.object({
  query: z.string().optional().describe("Optional search query to get facets for"),
});

// Create MCP server
const server = new Server(
  {
    name: "mygov-search-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_government_services",
        description: "Search for Australian government services and information using natural language queries. Returns relevant documents with content, provider details, and metadata.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query for government services (e.g., 'maternity leave', 'tax returns', 'visa applications')"
            },
            category: {
              type: "string",
              description: "Optional category filter",
              enum: ["Health and caring", "Family and relationships", "Work and Money", "Housing and Travel", "Disasters and Crime", "Education and Identity"]
            },
            life_event: {
              type: "string", 
              description: "Optional life event filter (e.g., 'Having a baby', 'Getting married')"
            },
            provider: {
              type: "string",
              description: "Optional provider filter (e.g., 'Services Australia', 'Australian Taxation Office')"
            },
            state: {
              type: "string",
              description: "Optional state filter (e.g., 'NSW', 'VIC', 'QLD')"
            },
            per_page: {
              type: "number",
              description: "Number of results to return (1-50, default: 5)",
              minimum: 1,
              maximum: 50,
              default: 5
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_service_categories",
        description: "Get available categories, life events, providers, and states for filtering government services. Useful for understanding what filters are available.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Optional search query to get facets for specific results"
            }
          }
        }
      }
    ]
  };
});

// Tool handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search_government_services": {
        const result = await performSearch(args.query, args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "get_service_categories": {
        const params = GetFacetsSchema.parse(args);
        
        // Get facets from Typesense
        const searchParams = {
          q: params.query || "*",
          query_by: "title,content_text", 
          facet_by: "categories,life_events,provider,states",
          per_page: 0, // We only want facets, not results
        };

        const response = await typesenseClient
          .collections("content_fragments")
          .documents()
          .search(searchParams);

        return {
          content: [
            {
              type: "text", 
              text: JSON.stringify({
                categories: response.facet_counts?.find(f => f.field_name === "categories")?.counts || [],
                life_events: response.facet_counts?.find(f => f.field_name === "life_events")?.counts || [],
                providers: response.facet_counts?.find(f => f.field_name === "provider")?.counts || [],
                states: response.facet_counts?.find(f => f.field_name === "states")?.counts || [],
              }, null, 2)
            }
          ]
        };
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      );
    }

    console.error(`Error in ${name}:`, error);
    throw new McpError(
      ErrorCode.InternalError,
      `Search error: ${error.message}`
    );
  }
});

// HTTP bridge for internal API communication
const app = express();
app.use(express.json());

// Reusable search function
async function performSearch(query, options = {}) {
  const params = SearchFragmentsSchema.parse({ query, ...options });
  
  // Build Typesense search parameters
  const searchParams = {
    q: params.query || "*",
    query_by: "title,content_text",
    include_fields: "id,title,url,content_text,content_html,categories,life_events,provider,states,hierarchy_lvl0",
    per_page: params.per_page,
    page: 1,
  };

  // Add filters
  const filterConditions = [];
  if (params.category) {
    filterConditions.push(`categories:=[${params.category}]`);
  }
  if (params.life_event) {
    filterConditions.push(`life_events:=[${params.life_event}]`);
  }
  if (params.provider) {
    filterConditions.push(`provider:=${params.provider}`);
  }
  if (params.state && params.state !== "National") {
    filterConditions.push(`states:=[${params.state}]`);
  }

  if (filterConditions.length > 0) {
    searchParams.filter_by = filterConditions.join(" && ");
  }

  // Execute search
  const response = await typesenseClient
    .collections("content_fragments")
    .documents()
    .search(searchParams);

  // Format results
  const results = response.hits.map((hit) => ({
    id: hit.document.id,
    title: hit.document.title,
    url: hit.document.url,
    content: hit.document.content_text,
    content_html: hit.document.content_html,
    category: hit.document.categories?.[0] || "General",
    life_event: hit.document.life_events?.[0] || "General", 
    provider: hit.document.provider || "Services Australia",
    state: hit.document.states?.[0] || "National",
    hierarchy: hit.document.hierarchy_lvl0 || hit.document.title,
  }));

  return {
    query: params.query,
    total_results: response.found,
    results: results,
    search_metadata: {
      filters_applied: filterConditions,
      search_time_ms: response.search_time_ms,
    }
  };
}

// HTTP endpoint for internal API communication
app.post('/search', async (req, res) => {
  try {
    const result = await performSearch(req.body.query, req.body);
    res.json(result);
  } catch (error) {
    console.error('HTTP Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Start the server
async function main() {
  console.log("Starting MyGov MCP Server...");
  
  // Test Typesense connection
  try {
    await typesenseClient.collections().retrieve();
    console.log("✅ Connected to Typesense");
  } catch (error) {
    console.error("❌ Failed to connect to Typesense:", error.message);
    process.exit(1);
  }

  // Start HTTP bridge for internal API communication
  const HTTP_PORT = process.env.HTTP_PORT || 8081;
  app.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`🌐 HTTP bridge running on port ${HTTP_PORT}`);
  });

  // Start MCP stdio server for external model communication
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("🚀 MCP Server running on stdio for external models");
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});