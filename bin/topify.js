#!/usr/bin/env node

const { Command } = require('commander')
const chalk = require('chalk')
const ora = require('ora')
const fs = require('fs')
const path = require('path')
const { TopifyAPI } = require('../src/api')
const { getApiKey, setApiKey, getDefaultProject, setDefaultProject, clearConfig } = require('../src/config')
const { projectsTable, competitorsTable, overviewTable, sourcesTable, recordingsTable, jsonOutput, slimOverview, slimCompetitors, actionsTable, actionDetail, webhooksTable, promptInspectSummary } = require('../src/format')

const program = new Command()

program
  .name('topify')
  .description('Topify AI Visibility CLI - Monitor your brand in AI search results')
  .version(require('../package.json').version)

// Helper to get authenticated API client
function getClient() {
  const key = getApiKey()
  if (!key) {
    console.error(chalk.red('No API key configured. Run: topify config --api-key <key>'))
    console.error(chalk.dim('Get your key at: https://app.topify.ai → Settings → API Keys'))
    process.exit(1)
  }
  return new TopifyAPI(key)
}

// Helper to resolve project ID
function resolveProject(opts) {
  const projectId = opts.project || getDefaultProject()
  if (!projectId) {
    console.error(chalk.red('No project specified. Use --project <id> or set default: topify config --default-project <id>'))
    process.exit(1)
  }
  return projectId
}

function parseIncludeList(value, allowed, defaults) {
  const raw = (value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
  const validTokens = [...allowed, 'all']
  const invalid = raw.filter((item) => !validTokens.includes(item))
  if (invalid.length > 0) {
    throw new Error(`Unknown include value(s): ${invalid.join(', ')}. Allowed: ${allowed.join(', ')}, all`)
  }
  const requested = raw.length ? raw : defaults
  const expanded = requested.includes('all') ? allowed : requested
  return [...new Set(expanded)]
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizePromptType(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
}

function promptContent(prompt) {
  return String(prompt.content || prompt.keyword || '').trim()
}

function isFailedPrompt(prompt) {
  const content = promptContent(prompt).toLowerCase()
  const status = String(prompt.status || prompt.generation_status || prompt.result_status || '').toLowerCase()
  return status === 'failed' || /^(\[gen_failed\]|\[failed\]|gen_failed\b|failed\b)/i.test(content)
}

function isGeneratedPrompt(prompt, type) {
  const promptType = normalizePromptType(prompt.prompt_type || prompt.promptType)
  if (type === 'all') return ['suggested', 'url_recommended', 'urlrecommended'].includes(promptType)
  if (type === 'url-recommended') return ['url_recommended', 'urlrecommended'].includes(promptType)
  return promptType === type
}

function summarizePromptGeneration(prompts, type) {
  const items = prompts.filter((p) => isGeneratedPrompt(p, type))
  const failed = items.filter((p) => isFailedPrompt(p))
  const pending = items.filter((p) => !promptContent(p) && !isFailedPrompt(p))
  const ready = items.filter((p) => promptContent(p) && !isFailedPrompt(p))
  return { items, total: items.length, ready: ready.length, pending: pending.length, failed: failed.length }
}

function flattenForCsv(value, prefix = '', out = {}) {
  if (Array.isArray(value)) {
    out[prefix || 'value'] = value.map((item) => {
      if (item && typeof item === 'object') return JSON.stringify(item)
      return item
    }).join('; ')
    return out
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, nested]) => {
      const next = prefix ? `${prefix}.${key}` : key
      flattenForCsv(nested, next, out)
    })
    return out
  }
  out[prefix || 'value'] = value
  return out
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function toCsv(rows) {
  const flatRows = rows.map((row) => flattenForCsv(row))
  const columns = [...new Set(flatRows.flatMap((row) => Object.keys(row)))]
  return [
    columns.map(csvEscape).join(','),
    ...flatRows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n')
}

function writeOrPrint(content, outputPath) {
  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), content)
    console.log(chalk.green(`Wrote ${path.resolve(outputPath)}`))
  } else {
    console.log(content)
  }
}

function extractItems(payload, preferredKey) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  if (preferredKey && Array.isArray(payload[preferredKey])) return payload[preferredKey]
  if (Array.isArray(payload.items)) return payload.items
  if (Array.isArray(payload.prompts)) return payload.prompts
  if (Array.isArray(payload.urls)) return payload.urls
  if (Array.isArray(payload.active_competitors)) return payload.active_competitors
  return [payload]
}

function trendsToRows(payload) {
  const dates = Array.isArray(payload?.dates) ? payload.dates : []
  const series = Array.isArray(payload?.series) ? payload.series : []
  return series.flatMap((entry) => dates.map((date, index) => ({
    date,
    period: payload.period || '',
    competitor_id: entry.competitor_id,
    name: entry.name,
    website: entry.website,
    is_own_brand: entry.is_own_brand,
    visibility: Array.isArray(entry.visibility) ? entry.visibility[index] : undefined,
    sentiment: Array.isArray(entry.sentiment) ? entry.sentiment[index] : undefined,
    position: Array.isArray(entry.position) ? entry.position[index] : undefined,
  })))
}

function exportRows(resource, payload, preferredKey) {
  if (resource === 'trends') return trendsToRows(payload)
  return extractItems(payload, preferredKey)
}

// ============ config ============
program
  .command('config')
  .description('Configure CLI settings')
  .option('--api-key <key>', 'Set your Topify API key')
  .option('--default-project <id>', 'Set default project ID')
  .option('--show', 'Show current configuration')
  .option('--clear', 'Clear all configuration')
  .action((opts) => {
    if (opts.clear) {
      clearConfig()
      console.log(chalk.green('Configuration cleared.'))
      return
    }

    if (opts.apiKey) {
      setApiKey(opts.apiKey)
      console.log(chalk.green('API key saved.'))
    }

    if (opts.defaultProject) {
      setDefaultProject(opts.defaultProject)
      console.log(chalk.green(`Default project set to: ${opts.defaultProject}`))
    }

    if (opts.show || (!opts.apiKey && !opts.defaultProject)) {
      const key = getApiKey()
      const proj = getDefaultProject()
      console.log(chalk.bold('Topify CLI Configuration'))
      console.log(`  API Key:         ${key ? chalk.green(key.substring(0, 16) + '...') : chalk.dim('not set')}`)
      console.log(`  Default Project: ${proj || chalk.dim('not set')}`)
      console.log()
      console.log(chalk.dim('  Config file: ~/.config/topify-cli/config.json'))
    }
  })

// ============ projects ============
const projects = program
  .command('projects')
  .description('Manage projects')

