// config/scraper-config.js
module.exports = {
  maxDepth: parseInt(process.env.MAX_DEPTH) || 3,              // How deep to crawl
  maxLinksPerPage: parseInt(process.env.MAX_LINKS_PER_PAGE) || 10,      // Max links to follow per page
  maxPages: 1000,           // Total page limit
  crawlDelay: 1000,         // Delay between requests (ms)
  
  // Selectors for content extraction
  contentSelectors: {
    main: ['main', '#main-content', '.main-content', 'article'],
    headings: ['h1', 'h2', 'h3', 'h4'],
    content: ['p', 'ul', 'ol', 'div.content', '.info-box', 'table', 'form'],
    breadcrumbs: ['.breadcrumb', 'nav[aria-label="breadcrumb"]']
  },
  
  // URL patterns to exclude
  excludePatterns: [
    /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i,
    /\/search\?/,
    /\/login/,
    /\/logout/,
    /#/
  ],
  
  // URL patterns to prioritize
  priorityPatterns: [
    /\/services\//,
    /\/information\//,
    /\/help\//,
    /\/eligibility\//
  ]
};