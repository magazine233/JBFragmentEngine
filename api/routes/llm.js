// api/routes/llm.js
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// GET /api/llm/models
router.get('/models', async (req, res) => {
  try {
    const models = [];
    const liteUrl = process.env.LITELLM_URL;
    const liteKey = process.env.LITELLM_API_KEY;

    if (liteUrl) {
      // Fetch models from LiteLLM (OpenAI-compatible /v1/models)
      const resp = await fetch(`${liteUrl.replace(/\/$/, '')}/v1/models`, {
        headers: liteKey ? { Authorization: `Bearer ${liteKey}` } : {}
      });
      if (resp.ok) {
        const data = await resp.json();
        const list = Array.isArray(data.data) ? data.data : [];
        list.forEach(m => {
          const id = m.id || m.name;
          if (id) models.push({ value: id, label: id, provider: 'litellm' });
        });
      }
    } else {
      // Try Ollama
      const ollamaUrl = process.env.OLLAMA_URL || 'http://172.17.0.1:11434';
      try {
        const resp = await fetch(`${ollamaUrl}/api/tags`);
        if (resp.ok) {
          const data = await resp.json();
          (data.models || []).forEach(m => {
            const name = m.name;
            if (name) models.push({ value: `ollama:${name}`, label: `Ollama • ${name}`, provider: 'ollama' });
          });
        }
      } catch (_) {}

      // Optional: add OpenAI defaults if API key present
      if (process.env.OPENAI_API_KEY) {
        ['gpt-4o-mini', 'gpt-4o'].forEach(n => models.push({ value: `openai:${n}`, label: `OpenAI • ${n}`, provider: 'openai' }));
      }
    }

    // Fallback defaults if none discovered
    if (models.length === 0) {
      models.push(
        { value: 'ollama:gemma3:27b', label: 'Ollama • gemma3:27b', provider: 'ollama' },
        { value: 'ollama:llama3:8b', label: 'Ollama • llama3:8b', provider: 'ollama' }
      );
    }

    return res.json({ models });
  } catch (error) {
    console.error('Models list error:', error);
    return res.status(500).json({ error: 'Failed to list models', details: error.message });
  }
});

// POST /api/llm/chat
// Body: { prompt: string, model: string }
// model format examples:
//  - "ollama:llama3:8b"
//  - "ollama:gemma:27b"
//  - "openai:gpt-4o-mini"
router.post('/chat', async (req, res) => {
  try {
    const { prompt, model } = req.body || {};
    if (!prompt || !model) {
      return res.status(400).json({ error: 'prompt and model are required' });
    }

    // If LiteLLM is configured, use it for all requests
    const liteUrl = process.env.LITELLM_URL;
    const liteKey = process.env.LITELLM_API_KEY;
    if (liteUrl) {
      const url = `${liteUrl.replace(/\/$/, '')}/v1/chat/completions`;
      // Map provider:model to LiteLLM router model_name if needed
      let routedModel = model;
      if (model.includes(':') && !model.includes('/')) {
        const [prov, ...rest] = model.split(':');
        routedModel = `${prov}/${rest.join(':')}`; // e.g., ollama/gemma3:27b
      }
      const payload = {
        model: routedModel,
        messages: [
          { role: 'system', content: 'You are a helpful Australian government services assistant.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      };
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(liteKey ? { Authorization: `Bearer ${liteKey}` } : {})
        },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const text = await resp.text();
        return res.status(resp.status).json({ error: text });
      }
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      return res.json({ response: content });
    }

    // Otherwise fall back to provider parsing
    const [provider, ...rest] = String(model).split(':');
    const providerModel = rest.join(':');

    if (!provider || !providerModel) {
      return res.status(400).json({ error: 'Invalid model format. Use provider:model, e.g., ollama:llama3:8b' });
    }

    if (provider === 'ollama') {
      const OLLAMA_URL = process.env.OLLAMA_URL || 'http://172.17.0.1:11434';
      const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: providerModel, prompt, stream: false })
      });
      if (!resp.ok) {
        const text = await resp.text();
        return res.status(resp.status).json({ error: text });
      }
      const data = await resp.json();
      return res.json({ response: data.response });
    }

    if (provider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: 'OPENAI_API_KEY not configured on server' });
      }

      // Use responses API if available; otherwise fallback to chat.completions
      const url = 'https://api.openai.com/v1/chat/completions';
      const payload = {
        model: providerModel,
        messages: [
          { role: 'system', content: 'You are a helpful Australian government services assistant.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      };
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const text = await resp.text();
        return res.status(resp.status).json({ error: text });
      }
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      return res.json({ response: content });
    }

    return res.status(400).json({ error: `Unsupported provider: ${provider}` });
  } catch (error) {
    console.error('LLM proxy error:', error);
    return res.status(500).json({ error: 'LLM request failed', details: error.message });
  }
});

module.exports = router;
