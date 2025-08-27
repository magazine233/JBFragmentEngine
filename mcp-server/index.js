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

const AnalyzeFilterCombinationsSchema = z.object({
  existing_filters: z.object({
    category: z.string().optional(),
    life_event: z.string().optional(),
    provider: z.string().optional(),
    state: z.string().optional(),
  }).optional().describe("Currently applied filters"),
  max_options: z.number().min(3).max(10).default(6).describe("Maximum number of options to suggest"),
});

const RankContentByRelevanceSchema = z.object({
  content_titles: z.array(z.object({
    id: z.string(),
    title: z.string(),
    category: z.string().optional(),
    life_event: z.string().optional(),
    provider: z.string().optional(),
  })).describe("Array of content items with titles and metadata to rank"),
  user_profile: z.object({
    category: z.string().optional(),
    life_event: z.string().optional(),
    provider: z.string().optional(),
    state: z.string().optional(),
  }).describe("User's filter selections representing their life circumstances"),
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
      },
      {
        name: "analyze_filter_combinations",
        description: "Analyze filter combinations to suggest optimal next filtering options with result counts. Helps build user's intersectional life experience profile by suggesting the most relevant filter choices.",
        inputSchema: {
          type: "object",
          properties: {
            existing_filters: {
              type: "object",
              description: "Currently applied filters",
              properties: {
                category: { type: "string", description: "Current category filter" },
                life_event: { type: "string", description: "Current life event filter" },
                provider: { type: "string", description: "Current provider filter" },
                state: { type: "string", description: "Current state filter" }
              }
            },
            max_options: {
              type: "number",
              description: "Maximum number of options to suggest (3-10, default: 6)",
              minimum: 3,
              maximum: 10,
              default: 6
            }
          }
        }
      },
      {
        name: "rank_content_by_relevance", 
        description: "Rank content titles by individual specificity and life impact priority for personalized content ordering. Only uses titles and metadata, not full content.",
        inputSchema: {
          type: "object",
          properties: {
            content_titles: {
              type: "array",
              description: "Array of content items with titles and metadata to rank",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Content item ID" },
                  title: { type: "string", description: "Content title/heading" },
                  category: { type: "string", description: "Content category" },
                  life_event: { type: "string", description: "Associated life event" },
                  provider: { type: "string", description: "Service provider" }
                },
                required: ["id", "title"]
              }
            },
            user_profile: {
              type: "object", 
              description: "User's filter selections representing their life circumstances",
              properties: {
                category: { type: "string", description: "User's selected category" },
                life_event: { type: "string", description: "User's selected life event" },
                provider: { type: "string", description: "User's selected provider" },
                state: { type: "string", description: "User's selected state" }
              }
            }
          },
          required: ["content_titles", "user_profile"]
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

      case "analyze_filter_combinations": {
        const params = AnalyzeFilterCombinationsSchema.parse(args);
        const existingFilters = params.existing_filters || {};
        const maxOptions = params.max_options;

        // Get all available facets first
        const facetsResponse = await typesenseClient
          .collections("content_fragments")
          .documents()
          .search({
            q: "*",
            query_by: "title,content_text",
            facet_by: "categories,life_events,provider,states",
            per_page: 0,
          });

        const facets = {
          categories: facetsResponse.facet_counts?.find(f => f.field_name === "categories")?.counts || [],
          life_events: facetsResponse.facet_counts?.find(f => f.field_name === "life_events")?.counts || [],
          providers: facetsResponse.facet_counts?.find(f => f.field_name === "provider")?.counts || [],
          states: facetsResponse.facet_counts?.find(f => f.field_name === "states")?.counts || [],
        };

        // Analyze combinations based on existing filters
        const suggestions = [];
        
        // If no filters applied, suggest top categories
        if (!existingFilters.category && !existingFilters.life_event && !existingFilters.provider && !existingFilters.state) {
          const topCategories = facets.categories
            .sort((a, b) => b.count - a.count)
            .slice(0, maxOptions)
            .map(cat => ({
              type: 'category',
              value: cat.value,
              label: cat.value,
              count: cat.count,
              description: `${cat.count} results in ${cat.value}`
            }));
          suggestions.push(...topCategories);
        } else {
          // Build current filter conditions for testing combinations
          const testCombinations = async (filterType, filterValues) => {
            const results = [];
            for (const filterValue of filterValues) {
              // Test this filter combination
              const testFilters = { ...existingFilters };
              testFilters[filterType] = filterValue.value;

              const filterConditions = [];
              if (testFilters.category) filterConditions.push(`categories:=[${testFilters.category}]`);
              if (testFilters.life_event) filterConditions.push(`life_events:=[${testFilters.life_event}]`);
              if (testFilters.provider) filterConditions.push(`provider:=${testFilters.provider}`);
              if (testFilters.state && testFilters.state !== "National") filterConditions.push(`states:=[${testFilters.state}]`);

              try {
                const testResponse = await typesenseClient
                  .collections("content_fragments")
                  .documents()
                  .search({
                    q: "*",
                    query_by: "title,content_text",
                    filter_by: filterConditions.length > 0 ? filterConditions.join(" && ") : undefined,
                    per_page: 0,
                  });

                if (testResponse.found > 0) {
                  results.push({
                    type: filterType,
                    value: filterValue.value,
                    label: filterValue.value,
                    count: testResponse.found,
                    description: `${testResponse.found} results for ${filterValue.value}`,
                    priority: testResponse.found // Higher count = higher priority for now
                  });
                }
              } catch (error) {
                console.error(`Error testing ${filterType}=${filterValue.value}:`, error);
              }
            }
            return results;
          };

          // Test next logical filter progression
          if (!existingFilters.category) {
            const categoryOptions = await testCombinations('category', facets.categories.slice(0, 8));
            suggestions.push(...categoryOptions);
          } else if (!existingFilters.life_event) {
            const lifeEventOptions = await testCombinations('life_event', facets.life_events.slice(0, 8));
            suggestions.push(...lifeEventOptions);
          } else if (!existingFilters.provider) {
            const providerOptions = await testCombinations('provider', facets.providers.slice(0, 8));
            suggestions.push(...providerOptions);
          } else if (!existingFilters.state) {
            const stateOptions = await testCombinations('state', facets.states.slice(0, 8));
            suggestions.push(...stateOptions);
          }
        }

        // Sort by priority (count) and limit to max_options
        const finalSuggestions = suggestions
          .sort((a, b) => b.priority - a.priority)
          .slice(0, maxOptions);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                current_filters: existingFilters,
                suggestions: finalSuggestions,
                total_available_facets: {
                  categories: facets.categories.length,
                  life_events: facets.life_events.length,
                  providers: facets.providers.length,
                  states: facets.states.length,
                }
              }, null, 2)
            }
          ]
        };
      }

      case "rank_content_by_relevance": {
        const params = RankContentByRelevanceSchema.parse(args);
        const { content_titles, user_profile } = params;

        // Scoring algorithm: Individual specificity first, then life impact
        const rankedContent = content_titles.map(content => {
          let score = 0;
          let specificity = 0;
          let lifeImpact = 0;

          // Specificity scoring (higher = more specific to user)
          if (content.category === user_profile.category) specificity += 30;
          if (content.life_event === user_profile.life_event) specificity += 25;
          if (content.provider === user_profile.provider) specificity += 20;

          // Life impact scoring based on title keywords (higher = more immediate impact)
          const title = content.title.toLowerCase();
          
          // High impact keywords (immediate action needed)
          if (title.includes('apply') || title.includes('application')) lifeImpact += 15;
          if (title.includes('payment') || title.includes('benefit')) lifeImpact += 15;
          if (title.includes('deadline') || title.includes('due') || title.includes('expires')) lifeImpact += 20;
          if (title.includes('emergency') || title.includes('urgent')) lifeImpact += 25;
          
          // Medium impact keywords (important but less immediate)
          if (title.includes('eligibility') || title.includes('qualify')) lifeImpact += 10;
          if (title.includes('how to') || title.includes('guide')) lifeImpact += 8;
          if (title.includes('support') || title.includes('help')) lifeImpact += 10;
          
          // Lower impact (informational)
          if (title.includes('about') || title.includes('information') || title.includes('overview')) lifeImpact += 5;

          // Combine scores: Specificity is weighted more heavily
          score = (specificity * 2) + lifeImpact;

          return {
            ...content,
            score,
            specificity_score: specificity,
            life_impact_score: lifeImpact,
          };
        });

        // Sort by score (highest first)
        rankedContent.sort((a, b) => b.score - a.score);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                user_profile,
                ranked_content: rankedContent,
                ranking_explanation: "Content ranked by individual specificity (category, life event, provider matches) weighted 2x, plus life impact priority (action urgency, benefit availability, etc.)"
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

// Endpoint for analyzing filter combinations
app.post('/analyze-combinations', async (req, res) => {
  try {
    // Call the handler directly instead of using server.request
    const params = AnalyzeFilterCombinationsSchema.parse(req.body);
    const existingFilters = params.existing_filters || {};
    const maxOptions = params.max_options;

    // Get all available facets first
    const facetsResponse = await typesenseClient
      .collections("content_fragments")
      .documents()
      .search({
        q: "*",
        query_by: "title,content_text",
        facet_by: "categories,life_events,provider,states",
        per_page: 0,
      });

    const facets = {
      categories: facetsResponse.facet_counts?.find(f => f.field_name === "categories")?.counts || [],
      life_events: facetsResponse.facet_counts?.find(f => f.field_name === "life_events")?.counts || [],
      providers: facetsResponse.facet_counts?.find(f => f.field_name === "provider")?.counts || [],
      states: facetsResponse.facet_counts?.find(f => f.field_name === "states")?.counts || [],
    };

    // Analyze combinations based on existing filters
    const suggestions = [];
    
    // If no filters applied, suggest top categories
    if (!existingFilters.category && !existingFilters.life_event && !existingFilters.provider && !existingFilters.state) {
      const topCategories = facets.categories
        .sort((a, b) => b.count - a.count)
        .slice(0, maxOptions)
        .map(cat => ({
          type: 'category',
          value: cat.value,
          label: cat.value,
          count: cat.count,
          description: `${cat.count} results in ${cat.value}`,
          priority: cat.count // Add priority for consistency
        }));
      suggestions.push(...topCategories);
    } else {
      // Build current filter conditions for testing combinations
      const testCombinations = async (filterType, filterValues) => {
        const results = [];
        for (const filterValue of filterValues) {
          // Test this filter combination
          const testFilters = { ...existingFilters };
          testFilters[filterType] = filterValue.value;

          const filterConditions = [];
          if (testFilters.category) filterConditions.push(`categories:=[${testFilters.category}]`);
          if (testFilters.life_event) filterConditions.push(`life_events:=[${testFilters.life_event}]`);
          if (testFilters.provider) filterConditions.push(`provider:=${testFilters.provider}`);
          if (testFilters.state && testFilters.state !== "National") filterConditions.push(`states:=[${testFilters.state}]`);
          
          console.log(`Testing combination for ${filterType}=${filterValue.value}:`, filterConditions);

          try {
            const testResponse = await typesenseClient
              .collections("content_fragments")
              .documents()
              .search({
                q: "*",
                query_by: "title,content_text",
                filter_by: filterConditions.length > 0 ? filterConditions.join(" && ") : undefined,
                per_page: 0,
              });

            console.log(`Results for ${filterType}=${filterValue.value}: ${testResponse.found} found`);
            
            if (testResponse.found > 0) {
              results.push({
                type: filterType,
                value: filterValue.value,
                label: filterValue.value,
                count: testResponse.found,
                description: `${testResponse.found} results for ${filterValue.value}`,
                priority: testResponse.found
              });
            }
          } catch (error) {
            console.error(`Error testing ${filterType}=${filterValue.value}:`, error);
          }
        }
        return results;
      };

      // Test next logical filter progression with category-specific filtering
      if (!existingFilters.category) {
        const categoryOptions = await testCombinations('category', facets.categories.slice(0, 8));
        suggestions.push(...categoryOptions);
      } else if (!existingFilters.life_event) {
        // Filter life events to be more relevant to the selected category
        let relevantLifeEvents = facets.life_events;
        
        // Category-specific life event filtering
        if (existingFilters.category === 'Family and relationships') {
          relevantLifeEvents = facets.life_events.filter(le => 
            le.value.toLowerCase().includes('baby') ||
            le.value.toLowerCase().includes('marriage') ||
            le.value.toLowerCase().includes('divorce') ||
            le.value.toLowerCase().includes('family') ||
            le.value.toLowerCase().includes('child') ||
            le.value.toLowerCase().includes('relationship') ||
            le.value.toLowerCase().includes('caring') ||
            le.value.toLowerCase().includes('domestic')
          );
        } else if (existingFilters.category === 'Health and caring') {
          relevantLifeEvents = facets.life_events.filter(le => 
            le.value.toLowerCase().includes('illness') ||
            le.value.toLowerCase().includes('health') ||
            le.value.toLowerCase().includes('disability') ||
            le.value.toLowerCase().includes('mental') ||
            le.value.toLowerCase().includes('caring') ||
            le.value.toLowerCase().includes('medical')
          );
        } else if (existingFilters.category === 'Work and Money') {
          relevantLifeEvents = facets.life_events.filter(le => 
            le.value.toLowerCase().includes('job') ||
            le.value.toLowerCase().includes('work') ||
            le.value.toLowerCase().includes('unemploy') ||
            le.value.toLowerCase().includes('retire') ||
            le.value.toLowerCase().includes('study') ||
            le.value.toLowerCase().includes('financial')
          );
        } else if (existingFilters.category === 'Housing and Travel') {
          relevantLifeEvents = facets.life_events.filter(le => 
            le.value.toLowerCase().includes('moving') ||
            le.value.toLowerCase().includes('travel') ||
            le.value.toLowerCase().includes('home') ||
            le.value.toLowerCase().includes('house') ||
            le.value.toLowerCase().includes('rental')
          );
        }
        
        // If no category-specific matches found, use top life events
        if (relevantLifeEvents.length === 0) {
          relevantLifeEvents = facets.life_events.slice(0, 8);
        }
        
        const lifeEventOptions = await testCombinations('life_event', relevantLifeEvents.slice(0, 8));
        suggestions.push(...lifeEventOptions);
      } else if (!existingFilters.provider) {
        // Only suggest providers that actually have content for this category + life event combination
        const providerOptions = await testCombinations('provider', facets.providers.slice(0, 6));
        suggestions.push(...providerOptions);
      } else if (!existingFilters.state) {
        const stateOptions = await testCombinations('state', facets.states.slice(0, 6));
        suggestions.push(...stateOptions);
      }
    }

    // Sort by priority (count) and limit to max_options
    const finalSuggestions = suggestions
      .sort((a, b) => b.priority - a.priority)
      .slice(0, maxOptions);

    const result = {
      current_filters: existingFilters,
      suggestions: finalSuggestions,
      total_available_facets: {
        categories: facets.categories.length,
        life_events: facets.life_events.length,
        providers: facets.providers.length,
        states: facets.states.length,
      }
    };
    
    console.log('MCP Analysis result:', JSON.stringify(result, null, 2));
    
    res.json(result);
  } catch (error) {
    console.error('HTTP Analyze Combinations error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint for ranking content by relevance
app.post('/rank-content', async (req, res) => {
  try {
    const result = await server.request({
      method: 'tools/call',
      params: {
        name: 'rank_content_by_relevance',
        arguments: req.body
      }
    });
    
    // Parse the JSON content from the MCP response
    const jsonContent = JSON.parse(result.content[0].text);
    res.json(jsonContent);
  } catch (error) {
    console.error('HTTP Rank Content error:', error);
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