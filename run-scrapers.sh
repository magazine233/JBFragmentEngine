#!/bin/bash

# Expand content index by scraping multiple government sites
echo "🚀 Starting comprehensive government services scraping..."

# Start Typesense if not running
echo "📊 Starting Typesense..."
docker-compose up -d typesense

# Wait for Typesense to be ready
echo "⏳ Waiting for Typesense to be ready..."
sleep 10

# Run MyGov scraper first
echo "🏛️ Scraping my.gov.au for general government services..."
docker-compose run --rm scraper-mygov

# Run Services Australia scraper
echo "💰 Scraping servicesaustralia.gov.au for welfare and support services..."
docker-compose run --rm scraper-servicesaustralia

echo "✅ Content index expansion complete!"
echo "📈 Your guided mode should now have much better service recommendations."

# Show some stats
echo "📊 Checking content statistics..."
curl -s "http://localhost:8108/collections/content_fragments" \
  -H "X-TYPESENSE-API-KEY: ${TYPESENSE_API_KEY:-xyz123abc}" | \
  jq -r '"Total documents indexed: " + (.num_documents | tostring)'