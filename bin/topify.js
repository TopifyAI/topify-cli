#!/usr/bin/env node

const { Command } = require('commander')
const chalk = require('chalk')
const ora = require('ora')
const { TopifyAPI } = require('../src/api')
const { getApiKey, setApiKey, getDefaultProject, setDefaultProject, clearConfig } = require('../src/config')
const { projectsTable, competitorsTable, overviewTable, sourcesTable, jsonOutput, slimOverview, slimCompetitors } = require('../src/format')

const program = new Command()

program
  .name('topify')
  .description('Topify AI Visibility CLI - Monitor your brand in AI search results')
  .version('0.1.0')

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
program
  .command('projects')
  .description('List all projects')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const client = getClient()
    const spinner = ora('Fetching projects...').start()
    try {
      const result = await client.listProjects()
      spinner.stop()
      const projects = result.data || []

      if (opts.json) {
        console.log(jsonOutput(projects))
      } else {
        console.log(chalk.bold(`\n${projects.length} Projects\n`))
        console.log(projectsTable(projects))
        console.log(chalk.dim(`\nTip: Set a default project with: topify config --default-project <id>`))
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
      const result = await client.listPrompts(projectId, {
        page: opts.page,
        pageSize: opts.pageSize,
      })
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        const items = result.data?.items || result.data || []
        console.log(chalk.bold(`\n${items.length} Prompts\n`))
        items.slice(0, 30).forEach((p, i) => {
          console.log(`  ${chalk.dim(i + 1 + '.')} ${p.content || p.keyword || '—'}`)
        })
        if (items.length > 30) {
          console.log(chalk.dim(`\n  ... and ${items.length - 30} more. Use --json for full output.`))
        }
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
  .command('delete')
  .description('Delete a prompt')
  .option('-p, --project <id>', 'Project ID')
  .option('-y, --yes', 'Skip confirmation')
  .option('--json', 'Output as JSON')
  .argument('<prompt-id>', 'Prompt ID to delete')
  .action(async (promptId, opts) => {
    const client = getClient()
    const projectId = resolveProject(opts)

    if (!opts.yes) {
      const readline = require('readline')
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
      const answer = await new Promise((resolve) => {
        rl.question(chalk.yellow(`Delete prompt ${promptId}? [y/N] `), resolve)
      })
      rl.close()
      if (answer.toLowerCase() !== 'y') {
        console.error('Aborted.')
        process.exit(0)
      }
    }

    const spinner = ora('Deleting prompt...').start()
    try {
      const result = await client.deletePrompt(projectId, promptId)
      spinner.stop()

      if (opts.json) {
        console.log(jsonOutput(result.data))
      } else {
        console.log(chalk.green(`Prompt ${promptId} deleted.`))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

// ============ sources ============
program
  .command('sources')
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

program.parse()
