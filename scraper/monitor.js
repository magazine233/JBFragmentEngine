// scraper/monitor.js
class ScraperMonitor {
  constructor() {
    this.stats = {
      startTime: Date.now(),
      urlsCrawled: 0,
      fragmentsExtracted: 0,
      errors: [],
      performance: {
        avgPageLoadTime: 0,
        avgExtractionTime: 0
      }
    };
  }

  recordCrawl(url, success, duration) {
    this.stats.urlsCrawled++;
    if (!success) {
      this.stats.errors.push({ url, time: new Date() });
    }
    // Update rolling average
    this.stats.performance.avgPageLoadTime = 
      (this.stats.performance.avgPageLoadTime * (this.stats.urlsCrawled - 1) + duration) / 
      this.stats.urlsCrawled;
  }

  recordExtraction(fragmentCount, duration) {
    this.stats.fragmentsExtracted += fragmentCount;
    // Update rolling average
    const totalExtractions = this.stats.fragmentsExtracted;
    this.stats.performance.avgExtractionTime = 
      (this.stats.performance.avgExtractionTime * (totalExtractions - fragmentCount) + duration) / 
      totalExtractions;
  }

  getReport() {
    const runtime = (Date.now() - this.stats.startTime) / 1000;
    return {
      ...this.stats,
      runtime: `${Math.floor(runtime / 60)}m ${Math.floor(runtime % 60)}s`,
      crawlRate: (this.stats.urlsCrawled / runtime).toFixed(2) + ' pages/sec',
      extractionRate: (this.stats.fragmentsExtracted / runtime).toFixed(2) + ' fragments/sec',
      errorRate: ((this.stats.errors.length / this.stats.urlsCrawled) * 100).toFixed(2) + '%',
      avgPageLoadTime: this.stats.performance.avgPageLoadTime.toFixed(0) + 'ms',
      avgExtractionTime: this.stats.performance.avgExtractionTime.toFixed(0) + 'ms'
    };
  }
}

module.exports = ScraperMonitor;