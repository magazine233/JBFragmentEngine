# FragmentEngine Content Extractor

A Typesense-powered content extraction and search system for government websites. This system crawls websites, extracts structured content fragments, enriches them with taxonomies, and provides a powerful search API. It then exposes this backend to produce user profiles, personalised content recommendation, retrieval augemented generation, service checklists and journey map visualisation. 

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

0. Prep your system
On a clean vm you'll need to install docker-compose, enable docker and add yourself to the docker group 

1. Clone the repository:
```bash
git clone https://github.com/p0ss/FragmentEngine
cd FragmentEngine
```

2. Copy environment configuration:
```bash
cp .env-example .env
```

3. Edit `.env` with your settings:
```bash
TYPESENSE_API_KEY=your-secure-key-here
# Optional: unified scraper targets (comma-separated)
# TARGET_URLS=https://my.gov.au,https://www.servicesaustralia.gov.au
```

4. Deploy the system:
```bash
chmod +x deploy.sh
./deploy.sh --crawl  # Include --crawl to run initial scrape
```



## Usage

### Running a Crawl (Unified Scraper)

```bash
# Run a full crawl of default targets (my.gov.au + servicesaustralia.gov.au)
docker-compose run --rm scraper

# Or specify multiple targets explicitly
TARGET_URLS="https://my.gov.au,https://www.servicesaustralia.gov.au,https://www.ato.gov.au" \
  docker-compose run --rm -e TARGET_URLS="$TARGET_URLS" scraper

# Tuning options
docker-compose run --rm -e MAX_DEPTH=2 -e CONCURRENCY=8 scraper
```

If you prefer targeted runs, the compose file also includes:
- `scraper-mygov`
- `scraper-servicesaustralia`

However, the unified `scraper` service is recommended to keep a single crawl version and simplify pruning/indexing across domains.

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

#### List available chat models (via LiteLLM or Ollama)
```bash
curl "http://localhost:3000/api/llm/models"
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

### Chat/LLM Integration

This stack runs LiteLLM by default (via Docker Compose) to proxy requests to local Ollama and/or remote APIs. The UI auto-discovers models from LiteLLM and provides a dropdown to switch.

- Configure in `.env`:
  - `OLLAMA_URL` → where your local Ollama is reachable from within Docker.
    - Linux: `http://172.17.0.1:11434`
    - Mac/Windows: `http://host.docker.internal:11434`
  - `OPENAI_API_KEY` → optional, enables OpenAI models in LiteLLM.
- The API uses `LITELLM_URL=http://litellm:4000` by default (in-compose DNS).

You can verify models available via:
```bash
curl http://localhost:3000/api/llm/models
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
