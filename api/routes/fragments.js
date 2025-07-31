// api/routes/fragments.js
const express = require('express');
const router = express.Router();

// Search fragments
router.get('/search', async (req, res) => {
  try {
    const {
      q = '*',
      life_event,
      category,
      state,
      stage,
      stage_variant,
      provider,
      component_type,
      page = 1,
      per_page = 20,
      include_html = false,
      sort_by = 'popularity_sort:asc'
    } = req.query;

    // Build filter query
    const filterBy = [];
    
    if (life_event) {
      filterBy.push(`life_events:=${life_event}`);
    }
    if (category) {
      filterBy.push(`categories:=${category}`);
    }
    if (state) {
      filterBy.push(`states:=${state}`);
    }
    if (stage) {
      filterBy.push(`stage:=${stage}`);
    }
    if (stage_variant) {
      filterBy.push(`stage_variant:=${stage_variant}`);
    }
    if (provider) {
      filterBy.push(`provider:=${provider}`);
    }
    if (component_type) {
      filterBy.push(`component_type:=${component_type}`);
    }

    // Fields to retrieve
    const includeFields = [
      'id', 'url', 'title', 'content_text',
      'hierarchy_lvl0', 'hierarchy_lvl1', 'hierarchy_lvl2',
      'life_events', 'categories', 'states', 'stage', 'stage_variant',
      'provider', 'governance', 'component_type',
      'last_modified', 'task_order'
    ];
    
    if (include_html === 'true') {
      includeFields.push('content_html', 'styles_raw', 'classes');
    }

    const searchParameters = {
      q,
      query_by: 'title,content_text,search_keywords',
      filter_by: filterBy.join(' && '),
      sort_by,
      page: parseInt(page),
      per_page: parseInt(per_page),
      include_fields: includeFields.join(','),
      highlight_full_fields: 'content_text',
      highlight_affix_num_tokens: 4,
      num_typos: 2
    };

    // Remove empty filter_by
    if (!searchParameters.filter_by) {
      delete searchParameters.filter_by;
    }

    const results = await req.app.locals.typesense
      .collections('content_fragments')
      .documents()
      .search(searchParameters);

    res.json({
      results: results.hits,
      found: results.found,
      page: results.page,
      total_pages: Math.ceil(results.found / per_page),
      request_params: results.request_params
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

// Get facets for filtering
router.get('/facets', async (req, res) => {
  try {
    const facetFields = [
      'life_events',
      'categories', 
      'states',
      'stage',
      'stage_variant',
      'provider',
      'governance',
      'component_type'
    ];

    const results = await req.app.locals.typesense
      .collections('content_fragments')
      .documents()
      .search({
        q: '*',
        query_by: 'title',
        facet_by: facetFields.join(','),
        max_facet_values: 100,
        per_page: 0 // We only want facets, not results
      });

    const facets = {};
    results.facet_counts.forEach(facet => {
      facets[facet.field_name] = facet.counts
        .map(count => ({
          value: count.value,
          count: count.count
        }))
        .sort((a, b) => b.count - a.count);
    });

    res.json(facets);

  } catch (error) {
    console.error('Facets error:', error);
    res.status(500).json({ error: 'Failed to retrieve facets' });
  }
});

// Get hierarchical navigation
router.get('/hierarchy', async (req, res) => {
  try {
    const { parent_path } = req.query;
    
    let filterBy = '';
    if (parent_path) {
      // Filter by parent path in site_hierarchy
      filterBy = `site_hierarchy:=${parent_path}`;
    }

    const results = await req.app.locals.typesense
      .collections('content_fragments')
      .documents()
      .search({
        q: '*',
        query_by: 'title',
        filter_by: filterBy,
        group_by: 'hierarchy_lvl0,hierarchy_lvl1',
        group_limit: 10,
        per_page: 0
      });

    res.json(results.grouped_hits);

  } catch (error) {
    console.error('Hierarchy error:', error);
    res.status(500).json({ error: 'Failed to retrieve hierarchy' });
  }
});

// Get single fragment by ID
router.get('/:id', async (req, res) => {
  try {
    const fragment = await req.app.locals.typesense
      .collections('content_fragments')
      .documents(req.params.id)
      .retrieve();

    res.json(fragment);

  } catch (error) {
    if (error.httpStatus === 404) {
      res.status(404).json({ error: 'Fragment not found' });
    } else {
      res.status(500).json({ error: 'Failed to retrieve fragment' });
    }
  }
});

// Batch retrieve fragments by IDs
router.post('/batch', async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Invalid or empty ids array' });
    }

    const fragments = await Promise.all(
      ids.map(async (id) => {
        try {
          return await req.app.locals.typesense
            .collections('content_fragments')
            .documents(id)
            .retrieve();
        } catch (error) {
          return null; // Return null for not found
        }
      })
    );

    res.json({
      fragments: fragments.filter(f => f !== null),
      requested: ids.length,
      found: fragments.filter(f => f !== null).length
    });

  } catch (error) {
    res.status(500).json({ error: 'Batch retrieval failed' });
  }
});


router.get('/export', async (req, res) => {
  try {
    const typesense = req.app.locals.typesense;
    const format = req.query.format || 'json'; // json or csv
    const limit = parseInt(req.query.limit) || 10000; // max records
    
    // Fetch all documents (or up to limit)
    const searchParameters = {
      q: '*',
      query_by: 'title',
      per_page: 250, // Max per request
      page: 1
    };
    
    let allDocuments = [];
    let hasMore = true;
    
    while (hasMore && allDocuments.length < limit) {
      const results = await typesense
        .collections('content_fragments')
        .documents()
        .search(searchParameters);
      
      allDocuments = allDocuments.concat(results.hits.map(hit => hit.document));
      
      if (results.found <= searchParameters.page * searchParameters.per_page) {
        hasMore = false;
      } else {
        searchParameters.page++;
      }
    }
    
    // Limit to requested number
    allDocuments = allDocuments.slice(0, limit);
    
    if (format === 'csv') {
      // Convert to CSV
      const Papa = require('papaparse');
      const csv = Papa.unparse(allDocuments, {
        header: true,
        skipEmptyLines: true
      });
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="fragments_export.csv"');
      res.send(csv);
    } else {
      // Return as JSON
      res.json({
        total: allDocuments.length,
        documents: allDocuments
      });
    }
    
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Export failed', message: error.message });
  }
});

// Alternative: Stream large exports
router.get('/export/stream', async (req, res) => {
  try {
    const typesense = req.app.locals.typesense;
    const format = req.query.format || 'json';
    
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="fragments_export.${format}"`);
    
    if (format === 'json') {
      res.write('['); // Start JSON array
    }
    
    let page = 1;
    let first = true;
    let hasMore = true;
    
    while (hasMore) {
      const results = await typesense
        .collections('content_fragments')
        .documents()
        .search({
          q: '*',
          query_by: 'title',
          per_page: 250,
          page: page
        });
      
      if (format === 'csv' && page === 1) {
        // Write CSV header
        const Papa = require('papaparse');
        const header = Papa.unparse([results.hits[0].document], {
          header: true,
          skipEmptyLines: true
        }).split('\n')[0];
        res.write(header + '\n');
      }
      
      results.hits.forEach(hit => {
        if (format === 'json') {
          if (!first) res.write(',');
          res.write(JSON.stringify(hit.document));
          first = false;
        } else {
          // CSV format
          const Papa = require('papaparse');
          const row = Papa.unparse([hit.document], {
            header: false,
            skipEmptyLines: true
          });
          res.write(row + '\n');
        }
      });
      
      if (results.found <= page * 250) {
        hasMore = false;
      } else {
        page++;
      }
    }
    
    if (format === 'json') {
      res.write(']'); // End JSON array
    }
    
    res.end();
    
  } catch (error) {
    console.error('Stream export error:', error);
    res.status(500).json({ error: 'Export failed', message: error.message });
  }
});

// Get collection stats
router.get('/stats/overview', async (req, res) => {
  try {
    const collection = await req.app.locals.typesense
      .collections('content_fragments')
      .retrieve();

    res.json({
      total_documents: collection.num_documents,
      fields: collection.fields,
      created_at: collection.created_at
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve stats' });
  }
});

module.exports = router;
