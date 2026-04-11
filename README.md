# Topify CLI

Monitor your brand's AI visibility from the command line.

## Install

```bash
npm install -g topify-cli
```

## Quick Start

```bash
# 1. Set your API key (get it at https://app.topify.ai → Settings → API Keys)
topify config --api-key tk_live_xxxxxxxxxxxxx

# 2. List your projects
topify projects

# 3. Set a default project so you don't have to pass --project every time
topify config --default-project <project-id>

# 4. Check your brand visibility
topify overview
```

### New user? Create a project from the CLI

If you don't have a project yet, you can create one directly:

```bash
topify projects create --brand "Acme Corp" --website acme.com --webhook https://example.com/hook
```

This kicks off Topify's brand tracking pipeline. You'll receive a webhook notification when setup is complete. Then set it as your default:

```bash
topify config --default-project <project-id>
```

## Commands

### Projects

```bash
topify projects                        # list all projects
topify projects create \
  --brand "Acme" --website acme.com \
  --webhook https://example.com/hook   # create a new project
```

### Overview — visibility summary across all prompts

```bash
topify overview                        # last 7 days
topify overview --days 30              # last 30 days
topify overview --from 2026-03-01 --to 2026-03-15
```

### Competitors

```bash
topify competitors list                # list competitors and metrics
topify competitors list --days 30
topify competitors create "Acme:acme.com" "Globex:globex.net"
topify competitors update <id> --name "New Name" --website new.com
topify competitors delete <id>
```

### Prompts — tracked search queries

```bash
topify prompts list                    # list tracked prompts
topify prompts create --topic-id <id> "best CRM for startups"
topify prompts update <id> --content "new text"
topify prompts delete <id>
```

### Other commands

```bash
topify sources                         # domains cited in AI responses
topify topics                          # prompt topic groups
topify trends --days 30                # visibility over time
```

## Options

All data commands support:
- `-p, --project <id>` — specify project (or use default)
- `-d, --days <n>` — lookback period (default: 7)
- `--from <date>` / `--to <date>` — date range (YYYY-MM-DD)
- `--providers <list>` — filter by provider (chatgpt, perplexity, google_ai_overview)
- `--json` — output raw JSON

## Environment Variable

You can also set your API key via environment variable:

```bash
export TOPIFY_API_KEY=tk_live_xxxxxxxxxxxxx
```

## Use with Claude Code

Add to your project's `CLAUDE.md`:

```markdown
## Topify AI Visibility
Run `topify` commands to check brand visibility in AI search.
API key is configured via `topify config`.
```

Then ask Claude: "Show my brand visibility for the last 30 days"

## API Documentation

https://docs.topify.ai/api-reference/public/introduction
