# FragmentEngine Test Suite

Automated tests for the 6 core MCP tools that enable agent-based grounding and verification.

## Quick Start

```bash
# 1. Ensure services are running
docker-compose up -d typesense mcp-server api

# 2. Run tests
cd tests
node mcp-tools.test.js
```

## Test Structure

### Fixtures (`fixtures/eval-scenarios.json`)

Defines test scenarios with:
- **Facet combinations**: Known profile states (e.g., NSW + Having a baby)
- **Expected entities**: Services that should exist for this scenario
- **Test claims**: Factual statements with expected verdicts
- **Search queries**: Queries with minimum result expectations

### Test Suites (`mcp-tools.test.js`)

Tests all 6 core MCP tools:

1. **search_fragments**: Text search + facet filtering
2. **get_facets**: Discover available filters
3. **get_content_by_facets**: Pure facet-based retrieval
4. **verify_entity_exists**: Entity existence checking
5. **ground_claim**: Evidence-based claim verification
6. **get_fragment_context**: Get full context graph for RAG

Plus backwards compatibility tests for existing UI endpoints.

## Adding Test Scenarios

Edit `fixtures/eval-scenarios.json`:

```json
{
  "scenarios": {
    "your_scenario_name": {
      "description": "What this scenario tests",
      "facets": {
        "life_event": "Your Life Event",
        "state": "NSW"
      },
      "expected_entities": [
        "Expected Service Name"
      ],
      "test_claims": [
        {
          "claim": "Your factual claim",
          "expected_verdict": "supported|contradicted|not_found",
          "min_confidence": 0.7
        }
      ],
      "search_queries": [
        {
          "query": "your search term",
          "min_results": 3
        }
      ]
    }
  }
}
```

## Test Endpoints

Tests call the new v2 endpoints (non-breaking):

- `POST /v2/search` - Search with facets
- `POST /v2/facets` - Get available facets
- `POST /v2/content` - Get content by facets only
- `POST /v2/verify-entity` - Verify entity exists
- `POST /v2/ground-claim` - Ground factual claims
- `POST /v2/fragment-context` - Get fragment context

**Legacy endpoints are preserved** for UI compatibility:
- `/search`, `/facets`, `/analyze-combinations`, `/rank-content`

## Environment Variables

```bash
# Override default URLs
MCP_URL=http://localhost:8081 \
API_URL=http://localhost:3000 \
node mcp-tools.test.js
```

## CI/CD Integration

```bash
# In your CI pipeline
npm test  # or: node tests/mcp-tools.test.js

# Exit code 0 = all passed
# Exit code 1 = failures
```

## Writing Agent Evals

The test fixtures can be used as eval datasets:

```javascript
const scenarios = require('./fixtures/eval-scenarios.json');

// Use in your agent eval framework
for (const [name, scenario] of Object.entries(scenarios.scenarios)) {
  // Test agent's ability to ground claims
  const agentResponse = await agent.answer(scenario.test_claims[0].claim);
  const groundTruth = await groundClaim(scenario.test_claims[0].claim);

  // Compare agent verdict with ground truth
  assertEqual(agentResponse.verdict, groundTruth.verdict);
}
```

## Next Steps

After tests pass:
1. Extend scenarios with more edge cases
2. Add performance benchmarks (response times)
3. Add load testing (concurrent requests)
4. Integrate with GitHub Actions
