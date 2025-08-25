#!/bin/bash
# deploy.sh

echo "🚀 Deploying MyGov Content Extractor..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found. Please copy .env.example to .env and configure it."
    exit 1
fi

# Load environment safely (supports spaces/quotes)
set -a
. ./.env
set +a

# Build images
echo "🔨 Building Docker images..."
docker-compose build

# Start services (conditionally include LiteLLM)
echo "🐳 Starting services..."
if [ "${ENABLE_LITELLM:-false}" = "true" ]; then
    echo "  📡 LiteLLM enabled - starting with unified AI routing"
    docker-compose --profile litellm up -d
else
    echo "  🦙 LiteLLM disabled - using direct provider calls"
    docker-compose up -d
fi

# Wait for Typesense to be ready
echo "⏳ Waiting for Typesense..."
max_attempts=30
attempt=0
until curl -s http://localhost:8108/health | grep -q "ok"; do
  attempt=$((attempt + 1))
  if [ $attempt -eq $max_attempts ]; then
    echo "❌ Typesense failed to start after $max_attempts attempts"
    exit 1
  fi
  echo "  Attempt $attempt/$max_attempts..."
  sleep 2
done

echo "✅ Typesense is ready"

# Check if we should run initial crawl
if [ "$1" == "--crawl" ]; then
    echo "🕷️ Starting initial crawl..."
    docker-compose run --rm scraper
fi

echo "✨ Deployment complete!"
echo "📊 API available at http://localhost:3000"
echo "🔍 Typesense dashboard at http://localhost:8108"
if [ "${ENABLE_LITELLM:-false}" = "true" ]; then
    echo "📡 LiteLLM unified AI router at http://localhost:4000"
fi
echo ""
echo "Next steps:"
echo "  - Run initial crawl: docker-compose run --rm scraper"
echo "  - Check API health: curl http://localhost:3000/health"
echo "  - Test AI models: curl http://localhost:3000/api/llm/models"
if [ "${ENABLE_LITELLM:-false}" = "true" ]; then
    echo "  - Check LiteLLM health: curl http://localhost:4000/health"
fi
echo "  - View logs: docker-compose logs -f"
