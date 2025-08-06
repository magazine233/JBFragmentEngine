// api/services/profileMatcher.js
class ProfileMatcher {
  constructor(typesenseClient) {
    this.typesense = typesenseClient;
  }

  async findEligibleServices(profile) {
    // Build filter query based on profile
    const filters = [];
    
    // Age-based filtering
    if (profile.age) {
      filters.push(`min_age:<=${profile.age}`);
      filters.push(`max_age:>=${profile.age}`);
    }
    
    // Income-based filtering
    if (profile.income !== undefined) {
      filters.push(`min_income:<=${profile.income}`);
      filters.push(`max_income:>=${profile.income}`);
    }
    
    // Citizenship/residency
    if (profile.citizenship?.length) {
      filters.push(`required_citizenship:=[${profile.citizenship.join(',')}]`);
    }
    
    // Complex eligibility - children
    let childFilters = [];
    if (profile.children?.length > 0) {
      childFilters.push('required_children:=true');
      // Could add age-specific child filters here
    }
    
    // Search with filters
    const searchParams = {
      q: '*',
      filter_by: filters.join(' && '),
      per_page: 250
    };
    
    const results = await this.typesense
      .collections('content_fragments_v2')
      .documents()
      .search(searchParams);
    
    // Post-process for complex eligibility
    return this.postProcessResults(results.hits, profile);
  }
  
  postProcessResults(hits, profile) {
    return hits.map(hit => {
      const doc = hit.document;
      const eligibilityScore = this.calculateEligibilityScore(doc, profile);
      
      return {
        ...doc,
        eligibility_score: eligibilityScore,
        eligibility_reasons: this.getEligibilityReasons(doc, profile),
        relevance_score: this.calculateRelevanceScore(doc, profile)
      };
    }).sort((a, b) => b.relevance_score - a.relevance_score);
  }
  
  calculateEligibilityScore(doc, profile) {
    let score = 0;
    let maxScore = 0;
    
    // Age match
    if (doc.min_age || doc.max_age) {
      maxScore += 1;
      if ((!doc.min_age || profile.age >= doc.min_age) &&
          (!doc.max_age || profile.age <= doc.max_age)) {
        score += 1;
      }
    }
    
    // Income match
    if (doc.min_income || doc.max_income) {
      maxScore += 1;
      if ((!doc.min_income || profile.income >= doc.min_income) &&
          (!doc.max_income || profile.income <= doc.max_income)) {
        score += 1;
      }
    }
    
    // Life event match
    if (doc.life_events?.length && profile.current_life_events?.length) {
      maxScore += 1;
      const overlap = doc.life_events.filter(e => 
        profile.current_life_events.includes(e)
      );
      if (overlap.length > 0) {
        score += overlap.length / doc.life_events.length;
      }
    }
    
    return maxScore > 0 ? score / maxScore : 0;
  }
  
  calculateRelevanceScore(doc, profile) {
    // Combine eligibility with urgency and life event relevance
    const eligibility = this.calculateEligibilityScore(doc, profile);
    const urgency = (doc.urgency_score || 50) / 100;
    const lifeEventMatch = this.getLifeEventMatchScore(doc, profile);
    
    return (eligibility * 0.5) + (urgency * 0.2) + (lifeEventMatch * 0.3);
  }
  
  getLifeEventMatchScore(doc, profile) {
    if (!doc.life_events?.length || !profile.current_life_events?.length) {
      return 0;
    }
    
    const currentMatches = doc.life_events.filter(e => 
      profile.current_life_events.includes(e)
    ).length;
    
    const futureMatches = doc.prerequisite_states?.filter(e =>
      profile.completed_life_events?.includes(e)
    ).length || 0;
    
    return Math.min(1, (currentMatches + futureMatches * 0.5) / doc.life_events.length);
  }
  
  getEligibilityReasons(doc, profile) {
    const reasons = [];
    
    if (doc.min_age && profile.age < doc.min_age) {
      reasons.push(`Must be at least ${doc.min_age} years old`);
    }
    
    if (doc.max_income && profile.income > doc.max_income) {
      reasons.push(`Income must be below $${doc.max_income.toLocaleString()}`);
    }
    
    if (doc.required_citizenship?.length && 
        !doc.required_citizenship.some(c => profile.citizenship?.includes(c))) {
      reasons.push(`Requires ${doc.required_citizenship.join(' or ')} citizenship`);
    }
    
    return reasons;
  }
  
  async predictNextLifeEvents(profile) {
    // Query the life event graph for possible transitions
    const currentEvents = profile.current_life_events || [];
    
    const searchParams = {
      q: currentEvents.join(' '),
      query_by: 'event_name,prerequisites',
      filter_by: `typical_age_range:>=${profile.age - 5} && typical_age_range:<=${profile.age + 10}`,
      per_page: 20
    };
    
    const results = await this.typesense
      .collections('life_event_graph')
      .documents()
      .search(searchParams);
    
    // Find events that could be next based on prerequisites
    return results.hits
      .map(hit => hit.document)
      .filter(event => {
        // Check if prerequisites are met
        if (!event.prerequisites?.length) return true;
        return event.prerequisites.every(prereq => 
          profile.completed_life_events?.includes(prereq) ||
          profile.current_life_events?.includes(prereq)
        );
      })
      .map(event => ({
        ...event,
        likelihood: this.calculateEventLikelihood(event, profile)
      }))
      .sort((a, b) => b.likelihood - a.likelihood);
  }
  
  calculateEventLikelihood(event, profile) {
    let likelihood = 0.5; // Base likelihood
    
    // Age appropriateness
    if (event.typical_age_range?.length === 2) {
      const [minAge, maxAge] = event.typical_age_range;
      if (profile.age >= minAge && profile.age <= maxAge) {
        likelihood += 0.3;
      } else {
        const distance = Math.min(
          Math.abs(profile.age - minAge),
          Math.abs(profile.age - maxAge)
        );
        likelihood -= distance * 0.01;
      }
    }
    
    // Prerequisites met
    if (event.prerequisites?.every(p => 
        profile.completed_life_events?.includes(p))) {
      likelihood += 0.2;
    }
    
    return Math.max(0, Math.min(1, likelihood));
  }
}

module.exports = ProfileMatcher;
