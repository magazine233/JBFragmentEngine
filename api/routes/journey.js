const express = require('express');
const router = express.Router();
const ProfileMatcher = require('../services/profileMatcher');

// Convert life events to eligibility attributes
const lifeEventToAttributes = {
  'Having a baby': {
    required_children: true,
    children_age_ranges: [{ min: 0, max: 1 }]
  },
  'Raising Kids': {
    required_children: true,
    children_age_ranges: [{ min: 0, max: 18 }]
  },
  'Work': {
    required_employment_status: ['employed', 'self-employed']
  },
  'Unemployment': {
    required_employment_status: ['unemployed', 'job-seeking']
  },
  'Ageing': {
    min_age: 65
  },
  'Disability': {
    required_disabilities: ['any']
  },
  'Student': {
    required_employment_status: ['student']
  },
  'Carer': {
    required_caring_status: true
  }
};

// Build user profile from input
router.post('/profile/build', async (req, res) => {
  try {
    const input = req.body;
    
    // Start with explicit attributes
    const profile = {
      age: input.age,
      income: input.income,
      assets: input.assets,
      citizenship: input.citizenship || ['Australian'],
      residency_state: input.state || 'National',
      disabilities: input.disabilities || [],
      employment_status: input.employment_status,
      housing_status: input.housing_status,
      is_carer: input.is_carer || false,
      children: input.children || [],
      disaster_affected: input.disaster_affected || [],
      current_life_events: [],
      completed_life_events: input.completed_life_events || []
    };
    
    // Infer life events from attributes
    const inferredEvents = inferLifeEvents(profile);
    profile.current_life_events = [...new Set([
      ...(input.current_life_events || []),
      ...inferredEvents
    ])];
    
    // Save profile (in production, this would go to a database)
    const profileId = generateProfileId();
    
    res.json({
      profile_id: profileId,
      profile,
      inferred_life_events: inferredEvents
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get personalized journey
router.get('/journey/:profileId', async (req, res) => {
  try {
    // In production, load from database
    const profile = await loadProfile(req.params.profileId);
    const matcher = new ProfileMatcher(req.app.locals.typesense);
    
    // Get eligible services
    const eligibleServices = await matcher.findEligibleServices(profile);
    
    // Get next possible life events
    const nextEvents = await matcher.predictNextLifeEvents(profile);
    
    // Build journey graph
    const journeyGraph = await buildJourneyGraph(profile, req.app.locals.typesense);
    
    res.json({
      profile,
      eligible_services: eligibleServices.slice(0, 50), // Top 50
      next_life_events: nextEvents.slice(0, 10), // Top 10
      journey_graph: journeyGraph,
      statistics: {
        total_eligible_services: eligibleServices.length,
        high_relevance_services: eligibleServices.filter(s => s.relevance_score > 0.8).length,
        current_life_stage: determineLifeStage(profile),
        completeness_score: calculateProfileCompleteness(profile)
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get journey visualization data
router.get('/journey/:profileId/visualization', async (req, res) => {
  try {
    const profile = await loadProfile(req.params.profileId);
    const typesense = req.app.locals.typesense;
    
    // Get all life events from graph
    const { results: allEvents } = await typesense
      .collections('life_event_graph')
      .documents()
      .search({
        q: '*',
        per_page: 250
      });
    
    // Calculate positions if not set
    const positionedEvents = allEvents.hits.map(hit => {
      const event = hit.document;
      if (!event.position_x) {
        const pos = calculateEventPosition(event, profile, allEvents.hits);
        event.position_x = pos.x;
        event.position_y = pos.y;
        event.position_z = pos.z;
      }
      return event;
    });
    
    res.json({
      profile,
      events: positionedEvents,
      clusters: groupEventsByClusters(positionedEvents),
      focus_point: calculateFocusPoint(profile, positionedEvents)
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper functions
function inferLifeEvents(profile) {
  const events = [];
  
  // Age-based events
  if (profile.age < 5 && profile.children?.some(c => c.age < 5)) {
    events.push('Having a baby');
  }
  if (profile.age >= 5 && profile.age < 18) {
    events.push('Growing up');
  }
  if (profile.children?.some(c => c.age >= 5 && c.age < 18)) {
    events.push('Raising Kids');
  }
  if (profile.age >= 65) {
    events.push('Ageing');
  }
  
  // Status-based events
  if (profile.employment_status === 'employed') {
    events.push('Work');
  }
  if (profile.employment_status === 'student') {
    events.push('Education');
  }
  if (profile.is_carer) {
    events.push('Caring for someone');
  }
  if (profile.disabilities?.length > 0) {
    events.push('Health and Disability');
  }
  
  return events;
}

function determineLifeStage(profile) {
  if (profile.age < 18) return 'Youth';
  if (profile.age < 30) return 'Young Adult';
  if (profile.age < 50) return 'Adult';
  if (profile.age < 65) return 'Mature Adult';
  return 'Senior';
}

function calculateProfileCompleteness(profile) {
  const fields = [
    'age', 'income', 'citizenship', 'residency_state',
    'employment_status', 'housing_status', 'current_life_events'
  ];
  
  const filledFields = fields.filter(field => 
    profile[field] !== undefined && 
    profile[field] !== null &&
    (Array.isArray(profile[field]) ? profile[field].length > 0 : true)
  ).length;
  
  return filledFields / fields.length;
}

function calculateEventPosition(event, profile, allEvents) {
  // Group events by their typical age ranges
  const ageGroup = event.typical_age_range ? 
    (event.typical_age_range[0] + event.typical_age_range[1]) / 2 : 
    30;
  
  // X-axis: age progression
  const x = (ageGroup - 30) * 2; // Center at age 30
  
  // Y-axis: always at ground level for now
  const y = 0;
  
  // Z-axis: category clustering
  const categoryOffsets = {
    'Family': -30,
    'Work': 0,
    'Health': 30,
    'Education': -15,
    'Housing': 15
  };
  
  const z = categoryOffsets[event.cluster] || Math.random() * 60 - 30;
  
  // Add some randomness to prevent overlap
  return {
    x: x + (Math.random() - 0.5) * 10,
    y,
    z: z + (Math.random() - 0.5) * 10
  };
}

function calculateFocusPoint(profile, events) {
  // Find current events and calculate center point
  const currentEvents = events.filter(e => 
    profile.current_life_events?.includes(e.event_name)
  );
  
  if (currentEvents.length === 0) {
    return { x: 0, y: 10, z: 0 };
  }
  
  const center = currentEvents.reduce((acc, event) => ({
    x: acc.x + (event.position_x || 0),
    y: acc.y + (event.position_y || 0),
    z: acc.z + (event.position_z || 0)
  }), { x: 0, y: 0, z: 0 });
  
  return {
    x: center.x / currentEvents.length,
    y: center.y / currentEvents.length + 10, // Elevated view
    z: center.z / currentEvents.length
  };
}

function groupEventsByClusters(events) {
  const clusters = {};
  
  events.forEach(event => {
    const cluster = event.cluster || 'Other';
    if (!clusters[cluster]) {
      clusters[cluster] = {
        name: cluster,
        events: [],
        center: { x: 0, y: 0, z: 0 },
        color: getClusterColor(cluster)
      };
    }
    clusters[cluster].events.push(event);
  });
  
  // Calculate cluster centers
  Object.values(clusters).forEach(cluster => {
    const center = cluster.events.reduce((acc, event) => ({
      x: acc.x + (event.position_x || 0),
      y: acc.y + (event.position_y || 0),
      z: acc.z + (event.position_z || 0)
    }), { x: 0, y: 0, z: 0 });
    
    cluster.center = {
      x: center.x / cluster.events.length,
      y: center.y / cluster.events.length,
      z: center.z / cluster.events.length
    };
  });
  
  return clusters;
}

function getClusterColor(cluster) {
  const colors = {
    'Family': '#4ade80',
    'Work': '#3b82f6',
    'Health': '#f87171',
    'Education': '#a78bfa',
    'Housing': '#fbbf24',
    'Finance': '#34d399'
  };
  return colors[cluster] || '#9ca3af';
}

// Mock functions for demo - replace with real implementations
function generateProfileId() {
  return 'profile_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

async function loadProfile(profileId) {
  // In production, load from database
  // For demo, return a mock profile
  return {
    age: 35,
    income: 75000,
    citizenship: ['Australian'],
    residency_state: 'NSW',
    employment_status: 'employed',
    children: [{ age: 5, has_disability: false }],
    current_life_events: ['Work', 'Raising Kids'],
    completed_life_events: ['Education', 'Having a baby']
  };
}

async function buildJourneyGraph(profile, typesense) {
  // This would build the full graph structure
  // For now, return a simplified version
  return {
    nodes: profile.current_life_events.map(event => ({
      id: event,
      type: 'current',
      connections: []
    })),
    edges: []
  };
}

module.exports = router;
