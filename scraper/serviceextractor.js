// scraper/serviceExtractor.js
const crypto = require('crypto');

class ServiceExtractor {
  constructor(typesenseClient) {
    this.typesense = typesenseClient;
    this.services = new Map();
    this.fragmentToService = new Map();
  }

  /**
   * After scraping, analyze fragments to identify and extract services
   */
  async extractServicesFromFragments(fragments) {
    console.log(`Analyzing ${fragments.length} fragments for services...`);
    
    // Group fragments by likely service based on URL patterns and content
    const serviceGroups = this.groupFragmentsByService(fragments);
    
    // Extract service information from each group
    for (const [serviceKey, fragmentGroup] of serviceGroups.entries()) {
      const service = await this.extractServiceFromFragments(fragmentGroup);
      if (service) {
        this.services.set(service.id, service);
        
        // Map fragments to this service
        fragmentGroup.forEach(fragment => {
          if (!fragment.service_ids) fragment.service_ids = [];
          fragment.service_ids.push(service.id);
          
          // Determine fragment role
          fragment.fragment_role = this.detectFragmentRole(fragment, service);
        });
      }
    }
    
    console.log(`Extracted ${this.services.size} services`);
    return {
      services: Array.from(this.services.values()),
      updatedFragments: fragments
    };
  }

  /**
   * Group fragments that likely describe the same service
   */
  groupFragmentsByService(fragments) {
    const groups = new Map();
    
    fragments.forEach(fragment => {
      // Strategy 1: URL-based grouping (e.g., /services/payments/age-pension/*)
      const serviceKey = this.extractServiceKeyFromUrl(fragment.url);
      
      if (serviceKey) {
        if (!groups.has(serviceKey)) {
          groups.set(serviceKey, []);
        }
        groups.get(serviceKey).push(fragment);
      } else {
        // Strategy 2: Title-based grouping for services mentioned in content
        const serviceName = this.extractServiceNameFromContent(fragment);
        if (serviceName) {
          const key = this.normalizeServiceName(serviceName);
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key).push(fragment);
        }
      }
    });
    
