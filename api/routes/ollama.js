// api/routes/ollama.js
const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");

// Determine Ollama URL based on environment
// Try environment variable first, then use Docker bridge IP for Linux
const OLLAMA_URL = process.env.OLLAMA_URL || "http://172.17.0.1:11434";

// Log the URL being used
console.log("=================================");
console.log("Ollama Configuration:");
console.log("OLLAMA_URL from env:", process.env.OLLAMA_URL);
console.log("Using OLLAMA_URL:", OLLAMA_URL);
console.log("=================================");

// Proxy endpoint for Ollama
router.post("/chat", async (req, res) => {
  try {
    let { prompt, model = "gemma3:27b" } = req.body; // Updated to match your model

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    console.log(`Proxying Ollama request for model: ${model} to ${OLLAMA_URL}`);

    // First check what models are available
    try {
      const modelsResponse = await fetch(`${OLLAMA_URL}/api/tags`);
      const modelsData = await modelsResponse.json();
      console.log(
        "Available models:",
        modelsData.models?.map((m) => m.name),
      );

      // If requested model isn't available, use first available model
      if (modelsData.models && modelsData.models.length > 0) {
        const modelExists = modelsData.models.some(
          (m) => m.name === model || m.name.includes(model.split(":")[0]),
        );
        if (!modelExists) {
          model = modelsData.models[0].name;
          console.log(
            `Model ${req.body.model} not found, using ${model} instead`,
          );
        }
      }
    } catch (err) {
      console.log("Could not check available models:", err.message);
      console.log("Attempting to continue with model:", model);
    }

    // Make request to Ollama
    const ollamaResponse = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
        },
      }),
    });

    if (!ollamaResponse.ok) {
      const errorText = await ollamaResponse.text();
      console.error("Ollama error:", errorText);

      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error && errorJson.error.includes("model")) {
          return res.status(404).json({
            error: `Model "${model}" not found. Available model is gemma3:27b`,
          });
        }
      } catch {}

      return res.status(ollamaResponse.status).json({
        error: `Ollama error: ${errorText}`,
      });
    }

    const data = await ollamaResponse.json();
    res.json({ response: data.response });
  } catch (error) {
    console.error("Ollama proxy error:", error);

    if (error.code === "ECONNREFUSED") {
      res.status(503).json({
        error: `Cannot connect to Ollama at ${OLLAMA_URL}`,
        hint: "Ollama is running but Docker cannot reach it. Try restarting with: docker-compose down && docker-compose up -d",
        currentUrl: OLLAMA_URL,
        suggestion:
          "Make sure OLLAMA_URL environment variable is set to http://172.17.0.1:11434",
      });
    } else if (error.code === "ETIMEDOUT") {
      res.status(504).json({
        error: "Ollama request timed out. The model might be loading.",
      });
    } else {
      res.status(500).json({
        error: "Failed to process chat request",
        details: error.message,
      });
    }
  }
});

// Health check for Ollama
router.get("/health", async (req, res) => {
  console.log("Health check - attempting to connect to:", OLLAMA_URL);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (response.ok) {
      const data = await response.json();
      res.json({
        status: "connected",
        url: OLLAMA_URL,
        models: data.models || [],
        defaultModel: data.models?.[0]?.name || "none",
      });
    } else {
      res.status(503).json({
        status: "error",
        message: "Ollama not responding",
        url: OLLAMA_URL,
      });
    }
  } catch (error) {
    res.status(503).json({
      status: "disconnected",
      message: "Cannot connect to Ollama",
      url: OLLAMA_URL,
      hint: "Check if Ollama is running and the URL is correct",
      error: error.message,
    });
  }
});

module.exports = router;
