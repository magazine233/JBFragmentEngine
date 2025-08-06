// api/server.js
const express = require('express');
const cors = require('cors');
const Typesense = require('typesense');
const fragmentRoutes = require('./routes/fragments');

const app = express();

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json());

// Initialize Typesense client
const typesenseClient = new Typesense.Client({
  nodes: [{
    host: process.env.TYPESENSE_HOST || 'localhost',
    port: process.env.TYPESENSE_PORT || '8108',
    protocol: 'http'
  }],
  apiKey: process.env.TYPESENSE_API_KEY || 'xyz123abc',
  connectionTimeoutSeconds: 10
});

// Make client available to routes
app.locals.typesense = typesenseClient;

// Routes
app.use('/api/fragments', fragmentRoutes);

// Try to load ollama routes if dependencies are available
try {
  const ollamaRoutes = require('./routes/ollama');
  app.use('/api/ollama', ollamaRoutes);
  console.log('Ollama routes loaded successfully');
} catch (error) {
  console.log('Ollama routes not available (missing dependencies):', error.message);
  // Provide a simple fallback endpoint
  app.use('/api/ollama', (req, res) => {
    res.status(503).json({ 
      error: 'Ollama service not available', 
      message: 'Missing node-fetch dependency or Ollama not configured' 
    });
  });
}

// Health check
app.get('/health', async (req, res) => {
  try {
    // Check Typesense connection
    await typesenseClient.collections().retrieve();
    res.json({ 
      status: 'ok', 
      timestamp: new Date(),
      typesense: 'connected'
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'error', 
      timestamp: new Date(),
      typesense: 'disconnected',
      error: error.message
    });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});
