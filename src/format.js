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

function recordingsTable(recordings) {
  const items = recordings?.urls || recordings?.items || recordings || []
  const table = new Table({
    head: [
      chalk.bold('ID'),
      chalk.bold('URL'),
      chalk.bold('Title'),
      chalk.bold('Added'),
    ],
    colWidths: [38, 48, 30, 15],
    wordWrap: true,
  })

  items.slice(0, 20).forEach((item) => {
    table.push([
      item.id || '',
      item.url || '',
      item.title || chalk.dim('-'),
      formatDate(item.created_at),
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

function dash(value) {
  return value === null || value === undefined || value === '' ? chalk.dim('-') : value
}

function truncate(value, maxLength) {
  const text = String(value || '')
  if (text.length <= maxLength) return text
  return text.slice(0, Math.max(0, maxLength - 3)) + '...'
}

function asItems(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  if (Array.isArray(data.items)) return data.items
  return []
}

function chartProviders(chart) {
  const providers = new Set()
  Object.values(chart || {}).forEach((items) => {
    ;(items || []).forEach((item) => {
      if (item.provider) providers.add(item.provider)
    })
  })
  return [...providers].sort()
}

function promptInspectSummary(data) {
  const prompt = data.prompt || {}
  const analytics = data.analytics || null
  const domains = asItems(data.domains)
  const urls = asItems(data.urls)
  const chats = asItems(data.chats)

  const lines = []
  lines.push('')
  lines.push(chalk.bold('Prompt'))
  lines.push(`${chalk.bold('ID:')}       ${prompt.id || data.prompt_id || ''}`)
  lines.push(`${chalk.bold('Type:')}     ${dash(prompt.prompt_type)}`)
  lines.push(`${chalk.bold('Topic:')}    ${dash(prompt.topic_id)}`)
  lines.push(`${chalk.bold('Country:')}  ${dash(prompt.country)}`)
  lines.push(`${chalk.bold('Content:')}  ${dash(prompt.content)}`)
  lines.push('')
  lines.push(chalk.bold('Window'))
  lines.push(`${chalk.bold('Days:')}     ${dash(data.window?.duration_days)}`)
  lines.push(`${chalk.bold('From:')}     ${dash(data.window?.date_from)}`)
  lines.push(`${chalk.bold('To:')}       ${dash(data.window?.date_to)}`)
  lines.push(`${chalk.bold('Providers:')} ${dash(data.window?.providers)}`)

  lines.push('')
  lines.push(chalk.bold('Metrics'))
  lines.push(`${chalk.bold('Visibility:')} ${formatPercent(prompt.visibility)}`)
  lines.push(`${chalk.bold('Sentiment:')}  ${formatFloat(prompt.sentiment)}`)
  lines.push(`${chalk.bold('Position:')}   ${formatFloat(prompt.position)}`)
  lines.push(`${chalk.bold('Volume:')}     ${dash(prompt.volume)}`)
  lines.push(`${chalk.bold('Intent:')}     ${dash(prompt.intent)}`)
  lines.push(`${chalk.bold('CVR:')}        ${prompt.cvr === null || prompt.cvr === undefined ? chalk.dim('-') : prompt.cvr}`)

  if (analytics) {
    const visibilityDates = Object.keys(analytics.visibility_chart || {})
    const providers = chartProviders(analytics.visibility_chart)
    lines.push('')
    lines.push(chalk.bold('Analytics'))
    lines.push(`${chalk.bold('Date buckets:')} ${visibilityDates.length}`)
    lines.push(`${chalk.bold('Providers:')}    ${providers.length ? providers.join(', ') : chalk.dim('-')}`)
    lines.push(`${chalk.bold('Volume:')}       ${dash(analytics.volume)}`)
    lines.push(`${chalk.bold('Sentiment:')}    ${formatFloat(analytics.sentiment)}`)
  }

  if (domains.length > 0) {
    const table = new Table({
      head: [chalk.bold('Domain'), chalk.bold('Citations'), chalk.bold('Used %'), chalk.bold('Mentioned')],
      colWidths: [38, 12, 10, 10],
      wordWrap: true,
    })
    domains.slice(0, 10).forEach((d) => {
      table.push([
        d.domain || '-',
        d.citation_count ?? '-',
        d.used_percentage === null || d.used_percentage === undefined ? '-' : d.used_percentage.toFixed(1),
        d.mentioned ? 'yes' : 'no',
      ])
    })
    lines.push('')
    lines.push(chalk.bold(`Top Domains (${domains.length})`))
    lines.push(table.toString())
  } else if (Object.prototype.hasOwnProperty.call(data, 'domains')) {
    lines.push('')
    lines.push(chalk.bold('Top Domains (0)'))
    lines.push(chalk.dim('No cited domains in this window.'))
  }

  if (urls.length > 0) {
    const table = new Table({
      head: [chalk.bold('URL'), chalk.bold('Domain'), chalk.bold('Mentions')],
      colWidths: [62, 26, 10],
      wordWrap: true,
    })
    urls.slice(0, 10).forEach((u) => {
      table.push([
        truncate(u.url, 58),
        u.domain || '-',
        u.mentioned_count ?? '-',
      ])
    })
    lines.push('')
    lines.push(chalk.bold(`Top URLs (${urls.length})`))
    lines.push(table.toString())
  } else if (Object.prototype.hasOwnProperty.call(data, 'urls')) {
    lines.push('')
    lines.push(chalk.bold('Top URLs (0)'))
    lines.push(chalk.dim('No cited URLs in this window.'))
  }

  if (chats.length > 0) {
    const table = new Table({
      head: [chalk.bold('Date'), chalk.bold('Provider'), chalk.bold('Mentioned'), chalk.bold('Refs'), chalk.bold('Preview')],
      colWidths: [14, 16, 11, 7, 58],
      wordWrap: true,
    })
    chats.slice(0, 5).forEach((c) => {
      table.push([
        c.date ? c.date.slice(0, 10) : '-',
        c.platform || '-',
        c.mentioned ? 'yes' : 'no',
        Array.isArray(c.references) ? c.references.length : 0,
        truncate(c.chat_preview || c.full_content || '', 54),
      ])
    })
    lines.push('')
    lines.push(chalk.bold(`Chats (${chats.length})`))
    lines.push(table.toString())
    if (chats.length > 5) {
      lines.push(chalk.dim(`Showing first 5 chats. Use --json for full evidence.`))
    }
  } else if (Object.prototype.hasOwnProperty.call(data, 'chats')) {
    lines.push('')
    lines.push(chalk.bold('Chats (0)'))
    lines.push(chalk.dim('No chats in this scoped window.'))
  }

  lines.push('')
  lines.push(chalk.dim('Use --json for raw joinable evidence.'))
  return lines.join('\n')
}

module.exports = { projectsTable, competitorsTable, overviewTable, sourcesTable, recordingsTable, jsonOutput, slimOverview, slimCompetitors, formatPercent, formatDate, actionsTable, actionDetail, webhooksTable, promptInspectSummary }
