/**
 * MCP Tools Integration Tests
 *
 * Tests the 6 core MCP tools against real Typesense data
 * Run with: node tests/mcp-tools.test.js
 *
 * Requires:
 * - Typesense running with content_fragments collection populated
 * - MCP server HTTP bridge running on port 8081
 */

const scenarios = require('./fixtures/eval-scenarios.json');

const MCP_BASE_URL = process.env.MCP_URL || 'http://localhost:8081';
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';

// Test results tracker
const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
  errors: []
};

// Helper: Make HTTP request to MCP endpoint
async function callMCPTool(endpoint, body) {
  const response = await fetch(`${MCP_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return await response.json();
}

// Helper: Assert with detailed logging
function assert(condition, message, details = {}) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    results.passed++;
  } else {
    console.error(`  ✗ ${message}`);
    console.error(`    Details:`, details);
    results.failed++;
    results.errors.push({ message, details });
  }
}

// Test Suite 1: search_fragments
async function testSearchFragments() {
  console.log('\n=== Testing search_fragments ===');

  for (const [scenarioName, scenario] of Object.entries(scenarios.scenarios)) {
    if (!scenario.search_queries) continue;

    console.log(`\n  Scenario: ${scenario.description}`);

    for (const queryTest of scenario.search_queries) {
      try {
        const result = await callMCPTool('/v2/search', {
          query: queryTest.query,
          facets: scenario.facets,
          per_page: 20
        });

        assert(
          result.results && Array.isArray(result.results),
          `Returns results array for "${queryTest.query}"`,
          { got: typeof result.results }
        );

        assert(
          result.results.length >= queryTest.min_results,
          `Returns at least ${queryTest.min_results} results`,
          { expected: queryTest.min_results, got: result.results.length }
        );

        if (queryTest.must_contain_entity) {
          const hasEntity = result.results.some(r =>
            r.title?.toLowerCase().includes(queryTest.must_contain_entity.toLowerCase())
          );
          assert(
            hasEntity,
            `Results include "${queryTest.must_contain_entity}"`,
            { titles: result.results.slice(0, 5).map(r => r.title) }
          );
        }

        // Check structure
        if (result.results.length > 0) {
          const firstResult = result.results[0];
          assert(
            firstResult.id && firstResult.title && firstResult.url,
            'Results have required fields (id, title, url)',
            { sample: Object.keys(firstResult) }
          );
        }

      } catch (error) {
        console.error(`  ✗ Error testing "${queryTest.query}":`, error.message);
        results.failed++;
        results.errors.push({ test: queryTest.query, error: error.message });
      }
    }
  }
}

// Test Suite 2: get_facets
async function testGetFacets() {
  console.log('\n=== Testing get_facets ===');

  try {
    // Test 1: Get all facets
    const allFacets = await callMCPTool('/v2/facets', {
      query: '*'
    });

    assert(
      allFacets.life_events && Array.isArray(allFacets.life_events),
      'Returns life_events array',
      { got: typeof allFacets.life_events }
    );

    assert(
      allFacets.categories && Array.isArray(allFacets.categories),
      'Returns categories array',
      { got: typeof allFacets.categories }
    );

    assert(
      allFacets.states && Array.isArray(allFacets.states),
      'Returns states array',
      { got: typeof allFacets.states }
    );

    assert(
      allFacets.providers && Array.isArray(allFacets.providers),
      'Returns providers array',
      { got: typeof allFacets.providers }
    );

    // Test 2: Facet structure
    if (allFacets.life_events.length > 0) {
      const facet = allFacets.life_events[0];
      assert(
        facet.value && typeof facet.count === 'number',
        'Facets have value and count fields',
        { sample: facet }
      );
    }

    // Test 3: Filtered facets
    const filteredFacets = await callMCPTool('/v2/facets', {
      query: '*',
      for_facets: { life_event: 'Having a baby' }
    });

    assert(
      filteredFacets.categories.length > 0,
      'Returns facets filtered by existing selection',
      { count: filteredFacets.categories.length }
    );

  } catch (error) {
    console.error(`  ✗ Error:`, error.message);
    results.failed++;
  }
}

// Test Suite 3: get_content_by_facets
async function testGetContentByFacets() {
  console.log('\n=== Testing get_content_by_facets ===');

  for (const [scenarioName, scenario] of Object.entries(scenarios.scenarios)) {
    console.log(`\n  Scenario: ${scenario.description}`);

    try {
      const result = await callMCPTool('/v2/content', {
        facets: scenario.facets,
        per_page: 50,
        page: 1
      });

      assert(
        result.results && Array.isArray(result.results),
        'Returns results array',
        { got: typeof result.results }
      );

      assert(
        result.found >= 0,
        'Returns found count',
        { found: result.found }
      );

      assert(
        result.results.length > 0,
        `Returns content for facet combination`,
        { facets: scenario.facets, count: result.results.length }
      );

      // Verify facet filtering worked
      if (scenario.facets.provider && result.results.length > 0) {
        const matchingProvider = result.results.every(r =>
          r.provider === scenario.facets.provider
        );
        assert(
          matchingProvider,
          `All results match provider filter "${scenario.facets.provider}"`,
          { providers: [...new Set(result.results.map(r => r.provider))] }
        );
      }

    } catch (error) {
      console.error(`  ✗ Error:`, error.message);
      results.failed++;
    }
  }
}

// Test Suite 4: verify_entity_exists
async function testVerifyEntity() {
  console.log('\n=== Testing verify_entity_exists ===');

  // Test existing entities
  for (const [scenarioName, scenario] of Object.entries(scenarios.scenarios)) {
    if (!scenario.expected_entities) continue;

    console.log(`\n  Scenario: ${scenario.description}`);

    for (const entityName of scenario.expected_entities) {
      try {
        const result = await callMCPTool('/v2/verify-entity', {
          entity_name: entityName,
          facets: scenario.facets
        });

        assert(
          result.exists === true,
          `Entity "${entityName}" exists`,
          { result }
        );

        assert(
          result.matches && result.matches.length > 0,
          `Returns matches for "${entityName}"`,
          { count: result.matches?.length }
        );

        if (result.matches && result.matches.length > 0) {
          const match = result.matches[0];
          assert(
            match.id && match.title && match.url,
            'Match has required fields',
            { fields: Object.keys(match) }
          );
        }

      } catch (error) {
        console.error(`  ✗ Error verifying "${entityName}":`, error.message);
        results.failed++;
      }
    }
  }

  // Test non-existent entity
  console.log('\n  Edge case: Non-existent entity');
  try {
    const result = await callMCPTool('/v2/verify-entity', {
      entity_name: scenarios.edge_cases.non_existent_entity.entity_name
    });

    assert(
      result.exists === false,
      `Non-existent entity returns exists: false`,
      { result }
    );
  } catch (error) {
    console.error(`  ✗ Error:`, error.message);
    results.failed++;
  }
}

// Test Suite 5: ground_claim
async function testGroundClaim() {
  console.log('\n=== Testing ground_claim ===');

  for (const [scenarioName, scenario] of Object.entries(scenarios.scenarios)) {
    if (!scenario.test_claims) continue;

    console.log(`\n  Scenario: ${scenario.description}`);

    for (const claimTest of scenario.test_claims) {
      try {
        const result = await callMCPTool('/v2/ground-claim', {
          claim: claimTest.claim,
          facets: scenario.facets,
          max_evidence: 5
        });

        assert(
          ['supported', 'contradicted', 'not_found', 'ambiguous'].includes(result.verdict),
          `Returns valid verdict for claim`,
          { claim: claimTest.claim, verdict: result.verdict }
        );

        assert(
          typeof result.confidence === 'number' && result.confidence >= 0 && result.confidence <= 1,
          'Returns confidence score between 0 and 1',
          { confidence: result.confidence }
        );

        assert(
          result.verdict === claimTest.expected_verdict,
          `Verdict matches expected: ${claimTest.expected_verdict}`,
          { expected: claimTest.expected_verdict, got: result.verdict }
        );

        if (claimTest.min_confidence) {
          assert(
            result.confidence >= claimTest.min_confidence,
            `Confidence >= ${claimTest.min_confidence}`,
            { expected: claimTest.min_confidence, got: result.confidence }
          );
        }

        assert(
          result.evidence && Array.isArray(result.evidence),
          'Returns evidence array',
          { count: result.evidence?.length }
        );

      } catch (error) {
        console.error(`  ✗ Error grounding claim:`, error.message);
        console.error(`    Claim: "${claimTest.claim}"`);
        results.failed++;
      }
    }
  }
}

// Test Suite 6: get_fragment_context
async function testGetFragmentContext() {
  console.log('\n=== Testing get_fragment_context ===');

  try {
    // First, get a fragment ID to test with
    const searchResult = await callMCPTool('/v2/search', {
      query: 'medicare',
      per_page: 1
    });

    if (searchResult.results.length === 0) {
      console.log('  ⊘ Skipped: No fragments found to test context');
      results.skipped++;
      return;
    }

    const fragmentId = searchResult.results[0].id;
    console.log(`\n  Testing with fragment: ${fragmentId}`);

    const result = await callMCPTool('/v2/fragment-context', {
      fragment_id: fragmentId,
      include_hierarchy: true,
      include_page_siblings: true,
      include_related_pages: true
    });

    assert(
      result.fragment && result.fragment.id === fragmentId,
      'Returns fragment data',
      { got: result.fragment?.id }
    );

    assert(
      result.page_url,
      'Returns page URL',
      { url: result.page_url }
    );

    assert(
      result.hierarchy && Array.isArray(result.hierarchy),
      'Returns hierarchy array',
      { got: typeof result.hierarchy }
    );

    // Optional fields
    console.log(`    Siblings count: ${result.siblings?.length || 0}`);
    console.log(`    Related pages: ${result.related_pages?.length || 0}`);

  } catch (error) {
    console.error(`  ✗ Error:`, error.message);
    results.failed++;
  }
}

// Test Suite 7: Backwards compatibility with existing UI
async function testBackwardsCompatibility() {
  console.log('\n=== Testing Backwards Compatibility ===');

  try {
    // Test existing /search endpoint still works
    const searchResult = await callMCPTool('/search', {
      query: 'medicare',
      per_page: 5
    });

    assert(
      searchResult !== null,
      'Legacy /search endpoint still works',
      { status: 'ok' }
    );

    // Test existing /facets endpoint
    const facetsResult = await callMCPTool('/facets', {});

    assert(
      facetsResult !== null,
      'Legacy /facets endpoint still works',
      { status: 'ok' }
    );

    // Test existing /analyze-combinations endpoint
    const analyzeResult = await callMCPTool('/analyze-combinations', {
      existing_filters: { category: 'Health and caring' }
    });

    assert(
      analyzeResult !== null,
      'Legacy /analyze-combinations endpoint still works',
      { status: 'ok' }
    );

  } catch (error) {
    console.error(`  ✗ Backwards compatibility broken:`, error.message);
    results.failed++;
  }
}

// Main test runner
async function runTests() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   FragmentEngine MCP Tools Test Suite     ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`\nMCP Server: ${MCP_BASE_URL}`);
  console.log(`API Server: ${API_BASE_URL}\n`);

  try {
    await testSearchFragments();
    await testGetFacets();
    await testGetContentByFacets();
    await testVerifyEntity();
    await testGroundClaim();
    await testGetFragmentContext();
    await testBackwardsCompatibility();

  } catch (error) {
    console.error('\n❌ Test suite failed with error:', error);
  }

  // Print summary
  console.log('\n\n╔════════════════════════════════════════════╗');
  console.log('║              Test Summary                  ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`  ✓ Passed:  ${results.passed}`);
  console.log(`  ✗ Failed:  ${results.failed}`);
  console.log(`  ⊘ Skipped: ${results.skipped}`);
  console.log(`  Total:     ${results.passed + results.failed + results.skipped}\n`);

  if (results.failed > 0) {
    console.log('Failed tests:');
    results.errors.slice(0, 10).forEach((err, i) => {
      console.log(`  ${i + 1}. ${err.message || err.error}`);
    });
    process.exit(1);
  } else {
    console.log('✅ All tests passed!\n');
    process.exit(0);
  }
}

// Run tests if executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runTests, callMCPTool };
