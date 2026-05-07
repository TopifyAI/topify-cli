# Topify CLI

Monitor your brand's AI visibility from the command line.

## Install

```bash
npm install -g @topify/cli
```

## Setup

```bash
# Set your API key (get it at https://app.topify.ai → Settings → API Keys)
topify config --api-key tk_live_xxxxxxxxxxxxx

# Set a default project
topify projects                              # list all projects
topify config --default-project <project-id> # set default
```

## Commands

```bash
# Projects
topify projects              # list all projects

# Overview — visibility summary across all prompts
topify overview              # last 7 days
topify overview --days 30    # last 30 days
topify overview --from 2026-03-01 --to 2026-03-15

# Competitors — ranked by visibility
topify competitors
topify competitors --days 30

# Prompts — tracked search queries
topify prompts

# Sources — domains cited in AI responses
topify sources
topify sources --days 30

# Topics — prompt groupings
topify topics

# Trends — visibility over time
topify trends --days 30 --json
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