projects
  .command('list', { isDefault: true })
  .description('List all projects')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const client = getClient()
    const spinner = ora('Fetching projects...').start()
    try {
      const result = await client.listProjects()
      spinner.stop()
      const items = result.data || []

      if (opts.json) {
        console.log(jsonOutput(items))
      } else {
        console.log(chalk.bold(`\n${items.length} Projects\n`))
        console.log(projectsTable(items))
        console.log(chalk.dim(`\nTip: Set a default project with: topify config --default-project <id>`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

projects
  .command('create')
  .description('Create a new brand tracking project')
  .requiredOption('--brand <name>', 'Brand name to track')
  .requiredOption('--website <url>', 'Brand website URL')
  .requiredOption('--webhook <url>', 'Webhook URL for completion notification')
  .option('--language <code>', 'Prompt language (e.g. en, es, fr)')
  .option('--location <code>', 'Target market (e.g. US, GB, DE)')
  .option('--json', 'Output as JSON')
  .addHelpText('after', `
Examples:
  $ topify projects create --brand "Acme Corp" --website acme.com --webhook https://example.com/hook
  $ topify projects create --brand "Acme" --website acme.com --webhook https://hook.site/abc --language en --location US`)
  .action(async (opts) => {
    const client = getClient()
    const spinner = ora('Creating project...').start()
    try {
      const result = await client.createProject({
        brandName: opts.brand,
        brandUrl: opts.website,
        webhookUrl: opts.webhook,
        language: opts.language,
        location: opts.location,
      })
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data || result))
      } else {
        const data = result.data || result
        console.log(chalk.green('Project created!'))
        console.log(`  ${chalk.dim('Project ID:')} ${data.project_id}`)
        console.log(`  ${chalk.dim('Status:')}     ${data.status || 'initializing'}`)
        console.log()
        console.log(chalk.dim('The brand tracking pipeline is running. You\'ll receive a webhook when it\'s ready.'))
        console.log(chalk.dim(`Set as default: topify config --default-project ${data.project_id}`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

// ============ overview ============
program
  .command('overview')
  .description('Get visibility overview for a project')
  .option('-p, --project <id>', 'Project ID')
  .option('-d, --days <n>', 'Lookback days', '7')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--providers <list>', 'Filter providers (comma-separated)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Fetching overview...').start()
    try {
      const result = await client.getOverview(projectId, {
        days: opts.days,
        from: opts.from,
        to: opts.to,
        providers: opts.providers,
      })
      spinner.stop()

      if (opts.json) {
        console.log(slimOverview(result.data))
      } else {
        const items = result.data?.items || []
        console.log(chalk.bold(`\nVisibility Overview (last ${opts.days} days) — ${items.length} prompts\n`))
        console.log(overviewTable(items))
        if (items.length > 20) {
          console.log(chalk.dim(`\nShowing top 20 of ${items.length}. Use --json for full output.`))
        }
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

// ============ competitors ============
const competitors = program
  .command('competitors')
  .description('Manage competitors')

competitors
  .command('list')
  .description('List competitors and their metrics')
  .option('-p, --project <id>', 'Project ID')
  .option('-d, --days <n>', 'Lookback days', '7')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--providers <list>', 'Filter providers')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Fetching competitors...').start()
    try {
      const result = await client.getCompetitors(projectId, {
        days: opts.days,
        from: opts.from,
        to: opts.to,
        providers: opts.providers,
      })
      spinner.stop()

      if (opts.json) {
        console.log(slimCompetitors(result.data))
      } else {
        const items = result.data?.active_competitors || []
        console.log(chalk.bold(`\nCompetitors (last ${opts.days} days) — ${items.length} brands\n`))
        console.log(competitorsTable(items))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

competitors
  .command('create')
  .description('Add one or more competitors')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .argument('<competitors...>', 'name:website pairs (e.g. "Acme:acme.com")')
  .addHelpText('after', `
Examples:
  $ topify competitors create "Acme:acme.com"
  $ topify competitors create "Acme:acme.com" "Globex:globex.net"`)
  .action(async (pairs, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)

    const items = pairs.map((pair) => {
      const sep = pair.indexOf(':')
      if (sep === -1) {
        console.error(chalk.red(`Invalid format "${pair}". Use name:website (e.g. "Acme:acme.com")`))
        process.exit(1)
      }
      return { name: pair.slice(0, sep).trim(), website: pair.slice(sep + 1).trim() }
    })

    const spinner = ora(`Creating ${items.length} competitor(s)...`).start()
    try {
      const result = await client.createCompetitors(projectId, items)
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const data = result.data || {}
        console.log(chalk.green(`Created ${data.created || items.length} competitor(s).`))
        const created = data.competitors || []
        created.forEach((c) => {
          console.log(`  ${chalk.dim(c.competitorId || c.competitor_id)} ${c.name} (${c.website})`)
        })
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

competitors
  .command('update')
  .description('Update a competitor')
  .option('-p, --project <id>', 'Project ID')
  .option('--name <name>', 'New competitor name')
  .option('--website <url>', 'New website')
  .option('--json', 'Output as JSON')
  .argument('<competitor-id>', 'Competitor ID to update')
  .addHelpText('after', `
Examples:
  $ topify competitors update <id> --name "New Name"
  $ topify competitors update <id> --website newdomain.com`)
  .action(async (competitorId, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)

    const fields = {}
    if (opts.name) fields.name = opts.name
    if (opts.website) fields.website = opts.website

    if (Object.keys(fields).length === 0) {
      console.error(chalk.red('Provide at least one field to update: --name or --website'))
      process.exit(1)
    }

    const spinner = ora('Updating competitor...').start()
    try {
      const result = await client.updateCompetitor(projectId, competitorId, fields)
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        console.log(chalk.green('Competitor updated.'))
        const c = result.data || {}
        console.log(`  ${chalk.dim('ID:')} ${c.competitorId || c.competitor_id || competitorId}`)
        if (c.name) console.log(`  ${chalk.dim('Name:')} ${c.name}`)
        if (c.website) console.log(`  ${chalk.dim('Website:')} ${c.website}`)
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

competitors
  .command('track')
  .description('Track a pending competitor (state: pending -> active)')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .argument('<competitor-id>', 'Competitor ID to track')
  .addHelpText('after', `
Examples:
  $ topify competitors track <id>
Pending competitors come from the AI pipeline auto-detecting brand co-mentions.
Use 'topify competitors list' to see them.`)
  .action(async (competitorId, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Tracking competitor...').start()
    try {
      const result = await client.transitionCompetitorState(projectId, competitorId, 'active')
      spinner.stop()
      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const d = result.data || {}
        console.log(chalk.green(`${d.name || competitorId}: ${d.previous_state || '?'} -> ${d.new_state || 'active'}`))
        if (d.message) console.log(chalk.dim(`  ${d.message}`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

competitors
  .command('reject')
  .description('Reject a pending competitor (state: pending -> inactive)')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .argument('<competitor-id>', 'Competitor ID to reject')
  .action(async (competitorId, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Rejecting competitor...').start()
    try {
      const result = await client.transitionCompetitorState(projectId, competitorId, 'inactive')
      spinner.stop()
      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const d = result.data || {}
        console.log(chalk.green(`${d.name || competitorId}: ${d.previous_state || '?'} -> ${d.new_state || 'inactive'}`))
        if (d.message) console.log(chalk.dim(`  ${d.message}`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

competitors
  .command('delete')
  .description('Delete a competitor')
  .option('-p, --project <id>', 'Project ID')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .argument('<competitor-id>', 'Competitor ID to delete')
  .action(async (competitorId, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)

    if (!opts.yes) {
      const readline = require('readline')
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
      const answer = await new Promise((resolve) => {
        rl.question(chalk.yellow(`Delete competitor ${competitorId}? [y/N] `), resolve)
      })
      rl.close()
      if (answer.toLowerCase() !== 'y') {
        console.error('Aborted.')
        process.exit(0)
      }
    }

    const spinner = ora('Deleting competitor...').start()
    try {
      const result = await client.deleteCompetitor(projectId, competitorId)
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        console.log(chalk.green(`Competitor ${competitorId} deleted.`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

// ============ prompts ============
const prompts = program
  .command('prompts')
  .description('Manage tracked prompts')

prompts
  .command('list')
  .description('List tracked prompts')
  .option('-p, --project <id>', 'Project ID')
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Items per page', '50')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Fetching prompts...').start()
    try {
      const result = await client.listPrompts(projectId)
      spinner.stop()

      const allPrompts = result.data?.prompts || (Array.isArray(result.data) ? result.data : result.data?.items || [])
      const page = Math.max(1, parseInt(opts.page, 10) || 1)
      const pageSize = Math.max(1, parseInt(opts.pageSize, 10) || 50)
      const offset = (page - 1) * pageSize
      const pageItems = allPrompts.slice(offset, offset + pageSize)

      if (opts.json) {
        if (result.data?.prompts) {
          console.log(jsonOutput({
            ...result.data,
            page,
            page_size: pageSize,
            prompts: pageItems,
          }))
        } else {
          console.log(jsonOutput(pageItems))
        }
      } else {
        console.log(chalk.bold(`\nPrompts (${allPrompts.length} total, page ${page})\n`))
        pageItems.forEach((p, i) => {
          const rowNumber = offset + i + 1
          console.log(`  ${chalk.dim(rowNumber + '.')} ${chalk.cyan(p.id || p.prompt_id || '')} ${p.content || p.keyword || '-'}`)
        })
        if (offset + pageItems.length < allPrompts.length) {
          console.log(chalk.dim(`\nShowing ${pageItems.length} of ${allPrompts.length}. Next page: topify prompts list --page ${page + 1}`))
        }
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

prompts
  .command('inspect')
  .description('Inspect one prompt with analytics, citation evidence, and optional chats')
  .option('-p, --project <id>', 'Project ID')
  .option('-d, --days <n>', 'Lookback days', '30')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--providers <list>', 'Filter providers (required when including chats)')
  .option('--include <list>', 'Evidence to fetch: analytics,domains,urls,chats,all', 'analytics,domains,urls')
  .option('--json', 'Output as JSON')
  .argument('<prompt-id>', 'Prompt ID to inspect')
  .addHelpText('after', `
Examples:
  $ topify prompts inspect <prompt-id>
  $ topify prompts inspect <prompt-id> --days 30 --json
  $ topify prompts inspect <prompt-id> --include analytics,chats,domains,urls --providers chatgpt`)
  .action(async (promptId, opts) => {
    let includes
    try {
      includes = parseIncludeList(opts.include, ['analytics', 'domains', 'urls', 'chats'], ['analytics', 'domains', 'urls'])
    } catch (error) {
      console.error(chalk.red(error.message))
      process.exit(1)
    }

    if (includes.includes('chats') && !(opts.providers || '').trim()) {
      console.error(chalk.red('Including chats requires --providers <list> to keep full-response payloads bounded.'))
      console.error(chalk.dim('Example: topify prompts inspect <prompt-id> --include chats --providers chatgpt --days 7'))
      process.exit(1)
    }

    const client = getClient()
    const projectId = resolveProject(opts)
    const window = {
      days: opts.days,
      from: opts.from,
      to: opts.to,
      providers: opts.providers,
    }

    const spinner = ora('Inspecting prompt...').start()
    try {
      const requests = [
        ['prompt', client.getPrompt(projectId, promptId, window)],
      ]
      if (includes.includes('analytics')) requests.push(['analytics', client.getPromptAnalytics(projectId, promptId, window)])
      if (includes.includes('domains')) requests.push(['domains', client.getPromptDomains(projectId, promptId, window)])
      if (includes.includes('urls')) requests.push(['urls', client.getPromptUrls(projectId, promptId, window)])
      if (includes.includes('chats')) requests.push(['chats', client.getPromptChats(projectId, promptId, window)])

      const pairs = await Promise.all(requests.map(async ([key, promise]) => {
        const result = await promise
        return [key, result.data]
      }))

      const data = Object.fromEntries(pairs)
      const payload = {
        project_id: projectId,
        prompt_id: promptId,
        window: {
          duration_days: opts.days ? parseInt(opts.days, 10) : undefined,
          date_from: opts.from,
          date_to: opts.to,
          providers: opts.providers,
        },
        includes,
        ...data,
      }

      spinner.stop()
      if (opts.json) {
        console.log(jsonOutput(payload))
      } else {
        console.log(promptInspectSummary(payload))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

prompts
  .command('create')
  .description('Create one or more prompts')
  .option('-p, --project <id>', 'Project ID')
  .requiredOption('--topic-id <id>', 'Topic ID (required)')
  .option('--country <code>', 'Country code (e.g. US, GB)')
  .option('--json', 'Output as JSON')
  .argument('<prompts...>', 'Prompt content(s) to create')
  .addHelpText('after', `
Examples:
  $ topify prompts create --topic-id <id> "best CRM for startups"
  $ topify prompts create --topic-id <id> --country US "prompt one" "prompt two"`)
  .action(async (promptTexts, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora(`Creating ${promptTexts.length} prompt(s)...`).start()
    try {
      const result = await client.createPrompts(projectId, {
        prompts: promptTexts,
        topicId: opts.topicId,
        country: opts.country,
      })
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const data = result.data || {}
        console.log(chalk.green(`Created ${data.created || promptTexts.length} prompt(s).`))
        const created = data.prompts || []
        created.forEach((p) => {
          console.log(`  ${chalk.dim(p.id)} ${p.content || ''}`)
        })
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

prompts
  .command('update')
  .description('Update a prompt')
  .option('-p, --project <id>', 'Project ID')
  .option('--content <text>', 'New prompt content')
  .option('--country <code>', 'Country code')
  .option('--topic-id <id>', 'New topic ID')
  .option('--prompt-type <type>', 'Prompt type')
  .option('--json', 'Output as JSON')
  .argument('<prompt-id>', 'Prompt ID to update')
  .addHelpText('after', `
Examples:
  $ topify prompts update <prompt-id> --content "new prompt text"
  $ topify prompts update <prompt-id> --country GB --topic-id <id>`)
  .action(async (promptId, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)

    const fields = {}
    if (opts.content) fields.content = opts.content
    if (opts.country) fields.country = opts.country
    if (opts.topicId) fields.topicId = opts.topicId
    if (opts.promptType) fields.promptType = opts.promptType

    if (Object.keys(fields).length === 0) {
      console.error(chalk.red('Provide at least one field to update: --content, --country, --topic-id, or --prompt-type'))
      process.exit(1)
    }

    const spinner = ora('Updating prompt...').start()
    try {
      const result = await client.updatePrompt(projectId, promptId, fields)
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        console.log(chalk.green('Prompt updated.'))
        const p = result.data || {}
        console.log(`  ${chalk.dim('ID:')} ${p.id || promptId}`)
        if (p.content) console.log(`  ${chalk.dim('Content:')} ${p.content}`)
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

prompts
  .command('suggest')
  .description('Generate AI-suggested prompts (background pipeline, fills in over ~30-90s)')
  .option('-p, --project <id>', 'Project ID')
  .option('--count <n>', 'Number of prompts to generate (1-50, default = project batch size)')
  .option('--method <name>', 'Generation method (default keyword_seo_v1)', 'keyword_seo_v1')
  .option('--idempotency-key <key>', 'Pass the same value to retry safely')
  .option('--json', 'Output as JSON')
  .addHelpText('after', `
Examples:
  $ topify prompts suggest                          # default count
  $ topify prompts suggest --count 20
  $ topify prompts suggest --idempotency-key run-2026-05-07-1
After running, poll with: topify prompts list  (suggested prompts have promptType=Suggested)`)
  .action(async (opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Requesting suggested prompts...').start()
    try {
      const result = await client.createSuggestedPrompts(projectId, {
        count: opts.count !== undefined ? parseInt(opts.count, 10) : undefined,
        generationMethod: opts.method,
        idempotencyKey: opts.idempotencyKey,
      })
      spinner.stop()
      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const d = result.data || {}
        console.log(chalk.green(`Created ${d.created_count || 0} placeholder prompt(s). Total suggested on project: ${d.total_suggested ?? '?'}.`))
        if (d.message) console.log(chalk.dim(`  ${d.message}`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

prompts
  .command('cleanup-suggested')
  .description('Remove failed/empty suggested-prompt placeholders')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Cleaning up failed placeholders...').start()
    try {
      const result = await client.cleanupSuggestedPrompts(projectId)
      spinner.stop()
      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const d = result.data || {}
        console.log(chalk.green(`Removed ${d.deleted_count ?? 0} failed/empty placeholder(s).`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

prompts
  .command('recommend-urls')
  .description('Generate prompt recommendations for 1-5 target URLs (background pipeline)')
  .option('-p, --project <id>', 'Project ID')
  .option('--count <n>', 'How many recommendations to return (1-20, default 5)', '5')
  .option('--json', 'Output as JSON')
  .argument('<urls...>', 'Target URLs (1-5)')
  .addHelpText('after', `
Examples:
  $ topify prompts recommend-urls https://example.com/blog/post-1
  $ topify prompts recommend-urls --count 10 https://acme.com/pricing https://acme.com/features

Existing prompt DB-match lookup and new recommendation generation run in the
background. Poll with: topify prompts list`)
  .action(async (urls, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const count = parseInt(opts.count, 10)
    const spinner = ora('Requesting URL-driven recommendations...').start()
    try {
      const result = await client.createUrlRecommendations(projectId, urls, count)
      spinner.stop()
      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const d = result.data || {}
        const urlsProvided = d.urls_provided ?? d.urlsProvided ?? urls.length
        const placeholdersCreated = d.placeholders_created ?? d.placeholdersCreated ?? 0
        const dbMatches = d.db_matches ?? d.dbMatches
        const dbMatchesText = /DB-match lookup|background DB-match/i.test(d.message || '')
          ? 'queued'
          : (dbMatches ?? 0)
        console.log(chalk.green(
          `URLs provided: ${urlsProvided}. ` +
          `DB matches: ${dbMatchesText}. ` +
          `Placeholders created: ${placeholdersCreated}.`
        ))
        if (d.message) console.log(chalk.dim(`  ${d.message}`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

prompts
  .command('generation-status')
  .description('Show pending/ready counts for generated prompt placeholders')
  .option('-p, --project <id>', 'Project ID')
  .option('--type <type>', 'suggested, url-recommended, or all', 'all')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const type = String(opts.type || 'all').toLowerCase()
    if (!['all', 'suggested', 'url-recommended'].includes(type)) {
      console.error(chalk.red('--type must be one of: all, suggested, url-recommended'))
      process.exit(1)
    }
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Checking generated prompts...').start()
    try {
      const result = await client.listPrompts(projectId)
      spinner.stop()
      const promptsList = result.data?.prompts || (Array.isArray(result.data) ? result.data : result.data?.items || [])
      const summary = summarizePromptGeneration(promptsList, type)
      if (opts.json) {
        console.log(jsonOutput({ project_id: projectId, type, ...summary }))
      } else {
        console.log(chalk.bold(`\nGenerated prompt status (${type})\n`))
        console.log(`  ${chalk.dim('Total:')}   ${summary.total}`)
        console.log(`  ${chalk.dim('Ready:')}   ${summary.ready}`)
        console.log(`  ${chalk.dim('Pending:')} ${summary.pending}`)
        console.log(`  ${chalk.dim('Failed:')}  ${summary.failed}`)
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

prompts
  .command('watch')
  .description('Poll generated prompts until placeholders are filled')
  .option('-p, --project <id>', 'Project ID')
  .option('--type <type>', 'suggested, url-recommended, or all', 'all')
  .option('--interval <seconds>', 'Polling interval', '5')
  .option('--timeout <seconds>', 'Maximum wait time', '300')
  .option('--json', 'Output final status as JSON')
  .action(async (opts) => {
    const type = String(opts.type || 'all').toLowerCase()
    if (!['all', 'suggested', 'url-recommended'].includes(type)) {
      console.error(chalk.red('--type must be one of: all, suggested, url-recommended'))
      process.exit(1)
    }
    const intervalMs = Math.max(1, parseInt(opts.interval, 10) || 5) * 1000
    const timeoutMs = Math.max(1, parseInt(opts.timeout, 10) || 300) * 1000
    const client = getClient()
    const projectId = resolveProject(opts)
    const started = Date.now()
    let finalSummary = null

    try {
      while (Date.now() - started <= timeoutMs) {
        const result = await client.listPrompts(projectId)
        const promptsList = result.data?.prompts || (Array.isArray(result.data) ? result.data : result.data?.items || [])
        finalSummary = summarizePromptGeneration(promptsList, type)
        const elapsed = Math.round((Date.now() - started) / 1000)
        if (!opts.json) {
          console.error(chalk.dim(
            `ready=${finalSummary.ready} pending=${finalSummary.pending} failed=${finalSummary.failed} elapsed=${elapsed}s`
          ))
        }
        if (finalSummary.total > 0 && finalSummary.pending === 0) break
        await sleep(intervalMs)
      }

      const noItems = !finalSummary || finalSummary.total === 0
      const timedOut = noItems || finalSummary.pending > 0
      const hasFailed = Boolean(finalSummary && finalSummary.failed > 0)
      const payload = {
        project_id: projectId,
        type,
        timed_out: timedOut,
        has_failed: hasFailed,
        ...(finalSummary || { items: [], total: 0, ready: 0, pending: 0, failed: 0 }),
      }
      if (opts.json) {
        console.log(jsonOutput(payload))
      } else if (noItems) {
        console.log(chalk.yellow(`Timed out with no generated prompt placeholders for type "${type}".`))
      } else if (timedOut) {
        console.log(chalk.yellow(`Timed out with ${finalSummary.pending} pending generated prompt(s).`))
      } else if (hasFailed) {
        console.log(chalk.red(`Generated prompts completed with ${finalSummary.failed} failed item(s).`))
      } else {
        console.log(chalk.green('Generated prompts are ready.'))
      }
      if (timedOut) process.exit(2)
      if (hasFailed) process.exit(3)
    } catch (error) {
      console.error(chalk.red(error.message))
      process.exit(1)
    }
  })

// ============ recordings ============
const recordings = program
  .command('recording')
  .alias('recordings')
  .description('Manage recorded URLs for prompt discovery')

recordings
  .command('list')
  .description('List recorded URLs')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Fetching recordings...').start()
    try {
      const result = await client.listRecordings(projectId)
      spinner.stop()

      const data = result.data || {}
      const urls = data.urls || []
      if (opts.json) {
        console.log(jsonOutput(data))
        return
      }

      console.log(chalk.bold(`\nRecorded URLs (${urls.length})\n`))
      if (urls.length === 0) {
        console.log(chalk.dim('  No recorded URLs yet. Add one with: topify recording add <url>'))
      } else {
        console.log(recordingsTable(data))
        if (urls.length > 20) {
          console.log(chalk.dim(`\nShowing top 20 of ${urls.length}. Use --json for full output.`))
        }
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

recordings
  .command('add')
  .description('Add one or more URLs to recording')
  .option('-p, --project <id>', 'Project ID')
  .option('--title <title>', 'Optional title when adding a single URL')
  .option('--json', 'Output as JSON')
  .argument('<urls...>', 'URLs to record')
  .addHelpText('after', `
Examples:
  $ topify recording add https://example.com/blog/post
  $ topify recording add https://example.com/blog/post --title "Launch post"`)
  .action(async (urls, opts) => {
    if (opts.title && urls.length !== 1) {
      console.error(chalk.red('--title can only be used when adding a single URL.'))
      process.exit(1)
    }

    const client = getClient()
    const projectId = resolveProject(opts)
    const inputs = urls.map((url) => ({
      url,
      title: opts.title || undefined,
    }))
    const spinner = ora(`Adding ${urls.length} URL(s) to recording...`).start()
    try {
      const result = await client.addRecordings(projectId, inputs)
      spinner.stop()
      const data = result.data || {}
      if (opts.json) {
        console.log(jsonOutput(data))
      } else {
        console.log(chalk.green(`Added ${data.affected_count ?? 0} URL(s). Total recorded: ${data.total_recorded ?? '?'}.`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

recordings
  .command('remove')
  .description('Remove one or more URLs from recording')
  .option('-p, --project <id>', 'Project ID')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .argument('<urls...>', 'URLs to remove')
  .action(async (urls, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)

    if (!opts.yes) {
      const readline = require('readline')
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
      const answer = await new Promise((resolve) => {
        rl.question(chalk.yellow(`Remove ${urls.length} URL(s) from recording? [y/N] `), resolve)
      })
      rl.close()
      if (answer.toLowerCase() !== 'y') {
        console.error('Aborted.')
        process.exit(0)
      }
    }

    const spinner = ora(`Removing ${urls.length} URL(s) from recording...`).start()
    try {
      const result = await client.removeRecordings(projectId, urls)
      spinner.stop()
      const data = result.data || {}
      if (opts.json) {
        console.log(jsonOutput(data))
      } else {
        console.log(chalk.green(`Removed ${data.affected_count ?? 0} URL(s). Total recorded: ${data.total_recorded ?? '?'}.`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

recordings
  .command('generate-prompts')
  .description('Generate prompt recommendations for recorded target URLs')
  .option('-p, --project <id>', 'Project ID')
  .option('--count <n>', 'How many recommendations to return (1-20, default 5)', '5')
  .option('--json', 'Output as JSON')
  .argument('<urls...>', 'Recorded or target URLs (1-5)')
  .addHelpText('after', `
Examples:
  $ topify recording generate-prompts https://example.com/blog/post
  $ topify recording generate-prompts --count 10 https://example.com/a https://example.com/b`)
  .action(async (urls, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const count = parseInt(opts.count, 10)
    const spinner = ora('Requesting prompt recommendations...').start()
    try {
      const result = await client.createUrlRecommendations(projectId, urls, count)
      spinner.stop()
      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const data = result.data || {}
        const urlsProvided = data.urls_provided ?? data.urlsProvided ?? urls.length
        const placeholdersCreated = data.placeholders_created ?? data.placeholdersCreated ?? 0
        const dbMatches = data.db_matches ?? data.dbMatches
        const dbMatchesText = /DB-match lookup|background DB-match/i.test(data.message || '')
          ? 'queued'
          : (dbMatches ?? 0)
        console.log(chalk.green(
          `URLs provided: ${urlsProvided}. ` +
          `DB matches: ${dbMatchesText}. ` +
          `Placeholders created: ${placeholdersCreated}.`
        ))
        if (data.message) console.log(chalk.dim(`  ${data.message}`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

// ============ reports ============
const reports = program
  .command('reports')
  .alias('report')
  .description('Generate project reports')

reports
  .command('generate')
  .alias('download')
  .description('Generate a self-contained HTML project report')
  .option('-p, --project <id>', 'Project ID')
  .option('-d, --days <n>', 'Lookback days', '30')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('-o, --output <file>', 'Output HTML file')
  .option('--stdout', 'Print HTML to stdout instead of writing a file')
  .addHelpText('after', `
Examples:
  $ topify reports generate --days 30
  $ topify reports generate --from 2026-05-01 --to 2026-05-22 -o report.html`)
  .action(async (opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Generating report...').start()
    try {
      const result = await client.generateReport(projectId, {
        days: opts.days,
        from: opts.from,
        to: opts.to,
        format: opts.stdout ? 'inline' : 'download',
      })
      spinner.stop()
      if (opts.stdout) {
        process.stdout.write(result.body)
        return
      }
      const dateLabel = opts.from && opts.to ? `${opts.from}_${opts.to}` : `${opts.days || 30}d`
      const output = opts.output || `topify-report-${projectId}-${dateLabel}.html`
      fs.writeFileSync(path.resolve(output), result.body)
      console.log(chalk.green(`Report written to ${path.resolve(output)}`))
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

// ============ sources ============
const sources = program
  .command('sources')
  .description('Source domains cited in AI responses')

sources
  .command('list', { isDefault: true })
  .description('List source domains cited in AI responses')
  .option('-p, --project <id>', 'Project ID')
  .option('-d, --days <n>', 'Lookback days', '7')
  .option('--from <date>', 'Start date')
  .option('--to <date>', 'End date')
  .option('--providers <list>', 'Filter providers')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Fetching sources...').start()
    try {
      const result = await client.getSources(projectId, {
        days: opts.days,
        from: opts.from,
        to: opts.to,
        providers: opts.providers,
      })
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const sources = result.data?.items || result.data || []
        console.log(chalk.bold(`\nSources (last ${opts.days} days)\n`))
        console.log(sourcesTable(sources))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

sources
  .command('detail')
  .description('Show citation drilldown for one source domain')
  .argument('<domain>', 'Source domain, for example example.com')
  .option('-p, --project <id>', 'Project ID')
  .option('-d, --days <n>', 'Lookback days', '30')
  .option('--from <date>', 'Start date')
  .option('--to <date>', 'End date')
  .option('--providers <list>', 'Filter providers')
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Page size', '20')
  .option('--json', 'Output as JSON')
  .action(async (domain, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Fetching source detail...').start()
    try {
      const result = await client.getSourceDetail(projectId, domain, {
        days: opts.days,
        from: opts.from,
        to: opts.to,
        providers: opts.providers,
        page: opts.page,
        pageSize: opts.pageSize,
      })
      spinner.stop()
      const data = result.data || {}
      if (opts.json) {
        console.log(jsonOutput(data))
      } else {
        const stats = data.stats || {}
        console.log(chalk.bold(`\n${data.domain || domain}\n`))
        console.log(`  ${chalk.dim('Citations:')} ${stats.total_citations ?? 0}`)
        console.log(`  ${chalk.dim('URLs:')}      ${stats.total_urls ?? 0}`)
        console.log(`  ${chalk.dim('Chats:')}     ${stats.total_chats ?? 0}`)
        const urls = data.urls?.items || []
        if (urls.length) {
          console.log(chalk.bold('\nTop URLs\n'))
          urls.slice(0, 10).forEach((u, i) => {
            console.log(`  ${chalk.dim(`${i + 1}.`)} ${u.url} ${chalk.dim(`(${u.citation_count} citations)`)}`)
          })
        }
        const promptsList = data.prompts?.items || []
        if (promptsList.length) {
          console.log(chalk.bold('\nTop Prompts\n'))
          promptsList.slice(0, 10).forEach((p, i) => {
            console.log(`  ${chalk.dim(`${i + 1}.`)} ${p.content} ${chalk.dim(`(${p.citation_count} citations)`)}`)
          })
        }
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

sources
  .command('chats')
  .description('Show LLM chats that cited one source domain')
  .argument('<domain>', 'Source domain, for example example.com')
  .option('-p, --project <id>', 'Project ID')
  .option('-d, --days <n>', 'Lookback days', '30')
  .option('--from <date>', 'Start date')
  .option('--to <date>', 'End date')
  .option('--providers <list>', 'Filter providers')
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Page size', '10')
  .option('--json', 'Output as JSON')
  .action(async (domain, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Fetching source chats...').start()
    try {
      const result = await client.getSourceChats(projectId, domain, {
        days: opts.days,
        from: opts.from,
        to: opts.to,
        providers: opts.providers,
        page: opts.page,
        pageSize: opts.pageSize,
      })
      spinner.stop()
      const data = result.data || {}
      if (opts.json) {
        console.log(jsonOutput(data))
      } else {
        const chats = data.chats?.items || []
        console.log(chalk.bold(`\nChats citing ${data.domain || domain} (${data.chats?.total ?? chats.length})\n`))
        chats.forEach((chat, i) => {
          const refs = chat.references || []
          console.log(`${chalk.dim(`${i + 1}.`)} ${chalk.cyan(chat.platform || '')} ${chalk.dim(chat.date || '')}`)
          console.log(`   ${chat.prompt_content || ''}`)
          console.log(`   ${chalk.dim(`${refs.length} cited URL(s): ${refs.map((r) => r.link).slice(0, 3).join(', ')}`)}`)
          if (chat.chat_preview) console.log(`   ${chat.chat_preview.replace(/\s+/g, ' ').slice(0, 220)}`)
        })
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

// ============ topics ============
program
  .command('topics')
  .description('List topic groups')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Fetching topics...').start()
    try {
      const result = await client.getTopics(projectId)
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const topics = result.data || []
        console.log(chalk.bold(`\n${topics.length} Topics\n`))
        topics.forEach((t) => {
          console.log(`  ${chalk.cyan(t.name || t.topic_name || '—')} ${chalk.dim(`(${t.prompt_count || 0} prompts)`)}`)
        })
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

// ============ trends ============
program
  .command('trends')
  .description('Get visibility trends over time')
  .option('-p, --project <id>', 'Project ID')
  .option('-d, --days <n>', 'Lookback days', '30')
  .option('--from <date>', 'Start date')
  .option('--to <date>', 'End date')
  .option('--providers <list>', 'Filter providers')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Fetching trends...').start()
    try {
      const result = await client.getVisibilityTrends(projectId, {
        days: opts.days,
        from: opts.from,
        to: opts.to,
        providers: opts.providers,
      })
      spinner.stop()
      console.log(jsonOutput(result.data))
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

// ============ exports ============
program
  .command('export')
  .description('Export project data as JSON or CSV')
  .argument('<resource>', 'projects|prompts|sources|competitors|recordings|topics|overview|trends|actions')
  .option('-p, --project <id>', 'Project ID')
  .option('--format <format>', 'json or csv', 'json')
  .option('-o, --output <file>', 'Output file')
  .option('-d, --days <n>', 'Lookback days', '30')
  .option('--from <date>', 'Start date')
  .option('--to <date>', 'End date')
  .option('--providers <list>', 'Filter providers')
  .option('--status <status>', 'Filter actions by status')
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Page size', '100')
  .addHelpText('after', `
Examples:
  $ topify export prompts --format csv -o prompts.csv
  $ topify export sources --days 30 --format json
  $ topify export recordings --format csv`)
  .action(async (resource, opts) => {
    const normalizedResource = String(resource || '').toLowerCase()
    const format = String(opts.format || 'json').toLowerCase()
    const allowedResources = new Set([
      'projects',
      'prompts',
      'sources',
      'competitors',
      'recordings',
      'recording',
      'topics',
      'overview',
      'trends',
      'actions',
    ])
    if (!['json', 'csv'].includes(format)) {
      console.error(chalk.red('--format must be json or csv'))
      process.exit(1)
    }
    if (!allowedResources.has(normalizedResource)) {
      console.error(chalk.red(`Unknown export resource: ${resource}`))
      process.exit(1)
    }

    const client = getClient()
    const spinner = ora(`Exporting ${normalizedResource}...`).start()
    try {
      const needsProject = normalizedResource !== 'projects'
      const projectId = needsProject ? resolveProject(opts) : null
      const window = {
        days: opts.days,
        from: opts.from,
        to: opts.to,
        providers: opts.providers,
        page: opts.page,
        pageSize: opts.pageSize,
      }
      let payload
      let preferredKey

      switch (normalizedResource) {
        case 'projects':
          payload = (await client.listProjects()).data
          break
        case 'prompts':
          payload = (await client.listPrompts(projectId)).data
          preferredKey = 'prompts'
          break
        case 'sources':
          payload = (await client.getSources(projectId, window)).data
          break
        case 'competitors':
          payload = (await client.getCompetitors(projectId, window)).data
          preferredKey = 'active_competitors'
          break
        case 'recordings':
        case 'recording':
          payload = (await client.listRecordings(projectId)).data
          preferredKey = 'urls'
          break
        case 'topics':
          payload = (await client.getTopics(projectId)).data
          break
        case 'overview':
          payload = (await client.getOverview(projectId, window)).data
          preferredKey = 'items'
          break
        case 'trends':
          payload = (await client.getVisibilityTrends(projectId, window)).data
          break
        case 'actions':
          payload = (await client.listActions(projectId, { status: opts.status })).data
          preferredKey = 'items'
          break
        default:
          throw new Error(`Unknown export resource: ${resource}`)
      }

      spinner.stop()
      const content = format === 'json'
        ? jsonOutput(payload)
        : toCsv(exportRows(normalizedResource, payload, preferredKey))
      writeOrPrint(content, opts.output)
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

// ============ actions ============
const actions = program
  .command('actions')
  .description('Manage action items')

actions
  .command('list')
  .description('List action items')
  .option('-p, --project <id>', 'Project ID')
  .option('--status <status>', 'Filter by status (suggested|accepted|completed|ignored)')
  .option('--group <group>', 'Filter by group/category')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Fetching actions...').start()
    try {
      const result = await client.listActions(projectId, {
        status: opts.status,
        group: opts.group,
      })
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const items = result.data?.items || result.data || []
        console.log(chalk.bold(`\n${items.length} Actions\n`))
        if (items.length === 0) {
          console.log(chalk.dim('  No actions found. Run `topify actions recommend` to generate suggestions.'))
        } else {
          console.log(actionsTable(items))
        }
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

actions
  .command('get')
  .description('Get action details')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .argument('<action-id>', 'Action ID')
  .action(async (actionId, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Fetching action...').start()
    try {
      const result = await client.getAction(projectId, actionId)
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const a = result.data || {}
        console.log()
        console.log(actionDetail(a))
        console.log()
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

for (const [transition, label] of [['accept', 'Accepting'], ['ignore', 'Ignoring'], ['complete', 'Completing'], ['reopen', 'Reopening']]) {
  const cmd = actions
    .command(transition)
    .description(`${transition.charAt(0).toUpperCase() + transition.slice(1)} an action`)
    .option('-p, --project <id>', 'Project ID')
    .argument('<action-id>', 'Action ID')

  if (transition === 'ignore') {
    cmd.option('--reason <reason>', 'Reason for ignoring')
  }

  cmd.action(async (actionId, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora(`${label} action...`).start()
    try {
      const body = transition === 'ignore' && opts.reason ? { reason: opts.reason } : null
      const result = await client.transitionAction(projectId, actionId, transition, body)
      spinner.stop()

      const newStatus = result.data?.status || transition
      console.log(chalk.green(`Action ${actionId} -> ${newStatus}`))
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })
}

actions
  .command('recommend')
  .description('Trigger action recommendations')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Requesting recommendations...').start()
    try {
      const result = await client.recommendActions(projectId)
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const taskId = result.data?.task_id || result.data?.taskId || ''
        console.log(chalk.green('Recommendation task started.'))
        if (taskId) {
          console.log(`  ${chalk.dim('Task ID:')} ${taskId}`)
          console.log(chalk.dim(`\nUse \`topify actions task ${taskId}\` to check status.`))
        }
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

actions
  .command('task')
  .description('Check recommendation task status')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .argument('<task-id>', 'Task ID')
  .action(async (taskId, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Checking task status...').start()
    try {
      const result = await client.getTaskStatus(projectId, taskId)
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const d = result.data || {}
        console.log(`  ${chalk.bold('Status:')} ${d.status || ''}`)
        if (d.progress !== undefined) console.log(`  ${chalk.bold('Progress:')} ${d.progress}`)
        if (d.result) console.log(`  ${chalk.bold('Result:')} ${typeof d.result === 'string' ? d.result : JSON.stringify(d.result)}`)
        if (d.error) console.log(`  ${chalk.bold('Error:')} ${chalk.red(d.error)}`)
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

actions
  .command('enrich-content')
  .description('Generate content edits for an action')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .argument('<action-id>', 'Action ID')
  .action(async (actionId, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Generating edits...').start()
    try {
      const result = await client.enrichContent(projectId, actionId)
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const edits = result.data?.edits || result.data || []
        if (Array.isArray(edits) && edits.length > 0) {
          console.log(chalk.bold(`\n${edits.length} Edits\n`))
          edits.forEach((e, i) => {
            console.log(`  ${chalk.cyan(`${i + 1}.`)} ${chalk.bold(e.section || '')} ${chalk.dim(`[${e.type || ''}]`)}`)
            if (e.signal) console.log(`     ${chalk.dim('Signal:')} ${e.signal}`)
            if (e.reason) console.log(`     ${chalk.dim('Reason:')} ${e.reason}`)
          })
        } else {
          console.log(chalk.green('Enrichment complete.'))
          if (typeof result.data === 'object') console.log(jsonOutput(result.data))
        }
        console.log()
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

actions
  .command('enrich-forum')
  .description('Generate a forum comment for an action')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .argument('<action-id>', 'Action ID')
  .action(async (actionId, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Generating comment...').start()
    try {
      const result = await client.enrichForum(projectId, actionId)
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const comment = result.data?.comment || result.data?.content || result.data?.text || ''
        if (comment) {
          console.log(chalk.bold('\nGenerated Comment:\n'))
          console.log(comment)
        } else {
          console.log(chalk.green('Enrichment complete.'))
          if (typeof result.data === 'object') console.log(jsonOutput(result.data))
        }
        console.log()
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

actions
  .command('execute')
  .description('Start action execution workflow')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .argument('<action-id>', 'Action ID')
  .action(async (actionId, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Starting execution...').start()
    try {
      const result = await client.executeAction(projectId, actionId)
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const workflowId = result.data?.workflow_id || result.data?.workflowId || ''
        console.log(chalk.green('Workflow started.'))
        if (workflowId) {
          console.log(`  ${chalk.dim('Workflow ID:')} ${workflowId}`)
        }
        console.log(chalk.dim(`\nPoll progress with: topify actions state ${actionId}`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

actions
  .command('respond')
  .description('Respond to an execution checkpoint')
  .option('-p, --project <id>', 'Project ID')
  .requiredOption('--workflow-id <id>', 'Workflow ID')
  .requiredOption('--decision <decision>', 'Decision (approve|edit|regenerate|reject)')
  .option('--content <text>', 'Edited content (for edit decision)')
  .option('--feedback <text>', 'Feedback message')
  .option('--json', 'Output as JSON')
  .argument('<action-id>', 'Action ID')
  .action(async (actionId, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)

    const body = {
      workflow_id: opts.workflowId,
      decision: opts.decision,
    }
    if (opts.content) body.content = opts.content
    if (opts.feedback) body.feedback = opts.feedback

    const spinner = ora('Sending response...').start()
    try {
      const result = await client.respondToCheckpoint(projectId, actionId, body)
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        console.log(chalk.green(`Checkpoint response sent: ${opts.decision}`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

actions
  .command('state')
  .description('Show lifecycle + valid next-actions for an action (agent-friendly)')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .argument('<action-id>', 'Action ID')
  .action(async (actionId, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Fetching state...').start()
    try {
      const result = await client.getActionState(projectId, actionId)
      spinner.stop()
      const data = result.data || {}
      if (opts.json) {
        console.log(jsonOutput(data))
        return
      }
      console.log()
      console.log(`${chalk.bold('Action:')}      ${data.action_id}`)
      console.log(`${chalk.bold('Status:')}      ${data.status}`)
      console.log(`${chalk.bold('Lifecycle:')}   ${data.lifecycle}`)
      if (data.current_checkpoint) {
        console.log(`${chalk.bold('Checkpoint:')}  ${data.current_checkpoint}  (${data.workflow_status || '?'})`)
      }
      if (Array.isArray(data.ready_artifacts) && data.ready_artifacts.length > 0) {
        console.log(`${chalk.bold('Artifacts:')}   ${data.ready_artifacts.join(', ')}  ${chalk.dim('(use `topify actions artifact ' + actionId.slice(0, 8) + '... <name>`)')}`)
      }
      console.log()
      console.log(chalk.bold('Next actions:'))
      const next = data.next_actions || []
      if (next.length === 0) {
        console.log(chalk.dim('  (none)'))
      } else {
        next.forEach((a, i) => {
          const lab = a.label || a.name
          console.log(`  ${chalk.cyan(`${i + 1}.`)} ${lab}`)
          if (a.http) {
            console.log(`     ${chalk.dim(a.http.method)} ${chalk.dim(a.http.path)}`)
          }
          if (a.requires_input && a.input_field) {
            console.log(`     ${chalk.yellow('input:')} ${a.input_field}`)
          }
        })
      }
      console.log()
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

actions
  .command('artifacts')
  .description('List named artifacts ready to fetch for an action')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .argument('<action-id>', 'Action ID')
  .action(async (actionId, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Listing artifacts...').start()
    try {
      const result = await client.listActionArtifacts(projectId, actionId)
      spinner.stop()
      const names = result.data?.artifacts || []
      if (opts.json) {
        console.log(jsonOutput({ artifacts: names }))
        return
      }
      if (names.length === 0) {
        console.log(chalk.dim('No artifacts ready yet.'))
      } else {
        console.log(chalk.bold(`\nArtifacts ready (${names.length}):`))
        names.forEach((n) => console.log(`  ${chalk.cyan('-')} ${n}`))
        console.log(chalk.dim(`\n  Fetch one with: topify actions artifact ${actionId.slice(0, 8)}... <name>`))
        console.log()
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

// Build a YAML frontmatter block from a flat object. Values are quoted only
// when they contain characters that would otherwise need escaping. Avoids
// pulling in a YAML library for this single use case.
function toYamlFrontmatter(fm) {
  if (!fm || typeof fm !== 'object') return ''
  const lines = ['---']
  for (const [k, v] of Object.entries(fm)) {
    if (v === null || v === undefined) continue
    if (Array.isArray(v)) {
      lines.push(`${k}:`)
      v.forEach((item) => lines.push(`  - ${JSON.stringify(item)}`))
    } else if (typeof v === 'string') {
      // Use double quotes to safely handle most strings; JSON.stringify
      // handles escaping for us.
      lines.push(`${k}: ${JSON.stringify(v)}`)
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`)
    }
  }
  lines.push('---', '')
  return lines.join('\n')
}

actions
  .command('artifact')
  .description('Fetch a single named artifact for an action')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON (default for non-text artifacts)')
  .option('--save <path>', 'For the article publish kit, write body_markdown + YAML frontmatter to this file')
  .argument('<action-id>', 'Action ID')
  .argument('<name>', 'Artifact name (e.g. research, outline, article, thread, comment, edits)')
  .action(async (actionId, name, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora(`Fetching ${name}...`).start()
    try {
      const result = await client.getActionArtifact(projectId, actionId, name)
      spinner.stop()
      const data = result.data

      // Special handling for the article publish kit + --save
      if (name === 'article' && opts.save) {
        if (!data || typeof data !== 'object') {
          console.error(chalk.red('No article data returned.'))
          process.exit(1)
        }
        const body = data.body_markdown || ''
        const fm = toYamlFrontmatter(data.frontmatter || {})
        const content = fm + body + (body.endsWith('\n') ? '' : '\n')

        const target = path.resolve(opts.save)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, content, 'utf8')

        console.log(chalk.green(`Wrote ${content.length} bytes to ${target}`))
        if (data.schema_jsonld) {
          console.log(chalk.dim('  schema_jsonld is NOT inlined into the file. Embed it as <script type="application/ld+json"> in your page <head>:'))
          console.log(chalk.dim('  ' + JSON.stringify(data.schema_jsonld).slice(0, 200) + (JSON.stringify(data.schema_jsonld).length > 200 ? '...' : '')))
        }
        if (data.publish_instructions) {
          console.log()
          console.log(chalk.bold('Next steps:'))
          console.log(data.publish_instructions)
        }
        return
      }

      if (opts.json || (data && typeof data === 'object' && !data.body_markdown)) {
        console.log(jsonOutput(data))
        return
      }

      // Convenient text fallthrough for the article kit when not saving
      if (name === 'article' && data && data.body_markdown) {
        console.log(chalk.bold(`# ${data.title || ''}`))
        if (data.slug) console.log(chalk.dim(`slug: ${data.slug}`))
        if (data.suggested_file_path) console.log(chalk.dim(`suggested path: ${data.suggested_file_path}`))
        console.log()
        console.log(data.body_markdown)
        return
      }

      console.log(jsonOutput(data))
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

// ============ webhooks ============
const webhooks = program
  .command('webhooks')
  .description('Manage webhooks')

webhooks
  .command('list')
  .description('List registered webhooks')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const client = getClient()
    const spinner = ora('Fetching webhooks...').start()
    try {
      const result = await client.listWebhooks()
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const items = result.data?.items || result.data || []
        if (items.length === 0) {
          console.log(chalk.dim('\nNo webhooks registered.\n'))
        } else {
          console.log(chalk.bold(`\n${items.length} Webhooks\n`))
          console.log(webhooksTable(items))
        }
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

webhooks
  .command('create')
  .description('Create a webhook')
  .requiredOption('--url <url>', 'Webhook endpoint URL')
  .requiredOption('--events <events>', 'Comma-separated event types (e.g. action.checkpoint,action.completed,action.failed)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const client = getClient()
    const events = opts.events.split(',').map((e) => e.trim())
    const spinner = ora('Creating webhook...').start()
    try {
      const result = await client.createWebhook(opts.url, events)
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const d = result.data || {}
        console.log(chalk.green('Webhook created.'))
        console.log(`  ${chalk.dim('ID:')}     ${d.id || d.webhook_id || ''}`)
        console.log(`  ${chalk.dim('URL:')}    ${d.url || opts.url}`)
        console.log(`  ${chalk.dim('Events:')} ${(d.events || events).join(', ')}`)
        if (d.secret) {
          console.log()
          console.log(`  ${chalk.bold('Secret:')} ${d.secret}`)
          console.log(chalk.yellow('  Save this secret -- it will not be shown again.'))
        }
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

webhooks
  .command('delete')
  .description('Delete a webhook')
  .option('-y, --yes', 'Skip confirmation')
  .argument('<webhook-id>', 'Webhook ID to delete')
  .action(async (webhookId, opts) => {
    const client = getClient()

    if (!opts.yes) {
      const readline = require('readline')
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
      const answer = await new Promise((resolve) => {
        rl.question(chalk.yellow(`Delete webhook ${webhookId}? [y/N] `), resolve)
      })
      rl.close()
      if (answer.toLowerCase() !== 'y') {
        console.error('Aborted.')
        process.exit(0)
      }
    }

    const spinner = ora('Deleting webhook...').start()
    try {
      await client.deleteWebhook(webhookId)
      spinner.stop()
      console.log(chalk.green(`Webhook ${webhookId} deleted.`))
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

// ============ aliases ============
const aliases = program
  .command('aliases')
  .description('Manage brand aliases (alternate spellings/abbreviations of your brand name)')

aliases
  .command('list')
  .description('List brand aliases')
  .option('-p, --project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Fetching aliases...').start()
    try {
      const result = await client.listAliases(projectId)
      spinner.stop()
      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const d = result.data || {}
        const items = d.aliases || []
        console.log(chalk.bold(`\n${items.length} Aliases for ${chalk.cyan(d.brand_name || 'brand')} (${d.remaining ?? '?'} of ${d.limit ?? '?'} remaining)\n`))
        if (items.length === 0) {
          console.log(chalk.dim('  No aliases. Run `topify aliases add <text>` to add one.'))
        } else {
          items.forEach((a, i) => {
            console.log(`  ${chalk.dim(`${i + 1}.`)} ${a.name} ${chalk.dim(`[${a.match_type}]`)}`)
          })
        }
        console.log()
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

aliases
  .command('add')
  .description('Add a brand alias')
  .option('-p, --project <id>', 'Project ID')
  .option('--match-type <type>', 'Match type: fuzzy (default) or exact', 'fuzzy')
  .option('--json', 'Output as JSON')
  .argument('<alias>', 'The alias text to add')
  .addHelpText('after', `
Examples:
  $ topify aliases add "LadyM"
  $ topify aliases add "Apple Inc" --match-type exact

Match types:
  fuzzy   Default. Tolerates capitalization and whitespace differences.
  exact   Requires whole-word match. Use for brand names that overlap with common words.`)
  .action(async (alias, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora(`Adding alias "${alias}"...`).start()
    try {
      const result = await client.addAlias(projectId, alias, opts.matchType)
      spinner.stop()
      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const d = result.data || {}
        console.log(chalk.green(`Added "${alias}" [${opts.matchType}]. ${d.aliases?.length || 0}/${d.limit || 20} aliases.`))
        if (d.message) console.log(chalk.dim(`  ${d.message}`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

aliases
  .command('update')
  .description('Rename an existing alias and/or change its match_type')
  .option('-p, --project <id>', 'Project ID')
  .requiredOption('--to <new>', 'New alias text')
  .option('--match-type <type>', 'Optional new match_type (fuzzy or exact)')
  .option('--json', 'Output as JSON')
  .argument('<original>', 'Existing alias text (case-insensitive match)')
  .addHelpText('after', `
Examples:
  $ topify aliases update "LadyM" --to "Lady M"
  $ topify aliases update "Apple" --to "Apple Inc" --match-type exact`)
  .action(async (original, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)
    const spinner = ora('Updating alias...').start()
    try {
      const result = await client.updateAlias(projectId, original, opts.to, opts.matchType || null)
      spinner.stop()
      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const d = result.data || {}
        console.log(chalk.green(`Renamed "${original}" -> "${opts.to}".`))
        if (d.message) console.log(chalk.dim(`  ${d.message}`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

aliases
  .command('delete')
  .description('Delete a brand alias')
  .option('-p, --project <id>', 'Project ID')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .argument('<alias>', 'Alias text to delete (case-insensitive match)')
  .action(async (alias, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)

    if (!opts.yes) {
      const readline = require('readline')
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
      const answer = await new Promise((resolve) => {
        rl.question(chalk.yellow(`Delete alias "${alias}"? [y/N] `), resolve)
      })
      rl.close()
      if (answer.toLowerCase() !== 'y') {
        console.error('Aborted.')
        process.exit(0)
      }
    }

    const spinner = ora('Deleting alias...').start()
    try {
      const result = await client.deleteAlias(projectId, alias)
      spinner.stop()
      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const d = result.data || {}
        console.log(chalk.green(`Deleted "${alias}". ${d.aliases?.length || 0} alias(es) remaining.`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

program.parse()
