# Adversarial Evals Implementation - Summary

## What We Built

A complete **adversarial evaluation framework** where Claude evaluates itself with tool access, inspired by OpenAI Evals.

### Core Concept

Two instances of Claude work together:
1. **Responder**: Answers user queries (with optional tool access)
2. **Reviewer**: Fact-checks responses using tools, forces retry if wrong

This tests:
- Baseline accuracy (no tools)
- Tool-enabled accuracy (single-shot)
- Self-correction capability (adversarial loop)

## Architecture

```
User Query → Responder (generates answer)
                ↓
           Reviewer (fact-checks with tools)
                ↓
         ACCEPT ✓  or  REJECT ✗
                        ↓
            Responder retries with feedback
                        ↓
                    (repeat up to 3x)
```

## Files Created

### Eval Registry (OpenAI Evals Pattern)
```
evals/
├── registry/
│   ├── data/government-services-grounding/
│   │   └── samples.jsonl              # 8 test cases
│   └── evals/
│       └── government-services-grounding.yaml
```

### Prompts
```
├── prompts/
│   ├── reviewer.md                    # Fact-checker system prompt
│   └── responder-retry.md             # Retry with feedback prompt
```

### Orchestration
```
├── adversarial-orchestrator.js        # Core adversarial loop
├── run-eval.js                        # Main eval runner
├── package.json
└── README.md
```

### Results Directory
```
└── results/                           # Auto-created, stores JSON output
```

## Test Scenarios

From `samples.jsonl`:

1. **Factual accuracy**: "How long is Paid Parental Leave?" → 18 weeks
2. **Work requirements**: "What are work requirements?" → 10 months in 13 months
3. **Completeness**: "I'm in NSW having baby, what payments?" → PPL, Dad & Partner Pay, FTB
4. **Non-existent entity**: "Does Unicorn Subsidy exist?" → Should say no
5. **Entity disambiguation**: "Tell me about Family Payment" → Should clarify Family Tax Benefit
6. **Medicare services**: General health services listing
7. **Aged care VIC**: Victorian aged care services
8. **JobSeeker**: Purpose of JobSeeker Payment

## How to Run

### Start Services
```bash
docker-compose up -d typesense mcp-server api
```

### Run All Modes (Comparison)
```bash
cd evals
npm run eval:all
```

This runs:
1. **Baseline** - no tools
2. **With tools** - single-shot with MCP access
3. **Adversarial** - with reviewer forcing retries

### Run Individual Modes
```bash
npm run eval:baseline      # Baseline only
npm run eval:tools         # Tools only
npm run eval:adversarial   # Adversarial only
```

## Expected Results

Hypothesis to test:

| Mode | Expected Accuracy | Reasoning |
|------|-------------------|-----------|
| Baseline | 60-70% | Training data only, may be outdated |
| With Tools | 75-85% | Can ground facts, but may not use tools enough |
| Adversarial | 90-95% | Reviewer forces grounding of all claims |

## Metrics Tracked

### Core Metrics
- **Accuracy**: % correct responses
- **Partial**: % partially correct
- **Incorrect**: % wrong

### Adversarial-Specific
- **Avg iterations**: How many retries needed
- **Convergence rate**: % that reached ACCEPT
- **First-attempt accuracy**: % right without retry

## What This Tests

### For Claude's Self-Awareness (Your Question)

The adversarial setup tests:

1. **Tool usage discipline**: Does responder use tools proactively or lazily?
2. **Self-correction**: Can responder fix errors when given specific feedback?
3. **Claim extraction**: Can reviewer identify all factual claims?
4. **Grounding rigor**: Does reviewer actually verify claims or rubber-stamp?
5. **Convergence**: Do they reach accurate answers through iteration?

### Measuring Tool Value

Comparing modes shows:
- **Tools vs Baseline**: How much tools improve accuracy
- **Adversarial vs Tools**: Value of verification loop
- **Iteration patterns**: Which errors require multiple tries

## Key Innovation: Adversarial Self-Play

Unlike traditional evals (model vs ground truth), this is:
- **Model vs Model** using same tools
- **Forces explicit verification** via reviewer mandate
- **Iterative improvement** until acceptance or max iterations
- **Evidence-based** - all rejections cite tool results

This simulates production use where:
- You want responses to be accurate
- You have authoritative tools available
- You can iterate before showing to user
- You need audit trail (evidence URLs)

## Integration with MCP Tools

The adversarial loop uses all 6 v2 MCP tools:

- `verify_entity_exists` - Check service names
- `ground_claim` - Verify facts with evidence
- `search_fragments` - Find relevant content
- `get_content_by_facets` - Check completeness
- `get_facets` - Discover available filters
- `get_fragment_context` - Build GraphRAG context

Reviewer **must** use tools; Responder **can** use tools.

## Next Steps

### 1. Run First Eval
```bash
cd evals
npm run eval:all
```

This will take ~5-10 minutes (8 samples × 3 modes with API calls).

### 2. Analyze Results
Check `results/` directory for detailed JSON output:
- Which questions did baseline get wrong?
- Did tools help?
- How many iterations needed?
- What types of errors required reviewer intervention?

### 3. Tune Thresholds
Edit `prompts/reviewer.md` to adjust:
- Confidence thresholds (currently 0.6-0.7)
- What counts as "error"
- Completeness requirements

### 4. Add More Scenarios
Add to `registry/data/government-services-grounding/samples.jsonl`:
- Edge cases you've seen
- Common user queries
- Tricky eligibility rules
- Multi-step reasoning

### 5. Measure Over Time
Run evals after:
- Scraping new content
- Updating taxonomies
- Changing tool implementations
- Model updates

## Limitations & Future Work

### Current Limitations

1. **Simple claim grounding**: Uses keyword overlap, not semantic similarity
2. **No contradiction detection**: Can't catch inconsistencies within a response
3. **English only**: No multilingual support
4. **Static facets**: Doesn't learn from user feedback
5. **No temporal reasoning**: Can't detect outdated information

### Future Enhancements

**Phase 2: Semantic Grounding**
- Add embeddings to claim verification
- Use vector similarity for evidence matching
- Improve contradiction detection

**Phase 3: Multi-Agent Debate**
- 3+ agents debate before consensus
- Minority opinions flagged
- Confidence calibration from disagreement

**Phase 4: Continuous Learning**
- Track which errors repeat
- Update prompts based on failure patterns
- Build custom eval scenarios from production logs

## Why This Matters

This framework lets you:

1. **Quantify tool value**: Exact accuracy improvement from MCP tools
2. **Test model updates**: Run evals before/after model changes
3. **Validate content changes**: Ensure new scraped data improves accuracy
4. **Build confidence**: Know your accuracy rate for production
5. **Debug failures**: Detailed logs show where reasoning breaks down

Most importantly: You can now work on the eval framework (extending scenarios, tuning thresholds) and let the adversarial system ensure accuracy improves.

## Files Summary

Created 8 new files:
1. `evals/registry/data/government-services-grounding/samples.jsonl`
2. `evals/registry/evals/government-services-grounding.yaml`
3. `evals/prompts/reviewer.md`
4. `evals/prompts/responder-retry.md`
5. `evals/adversarial-orchestrator.js`
6. `evals/run-eval.js`
7. `evals/package.json`
8. `evals/README.md`

Plus this summary doc.

All existing code (MCP server, API, UI, tests) remains unchanged and functional.
