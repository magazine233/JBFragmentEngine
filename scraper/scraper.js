// scraper/scraper.js
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const crypto = require('crypto');
const pLimit = require('p-limit');
const robotsParser = require('robots-parser');
const Typesense = require('typesense');
const fetch = require('node-fetch'); // Add this import
const { extractFragment } = require('./extractors');
const { enrichWithTaxonomy } = require('./taxonomies');
const { contentFragmentSchema } = require('/config/typesense-schema');
const { fetchSitemapUrls } = require('./sitemap');
const ScraperMonitor = require('./monitor');

const CRAWL_VERSION = Math.floor(Date.now() / 1000); // Unix timestamp in seconds, fits in int32
const CONCURRENCY = parseInt(process.env.CONCURRENCY) || 5;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class MyGovScraper {
  constructor(cfg) {
    this.cfg = cfg;
    this.typesense = new Typesense.Client({
      nodes: [{ 
        host: process.env.TYPESENSE_HOST || 'localhost', 
        port: process.env.TYPESENSE_PORT || '8108', 
        protocol: 'http' 
      }],
      apiKey: process.env.TYPESENSE_API_KEY || 'xyz123abc',
      connectionTimeoutSeconds: 10
    });
    this.limit = pLimit(CONCURRENCY);
    this.visited = new Set();
    this.fragments = [];
    this.requestCount = 0;
    this.startTime = Date.now();
    this.monitor = new ScraperMonitor();
  }

  async prepareCollection() {
    const collName = contentFragmentSchema.name;
    try {
      await this.typesense.collections(collName).retrieve();
      console.log('Collection exists, ready for upsert');
    } catch (_) {
      console.log('Creating new collection...');
      await this.typesense.collections().create(contentFragmentSchema);
    }
  }

  async run(startUrl) {
    await this.prepareCollection();

    const browser = await puppeteer.launch({ 
      headless: 'new', 
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      // Use system Chromium if available (for Docker)
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
    });
    
    try {
      const robots = await this.fetchRobots(startUrl);
      
      // Try sitemap first
      const sitemapUrls = await fetchSitemapUrls(startUrl);
      if (sitemapUrls.length > 0) {
        console.log(`Found ${sitemapUrls.length} URLs from sitemap`);
        // Crawl sitemap URLs with higher priority
        await Promise.all(
          sitemapUrls.slice(0, this.cfg.maxPages).map(url => 
            this.limit(() => this.crawl(browser, url, robots, 0))
          )
        );
      }
      
      // Then crawl normally
      await this.crawl(browser, startUrl, robots);
      await this.indexFragments();
      await this.pruneStaleDocs();
      
      // Print final report
      console.log('Crawl complete!', this.monitor.getReport());
    } finally {
      await browser.close();
    }
  }

  async fetchRobots(seed) {
    try {
      const robotsUrl = new URL('/robots.txt', seed).href;
      const res = await fetch(robotsUrl);
      if (!res.ok) throw new Error();
      const body = await res.text();
      return robotsParser(robotsUrl, body);
    } catch {
      console.log('No robots.txt found, proceeding without restrictions');
      return { isAllowed: () => true };
    }
  }

  async crawl(browser, url, robots, depth = 0, retries = 3) {
    if (this.visited.has(url) || depth > this.cfg.maxDepth || !robots.isAllowed(url, '*')) {
      return;
    }
    
    // Rate limiting
    this.requestCount++;
    if (this.requestCount % 10 === 0) {
      const elapsed = Date.now() - this.startTime;
      const rps = this.requestCount / (elapsed / 1000);
      console.log(`Crawl rate: ${rps.toFixed(2)} req/s`);
      
      // Throttle if too fast
      if (rps > 5) {
        await delay(200);
      }
    }
    
    this.visited.add(url);
    console.log(`Crawling: ${url} (depth: ${depth})`);

    const page = await browser.newPage();
    const crawlStart = Date.now();
    
    try {
      await page.setRequestInterception(true);
      
      // Block unnecessary resources for faster crawling
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Wait for main content
      await page.waitForSelector('main, #main-content, .main-content, article', { timeout: 5000 }).catch(() => {});
      
      const html = await page.content();
      const $ = cheerio.load(html);
      const frags = await this.extractFragments($, url, page);
      this.fragments.push(...frags);
      
      this.monitor.recordCrawl(url, true, Date.now() - crawlStart);
      this.monitor.stats.fragmentsExtracted += frags.length;

      if (depth < this.cfg.maxDepth) {
        const links = await page.evaluate(() => 
          Array.from(document.querySelectorAll('a[href]'))
            .map(a => ({ href: a.href, text: a.textContent }))
        );
        
        // Filter and prioritize links
        const priorityLinks = links
          .filter(l => {
            try {
              const linkUrl = new URL(l.href);
              return linkUrl.origin === new URL(location.href).origin &&
                     !l.href.match(/\.(pdf|doc|docx|xls|xlsx)$/i) &&
                     !l.href.includes('#') &&
                     !this.cfg.excludePatterns.some(pattern => pattern.test(l.href));
            } catch {
              return false;
            }
          })
          .sort((a, b) => {
            const aScore = this.scoreLinkRelevance(a.text);
            const bScore = this.scoreLinkRelevance(b.text);
            return bScore - aScore;
          })
          .slice(0, this.cfg.maxLinksPerPage)
          .map(l => l.href);
        
        await Promise.all(
          priorityLinks.map(link => 
            this.limit(() => this.crawl(browser, link, robots, depth + 1))
          )
        );
      }
    } catch (e) {
      console.error(`Crawl error (${retries} retries left)`, url, e.message);
      this.monitor.recordCrawl(url, false, Date.now() - crawlStart);
      
      if (retries > 0) {
        await delay(1000);
        return this.crawl(browser, url, robots, depth, retries - 1);
      }
    } finally {
      await page.close();
    }
  }

  scoreLinkRelevance(linkText) {
    const keywords = ['service', 'eligibility', 'apply', 'benefit', 'support', 'help', 'information'];
    const text = (linkText || '').toLowerCase();
    return keywords.filter(k => text.includes(k)).length;
  }

  async extractFragments($, url, page) {
    const fragments = [];
    
    try {
      const pageTitle = $('title').text() || '';
      const breadcrumbs = this.extractBreadcrumbs($);
    
      // Extract main content area
      const mainSelectors = ['main', '#main-content', '.main-content', 'article'];
      let $main = null;
      
      for (const selector of mainSelectors) {
        if ($(selector).length) {
          $main = $(selector).first();
          break;
        }
      }
      
      if (!$main) {
        $main = $('body');
      }

      // Find all headings and their content
      const headings = $main.find('h1, h2, h3, h4').toArray();
      
      for (let i = 0; i < headings.length; i++) {
        const heading = headings[i];
        const $heading = $(heading);
        const nextHeading = headings[i + 1];
        
        // Get content between this heading and the next
        let $content = $heading.nextUntil(
          nextHeading ? $(nextHeading) : undefined,
          'p, ul, ol, div.content, .info-box, table, form'
        );
        
        if ($content.length === 0 && $heading.parent().is('div, section, article')) {
          // Try getting siblings within the same container
          const $container = $heading.parent();
          const siblings = $container.children().not('h1, h2, h3, h4').toArray();
          siblings.forEach(elem => {
            $content = $content.add(elem);
          });
        }

        if ($content.length > 0 || $heading.is('h1')) {
          try {
            const fragment = await extractFragment({
              $heading,
              $content,
              $,
              url,
              breadcrumbs,
              pageTitle,
              page
            });
            
            if (fragment) {
              // Enrich with taxonomy
              const enrichedFragment = await enrichWithTaxonomy(fragment);
              
              // Add versioning fields
              const finalFragment = {
                ...enrichedFragment,
                crawl_version: CRAWL_VERSION,
                last_seen_at: Date.now(),
                popularity_sort: 100 - (enrichedFragment.popularity_score || 0)
              };
              
              fragments.push(finalFragment);
            }
          } catch (fragmentError) {
            console.error(`Error processing fragment in ${url}:`, fragmentError.message);
            // Continue with other fragments
          }
        }
      }

      // Also extract any standalone important sections
      const standaloneSelectors = [
        '.alert', '.warning-box', '.info-panel',
        '[role="alert"]', '.checklist', '.step-list'
      ];
      
      for (const selector of standaloneSelectors) {
        try {
          const elements = $main.find(selector).toArray();
          for (const elem of elements) {
            const $elem = $(elem);
            
            // Safely check if this element is already part of a heading section
            // Use a more robust approach that doesn't rely on complex selectors
            let isPartOfHeading = false;
            try {
              // Check if any parent is a heading or if closest heading exists
              const headingSelectors = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
              for (const hSelector of headingSelectors) {
                const $headings = $main.find(hSelector);
                for (let h = 0; h < $headings.length; h++) {
                  const $h = $headings.eq(h);
                  // Check if this element comes after the heading in document order
                  if ($h.get(0) && $elem.get(0) && 
                      $h.get(0).compareDocumentPosition($elem.get(0)) & Node.DOCUMENT_POSITION_FOLLOWING) {
                    // Check if there's another heading between them
                    const nextHeading = $h.nextAll(headingSelectors.join(',')).first();
                    if (!nextHeading.length || 
                        (nextHeading.get(0).compareDocumentPosition($elem.get(0)) & Node.DOCUMENT_POSITION_PRECEDING)) {
                      isPartOfHeading = true;
                      break;
                    }
                  }
                }
                if (isPartOfHeading) break;
              }
            } catch (closestError) {
              // If we can't determine hierarchy safely, skip this check
              console.log(`Skipping hierarchy check for standalone element: ${closestError.message}`);
            }
            
            if (!isPartOfHeading) {
              try {
                const fragment = this.extractStandaloneFragment($elem, url, breadcrumbs);
                if (fragment) {
                  const enrichedFragment = await enrichWithTaxonomy(fragment);
                  fragments.push({
                    ...enrichedFragment,
                    crawl_version: CRAWL_VERSION,
                    last_seen_at: Date.now(),
                    popularity_sort: 100 - (enrichedFragment.popularity_score || 0)
                  });
                }
              } catch (standaloneError) {
                console.error(`Error processing standalone element in ${url}:`, standaloneError.message);
                // Continue with other elements
              }
            }
          }
        } catch (selectorError) {
          console.error(`Error with selector ${selector} in ${url}:`, selectorError.message);
          // Continue with other selectors
        }
      }

      return fragments;
    } catch (error) {
      console.error(`Error in extractFragments for ${url}:`, error.message);
      return fragments; // Return what we have so far
    }
  }

  extractBreadcrumbs($) {
    const breadcrumbs = [];
    
    // Common breadcrumb selectors
    const selectors = [
      '.breadcrumb li',
      'nav[aria-label="breadcrumb"] li',
      '.breadcrumbs li',
      '[class*="breadcrumb"] li'
    ];
    
    for (const selector of selectors) {
      try {
        const $items = $(selector);
        if ($items.length > 0) {
          $items.each((i, item) => {
            const text = $(item).text().trim();
            if (text && text !== '>' && text !== '/') {
              breadcrumbs.push(text);
            }
          });
          break;
        }
      } catch (breadcrumbError) {
        console.log(`Error extracting breadcrumbs with selector ${selector}:`, breadcrumbError.message);
      }
    }
    
    return breadcrumbs;
  }

  extractStandaloneFragment($elem, url, breadcrumbs) {
    const crypto = require('crypto');
    const id = crypto.createHash('md5')
      .update(url + $elem.text())
      .digest('hex');
    
    const title = $elem.find('h1, h2, h3, h4').first().text() || 
                  $elem.attr('aria-label') || 
                  'Important Information';
    
    return {
      id,
      url: `${url}#${id}`,
      title,
      content_text: $elem.text().trim(),
      content_html: $elem.html(),
      site_hierarchy: this.extractSiteHierarchy(url),
      page_hierarchy: breadcrumbs,
      
      // Ensure required hierarchy fields are present
      hierarchy_lvl0: breadcrumbs[breadcrumbs.length - 1] || title || 'Content',
      
      component_type: this.detectComponentType($elem),
      last_modified: new Date().getTime()
    };
  }

  extractSiteHierarchy(url) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname
        .split('/')
        .filter(part => part.length > 0);
      
      return [urlObj.hostname, ...pathParts];
    } catch {
      return [];
    }
  }

  detectComponentType($elem) {
    if ($elem.is('form') || $elem.find('form').length) return 'form';
    if ($elem.is('table') || $elem.find('table').length) return 'table';
    if ($elem.hasClass('checklist') || $elem.find('ol.steps').length) return 'checklist';
    if ($elem.hasClass('alert') || $elem.is('[role="alert"]')) return 'alert';
    if ($elem.hasClass('info-box') || $elem.hasClass('info-panel')) return 'info_box';
    return 'content';
  }

  async indexFragments() {
    console.log(`Indexing ${this.fragments.length} fragments...`);
    const coll = this.typesense.collections('content_fragments').documents();
    
    let indexed = 0;
    for (let i = 0; i < this.fragments.length; i += 100) {
      const batch = this.fragments.slice(i, i + 100);
      try {
        const result = await coll.import(batch, { action: 'upsert' });
        indexed += batch.length;
        console.log(`Progress: ${indexed}/${this.fragments.length} (${Math.round(indexed/this.fragments.length*100)}%)`);
      } catch (e) {
        console.error('Batch import error:', e);
        // Try individual upserts for failed batch
        for (const doc of batch) {
          try {
            await coll.upsert(doc);
            indexed++;
          } catch (docErr) {
            console.error(`Failed to index fragment: ${doc.url}`, docErr.message);
          }
        }
      }
    }
    console.log(`Indexing complete: ${indexed} documents`);
  }

  async pruneStaleDocs() {
    console.log('Pruning stale documents...');
    try {
      const result = await this.typesense
        .collections('content_fragments')
        .documents()
        .delete({ filter_by: `crawl_version:<${CRAWL_VERSION}` });
      console.log(`Pruned ${result.num_deleted} stale documents`);
    } catch (e) {
      console.error('Error pruning stale docs:', e);
    }
  }
}

// Run the scraper
if (require.main === module) {
  const cfg = require('/config/scraper-config');
  const scraper = new MyGovScraper(cfg);
  const startUrl = process.env.TARGET_URL || 'https://my.gov.au';
  
  scraper.run(startUrl)
    .then(() => console.log('Scraping complete!'))
    .catch(console.error);
}

module.exports = MyGovScraper;
