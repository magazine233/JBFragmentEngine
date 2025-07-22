#!/bin/bash
# deploy.sh

echo "🚀 Deploying MyGov Content Extractor..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found. Please copy .env.example to .env and configure it."
    exit 1
fi

# Load environment
export $(cat .env | grep -v '^#' | xargs)

# Build images
echo "🔨 Building Docker images..."
docker-compose build

# Start services
echo "🐳 Starting services..."
docker-compose up -d

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
echo ""
echo "Next steps:"
echo "  - Run initial crawl: docker-compose run --rm scraper"
echo "  - Check API health: curl http://localhost:3000/health"
echo "  - View logs: docker-compose logs -f"