const fetch = require('node-fetch')

const BASE_URL = 'https://topify-customer-api-production.up.railway.app/api/public/v1'

class TopifyAPI {
  constructor(apiKey) {
    this.apiKey = apiKey
  }

  async request(path, params = {}) {
    const url = new URL(`${BASE_URL}${path}`)
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value)
      }
    })

    const response = await fetch(url.toString(), {
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || error.message || `API error: ${response.status}`)
    }

    return response.json()
  }

  // Projects
  async listProjects() {
    return this.request('/projects')
  }

  async getProject(projectId) {
    return this.request(`/projects/${projectId}`)
  }

  // Overview
  async getOverview(projectId, opts = {}) {
    return this.request(`/projects/${projectId}/overview`, {
      duration_days: opts.days,
      date_from: opts.from,
      date_to: opts.to,
      providers: opts.providers,
      prompt_type: opts.type,
    })
  }

  // Competitors
  async getCompetitors(projectId, opts = {}) {
    return this.request(`/projects/${projectId}/competitors`, {
      duration_days: opts.days,
      date_from: opts.from,
      date_to: opts.to,
      providers: opts.providers,
    })
  }

  // Prompts
  async listPrompts(projectId, opts = {}) {
    return this.request(`/projects/${projectId}/prompts`, {
      page: opts.page,
      page_size: opts.pageSize,
    })
  }

  async getPromptAnalytics(projectId, promptId, opts = {}) {
    return this.request(`/projects/${projectId}/prompts/${promptId}/analytics`, {
      duration_days: opts.days,
      date_from: opts.from,
      date_to: opts.to,
      providers: opts.providers,
    })
  }

  // Sources
  async getSources(projectId, opts = {}) {
    return this.request(`/projects/${projectId}/sources`, {
      duration_days: opts.days,
      date_from: opts.from,
      date_to: opts.to,
      providers: opts.providers,
      page: opts.page,
      page_size: opts.pageSize,
    })
  }

  // Topics
  async getTopics(projectId) {
    return this.request(`/projects/${projectId}/topics`)
  }

  // Visibility trends
  async getVisibilityTrends(projectId, opts = {}) {
    return this.request(`/projects/${projectId}/visibility-trends`, {
      duration_days: opts.days,
      date_from: opts.from,
      date_to: opts.to,
      providers: opts.providers,
    })
  }

  // Sources analytics
  async getSourcesAnalytics(projectId, opts = {}) {
    return this.request(`/projects/${projectId}/sources-analytics`, {
      duration_days: opts.days,
      date_from: opts.from,
      date_to: opts.to,
      providers: opts.providers,
    })
  }
}

module.exports = { TopifyAPI }
