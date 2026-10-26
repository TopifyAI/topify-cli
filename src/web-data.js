const fs = require('fs')
const fetch = require('node-fetch')
const resources = require('./web-resources.json')
const { saveExport } = require('./export')

class WebDataAPI {
  constructor({ base = process.env.TOPIFY_WEB_BASE || 'https://app.topify.ai', cookie, timeoutMs = 90000 } = {}) {
    this.base = new URL(base)
    if (this.base.protocol !== 'https:' && !(this.base.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(this.base.hostname))) throw new Error('Web API requires HTTPS')
    if (this.base.username || this.base.password || this.base.pathname !== '/' || this.base.search || this.base.hash) throw new Error('TOPIFY_WEB_BASE must be an origin')
    if (!cookie || /[\r\n]/.test(cookie)) throw new Error('Set TOPIFY_WEB_COOKIE_FILE to your overseas dashboard session Cookie header file')
    this.cookie = cookie
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300000) throw new Error("Timeout must be greater than 0 and at most 300 seconds")
    this.timeoutMs = timeoutMs
  }
  async read(resource, opts = {}, filters = {}) {
    const spec = Object.hasOwn(resources, resource) && resources[resource]
    if (!spec) throw new Error('Unknown page data resource; use topify web-data --help')
    if (!filters || Array.isArray(filters) || typeof filters !== 'object') throw new Error('Filters must be a JSON object')
    filters = { ...filters }
    for (const key of ['fanoutQuery','answer','url','promptIds','offset','limit']) {
      if (opts[key] === undefined) continue
      const target = spec.filter_options?.[key]
      if (!target) throw new Error(`${resource} does not support option ${key}`)
      let value = opts[key]
      if (key === 'promptIds') {
        value = value.split(',').map(x => x.trim()).filter(Boolean)
        if (!value.length || value.some(x => !/^[a-zA-Z0-9-]{1,64}$/.test(x))) throw new Error('Supply valid comma-separated --prompt-ids')
      }
      if (key === 'offset' || key === 'limit') {
        value = Number(value)
        if (!Number.isSafeInteger(value) || value < (key === 'limit' ? 1 : 0)) throw new Error(`${key} has an invalid value`)
      }
      if (Object.hasOwn(filters,target) && JSON.stringify(filters[target]) !== JSON.stringify(value)) throw new Error(`Conflicting ${target}: use either the option or filters-file`)
      filters[target] = value
    }
    for (const key of ['user_id','userId','team_id','tenant_id','authorization','api_key','project_id','projectId']) {
      if (Object.hasOwn(filters, key)) throw new Error(`Do not supply identity field ${key}; use your session and --project`)
    }
    for (const key of spec.required_filters || []) {
      if (typeof filters[key] !== 'string' || !filters[key].trim()) throw new Error(`${resource} requires ${key} in --filters-file`)
    }
    const project = opts.project
    if (!project || !/^[a-zA-Z0-9-]{1,64}$/.test(project)) throw new Error('A valid --project is required')
    const route = spec.path.replace(/\{(project|id|domain)\}/g, (_, key) => {
      const value = opts[key]
      if (!value || ['.', '..'].includes(value)) throw new Error(`--${key} is required`)
      return encodeURIComponent(value)
    })
    const payload = { ...spec.defaults, ...filters, project_id: project }
    for (const [key,value] of Object.entries({ duration_days: opts.days == null ? undefined : Number(opts.days), date_from:opts.from, date_to:opts.to, providers:opts.providers?.split(','), competitor_id:opts.competitor, domain:opts.domain, page:opts.page == null ? undefined : Number(opts.page), page_size:opts.pageSize == null ? undefined : Number(opts.pageSize) })) {
      if (value !== undefined) payload[key] = value
    }
    for (const [key, minimum] of [['duration_days', 0], ['page', 1], ['page_size', 1]]) {
      if (payload[key] !== undefined && (!Number.isSafeInteger(payload[key]) || payload[key] < minimum)) throw new Error(`${key} must be an integer >= ${minimum}`)
    }
    if ((payload.date_from == null) !== (payload.date_to == null)) throw new Error('Supply both --from and --to')
    if (payload.date_from != null) {
      const valid = x => /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x)) && new Date(x).toISOString().slice(0,10) === x
      if (!valid(payload.date_from) || !valid(payload.date_to) || payload.date_from > payload.date_to) throw new Error('Use valid ordered YYYY-MM-DD dates')
    }
    if (spec.nested_date_range) {
      payload.date_range = { ...payload.date_range }
      for (const [from, to] of [['duration_days','duration_days'], ['date_from','start'], ['date_to','end']]) {
        if (payload[from] !== undefined) { payload.date_range[to] = payload[from]; delete payload[from] }
      }
      if (payload.providers !== undefined) {
        payload.filters = { ...payload.filters, models: payload.providers }; delete payload.providers
      }
    }
    if (spec.nested_pagination) {
      payload.pagination = { ...payload.pagination }
      for (const key of ['page','page_size']) if (payload[key] !== undefined) { payload.pagination[key] = payload[key]; delete payload[key] }
      if (!Object.keys(payload.pagination).length) delete payload.pagination
    }
    if (spec.provider_key && payload.providers !== undefined) { payload[spec.provider_key] = payload.providers; delete payload.providers }
    if (spec.days_key && payload.duration_days !== undefined) { payload[spec.days_key] = payload.duration_days; delete payload.duration_days }
    if (spec.date_keys) {
      if (payload.date_from !== undefined) { payload[spec.date_keys[0]] = payload.date_from; delete payload.date_from }
      if (payload.date_to !== undefined) { payload[spec.date_keys[1]] = payload.date_to; delete payload.date_to }
    }
    if (spec.query_fields) for (const key of Object.keys(payload)) {
      if (key !== 'project_id' && !spec.query_fields.includes(key)) throw new Error(`${resource} does not support filter ${key}`)
    }
    const url = new URL(route, this.base)
    if (spec.method === 'GET') for (const [key,value] of Object.entries(payload)) url.searchParams.set(key, Array.isArray(value) ? value.join(',') : typeof value === 'object' ? JSON.stringify(value) : value)
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(url, { method:spec.method, headers:{ Cookie:this.cookie, Accept:'application/json', 'Content-Type':'application/json' }, redirect:'manual', signal:controller.signal, ...(spec.method === 'POST' ? { body:JSON.stringify(payload) } : {}) })
      if (response.status === 401 || (response.status >= 300 && response.status < 400)) throw new Error('Overseas dashboard session expired; refresh TOPIFY_WEB_COOKIE_FILE')
      if (!response.ok) throw new Error(`Page data returned HTTP ${response.status}`)
      if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Expected JSON from dashboard; refresh your session')
      const data = await response.json()
      if (typeof data?.code === 'number' && data.code >= 400) throw new Error(`Page data returned application error ${data.code}`)
      return data
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Page data request timed out; no automatic retry')
      if (/HTTP 5\d\d/.test(error.message)) {
        const hint = resource === 'overview-sources' ? 'Use sources-list for the current source table.' : resource === 'prompt-chats' ? 'For answer exports, use prompt-answers-export with --prompt-ids; its response shape differs.' : 'The server request failed; no data was exported. Check the service before retrying.'
        throw new Error(`${resource}: ${error.message}. ${hint}`)
      }
      throw error
    } finally { clearTimeout(timer) }
  }
}
function selectRows(data, selector) {
  if (!selector) return data
  if (data?.connected === false || data?.data?.connected === false) throw new Error("Data source is not connected; read the full response without --rows. No empty business export was saved.")
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(selector)) throw new Error('--rows must be a dotted response field path')
  let selected = data
  for (const key of selector.split('.')) {
    if (!selected || !Object.hasOwn(selected, key)) throw new Error(`Response has no rows at ${selector}`)
    selected = selected[key]
  }
  if (!Array.isArray(selected)) throw new Error(`Response field ${selector} is not an array`)
  return selected
}
function registerWebData(program) {
  program.command('web-resources [resource]').description('Inspect read resources and required filters without credentials')
    .action(resource => {
      if (resource && !Object.hasOwn(resources, resource)) { console.error('Unknown page data resource'); process.exitCode = 1; return }
      process.stdout.write(JSON.stringify(resource ? resources[resource] : resources, null, 2) + '\n')
    })
  program.command('web-data <resource>').description('Read overseas dashboard analytics using your own web session')
    .requiredOption('-p, --project <id>', 'Project ID').option('--id <id>', 'Prompt or output ID')
    .option('--domain <domain>', 'Domain drilldown').option('--competitor <id>', 'Competitor ID')
    .option('--days <n>', 'Lookback days').option('--from <date>', 'Start date').option('--to <date>', 'End date')
    .option('--providers <list>', 'Provider list').option('--page <n>', 'Page number').option('--page-size <n>', 'Page size')
    .option('--fanout-query <text>', 'Fanout query drilldown').option('--answer <id>', 'Competitor answer ID')
    .option('--url <url>', 'Canonical URL for owned-source prompts').option('--prompt-ids <ids>', 'Comma-separated prompt IDs')
    .option('--offset <n>', 'Offset for supported lists/answer batches').option('--limit <n>', 'Batch size for supported lists/answer batches')
    .option('--timeout <seconds>', 'Request and body deadline, maximum 300 seconds', '90')
    .option('--filters-file <file>', 'Additional page filters as JSON; no identity fields')
    .option('--rows <path>', 'Export an array field, e.g. data.domain_table.items; single page only')
    .option('--format <type>', 'json or csv', 'json').option('--json', 'JSON output (default)')
    .option('-o, --output <file>', 'Save atomically').option('--force', 'Replace existing file')
    .addHelpText('after', '\nAvailable resources:\n' + Object.entries(resources).map(([name,spec]) => name + (spec.required_filters ? ' (filters-file: ' + spec.required_filters.join(', ') + ')' : '')).join('\n'))
    .action(async (resource, opts) => {
      try {
        const cookie = process.env.TOPIFY_WEB_COOKIE_FILE ? fs.readFileSync(process.env.TOPIFY_WEB_COOKIE_FILE, 'utf8').trim() : ''
        const filters = opts.filtersFile ? JSON.parse(fs.readFileSync(opts.filtersFile, 'utf8')) : {}
        saveExport(selectRows(await new WebDataAPI({ cookie, timeoutMs: Number(opts.timeout) * 1000 }).read(resource, opts, filters), opts.rows), opts)
      } catch (error) { console.error(error.message); process.exitCode = 1 }
    })
}
module.exports = { WebDataAPI, resources, registerWebData, selectRows }
