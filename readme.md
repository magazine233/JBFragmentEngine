# FragmentEngine Content Extractor

A Typesense-powered content extraction and search system for government websites. This system crawls websites, extracts structured content fragments, enriches them with taxonomies, and provides a powerful search API.

## Features

- 🕷️ **Smart Web Scraping**: Concurrent crawling with robots.txt compliance
- 📊 **Rich Taxonomies**: Auto-categorization by life events, services, and locations
- 🔍 **Powerful Search**: Faceted search with typo tolerance
- 📦 **HTML Preservation**: Maintains original styling and structure
- 🔄 **Incremental Updates**: Smart versioning prevents duplicates
- 🚀 **Production Ready**: Docker deployment with monitoring

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local development)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/p0ss/FragmentEngine
cd mygov-content-extractor
```

2. Copy environment configuration:
```bash
cp .env.example .env
```

3. Edit `.env` with your settings:
```bash
TYPESENSE_API_KEY=your-secure-key-here
TARGET_URL=https://my.gov.au
```

4. Deploy the system:
```bash
chmod +x deploy.sh
./deploy.sh --crawl  # Include --crawl to run initial scrape
```

## Usage

### Running a Crawl

```bash
# Run a full crawl
docker-compose run --rm scraper

# Or with custom settings
docker-compose run --rm -e MAX_DEPTH=2 -e TARGET_URL=https://example.gov.au scraper
```

### API Examples
# Check if API is running
docker-compose up -d api

# Get collection stats
curl http://localhost:3000/api/fragments/stats/overview

#### Search for content
```bash
curl "http://localhost:3000/api/fragments/search?q=medicare"
```

#### Get available facets
```bash
curl "http://localhost:3000/api/fragments/facets"
```

#### Get specific fragment
```bash
curl "http://localhost:3000/api/fragments/[fragment-id]"
```

#### Get a bulk export
```bash
curl "http://localhost:3000/api/fragments/export"
```

### Integration Example

```javascript
// In your application
async function getChecklistItems(state, stage, stageVariant) {
  const params = new URLSearchParams({
    life_event: 'Having a baby',
    state: state,
    stage: stage,
    stage_variant: stageVariant,
    include_html: true,
    per_page: 100
  });

  const response = await fetch(`http://localhost:3000/api/fragments/search?${params}`);
  const data = await response.json();
  
  return data.results.map(hit => ({
    id: hit.document.id,
    title: hit.document.title,
    description: hit.document.content_text,
    url: hit.document.url,
    html: hit.document.content_html,
    provider: hit.document.provider
  }));
}
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Scraper   │────▶│  Typesense  │◀────│     API     │
└─────────────┘     └─────────────┘     └─────────────┘
       │                                         ▲
       │                                         │
       ▼                                         │
┌─────────────┐                           ┌─────────────┐
│  Websites   │                           │  Your App   │
└─────────────┘                           └─────────────┘
```

## Configuration

### Scraper Configuration (`config/scraper-config.js`)
- `maxDepth`: How deep to follow links (default: 3)
- `maxLinksPerPage`: Links to follow per page (default: 10)
- `concurrency`: Parallel crawling threads (default: 5)

### Taxonomy Configuration (`data/seed-taxonomies.json`)
- Life events and their keywords
- Service categories
- Government providers
- State mappings

## Development

### Local Development Setup

```bash
# Install dependencies
cd scraper && npm install
cd ../api && npm install

# Run Typesense
docker run -p 8108:8108 -v/tmp/typesense-data:/data \
  typesense/typesense:0.25.1 \
  --data-dir /data --api-key=xyz123

# Run scraper
cd scraper && npm start

# Run API
cd api && npm start
```

### Adding New Taxonomies

Edit `data/seed-taxonomies.json` to add new:
- Life events
- Categories
- Providers
- Stage variants

## Monitoring

Check crawl status:
```bash
docker-compose logs -f scraper
```

Check API health:
```bash
curl http://localhost:3000/health
```

View Typesense metrics:
```bash
curl http://localhost:8108/metrics.json
```

## Troubleshooting

### Crawl is too slow
- Increase `CONCURRENCY` in `.env`
- Reduce `maxDepth` for faster initial crawls

### Out of memory
- Adjust Docker memory limits in `docker-compose.yml`
- Reduce `CONCURRENCY`

### Missing content
- Check robots.txt compliance
- Verify selectors in `config/scraper-config.js`
- Check crawl depth settings

## License

MIT
