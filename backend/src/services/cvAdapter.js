// Adapter pattern for computer vision providers.
// Trade-off decision: We implement option (b) — a clean adapter interface
// with LocalHeuristicProvider and RemoteMLProvider. This lets us:
// 1. Swap in a real ML model later without touching imageProcessor.js
// 2. Clearly document that current analysis is heuristic-based
// 3. Demonstrate integration architecture for portfolio/report purposes
//
// The RemoteMLProvider is a stub that logs a warning when ML_SERVICE_URL
// is set but the service isn't actually running.

const computerVision = require('./computerVision');

const ML_URL = process.env.ML_SERVICE_URL || null;

class LocalHeuristicProvider {
  async assessCondition(buffer) {
    return computerVision.assessCondition(buffer);
  }

  async detectDamage(buffer) {
    return computerVision.detectDamage(buffer);
  }

  async classifyProduct(buffer, metadata) {
    return computerVision.classifyProduct(buffer, metadata);
  }

  get name() { return 'local-heuristic'; }
}

class RemoteMLProvider {
  constructor(url) {
    this.url = url;
    this.available = false;
    this._warned = false;
  }

  async _check() {
    // Stub: in production, would health-check the ML service
    if (!this._warned) {
      console.warn(`[CV] ML_SERVICE_URL=${this.url} is configured but remote ML service is not implemented. Falling back to local heuristic.`);
      this._warned = true;
    }
    return false;
  }

  async assessCondition(buffer) {
    if (await this._check()) {
      // Would: POST ${this.url}/condition with buffer
    }
    return computerVision.assessCondition(buffer);
  }

  async detectDamage(buffer) {
    if (await this._check()) {
      // Would: POST ${this.url}/damage with buffer
    }
    return computerVision.detectDamage(buffer);
  }

  async classifyProduct(buffer, metadata) {
    if (await this._check()) {
      // Would: POST ${this.url}/classify with buffer + metadata
    }
    return computerVision.classifyProduct(buffer, metadata);
  }

  get name() { return 'remote-ml (fallback to heuristic)'; }
}

// Factory: returns the appropriate provider based on config
const createCVProvider = () => {
  if (ML_URL) {
    return new RemoteMLProvider(ML_URL);
  }
  return new LocalHeuristicProvider();
};

module.exports = { createCVProvider, LocalHeuristicProvider, RemoteMLProvider };
