const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

function rowsOf(data) {
  if (Array.isArray(data)) return data
  for (const key of ['prompts', 'items', 'posts', 'active_competitors']) if (Array.isArray(data?.[key])) return data[key]
  return [data]
}
function csv(data) {
  const rows = rowsOf(data)
  const keys = [...new Set(rows.flatMap(row => Object.keys(row || {})))]
  const cell = value => {
    let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
    // Prevent spreadsheet formula execution when exports are opened in Excel.
    if (typeof value === 'string' && /^[=+@\-\t\r]/.test(text)) text = "'" + text
    return '"' + text.replace(/"/g, '""') + '"'
  }
  return [keys.map(cell).join(','), ...rows.map(row => keys.map(key => cell(row?.[key])).join(','))].join('\r\n') + '\r\n'
}
function saveExport(data, opts) {
  const format = opts.format || 'json'
  if (!['json', 'csv'].includes(format)) throw new Error('Format must be json or csv')
  const text = format === 'csv' ? csv(data) : JSON.stringify(data, null, 2) + '\n'
  if (!opts.output) { process.stdout.write(text); return }
  const target = path.resolve(opts.output)
  const temp = path.join(path.dirname(target), '.' + path.basename(target) + '.' + randomUUID() + '.tmp')
  try {
    fs.writeFileSync(temp, text, { mode: 0o600, flag: 'wx' })
    if (opts.force) fs.renameSync(temp, target)
    else fs.linkSync(temp, target) // Atomic no-clobber; existing files are preserved.
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  console.error(`Saved ${format.toUpperCase()} to ${target}`)
}
async function allDomestic(client, resource, opts) {
  const items = [], seen = new Set(), seenItems = new Set()
  if (opts.cursor || opts.offset) throw new Error('--all starts from the first page; omit --cursor/--offset')
  let cursor, offset = 0, first
  for (let page = 0; page < 100; page++) {
    const data = await client.read(resource, { ...opts, limit: 100, cursor, offset: ['sources', 'accuracy-details'].includes(resource) ? offset : undefined })
    if (!Array.isArray(data.items)) throw new Error('API did not return paginated items')
    if (!first) first = data
    else if (data.snapshot_id !== first.snapshot_id || data.revision !== first.revision || data.source_updated_at !== first.source_updated_at) throw new Error('Data changed during export; no file saved. Repeat with a stable date range.')
    if (first.total_count !== data.total_count) throw new Error('Total changed during export; no partial file saved')
    for (const item of data.items) {
      if (item.id && seenItems.has(item.id)) throw new Error('Repeated item during pagination; no partial file saved')
      if (item.id) seenItems.add(item.id)
    }
    items.push(...data.items)
    const next = ['sources', 'accuracy-details'].includes(resource) ? data.next_offset : data.next_cursor
    if (next == null) return { ...first, items, next_cursor: null, next_offset: null, exported_count: items.length }
    if (!data.items.length || seen.has(String(next))) throw new Error('Pagination did not advance; no partial export saved')
    seen.add(String(next)); cursor = next; offset = next
  }
  throw new Error('Export exceeds 100 pages; narrow the date range')
}
async function allSources(client, projectId, opts) {
  const items = [], seen = new Set()
  for (let page = 1; page <= 100; page++) {
    const result = await client.getSources(projectId, { ...opts, page, pageSize: 100 })
    if (!Array.isArray(result.data)) throw new Error('Invalid source list response')
    for (const row of result.data) {
      const key = row.source_id || row.domain
      if (!key || seen.has(key)) throw new Error('Source pages changed or repeated; no partial export saved')
      seen.add(key); items.push(row)
    }
    if (result.data.length < 100) return items
  }
  throw new Error('Source export exceeds 100 pages; narrow the date range')
}
function registerExport(program, getClient, resolveProject) {
  program.command('export <resource>').description('Export complete overseas topics, prompts, sources or overview as JSON/CSV')
    .option('-p, --project <id>', 'Project ID').option('--topic-id <id>', 'Filter prompts by topic')
    .option('-d, --days <n>', 'Lookback days').option('--from <date>', 'Start date').option('--to <date>', 'End date')
    .option('--providers <list>', 'Provider filter').option('--format <type>', 'json or csv', 'json')
    .option('-o, --output <file>', 'Write file atomically').option('--force', 'Replace existing export')
    .action(async (resource, opts) => {
      try {
        if (!['topics', 'prompts', 'sources', 'overview'].includes(resource)) throw new Error('Choose topics, prompts, sources or overview')
        const client = getClient(), project = resolveProject(opts)
        let data
        if (resource === 'topics') {
          const topics = (await client.getTopics(project)).data
          const prompts = rowsOf((await client.listPrompts(project, opts)).data)
          data = topics.map(topic => ({ ...topic, prompts: prompts.filter(p => (p.topic_id || p.topicId) === topic.topic_id) }))
        } else if (resource === 'prompts') {
          data = rowsOf((await client.listPrompts(project, opts)).data)
          if (opts.topicId) data = data.filter(p => (p.topic_id || p.topicId) === opts.topicId)
        } else if (['sources', 'accuracy-details'].includes(resource)) data = await allSources(client, project, opts)
        else data = (await client.getOverview(project, opts)).data
        saveExport(data, opts)
      } catch (error) { console.error(error.message); process.exitCode = 1 }
    })
}
module.exports = { rowsOf, csv, saveExport, allDomestic, allSources, registerExport }
