/**
 * Adversarial Orchestrator
 *
 * Manages the responder-reviewer loop for adversarial evaluation.
 * Based on OpenAI evals framework patterns but adapted for FragmentEngine.
 */

const fs = require('fs').promises;
const path = require('path');

const MCP_BASE_URL = process.env.MCP_URL || 'http://localhost:8081';
const LLM_API_URL = process.env.LLM_API_URL || 'http://localhost:3000/api/llm';

// Load prompts
async function loadPrompt(name) {
  const promptPath = path.join(__dirname, 'prompts', `${name}.md`);
  return await fs.readFile(promptPath, 'utf-8');
}

// Call MCP tool
async function callMCPTool(endpoint, body) {
  const response = await fetch(`${MCP_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`MCP tool error: ${response.status} ${await response.text()}`);
  }

  return await response.json();
}

// Call LLM (via your API)
async function callLLM(messages, model = 'claude-3-5-sonnet-20241022', tools = null) {
  const requestBody = {
    messages,
    model,
    max_tokens: 1000,
    temperature: 0.1  // Lower temperature for more consistent evals
  };

  if (tools) {
    requestBody.tools = tools;
  }

  const response = await fetch(`${LLM_API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.content || data.message?.content || data.response;
}

// MCP tool definitions for function calling
const MCP_TOOLS = [
  {
    name: 'search_fragments',
    description: 'Search government services content with facet filtering',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        facets: {
          type: 'object',
          properties: {
            life_event: { type: 'string' },
            category: { type: 'string' },
            provider: { type: 'string' },
            state: { type: 'string' }
          }
        },
        per_page: { type: 'number', default: 10 }
      },
      required: ['query']
    }
  },
  {
    name: 'verify_entity_exists',
    description: 'Check if a government service or program exists',
    input_schema: {
      type: 'object',
      properties: {
        entity_name: { type: 'string', description: 'Name of service/program to verify' },
        facets: { type: 'object' }
      },
      required: ['entity_name']
    }
  },
  {
    name: 'ground_claim',
    description: 'Verify a factual claim against authoritative sources with evidence',
    input_schema: {
      type: 'object',
      properties: {
        claim: { type: 'string', description: 'The factual claim to verify' },
        focus_entity: { type: 'string' },
        facets: { type: 'object' },
        max_evidence: { type: 'number', default: 5 }
      },
      required: ['claim']
    }
  },
  {
    name: 'get_content_by_facets',
    description: 'Get all content matching specific facet combinations',
    input_schema: {
      type: 'object',
      properties: {
        facets: {
          type: 'object',
          properties: {
            life_event: { type: 'string' },
            category: { type: 'string' },
            provider: { type: 'string' },
            state: { type: 'string' }
          }
        },
        per_page: { type: 'number', default: 50 }
      },
      required: ['facets']
    }
  }
];

// Tool executor - maps function calls to MCP endpoints
async function executeTool(toolName, args) {
  const toolMap = {
    'search_fragments': '/v2/search',
    'verify_entity_exists': '/v2/verify-entity',
    'ground_claim': '/v2/ground-claim',
    'get_content_by_facets': '/v2/content'
  };

  const endpoint = toolMap[toolName];
  if (!endpoint) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  return await callMCPTool(endpoint, args);
}

/**
 * Responder: Generate initial response to user query
 */
async function runResponder(sample, toolsEnabled = true) {
  const messages = sample.input;

  if (toolsEnabled) {
    // Responder can use tools proactively
    return await callLLM(messages, 'claude-3-5-sonnet-20241022', MCP_TOOLS);
  } else {
    // Baseline: no tools
    return await callLLM(messages, 'claude-3-5-sonnet-20241022');
  }
}

/**
 * Reviewer: Check response for accuracy using tools
 */
