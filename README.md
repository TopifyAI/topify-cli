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
topify prompts inspect <prompt-id> --days 30
topify prompts inspect <prompt-id> --include analytics,chats,domains,urls --providers chatgpt --json
topify prompts create --topic-id <id> "best CRM for startups"
topify prompts update <id> --content "new text"
```

### Recordings - URLs used for prompt discovery

```bash
topify recording list
topify recording add https://example.com/blog/post
topify recording generate-prompts https://example.com/blog/post
```

### Actions — AI-recommended improvements

```bash
topify actions list                    # list action items
topify actions list --status suggested # filter by status
topify actions get <id>                # view action details
topify actions recommend               # trigger new recommendations
topify actions task <task-id>          # check recommendation progress
topify actions accept <id>             # accept an action
topify actions complete <id>           # mark as completed
topify actions ignore <id> --reason "not relevant"
topify actions enrich-content <id>     # generate content edits
topify actions enrich-forum <id>       # generate a forum comment
topify actions execute <id>            # start execution workflow
topify actions respond <id> \
  --workflow-id <wf-id> \
  --decision approve                   # respond to a checkpoint
```

### Webhooks

```bash
topify webhooks list                   # list registered webhooks
topify webhooks create \
  --url https://example.com/hook \
  --events action.checkpoint,action.completed
topify webhooks delete <id>
```

### Other commands

```bash
topify sources                         # domains cited in AI responses
topify topics                          # prompt topic groups
topify trends --days 30                # visibility over time
```

## Actions (agent-friendly)

For coding-agent workflows (e.g. Claude Code), Topify exposes a read surface
that tells the agent exactly what state an action is in and what to do next:

```bash
# What state is this action in? What can I do next?
topify actions state <action-id>

# What named outputs does it have for me to read?
topify actions artifacts <action-id>

# Read one named artifact (research, outline, article, thread, comment, edits)
topify actions artifact <action-id> article
topify actions artifact <action-id> thread --json

# Article publish kit -> drop straight into your static site repo
topify actions artifact <action-id> article \
  --save content/posts/your-slug/index.md
```

The `--save` flag (only meaningful for `name=article`) writes the full markdown
body with a YAML frontmatter block at the top, ready to commit + deploy from
your existing CI. The `schema_jsonld` is printed separately for you to embed
in your page `<head>`.

End-to-end agent flow:

```bash
topify actions list                                 # find actions to work on
topify actions state <id>                           # check state + next steps
topify actions execute <id>                         # start the workflow
topify actions state <id>                           # poll until checkpoint
topify actions artifact <id> research               # review research
topify actions respond <id> --workflow-id <wf> \
                            --decision approve      # approve checkpoint
# ... approve outline ...
topify actions artifact <id> article \
  --save content/posts/<slug>/index.md              # save article
git add . && git commit && git push                 # deploy from your repo
topify actions complete <id>                        # close the loop
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
