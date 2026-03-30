#!/usr/bin/env node

const { Command } = require('commander')
const chalk = require('chalk')
const ora = require('ora')
const { TopifyAPI } = require('../src/api')
const { getApiKey, setApiKey, getDefaultProject, setDefaultProject, clearConfig } = require('../src/config')
const { projectsTable, competitorsTable, overviewTable, sourcesTable, jsonOutput } = require('../src/format')

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
        console.log(jsonOutput(result.data))
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
program
  .command('competitors')
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
        console.log(jsonOutput(result.data))
      } else {
        const competitors = result.data?.active_competitors || []
        console.log(chalk.bold(`\nCompetitors (last ${opts.days} days) — ${competitors.length} brands\n`))
        console.log(competitorsTable(competitors))
      }
    } catch (error) {
      spinner.fail(chalk.red(error.message))
      process.exit(1)
    }
  })

// ============ prompts ============
program
  .command('prompts')
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
        const prompts = result.data?.items || result.data || []
        console.log(chalk.bold(`\n${prompts.length} Prompts\n`))
        prompts.slice(0, 30).forEach((p, i) => {
          console.log(`  ${chalk.dim(i + 1 + '.')} ${p.content || p.keyword || '—'}`)
        })
        if (prompts.length > 30) {
          console.log(chalk.dim(`\n  ... and ${prompts.length - 30} more. Use --json for full output.`))
        }
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
