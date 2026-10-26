const fs = require('fs')
const fetch = require('node-fetch')
const { saveExport } = require('./export')
const RESOURCES = ['history', 'brands', 'summary', 'prompts', 'details', 'responses', 'sources', 'article-hits']

class ToolAPI {
  constructor({ base = process.env.TOPIFY_TOOL_BASE || 'https://tool.topify.ai', invitation, timeoutMs = 30000 } = {}) {
    this.base = new URL(base)
    if (this.base.protocol !== 'https:' && !(this.base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname))) throw new Error('Tool API requires HTTPS')
    if (this.base.username || this.base.password || this.base.search || this.base.hash || this.base.pathname !== '/') throw new Error('TOPIFY_TOOL_BASE must be an origin')
    if (!invitation || /[\r\n]/.test(invitation)) throw new Error('Set TOPIFY_TOOL_INVITATION_FILE to your own report tool invitation credential file')
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid timeout')
    this.invitation = invitation
    this.timeoutMs = timeoutMs
  }
  async read(resource, opts = {}) {
    if (!RESOURCES.includes(resource)) throw new Error('Unsupported tool read resource')
    let path = resource
    if (!['history', 'brands'].includes(resource)) {
      if (!/^[A-Za-z0-9-]{1,64}$/.test(opts.id || '')) throw new Error('A valid --id is required')
      path = `${opts.id}/${resource}`
      if (resource === 'responses') {
        if (!/^\d+$/.test(String(opts.promptIndex)) || Number(opts.promptIndex) > 100000) throw new Error('A valid --prompt-index is required')
        path = `${opts.id}/prompts/${opts.promptIndex}/responses`
      }
    }
    const url = new URL(`/api/employee/reports/${path}`, this.base)
    const query = resource === 'history' ? { page: opts.page, page_size: opts.pageSize, search: opts.search, brand_group: opts.brands ? JSON.stringify(opts.brands) : undefined }
      : resource === 'brands' ? { limit: opts.limit } : resource === 'details' ? { include_responses: opts.includeResponses ? 'true' : undefined } : {}
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, value)
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(url, { method: 'GET', headers: { 'X-Invitation-Code': this.invitation, Accept: 'application/json' }, redirect: 'manual', signal: controller.signal })
      if (res.status >= 300 && res.status < 400) throw new Error('Tool API redirect rejected; credential was not forwarded')
      if (res.status === 401 || res.status === 403) throw new Error('Tool credential expired or lacks access')
      if (res.status === 404) throw new Error('Report unavailable or employee read API not deployed; no legacy fallback attempted')
      if (!res.ok) throw new Error(`Tool API returned HTTP ${res.status}`)
      if (!(res.headers.get('content-type') || '').includes('application/json')) throw new Error('Employee read API unavailable: expected JSON; no legacy fallback attempted')
      return await res.json()
    } catch (error) {
      // node-fetch errors contain URLs. Never expose response bodies or credentials.
      if (controller.signal.aborted) throw new Error('Tool API timed out; no retry sent')
      if (error.type) throw new Error('Tool API connection failed')
      throw error
    } finally { clearTimeout(timer) }
  }
  async historyAll(opts = {}) {
    if (opts.page) throw new Error('--all starts at page 1; omit --page')
    const reports = [], ids = new Set()
    let first
    for (let page = 1; page <= 100; page++) {
      const data = await this.read('history', { ...opts, page, pageSize: 100 })
      if (!Array.isArray(data.reports) || !Number.isInteger(data.total) || data.total < 0 || !Number.isInteger(data.total_pages) || data.total_pages < 0 || data.page !== page) throw new Error('Invalid history pagination')
      if (!first) first = data
      if (data.total !== first.total || data.total_pages !== first.total_pages) throw new Error('History changed during export; no partial output saved')
      for (const row of data.reports) {
        if (!row.id || ids.has(row.id)) throw new Error('History pages repeated or changed; no partial output saved')
        ids.add(row.id); reports.push(row)
      }
      if (page >= data.total_pages) {
        if (reports.length !== data.total) throw new Error('History count mismatch; no partial output saved')
        return { ...first, reports, exported_count: reports.length }
      }
      if (!data.reports.length) throw new Error('History pagination did not advance')
    }
    throw new Error('History exceeds 100 pages; narrow --search')
  }
}
function registerTool(program) {
  const tool = program.command('tool').description('Read authorized domestic report-tool business data (requires employee read API)')
  for (const resource of RESOURCES) {
    const cmd = tool.command(resource).option('--format <type>', 'json or csv', 'json').option('-o, --output <file>', 'Save export atomically').option('--force', 'Replace existing export')
    if (!['history', 'brands'].includes(resource)) cmd.requiredOption('--id <id>', 'Report ID from authorized history')
    if (resource === 'history') cmd.option('--page <n>', 'Page number').option('--page-size <n>', 'Page size, at most 100').option('--search <text>', 'Brand or website').option('--brand <name>', 'Exact brand group name; repeat', (value, prior) => [...prior, value], []).option('--all', 'All pages, at most 100; reject changed totals or duplicates')
    if (resource === 'brands') cmd.option('--limit <n>', 'Recent brand groups, at most 50')
    if (resource === 'responses') cmd.requiredOption('--prompt-index <n>', 'Zero-based prompt index')
    if (resource === 'details') cmd.option('--include-responses', 'Include full response texts and references')
    cmd.action(async opts => {
      try {
        const file = process.env.TOPIFY_TOOL_INVITATION_FILE
        const client = new ToolAPI({ invitation: file ? fs.readFileSync(file, 'utf8').trim() : '' })
        const args = { ...opts, brands: opts.brand?.length ? opts.brand : undefined }
        const result = opts.all ? await client.historyAll(args) : await client.read(resource, args)
        saveExport(opts.format === 'csv' && resource === 'history' ? result.reports : result, opts)
      } catch (error) { console.error(error.message); process.exitCode = 1 }
    })
  }
}
module.exports = { ToolAPI, registerTool, RESOURCES }
