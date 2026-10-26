const fs = require('fs')
const fetch = require('node-fetch')
const { saveExport, allDomestic } = require('./export')
const RESOURCES = ['companies', 'session', 'me', 'filters', 'overview', 'trend', 'competitors', 'providers', 'prompts', 'responses', 'sources', 'accuracy', 'accuracy-details', 'reports', 'prompt-detail', 'response-detail']
const GLOBAL = ['companies', 'session', 'me']

// Separate credentials and endpoint: overseas API keys must never reach CN.
class DomesticAPI {
  constructor({ base = process.env.TOPIFY_CN_BASE || 'https://dashboard.topify.ai', cookie, timeoutMs = 30000 } = {}) {
    this.base = new URL(base)
    if (this.base.protocol !== 'https:' && !(this.base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(this.base.hostname))) {
      throw new Error('Domestic API requires HTTPS (HTTP allowed only on localhost)')
    }
    if (this.base.username || this.base.password || this.base.search || this.base.hash || this.base.pathname !== '/') throw new Error('TOPIFY_CN_BASE must be an origin')
    if (!cookie || /[\r\n]/.test(cookie)) throw new Error('Set TOPIFY_CN_COOKIE_FILE to a file containing your authenticated dashboard Cookie header')
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid timeout')
    this.cookie = cookie
    this.timeoutMs = timeoutMs
  }

  async read(resource, { company, from, to, provider, cursor, limit, offset, search, id, verdict, prompt, promptKey, grouped } = {}) {
    const resources = new Set(RESOURCES)
    if (!resources.has(resource)) throw new Error('Unsupported domestic read resource')
    if (!GLOBAL.includes(resource) && !/^[A-Za-z0-9-]{1,64}$/.test(company || '')) throw new Error('A valid --company ID is required')
    let path = GLOBAL.includes(resource) ? resource : `companies/${company}/${resource}`
    if (resource.endsWith('-detail')) {
      const valid = resource === 'prompt-detail' ? /^[A-Fa-f0-9:.-]{1,128}$/ : /^[A-Za-z0-9-]{1,64}$/
      if (!valid.test(id || '')) throw new Error('A valid --id is required')
      if (from || to || (provider || []).length) throw new Error('Detail endpoints do not accept date/provider filters; select the ID from a filtered list')
      path = `companies/${company}/${resource === 'prompt-detail' ? 'prompts' : 'responses'}/${encodeURIComponent(id)}`
    }
    const url = new URL(`/api/customer/${path}`, this.base)
    for (const [key, value] of Object.entries({ from, to, cursor, limit, offset, search, verdict, prompt, prompt_key: promptKey, grouped })) {
      if (value !== undefined) url.searchParams.set(key, value)
    }
    for (const value of provider || []) url.searchParams.append('provider', value)
    if (resource === 'prompts' && (provider || []).length > 1) throw new Error('Prompts accepts one --provider; use separate queries for each model')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(url, { method: 'GET', headers: { Cookie: this.cookie, Accept: 'application/json' }, redirect: 'manual', signal: controller.signal })
      if (response.status === 401 || (response.status >= 300 && response.status < 400)) throw new Error('Dashboard session expired; sign in and refresh TOPIFY_CN_COOKIE_FILE')
      if (!response.ok) throw new Error(`Domestic API returned HTTP ${response.status}`)
      if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Expected JSON; refresh your dashboard login session')
      return await response.json()
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Domestic API request timed out; no retry was sent')
      throw error
    } finally { clearTimeout(timer) }
  }
}

function registerDomestic(program) {
  const domestic = program.command('domestic').description('Read domestic customer data using your dashboard session (JSON output)')
  for (const resource of RESOURCES) {
    const cmd = domestic.command(resource).option('--json', 'Output JSON (default)')
      .option('--format <type>', 'json or csv', 'json').option('-o, --output <file>', 'Save export atomically')
      .option('--force', 'Replace an existing export')
    if (!GLOBAL.includes(resource)) cmd.requiredOption('--company <id>', 'Domestic company ID')
    if (![...GLOBAL, 'filters', 'prompt-detail', 'response-detail'].includes(resource)) {
      cmd.option('--from <date>', 'Start date YYYY-MM-DD').option('--to <date>', 'End date YYYY-MM-DD')
        .option('--provider <name>', 'Model filter; repeat for multiple models', (value, prior) => [...prior, value], [])
    }
    if (resource.endsWith('-detail')) cmd.requiredOption('--id <id>', 'Prompt key or response ID from the list')
    if (resource === 'responses') cmd.option('--prompt-key <key>', 'Filter by prompt key').option('--grouped', 'Group repeated responses')
    if (resource === 'accuracy-details') cmd.option('--verdict <value>', 'error, pass or unverified').option('--prompt <text>', 'Prompt text filter').option('--offset <n>', 'Page offset').option('--limit <n>', 'Page size (1-100)')
    if (['prompts', 'responses'].includes(resource)) cmd.option('--cursor <id>', 'Next cursor from previous response').option('--limit <n>', 'Page size (1-100)')
    if (resource === 'sources') cmd.option('--offset <n>', 'Source offset').option('--limit <n>', 'Page size (1-200)').option('--search <text>', 'Source domain search')
    if (['prompts', 'responses', 'sources', 'accuracy-details'].includes(resource)) cmd.option('--all', 'Fetch all pages (up to 100); reject repeated pages or changed snapshot metadata')
    cmd.action(async opts => {
      try {
        const file = process.env.TOPIFY_CN_COOKIE_FILE
        const cookie = file ? fs.readFileSync(file, 'utf8').trim() : ''
        const client = new DomesticAPI({ cookie })
        const result = opts.all ? await allDomestic(client, resource, opts) : await client.read(resource, opts)
        saveExport(result, opts)
      } catch (error) {
        console.error(error.message)
        process.exitCode = 1
      }
    })
  }
}
module.exports = { DomesticAPI, registerDomestic }