async function runReviewer(userQuery, responderOutput, sample) {
  const reviewerPrompt = await loadPrompt('reviewer');

  const messages = [
    {
      role: 'system',
      content: reviewerPrompt
    },
    {
      role: 'user',
      content: `# User Query\n${userQuery}\n\n# Response to Review\n${responderOutput}\n\n# Context Facets\n${JSON.stringify(sample.facets || {}, null, 2)}\n\nPlease verify this response and return your verdict as JSON.`
    }
  ];

  // Reviewer ALWAYS has access to tools
  const reviewerResponse = await callLLM(messages, 'claude-3-5-sonnet-20241022', MCP_TOOLS);

  // Parse JSON from response
  try {
    // Extract JSON from markdown code blocks if present
    const jsonMatch = reviewerResponse.match(/```json\n([\s\S]*?)\n```/) ||
                      reviewerResponse.match(/```\n([\s\S]*?)\n```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : reviewerResponse;
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error('Failed to parse reviewer response:', reviewerResponse);
    throw new Error(`Reviewer output is not valid JSON: ${error.message}`);
  }
}

/**
 * Responder Retry: Generate corrected response based on reviewer feedback
 */
async function runResponderRetry(userQuery, originalResponse, reviewerFeedback) {
  const retryPrompt = await loadPrompt('responder-retry');

  const promptWithFeedback = retryPrompt.replace(
    '{REVIEWER_FEEDBACK}',
    JSON.stringify(reviewerFeedback, null, 2)
  );

  const messages = [
    {
      role: 'system',
      content: promptWithFeedback
    },
    {
      role: 'user',
      content: `# Original Query\n${userQuery}\n\n# Your Previous Response (Rejected)\n${originalResponse}\n\nPlease provide a corrected response.`
    }
  ];

  return await callLLM(messages, 'claude-3-5-sonnet-20241022', MCP_TOOLS);
}

/**
 * Adversarial Loop: Responder → Reviewer → Retry (up to max_iterations)
 */
async function runAdversarialLoop(sample, maxIterations = 3) {
  const userQuery = sample.input[sample.input.length - 1].content;
  const results = {
    iterations: [],
    final_verdict: null,
    converged: false
  };

  let currentResponse = null;

  for (let i = 0; i < maxIterations; i++) {
    const iteration = {
      number: i + 1,
      responder_output: null,
      reviewer_verdict: null,
      timestamp: new Date().toISOString()
    };

    try {
      // Step 1: Responder generates (or retries)
      if (i === 0) {
        console.log(`  Iteration ${i + 1}: Responder initial response...`);
        currentResponse = await runResponder(sample, true);
      } else {
        console.log(`  Iteration ${i + 1}: Responder retry...`);
        const previousReview = results.iterations[i - 1].reviewer_verdict;
        currentResponse = await runResponderRetry(userQuery, currentResponse, previousReview);
      }

      iteration.responder_output = currentResponse;

      // Step 2: Reviewer checks
      console.log(`  Iteration ${i + 1}: Reviewer checking...`);
      const review = await runReviewer(userQuery, currentResponse, sample);
      iteration.reviewer_verdict = review;

      results.iterations.push(iteration);

      // Step 3: Check if accepted
      if (review.verdict === 'ACCEPT') {
        results.final_verdict = 'ACCEPT';
        results.converged = true;
        console.log(`  ✓ Accepted after ${i + 1} iteration(s)`);
        break;
      } else {
        console.log(`  ✗ Rejected: ${review.verdict}`);
        console.log(`    Errors: ${review.errors?.length || 0}, Missing: ${review.missing_services?.length || 0}`);
      }

    } catch (error) {
      iteration.error = error.message;
      results.iterations.push(iteration);
      console.error(`  Error in iteration ${i + 1}:`, error.message);
      break;
    }
  }

  if (!results.converged) {
    results.final_verdict = 'MAX_ITERATIONS_EXCEEDED';
  }

  return results;
}

/**
 * Single evaluation mode (no adversarial review)
 */
async function runSingleEval(sample, toolsEnabled = true) {
  const userQuery = sample.input[sample.input.length - 1].content;

  try {
    const response = await runResponder(sample, toolsEnabled);

    // Still run reviewer to score, but don't iterate
    const review = await runReviewer(userQuery, response, sample);

    return {
      responder_output: response,
      reviewer_verdict: review,
      mode: toolsEnabled ? 'with_tools' : 'baseline'
    };
  } catch (error) {
    return {
      error: error.message,
      mode: toolsEnabled ? 'with_tools' : 'baseline'
    };
  }
}

module.exports = {
  runAdversarialLoop,
  runSingleEval,
  callMCPTool,
  executeTool
};
