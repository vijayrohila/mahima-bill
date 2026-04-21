const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Config {
  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'config.json');
    this.config = this.loadConfig();
    this.cachedEnvApiBaseUrl = undefined;
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading config:', error);
    }
    return {};
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error('Error saving config:', error);
      return false;
    }
  }

  get(key, defaultValue = null) {
    return this.config[key] !== undefined ? this.config[key] : defaultValue;
  }

  set(key, value) {
    this.config[key] = value;
    return this.saveConfig();
  }

  getDatabasePath() {
    return this.get('databasePath', null);
  }

  setDatabasePath(dbPath) {
    return this.set('databasePath', dbPath);
  }

  /** Laravel API base URL (no trailing slash), e.g. http://127.0.0.1:8000/api */
  getApiBaseUrl() {
    // Single source of truth: root .env.
    // Re-read if cache is empty/null so runtime .env updates are picked up.
    if (this.cachedEnvApiBaseUrl !== undefined && this.cachedEnvApiBaseUrl !== null) {
      return this.cachedEnvApiBaseUrl;
    }
    this.cachedEnvApiBaseUrl = this.readApiBaseUrlFromEnv();
    return this.cachedEnvApiBaseUrl;
  }

  setApiBaseUrl(url) {
    if (url == null || url === '') {
      delete this.config.apiBaseUrl;
      return this.saveConfig();
    }
    return this.set('apiBaseUrl', this.normalizeApiBaseUrl(url));
  }

  normalizeApiBaseUrl(value) {
    if (!value) return null;
    return String(value).trim().replace(/\/+$/, '');
  }

  readApiBaseUrlFromEnv() {
    const parseEnvFile = (envPath) => {
      if (!fs.existsSync(envPath)) return null;
      const raw = fs.readFileSync(envPath, 'utf8');
      const lines = raw.split(/\r?\n/);
      const vars = {};
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const idx = trimmed.indexOf('=');
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        vars[key] = val;
      }
      const value = vars.API_BASE_URL || vars.APP_URL || null;
      return this.normalizeApiBaseUrl(value);
    };

    try {
      // Read only from root .env (project root), but support common runtime roots.
      const candidateRoots = [
        process.cwd(),
        app.getAppPath(),
        path.dirname(app.getAppPath()),
        path.join(path.dirname(app.getAppPath()), '..'),
      ].filter(Boolean);

      const seen = new Set();
      for (const root of candidateRoots) {
        const resolvedRoot = path.resolve(String(root));
        if (seen.has(resolvedRoot)) continue;
        seen.add(resolvedRoot);
        const envPath = path.join(resolvedRoot, '.env');
        const value = parseEnvFile(envPath);
        if (value) return value;
      }

      return null;
    } catch (error) {
      console.error('Error reading API URL from env files:', error);
      return null;
    }
  }

  getApiToken() {
    return this.get('apiToken', null);
  }

  setApiToken(token) {
    return this.set('apiToken', token);
  }

  clearApiToken() {
    delete this.config.apiToken;
    return this.saveConfig();
  }

  getSyncCursor(companyId) {
    const key = String(companyId || '');
    if (!key) return null;
    const cursors = this.get('syncCursor', {});
    return cursors[key] || null;
  }

  setSyncCursor(companyId, cursor) {
    const key = String(companyId || '');
    if (!key) return false;
    const cursors = this.get('syncCursor', {});
    cursors[key] = cursor;
    this.config.syncCursor = cursors;
    return this.saveConfig();
  }
}

module.exports = Config;

