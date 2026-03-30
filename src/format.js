const chalk = require('chalk')
const Table = require('cli-table3')

function formatPercent(value) {
  if (value === null || value === undefined) return chalk.dim('—')
  return `${(value * 100).toFixed(1)}%`
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

module.exports = { projectsTable, competitorsTable, overviewTable, sourcesTable, jsonOutput, formatPercent, formatDate }
