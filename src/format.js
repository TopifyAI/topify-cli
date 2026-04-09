const chalk = require('chalk')
const Table = require('cli-table3')

function formatPercent(value) {
  if (value === null || value === undefined) return chalk.dim('—')
  return `${value.toFixed(1)}%`
}

function formatFloat(value, decimals = 1) {
  if (value === null || value === undefined) return chalk.dim('—')
  return value.toFixed(decimals)
}

function formatDate(iso) {
  if (!iso) return chalk.dim('—')
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function projectsTable(projects) {
  const table = new Table({
    head: [chalk.bold('Name'), chalk.bold('Brand'), chalk.bold('Website'), chalk.bold('Created')],
    colWidths: [25, 20, 35, 15],
    wordWrap: true,
  })

  for (const p of projects) {
    table.push([
      p.name || p.brand_name || '—',
      p.brand_name || '—',
      p.website_url || '—',
      formatDate(p.created_at),
    ])
  }

  return table.toString()
}

function competitorsTable(competitors) {
  const table = new Table({
    head: [
      chalk.bold('#'),
      chalk.bold('Brand'),
      chalk.bold('Visibility'),
      chalk.bold('Sentiment'),
      chalk.bold('Position'),
      chalk.bold('Mentions'),
    ],
  })

  competitors.forEach((c, i) => {
    const m = c.metrics || {}
    const own = c.is_own_brand ? chalk.green(' (you)') : ''
    table.push([
      i + 1,
      `${c.name}${own}`,
      formatPercent(m.visibility),
      formatFloat(m.sentiment),
      formatFloat(m.position),
      m.mention_count ?? '—',
    ])
  })

  return table.toString()
}

function overviewTable(items) {
  const table = new Table({
    head: [
      chalk.bold('Prompt'),
      chalk.bold('Visibility'),
      chalk.bold('Sentiment'),
      chalk.bold('Position'),
    ],
    colWidths: [50, 15, 15, 12],
    wordWrap: true,
  })

  for (const item of items.slice(0, 20)) {
    table.push([
      item.content || '—',
      formatPercent(item.visibility),
      formatFloat(item.sentiment),
      formatFloat(item.position),
    ])
  }

  return table.toString()
}

function sourcesTable(sources) {
  const table = new Table({
    head: [
      chalk.bold('#'),
      chalk.bold('Domain'),
      chalk.bold('Citations'),
      chalk.bold('Category'),
    ],
  })

  sources.slice(0, 20).forEach((s, i) => {
    table.push([
      i + 1,
      s.domain || '—',
      s.citation_count ?? s.citations ?? '—',
      s.category || '—',
    ])
  })

  return table.toString()
}

function jsonOutput(data) {
  return JSON.stringify(data, null, 2)
}

function slimOverview(data) {
  const items = data?.items || data || []
  if (!Array.isArray(items)) return jsonOutput(data)

  const competitorSet = new Set()
  items.forEach((item) => {
    (item.competitors_mentioned || []).forEach((c) => competitorSet.add(c.name))
  })

  const slimmed = items.map((item) => {
    const competitors = {}
    ;(item.competitors_mentioned || []).forEach((c) => {
      competitors[c.name] = c.mention_count
    })
    return {
      prompt_id: item.prompt_id,
      content: item.content,
      prompt_type: item.prompt_type,
      topic_name: item.topic_name,
      visibility: item.visibility,
      sentiment: item.sentiment,
      position: item.position,
      volume: item.volume,
      intent: item.intent,
      cvr: item.cvr,
      competitors,
    }
  })

  return jsonOutput({
    competitors: [...competitorSet].sort(),
    items: slimmed,
  })
}

function slimCompetitors(data) {
  const items = data?.active_competitors || data || []
  if (!Array.isArray(items)) return jsonOutput(data)

  const slimmed = items.map((c) => ({
    competitor_id: c.competitor_id,
    name: c.name,
    website: c.website,
    is_own_brand: c.is_own_brand,
    metrics: c.metrics,
  }))

  if (data?.active_competitors) {
    return jsonOutput({ ...data, active_competitors: slimmed })
  }
  return jsonOutput(slimmed)
}

function actionsTable(actions) {
  const table = new Table({
    head: [
      chalk.bold('#'),
      chalk.bold('Priority'),
      chalk.bold('Title'),
      chalk.bold('Category'),
      chalk.bold('Status'),
    ],
    colWidths: [5, 10, 52, 20, 14],
    wordWrap: true,
  })

  actions.forEach((a, i) => {
    const title = (a.title || '').length > 50 ? (a.title || '').substring(0, 47) + '...' : (a.title || '')
    const priorityColor = a.priority === 'high' ? chalk.red : a.priority === 'medium' ? chalk.yellow : chalk.dim
    const statusColor = a.status === 'completed' ? chalk.green : a.status === 'accepted' ? chalk.cyan : a.status === 'ignored' ? chalk.dim : chalk.white
    table.push([
      i + 1,
      priorityColor(a.priority || ''),
      title,
      a.category || a.group || '',
      statusColor(a.status || ''),
    ])
  })

  return table.toString()
}

function actionDetail(a) {
  const lines = []
  lines.push(`${chalk.bold('Title:')}       ${a.title || ''}`)
  lines.push(`${chalk.bold('ID:')}          ${a.id || a.action_id || ''}`)
  lines.push(`${chalk.bold('Status:')}      ${a.status || ''}`)
  lines.push(`${chalk.bold('Priority:')}    ${a.priority || ''}`)
  lines.push(`${chalk.bold('Category:')}    ${a.category || a.group || ''}`)
  if (a.description) lines.push(`${chalk.bold('Description:')} ${a.description}`)
  if (a.target_url) lines.push(`${chalk.bold('Target URL:')}  ${a.target_url}`)
  if (a.target_prompt) lines.push(`${chalk.bold('Target Prompt:')} ${a.target_prompt}`)
  if (a.execution_status) lines.push(`${chalk.bold('Execution:')}   ${a.execution_status}`)
  if (a.workflow_id) lines.push(`${chalk.bold('Workflow ID:')} ${a.workflow_id}`)
  if (a.created_at) lines.push(`${chalk.bold('Created:')}     ${formatDate(a.created_at)}`)
  if (a.updated_at) lines.push(`${chalk.bold('Updated:')}     ${formatDate(a.updated_at)}`)
  return lines.join('\n')
}

function webhooksTable(webhooks) {
  const table = new Table({
    head: [
      chalk.bold('#'),
      chalk.bold('ID'),
      chalk.bold('URL'),
      chalk.bold('Events'),
      chalk.bold('Created'),
    ],
    colWidths: [5, 20, 40, 30, 15],
    wordWrap: true,
  })

  webhooks.forEach((w, i) => {
    table.push([
      i + 1,
      w.id || w.webhook_id || '',
      w.url || '',
      (w.events || []).join(', '),
      formatDate(w.created_at),
    ])
  })

  return table.toString()
}

module.exports = { projectsTable, competitorsTable, overviewTable, sourcesTable, jsonOutput, slimOverview, slimCompetitors, formatPercent, formatDate, actionsTable, actionDetail, webhooksTable }