    return groups;
  }

  /**
   * Extract service key from URL patterns
   */
  extractServiceKeyFromUrl(url) {
    // Common patterns:
    // /services/payments/age-pension/*
    // /payments-and-services/age-pension/*
    // /benefits/age-pension/*
    
    const patterns = [
      /\/services\/([^\/]+)\/([^\/]+)/,
      /\/payments-and-services\/([^\/]+)/,
      /\/benefits\/([^\/]+)/,
      /\/support\/([^\/]+)/,
      /\/programs\/([^\/]+)/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        // Return normalized key
        return match.slice(1).join('-').toLowerCase();
      }
    }
    
    return null;
  }

  /**
   * Extract service name from content
   */
  extractServiceNameFromContent(fragment) {
    // Look for patterns like "Age Pension", "JobSeeker Payment", etc.
    const servicePatterns = [
      /^([\w\s]+(?:Payment|Pension|Allowance|Benefit|Card|Concession|Supplement|Scheme|Program|Service|Support))/im,
      /\b(Age Pension|JobSeeker|Youth Allowance|Disability Support Pension|Carer Payment|Family Tax Benefit|Child Care Subsidy|Medicare|NDIS)\b/i
    ];
    
    const text = fragment.title + ' ' + fragment.content_text;
    
    for (const pattern of servicePatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    return null;
  }

  /**
   * Extract service information from a group of related fragments
   */
  async extractServiceFromFragments(fragments) {
    if (fragments.length === 0) return null;
    
    // Find the most likely overview/main fragment
    const overviewFragment = this.findOverviewFragment(fragments);
    if (!overviewFragment) return null;
    
    // Extract service name
    const serviceName = this.extractServiceName(fragments, overviewFragment);
    if (!serviceName) return null;
    
    // Generate service ID
    const serviceId = this.generateServiceId(serviceName);
    
    // Extract eligibility information
    const eligibility = this.extractEligibility(fragments);
    
    // Extract service metadata
    const service = {
      id: serviceId,
      service_name: serviceName,
      service_code: this.generateServiceCode(serviceName),
      description: this.extractDescription(overviewFragment),
      
      // Provider info (from fragments)
      provider: overviewFragment.provider || 'Unknown',
      governance: overviewFragment.governance || 'Unknown',
      department: this.extractDepartment(overviewFragment),
      
      // Aggregate life events from all fragments
      life_events: this.aggregateLifeEvents(fragments),
      categories: this.aggregateCategories(fragments),
      
      // Eligibility
      ...eligibility,
      
      // Service details
      service_type: this.detectServiceType(fragments),
      delivery_method: this.extractDeliveryMethods(fragments),
      payment_frequency: this.extractPaymentFrequency(fragments),
      payment_amount: this.extractPaymentAmounts(fragments),
      
      // Relationships (to be enriched later)
      related_services: [],
      incompatible_services: [],
      gateway_service: null,
      
      // Content linkage
      fragment_ids: fragments.map(f => f.id),
      primary_url: overviewFragment.url.split('#')[0],
      urls: [...new Set(fragments.map(f => f.url.split('#')[0]))],
      
      // Search optimization
      keywords: this.extractKeywords(fragments),
      common_names: this.extractCommonNames(serviceName, fragments),
      
      // Metadata
      last_updated: Date.now(),
      popularity_score: Math.max(...fragments.map(f => f.popularity_score || 0)),
      is_active: true
    };
    
    return service;
  }

  /**
   * Find the overview/main fragment for a service
   */
  findOverviewFragment(fragments) {
    // Prefer fragments with overview-like titles
    const overviewKeywords = ['overview', 'about', 'what is', 'information', 'introduction'];
    
    let candidates = fragments.filter(f => 
      overviewKeywords.some(keyword => 
        f.title.toLowerCase().includes(keyword) ||
        f.url.toLowerCase().includes(keyword)
      )
    );
    
    if (candidates.length === 0) {
      // Fall back to fragment with shortest URL (likely the main page)
      candidates = [...fragments].sort((a, b) => a.url.length - b.url.length);
    }
    
    return candidates[0];
  }

  /**
   * Extract eligibility criteria from fragments
   */
  extractEligibility(fragments) {
    const eligibility = {
      eligibility_statuses: [],
      min_age: null,
      max_age: null,
      min_income: null,
      max_income: null,
      assets_test: null,
      residency_requirements: [],
      citizenship_requirements: [],
      required_documents: [],
      eligibility_rules: {}
    };
    
    // Find eligibility-specific fragments
    const eligFragments = fragments.filter(f => 
      f.title.toLowerCase().includes('eligib') ||
      f.url.toLowerCase().includes('eligib') ||
      f.content_text.toLowerCase().includes('you can get') ||
      f.content_text.toLowerCase().includes('you may be eligible')
    );
    
    eligFragments.forEach(fragment => {
      // Extract age requirements
      const ageMatches = fragment.content_text.match(/(?:age|aged?)\s+(\d+)(?:\s+(?:or|and)\s+(?:over|above|older))?/gi);
      if (ageMatches) {
        ageMatches.forEach(match => {
          const age = parseInt(match.match(/\d+/)[0]);
          if (match.toLowerCase().includes('under') || match.toLowerCase().includes('below')) {
            eligibility.max_age = eligibility.max_age ? Math.min(eligibility.max_age, age) : age;
          } else {
            eligibility.min_age = eligibility.min_age ? Math.max(eligibility.min_age, age) : age;
          }
        });
      }
      
      // Extract income limits
      const incomeMatches = fragment.content_text.match(/income.*?\$[\d,]+/gi);
      if (incomeMatches) {
        incomeMatches.forEach(match => {
          const amount = parseInt(match.match(/\$([\d,]+)/)[1].replace(/,/g, ''));
          if (match.toLowerCase().includes('under') || match.toLowerCase().includes('less')) {
            eligibility.max_income = amount;
          }
        });
      }
      
      // Extract residency requirements
      const residencyKeywords = ['australian resident', 'permanent resident', 'citizen', 'residency'];
      residencyKeywords.forEach(keyword => {
        if (fragment.content_text.toLowerCase().includes(keyword)) {
          eligibility.residency_requirements.push(keyword);
        }
      });
      
      // Extract required statuses from life events
      const statusMappings = {
        'unemployed': ['becoming_unemployed', 'looking_for_work'],
        'carer': ['becoming_long_term_carer', 'providing_temporary_care'],
        'parent': ['having_baby', 'raising_child', 'adopting_child'],
        'senior': ['becoming_older_australian', 'retiring_from_workforce'],
        'student': ['studying_tertiary', 'studying_high_school'],
        'disabled': ['being_diagnosed', 'experiencing_mental_illness']
      };
      
      Object.entries(statusMappings).forEach(([status, lifeEvents]) => {
        if (lifeEvents.some(event => fragment.life_events?.includes(event))) {
          eligibility.eligibility_statuses.push(status);
        }
      });
    });
    
    // Remove duplicates
    eligibility.eligibility_statuses = [...new Set(eligibility.eligibility_statuses)];
    eligibility.residency_requirements = [...new Set(eligibility.residency_requirements)];
    
    return eligibility;
  }

  /**
   * Detect fragment role within a service
   */
  detectFragmentRole(fragment, service) {
    const title = fragment.title.toLowerCase();
    const url = fragment.url.toLowerCase();
    
    if (title.includes('eligib') || url.includes('eligib') || url.includes('who-can-get')) return 'eligibility';
    if (title.includes('how to claim') || title.includes('apply') || url.includes('how-to-claim')) return 'how_to_apply';
    if (title.includes('how much you can get') || title.includes('payment rate') || url.includes('you-can-get')) return 'payment_rates';
    if (title.includes('proving your') || title.includes('proof of') || title.includes('prepare to claim') || title.includes('supporting information')|| title.includes('medical evidence')) return 'required_documents';
    if (title.includes('review') || title.includes('appeal')) return 'reviews_appeals';
    if (title.includes('change of circumstance') || title.includes('update details') || title.includes('manage your payment') || title.includes('study changes') || title.includes('report income')) return 'manage_service';
    if (title.includes('overview') || title.includes('about')) return 'overview';
    
    return 'general_information';
  }

  /**
   * Helper methods
   */
  normalizeServiceName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  }

  generateServiceId(serviceName) {
    const normalized = this.normalizeServiceName(serviceName);
    const hash = crypto.createHash('md5').update(normalized).digest('hex').substring(0, 8);
    return `svc_${normalized}_${hash}`;
  }

  generateServiceCode(serviceName) {
    // Generate a code like AGE_PENSION, FTB_A
    return serviceName
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '')
      .split(/\s+/)
      .map(word => {
        // Keep short words intact, abbreviate long ones
        if (word.length <= 4) return word;
        if (['PAYMENT', 'PENSION', 'BENEFIT', 'ALLOWANCE'].includes(word)) {
          return word[0];
        }
        return word.substring(0, 3);
      })
      .join('_');
  }

  extractDescription(fragment) {
    // First 200 chars of content, cleaned up
    return fragment.content_text
      .substring(0, 200)
      .replace(/\s+/g, ' ')
      .trim() + '...';
  }

  extractDepartment(fragment) {
    const providerToDept = {
      'Centrelink': 'Services Australia',
      'ATO': 'Australian Taxation Office',
      'My Health Record': 'Department of Health',
      'Unique Student Identifier': 'Department of Education'
    };
    return providerToDept[fragment.provider] || fragment.provider;
  }

  aggregateLifeEvents(fragments) {
    const events = new Set();
    fragments.forEach(f => {
      if (f.life_events) {
        f.life_events.forEach(event => events.add(event));
      }
    });
    return Array.from(events);
  }

  aggregateCategories(fragments) {
    const categories = new Set();
    fragments.forEach(f => {
      if (f.categories) {
        f.categories.forEach(cat => categories.add(cat));
      }
    });
    return Array.from(categories);
  }

  detectServiceType(fragments) {
    const content = fragments.map(f => f.content_text).join(' ').toLowerCase();
    
    if (content.includes('payment') || content.includes('pension') || content.includes('allowance')) {
      return 'payment';
    }
    if (content.includes('concession') || content.includes('discount')) {
      return 'concession';
    }
    if (content.includes('card') && !content.includes('payment')) {
      return 'card';
    }
    if (content.includes('subsidy') || content.includes('rebate')) {
      return 'subsidy';
    }
    
    return 'support';
  }

  extractDeliveryMethods(fragments) {
    const methods = new Set();
    const content = fragments.map(f => f.content_text).join(' ').toLowerCase();
    
    if (content.includes('online') || content.includes('mygov')) methods.add('online');
    if (content.includes('phone') || content.includes('call')) methods.add('phone');
    if (content.includes('centrelink office') || content.includes('service centre')) methods.add('in_person');
    if (content.includes('mobile app')) methods.add('mobile_app');
    
    return Array.from(methods);
  }

  extractPaymentFrequency(fragments) {
    const content = fragments.map(f => f.content_text).join(' ').toLowerCase();
    
    if (content.includes('fortnightly')) return 'fortnightly';
    if (content.includes('monthly')) return 'monthly';
    if (content.includes('quarterly')) return 'quarterly';
    if (content.includes('annually') || content.includes('yearly')) return 'annually';
    if (content.includes('one-off') || content.includes('lump sum')) return 'one_off';
    
    return null;
  }

  extractPaymentAmounts(fragments) {
    // Extract payment rates from content
    const amounts = {};
    fragments.forEach(fragment => {
      const matches = fragment.content_text.match(/\$[\d,]+(?:\.\d{2})?(?:\s+per\s+(?:fortnight|week|month|year))?/g);
      if (matches) {
        matches.forEach(match => {
          const amount = match.match(/\$([\d,]+(?:\.\d{2})?)/)[1];
          const period = match.match(/per\s+(\w+)/)?.[1] || 'fortnight';
          amounts[period] = amount;
        });
      }
    });
    
    return Object.keys(amounts).length > 0 ? amounts : null;
  }

  extractKeywords(fragments) {
    // Aggregate high-value keywords from all fragments
    const keywords = new Set();
    fragments.forEach(f => {
      if (f.search_keywords) {
        f.search_keywords.forEach(keyword => keywords.add(keyword));
      }
    });
    return Array.from(keywords);
  }

  extractCommonNames(officialName, fragments) {
    const names = new Set([officialName]);
    
    // Look for alternative names in content
    const altNamePatterns = [
      /also known as ([^.]+)/i,
      /formerly ([^.]+)/i,
      /previously called ([^.]+)/i,
      /\(([^)]+)\)/  // Names in parentheses
    ];
    
    fragments.forEach(fragment => {
      altNamePatterns.forEach(pattern => {
        const matches = fragment.content_text.match(pattern);
        if (matches && matches[1].length < 50) {
          names.add(matches[1].trim());
        }
      });
    });
    
    return Array.from(names);
  }
}

module.exports = ServiceExtractor;
