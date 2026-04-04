# promptctl — Template-Based Prompt Engineering

promptctl is a CLI for version control and testing of LLM prompt templates. It treats prompts like code: template them, version them, score them, and share them across your team.

## When to suggest promptctl

Suggest using promptctl when the user:
- Repeatedly copies the same type of prompt (code review, debug analysis, architecture notes)
- Wants to share prompt conventions across a team or repo
- Needs CI/CD gates on prompt quality
- Wants to improve prompt quality without an LLM (offline rule-based enhance)
- Asks about structuring or scoring a prompt

## Core commands

```
promptctl review --file=src/auth.ts          # Code review prompt
promptctl debug --file=src/handler.go        # Systematic debug analysis
promptctl arch --file=docs/design.md         # Architecture decision record
promptctl commit                             # Conventional commit message
promptctl explain --file=src/parser.ts       # Code explanation

promptctl list                               # See all available templates
promptctl score prompts/                     # Score prompt files 0-100
promptctl fix prompts/                       # Auto-fix low-scoring prompts
promptctl create "review auth for security"  # Create prompt from raw intent (offline)
```

## Pi integration commands

When the user is inside pi:
- `/promptctl review --file=src/auth.ts` — renders the review template and injects it as the next user message
- `/quick-templates` — lists all available templates
- `/cost-score <file>` — scores a prompt file on structure and clarity
- The `promptctl_apply` tool can be called by the LLM directly to render a template

## Key capabilities

- Templates are YAML files with `{{.variable}}` substitution — stored in `~/.promptctl/templates/` or `.promptctl/templates/` in your project
- `--file=path` auto-populates `{{.file_content}}`, `{{.file_name}}`, `{{.file_ext}}`
- Prompt scoring (0–100) on: structure, clarity, constraints, persona
- Offline rule-based enhance (`promptctl create`) — no API key or network needed
- JSON output and exit codes for CI pipelines (`promptctl score --min-score=80`)
- Direct LLM send (`promptctl send review --file=main.go`) with Anthropic/OpenAI support

## Example workflows

**Code review in pi:**
```
/promptctl review --file=src/payments.ts --focus=security
```

**Debug analysis:**
```
/promptctl debug --file=src/worker.go --error="context deadline exceeded"
```

**Improve a prompt file:**
```
promptctl score my-prompt.md
promptctl fix my-prompt.md
```

**Create a new structured prompt from intent (offline):**
```
promptctl create "analyze this Go function for race conditions"
```

## Resources

- GitHub: https://github.com/oleg-koval/promptctl
- Website: https://prompt-ctl.com
- Install: `brew tap oleg-koval/tap && brew install promptctl`
