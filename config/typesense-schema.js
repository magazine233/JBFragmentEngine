// config/typesense-schema.js
module.exports = {
  contentFragmentSchema: {
    name: 'content_fragments',
    enable_nested_fields: true,
    default_sorting_field: 'popularity_sort',
    fields: [
      // identity & versioning
      { name: 'crawl_version', type: 'int32' },
      { name: 'last_seen_at', type: 'int64' },

      // core
      { name: 'url', type: 'string', facet: true },
      { name: 'anchor', type: 'string', optional: true },
      { name: 'title', type: 'string' },
      { name: 'content_text', type: 'string' },
      { name: 'content_html', type: 'string', index: false, optional: true },

      // hierarchies
      { name: 'site_hierarchy', type: 'string[]', facet: true },
      { name: 'page_hierarchy', type: 'string[]', facet: true },
      { name: 'hierarchy_lvl0', type: 'string', facet: true },
      { name: 'hierarchy_lvl1', type: 'string', facet: true, optional: true },
      { name: 'hierarchy_lvl2', type: 'string', facet: true, optional: true },
      { name: 'hierarchy_lvl3', type: 'string', facet: true, optional: true },

      // taxonomy facets
      { name: 'life_events', type: 'string[]', facet: true },
      { name: 'categories', type: 'string[]', facet: true },
      { name: 'states', type: 'string[]', facet: true },
      { name: 'stage', type: 'string', facet: true, optional: true },
      { name: 'stage_variant', type: 'string', facet: true, optional: true },
      { name: 'provider', type: 'string', facet: true },
      { name: 'governance', type: 'string', facet: true },

      // metadata facets
      { name: 'component_type', type: 'string', facet: true },
      { name: 'has_form', type: 'bool', facet: true },
      { name: 'has_checklist', type: 'bool', facet: true },
      { name: 'reading_level', type: 'int32', optional: true },

      // presentation (not faceted / not indexed)
      { name: 'classes', type: 'string[]', index: false, optional: true },
      { name: 'styles_raw', type: 'object', index: false, optional: true },

      // relationships
      { name: 'parent_id', type: 'string', optional: true },
      { name: 'child_ids', type: 'string[]', optional: true },
      { name: 'related_ids', type: 'string[]', optional: true },

      // search optimization
      { name: 'search_keywords', type: 'string[]', optional: true },
      { name: 'task_order', type: 'int32', optional: true },

      // vector search placeholder
      { name: 'embedding', type: 'float[]', num_dim: 768, optional: true },

      // sorting helper (pre‑negated so ascending sort → highest first)
      { name: 'popularity_sort', type: 'int32' }
    ]
  }
};