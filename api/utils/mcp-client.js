/**
 * MCP Client for connecting to MyGov MCP Server
 * Uses HTTP bridge for container-to-container communication
 */

const fetch = require('node-fetch');

class MCPClient {
  constructor() {
    this.mcpServerUrl = process.env.MCP_SERVER_URL || 'http://mcp-server:8081';
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) return;

    try {
      console.log('MCP Client connecting via HTTP bridge to:', this.mcpServerUrl);
      
      // Test connection
      const response = await fetch(`${this.mcpServerUrl}/health`);
      if (response.ok) {
        this.isConnected = true;
        console.log('✅ Connected to MCP Server via HTTP bridge');
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('❌ Failed to connect to MCP Server:', error);
      throw error;
    }
  }

  async searchGovernmentServices(query, options = {}) {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const response = await fetch(`${this.mcpServerUrl}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          ...options
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('MCP Search error:', error);
      throw error;
    }
  }

  async getServiceCategories(query = null) {
    // For now, this uses the search endpoint with empty query to get facets
    // In a full implementation, we'd have a separate /facets endpoint
    try {
      const result = await this.searchGovernmentServices('*', { per_page: 0 });
      return {
        categories: [], // Would need to implement facets endpoint
        life_events: [],
        providers: [],
        states: []
      };
    } catch (error) {
      console.error('MCP Facets error:', error);
      throw error;
    }
  }

  async analyzeFilterCombinations(existingFilters = {}, maxOptions = 6) {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const response = await fetch(`${this.mcpServerUrl}/analyze-combinations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          existing_filters: existingFilters,
          max_options: maxOptions
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('MCP Filter Analysis error:', error);
      throw error;
    }
  }

  async rankContentByRelevance(contentTitles, userProfile) {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const response = await fetch(`${this.mcpServerUrl}/rank-content`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content_titles: contentTitles,
          user_profile: userProfile
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('MCP Content Ranking error:', error);
      throw error;
    }
  }

  disconnect() {
    this.isConnected = false;
  }
}

module.exports = { MCPClient };