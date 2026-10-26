const fetch = require('node-fetch')

const BASE_URL = process.env.TOPIFY_API_BASE
  || 'https://topify-customer-api-production.up.railway.app/api/public/v1'

class TopifyAPI {
  constructor(apiKey, { timeoutMs = Number(process.env.TOPIFY_TIMEOUT_MS || 90000) } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be positive')
    this.apiKey = apiKey
    this.timeoutMs = timeoutMs
  }

  async exchange(url, method = 'GET', body = null) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(url.toString(), {
        method,
        redirect: 'error',
        signal: controller.signal,
        headers: { 'X-API-Key': this.apiKey, 'Content-Type': 'application/json' },
        ...(body !== null ? { body: JSON.stringify(body) } : {}),
      })
      if (response.status === 204) return null
      const data = await response.json().catch(error => {
        if (controller.signal.aborted) throw error
        if (response.ok) throw new Error('API returned invalid JSON')
        return { detail: response.statusText }
      })
      if (!response.ok) {
        const detail = data.detail || data.message || `API error: ${response.status}`
        throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
      }
      return data
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`API request timed out after ${this.timeoutMs}ms; outcome may be unknown, request was not retried`)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async download(path, params = {}) {
    const url = new URL(`${BASE_URL}${path}`)
    for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(url, { headers: { 'X-API-Key': this.apiKey }, redirect: 'error', signal: controller.signal })
      if (!response.ok) throw new Error(`Report API returned HTTP ${response.status}`)
      if (!(response.headers.get('content-type') || '').includes('text/html')) throw new Error('Report API did not return HTML')
      return await response.buffer()
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Report download timed out; no partial file saved')
      throw error
    } finally { clearTimeout(timer) }
  }

  async request(path, params = {}) {
    const url = new URL(`${BASE_URL}${path}`)
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.append(key, value)
    })
    return this.exchange(url)
  }

  async mutate(method, path, body = null) {
    return this.exchange(new URL(`${BASE_URL}${path}`), method, body)
  }

  // Projects
  async listProjects() {
    return this.request('/projects/')
  }

  async getProject(projectId) {
    return this.request(`/projects/${projectId}`)
  }

  async createProject({ brandName, brandUrl, webhookUrl, language, location }) {
    const body = { brand_name: brandName, brand_url: brandUrl, webhook_url: webhookUrl }
    if (language) body.language = language
    if (location) body.location = location
    return this.mutate('POST', '/account/projects', body)
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

  // Competitor state transitions (track / reject pending suggestions)
  async transitionCompetitorState(projectId, competitorId, state) {
    return this.mutate(
      'PATCH',
      `/projects/${projectId}/competitors/${competitorId}/state`,
      { state },
    )
  }

  // Brand aliases
  async listAliases(projectId) {
    return this.request(`/projects/${projectId}/aliases`)
  }

  async addAlias(projectId, alias, matchType = 'fuzzy') {
    return this.mutate('POST', `/projects/${projectId}/aliases`, {
      alias,
      match_type: matchType,
    })
  }

  async updateAlias(projectId, originalAlias, newAlias, matchType = null) {
    const body = { original_alias: originalAlias, new_alias: newAlias }
    if (matchType) body.match_type = matchType
    return this.mutate('PATCH', `/projects/${projectId}/aliases`, body)
  }

  async deleteAlias(projectId, alias) {
    return this.mutate('DELETE', `/projects/${projectId}/aliases?alias=${encodeURIComponent(alias)}`)
  }

  // Prompts
  async listPrompts(projectId, opts = {}) {
    return this.request(`/projects/${projectId}/prompts`, {
      duration_days: opts.days,
      date_from: opts.from,
      date_to: opts.to,
      providers: opts.providers,
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

  // Suggested-prompt generation (background pipeline)
  async createSuggestedPrompts(projectId, opts = {}) {
    const body = {}
    if (opts.count !== undefined) body.count = opts.count
    if (opts.generationMethod) body.generation_method = opts.generationMethod
    if (opts.idempotencyKey) body.idempotency_key = opts.idempotencyKey
    if (opts.functionAnalysis) body.function_analysis = opts.functionAnalysis
    return this.mutate('POST', `/projects/${projectId}/prompts/suggested`, body)
  }

  async cleanupSuggestedPrompts(projectId) {
    return this.mutate('POST', `/projects/${projectId}/prompts/suggested/cleanup`, {})
  }

  // URL-driven prompt recommendations (background pipeline)
  async createUrlRecommendations(projectId, urls, count = 5) {
    return this.mutate('POST', `/projects/${projectId}/prompts/url-recommendations`, {
      urls,
      count,
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
    return this.request(`/projects/${projectId}/visibility`, {
      duration_days: opts.days,
      date_from: opts.from,
      date_to: opts.to,
      providers: opts.providers,
    })
  }

  // Sources analytics
  async getSourcesAnalytics(projectId, opts = {}) {
    return this.request(`/projects/${projectId}/sources/analytics`, {
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

  // Agent-facing read endpoints
  async getActionState(projectId, actionId) {
    return this.request(`/projects/${projectId}/actions/${actionId}/state`)
  }

  async listActionArtifacts(projectId, actionId) {
    return this.request(`/projects/${projectId}/actions/${actionId}/artifacts`)
  }

  async getActionArtifact(projectId, actionId, name) {
    return this.request(`/projects/${projectId}/actions/${actionId}/artifacts/${encodeURIComponent(name)}`)
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
