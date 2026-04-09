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

  async mutate(method, path, body = null) {
    const url = `${BASE_URL}${path}`
    const options = {
      method,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
    }
    if (body) {
      options.body = JSON.stringify(body)
    }

    const response = await fetch(url, options)

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

  async createCompetitors(projectId, competitors) {
    return this.mutate('POST', `/projects/${projectId}/competitors`, { competitors })
  }

  async updateCompetitor(projectId, competitorId, fields) {
    const body = {}
    if (fields.name !== undefined) body.name = fields.name
    if (fields.website !== undefined) body.website = fields.website
    return this.mutate('PATCH', `/projects/${projectId}/competitors/${competitorId}`, body)
  }

  async deleteCompetitor(projectId, competitorId) {
    return this.mutate('DELETE', `/projects/${projectId}/competitors/${competitorId}`)
  }

  // Prompts
  async listPrompts(projectId, opts = {}) {
    return this.request(`/projects/${projectId}/prompts`, {
      page: opts.page,
      page_size: opts.pageSize,
    })
  }

  async createPrompts(projectId, { prompts, topicId, country }) {
    return this.mutate('POST', `/projects/${projectId}/prompts`, {
      prompts,
      topicId,
      country: country || undefined,
    })
  }

  async updatePrompt(projectId, promptId, fields) {
    const body = {}
    if (fields.content !== undefined) body.content = fields.content
    if (fields.country !== undefined) body.country = fields.country
    if (fields.topicId !== undefined) body.topicId = fields.topicId
    if (fields.promptType !== undefined) body.promptType = fields.promptType
    return this.mutate('PATCH', `/projects/${projectId}/prompts/${promptId}`, body)
  }

  async deletePrompt(projectId, promptId) {
    return this.mutate('DELETE', `/projects/${projectId}/prompts/${promptId}`)
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

  // Actions
  async listActions(projectId, opts = {}) {
    return this.request(`/projects/${projectId}/actions`, {
      status: opts.status,
      group: opts.group,
    })
  }

  async getAction(projectId, actionId) {
    return this.request(`/projects/${projectId}/actions/${actionId}`)
  }

  async createAction(projectId, action) {
    return this.mutate('POST', `/projects/${projectId}/actions`, action)
  }

  async transitionAction(projectId, actionId, action, body = null) {
    return this.mutate('PATCH', `/projects/${projectId}/actions/${actionId}/${action}`, body)
  }

  async batchTransition(projectId, ids, action) {
    return this.mutate('POST', `/projects/${projectId}/actions/batch-transition`, { ids, action })
  }

  async recommendActions(projectId) {
    return this.mutate('POST', `/projects/${projectId}/actions/recommend`, {})
  }

  async getTaskStatus(projectId, taskId) {
    return this.request(`/projects/${projectId}/actions/tasks/${taskId}`)
  }

  async enrichContent(projectId, actionId) {
    return this.mutate('POST', `/projects/${projectId}/actions/${actionId}/enrich-content`, {})
  }

  async enrichForum(projectId, actionId) {
    return this.mutate('POST', `/projects/${projectId}/actions/${actionId}/enrich-forum`, {})
  }

  async executeAction(projectId, actionId) {
    return this.mutate('POST', `/projects/${projectId}/actions/${actionId}/execute`, {})
  }

  async respondToCheckpoint(projectId, actionId, body) {
    return this.mutate('POST', `/projects/${projectId}/actions/${actionId}/execute/respond`, body)
  }

  // Webhooks
  async listWebhooks() {
    return this.request('/webhooks')
  }

  async createWebhook(url, events) {
    return this.mutate('POST', '/webhooks', { url, events })
  }

  async deleteWebhook(webhookId) {
    return this.mutate('DELETE', `/webhooks/${webhookId}`)
  }
}

module.exports = { TopifyAPI }
