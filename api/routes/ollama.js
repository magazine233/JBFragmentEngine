// api/routes/ollama.js
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch'); // Make sure to install: npm install node-fetch@2

// Proxy endpoint for Ollama
router.post('/chat', async (req, res) => {
  try {
    const { prompt, model = 'llama2' } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    
    console.log(`Proxying Ollama request for model: ${model}`);
    
    // Make request to Ollama from the server (no CORS issues)
    const ollamaResponse = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false
      })
    });
    
    if (!ollamaResponse.ok) {
      const errorText = await ollamaResponse.text();
      console.error('Ollama error:', errorText);
      return res.status(ollamaResponse.status).json({ 
        error: `Ollama error: ${errorText}` 
      });
    }
    
    const data = await ollamaResponse.json();
    res.json({ response: data.response });
    
  } catch (error) {
    console.error('Ollama proxy error:', error);
    
    if (error.code === 'ECONNREFUSED') {
      res.status(503).json({ 
        error: 'Cannot connect to Ollama. Make sure it\'s running on port 11434' 
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to process chat request', 
        details: error.message 
      });
    }
  }
});

// Health check for Ollama
router.get('/health', async (req, res) => {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags');
    if (response.ok) {
      const data = await response.json();
      res.json({ 
        status: 'connected', 
        models: data.models || [] 
      });
    } else {
      res.status(503).json({ status: 'error', message: 'Ollama not responding' });
    }
  } catch (error) {
    res.status(503).json({ 
      status: 'disconnected', 
      message: 'Cannot connect to Ollama' 
    });
  }
});

module.exports = router;
