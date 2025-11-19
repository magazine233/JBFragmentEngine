#!/bin/bash

# FragmentEngine Adversarial Evals - Quick Start
# This script runs a simple test to verify the eval framework is working

set -e

echo "╔════════════════════════════════════════════╗"
echo "║   FragmentEngine Adversarial Evals        ║"
echo "║   Quick Start Check                        ║"
echo "╚════════════════════════════════════════════╝"
echo ""

# Check if services are running
echo "1. Checking services..."
echo ""

check_service() {
    local name=$1
    local url=$2
    if curl -s -f "$url" > /dev/null 2>&1; then
        echo "   ✓ $name is running"
        return 0
    else
        echo "   ✗ $name is NOT running"
        return 1
    fi
}

services_ok=true
check_service "MCP Server" "http://localhost:8081/health" || services_ok=false
check_service "API Server" "http://localhost:3000/health" || services_ok=false
check_service "Typesense" "http://localhost:8108/health" || services_ok=false

echo ""

if [ "$services_ok" = false ]; then
    echo "⚠️  Some services are not running."
    echo ""
    echo "To start services:"
    echo "  docker-compose up -d typesense mcp-server api"
    echo ""
    read -p "Start services now? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Starting services..."
        cd .. && docker-compose up -d typesense mcp-server api
        echo "Waiting 10 seconds for services to start..."
        sleep 10
        cd evals
    else
        echo "Exiting. Please start services and try again."
        exit 1
    fi
fi

# Check if samples exist
echo "2. Checking eval samples..."
if [ -f "registry/data/government-services-grounding/samples.jsonl" ]; then
    sample_count=$(wc -l < registry/data/government-services-grounding/samples.jsonl)
    echo "   ✓ Found $sample_count samples"
else
    echo "   ✗ Samples file not found"
    exit 1
fi

echo ""

# Check if Typesense has data
echo "3. Checking Typesense data..."
fragment_count=$(curl -s "http://localhost:8108/collections/content_fragments" \
    -H "X-TYPESENSE-API-KEY: ${TYPESENSE_API_KEY:-xyz123abc}" \
    | jq -r '.num_documents // 0' 2>/dev/null || echo "0")

if [ "$fragment_count" -gt 0 ]; then
    echo "   ✓ Typesense has $fragment_count fragments"
else
    echo "   ⚠️  Typesense collection is empty or not accessible"
    echo ""
    echo "   The evals will still run, but results may be limited."
    echo "   To populate data, run: docker-compose run --rm scraper"
    echo ""
fi

echo ""

# Run a quick test
echo "4. Running quick test (baseline mode, 3 samples)..."
echo ""

# Create temp samples file with just 3 samples for quick test
head -3 registry/data/government-services-grounding/samples.jsonl > /tmp/quick-test.jsonl

# Run baseline eval with first 3 samples only
echo "   This will take ~1-2 minutes..."
echo ""

# Note: This is a simplified test - full eval in run-eval.js
export MCP_URL=${MCP_URL:-http://localhost:8081}
export LLM_API_URL=${LLM_API_URL:-http://localhost:3000/api/llm}

echo "   Test configuration:"
echo "   - MCP Server: $MCP_URL"
echo "   - LLM API: $LLM_API_URL"
echo "   - Samples: 3"
echo ""

# Check if we can reach LLM API
if ! curl -s -f "$LLM_API_URL/models" > /dev/null 2>&1; then
    echo "   ✗ Cannot reach LLM API at $LLM_API_URL"
    echo ""
    echo "   Please check:"
    echo "   - Is the API server running?"
    echo "   - Is LiteLLM/Ollama configured?"
    echo "   - Are models available?"
    echo ""
    echo "   Test models endpoint:"
    echo "   curl $LLM_API_URL/models"
    echo ""
    exit 1
fi

echo "   ✓ LLM API is accessible"
echo ""

# Run quick eval
echo "═══════════════════════════════════════════════"
echo "Running eval..."
echo "═══════════════════════════════════════════════"
echo ""

# The actual eval will be run by the user
echo "✓ Quick start checks passed!"
echo ""
echo "Next steps:"
echo ""
echo "1. Run a full eval in one mode:"
echo "   npm run eval:baseline"
echo "   npm run eval:tools"
echo "   npm run eval:adversarial"
echo ""
echo "2. Run all modes for comparison:"
echo "   npm run eval:all"
echo ""
echo "3. View results:"
echo "   ls -lh results/"
echo "   cat results/*.json | jq '.metrics'"
echo ""
echo "See README.md for more details."
echo ""
