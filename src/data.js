// Explicit customer read surface. No arbitrary URL/path or internal/admin APIs.
const { saveExport } = require('./export')
const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const RESOURCES = ['projects', 'project', 'outputs', 'output', 'overview', 'competitors', 'aliases', 'topics', 'prompts', 'prompt', 'prompt-analytics', 'prompt-competitors', 'prompt-chats', 'prompt-domains', 'prompt-urls', 'sources', 'source-detail', 'source-chats', 'sources-analytics', 'visibility', 'actions', 'action', 'action-state', 'action-artifacts', 'action-artifact', 'discarded-edits', 'task', 'recordings', 'webhooks']
function segment(value, name) {
  if (!value || ['.', '..'].includes(value)) throw new Error(`--${name} is required`)
  return encodeURIComponent(value)
}
function readPath(resource, project, opts) {
  if (!RESOURCES.includes(resource)) throw new Error(`Choose one of: ${RESOURCES.join(', ')}`)
  if (resource === 'projects') return '/projects/'
  if (resource === 'webhooks') return '/webhooks'
  const base = `/projects/${segment(project, 'project')}`
  if (resource === 'project') return base
  if (resource === 'output') return `${base}/outputs/${segment(opts.id, 'id')}`
  if (resource.startsWith('prompt-') || resource === 'prompt') {
    const suffix = resource === 'prompt' ? '' : '/' + resource.slice(7)
    return `${base}/prompts/${segment(opts.id, 'id')}${suffix}`
  }
  if (resource.startsWith('source-')) return `${base}/sources/${segment(opts.domain, 'domain')}/${resource.slice(7)}`
  if (resource === 'task') return `${base}/actions/tasks/${segment(opts.id, 'id')}`
  if (['action', 'action-state', 'action-artifacts', 'action-artifact', 'discarded-edits'].includes(resource)) {
    const suffix = { action: '', 'action-state': '/state', 'action-artifacts': '/artifacts', 'action-artifact': '/artifacts/' + (opts.name ? segment(opts.name, 'name') : ''), 'discarded-edits': '/discarded-edits' }[resource]
    if (resource === 'action-artifact' && !opts.name) throw new Error('--name is required')
    return `${base}/actions/${segment(opts.id, 'id')}${suffix}`
  }
  return base + '/' + ({ 'sources-analytics': 'sources/analytics', recordings: 'recording' }[resource] || resource)
}
function params(opts) {
  return { duration_days: opts.days, date_from: opts.from, date_to: opts.to,
    prompt_ids: opts.promptIds, offset: opts.offset, limit: opts.limit, providers: opts.providers, page: opts.page, page_size: opts.pageSize,
    status: opts.status, group: opts.group, prompt_type: opts.type }
}
function saveRaw(bytes, filename, force) {
  const target = path.resolve(filename), tmp = `${target}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(tmp, bytes, { mode: 0o600, flag: 'wx' })
    if (force) fs.renameSync(tmp, target)
    else fs.linkSync(tmp, target)
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) }
}
function registerData(program, getClient, resolveProject) {
  program.command('data <resource>').description('Read page-visible customer data. Resources: ' + RESOURCES.join(', '))
    .option('-p, --project <id>', 'Project ID').option('--id <id>', 'Prompt, action or task ID')
    .option('--prompt-ids <ids>', 'Comma-separated prompt IDs for answer batches')
    .option('--offset <n>', 'Answer batch offset').option('--limit <n>', 'Answer batch size (1-100)')
    .option('--domain <domain>', 'Source domain').option('--name <name>', 'Artifact name')
    .option('--days <n>', 'Lookback days').option('--from <date>', 'Start date').option('--to <date>', 'End date')
    .option('--providers <list>', 'Comma-separated provider filter').option('--type <type>', 'Prompt type')
    .option('--page <n>', 'Page number').option('--page-size <n>', 'Page size')
    .option('--status <status>', 'Action status').option('--group <group>', 'Action group')
    .option('--json', 'JSON output (default)').option('--format <type>', 'json or csv', 'json')
    .option('-o, --output <file>', 'Save atomically').option('--force', 'Replace existing output')
    .action(async (resource, opts) => {
      try {
        if (resource === 'prompt-chats' && (!(opts.days || (opts.from && opts.to)) || !opts.providers)) throw new Error('prompt-chats requires --days or --from/--to, and --providers')
        const project = ['projects', 'webhooks'].includes(resource) ? null : resolveProject(opts)
        const data = await getClient().request(readPath(resource, project, opts), params(opts))
        saveExport(data, opts)
      } catch (error) { console.error(error.message); process.exitCode = 1 }
    })
  program.command('report').description('Download the customer HTML report')
    .option('-p, --project <id>', 'Project ID').option('--days <n>', 'Lookback days', '30')
    .option('--from <date>', 'Start date').option('--to <date>', 'End date')
    .requiredOption('-o, --output <file>', 'HTML destination').option('--force', 'Replace existing file')
    .action(async opts => {
      try {
        const bytes = await getClient().download(`/projects/${segment(resolveProject(opts), 'project')}/report`, { ...params(opts), format: 'download' })
        saveRaw(bytes, opts.output, opts.force)
        console.error(`Saved report to ${path.resolve(opts.output)}`)
      } catch (error) { console.error(error.message); process.exitCode = 1 }
    })
}
module.exports = { RESOURCES, readPath, params, saveRaw, registerData }
