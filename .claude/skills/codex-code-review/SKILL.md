---
name: codex-code-review
description: >
  Adversarial code review via OpenAI Codex CLI. Sends the full implementation diff
  for a completed epic to Codex for security audit, bug hunting, performance analysis,
  and code quality review. Uses a non-Claude model to reduce confirmation bias.
  Invoke after all work units are implemented and tests pass, before human testing.
  Triggers: "codex code review", "adversarial review", "codex challenge code",
  /codex-code-review.
---

# Codex Code Review

You are orchestrating an adversarial code review using OpenAI Codex CLI. The goal is to have a non-Claude model try to find bugs, security issues, and quality problems in code that Claude wrote — catching the blind spots that come from the same model building and reviewing its own work.

## When to Run

- After all work units for an epic are implemented and passing tests
- Before human testing and PR creation
- When the user invokes `/codex-code-review`

## Step 1 — Identify the scope

Determine what code to review:

```bash
# Find the merge base with dev to see all changes in this feature
MERGE_BASE=$(git merge-base dev HEAD)
echo "Reviewing all changes since: $MERGE_BASE"

# Summary of changes
git diff --stat $MERGE_BASE..HEAD

# Count of files changed
git diff --name-only $MERGE_BASE..HEAD | wc -l
```

Report the scope to the user: number of files, lines changed, areas touched.

## Step 2 — Generate the diff

```bash
MERGE_BASE=$(git merge-base dev HEAD)
git diff $MERGE_BASE..HEAD > /tmp/codex-code-review-diff.patch
```

If the diff is very large (>5000 lines), split by area:
```bash
# Generate per-directory diffs for readability
for dir in src/components src/services src/hooks supabase/functions supabase/migrations; do
  git diff $MERGE_BASE..HEAD -- "$dir" > "/tmp/codex-review-${dir//\//-}.patch" 2>/dev/null
done
```

## Step 3 — Locate the plan

```bash
ls -t docs/superpowers/plans/*.md | head -5
```

Read the plan file to understand the intent behind the code.

## Step 4 — Prepare the review prompt

```bash
cat > /tmp/codex-code-review-prompt.md << 'PROMPT_EOF'
You are an adversarial code reviewer. Your job is to find bugs, security holes,
performance issues, and quality problems. Assume the code was written by an AI
and may have subtle issues that look correct at first glance. Be thorough and specific.

## Project context

React 18 + TypeScript + Vite application with Supabase backend (PostgreSQL + Edge Functions).
Multi-tenant insurance SaaS with Row Level Security. Design system: Scandinavian Minimalism.

## Review criteria

### Security (CRITICAL)
- RLS policy gaps — any table missing tenant_id filtering?
- Auth bypass — can unauthenticated users reach protected data?
- Tenant leakage — can user A see user B's data through any query path?
- SQL injection — any raw string interpolation in queries?
- XSS — any dangerouslySetInnerHTML or unescaped user input?
- Secrets — any API keys, tokens, or credentials in client-side code?

### Correctness
- Logic errors — off-by-one, wrong comparisons, missing null checks
- Race conditions — concurrent state updates, stale closures in useEffect
- Error handling — uncaught promises, missing try/catch, swallowed errors
- Edge cases — empty arrays, undefined properties, zero-length strings
- Type safety — any `as any` casts, non-null assertions that could fail

### Performance
- N+1 queries — loops that make individual DB calls
- Unbounded fetches — SELECT without LIMIT, missing pagination
- Unnecessary re-renders — missing useMemo/useCallback where needed
- Bundle size — large imports that could be lazy loaded
- Missing indexes — queries that filter on un-indexed columns

### Code quality
- Dead code — unused imports, unreachable branches, commented-out code
- Duplication — copy-pasted logic that should be extracted
- Naming — misleading variable/function names
- Missing tests — functionality without corresponding test coverage

### Database (if migrations present)
- Non-idempotent DDL (missing IF NOT EXISTS / IF EXISTS)
- Missing RLS policies on new tables
- Missing indexes on foreign keys or frequently filtered columns
- Missing variable_registry entries for new columns used in templates

## Output format

For each finding:
- **File**: exact file path and line range
- **Category**: security | correctness | performance | quality | database
- **Severity**: critical (must fix) | bug (should fix) | improvement (nice to have)
- **Finding**: what's wrong (be specific, quote the code)
- **Fix**: what to do about it (be specific, show corrected code if possible)

End with:
- Overall code quality score (1-10)
- Top 3 highest-risk areas
- Files that need the most attention
- Verdict: safe to ship / needs fixes before shipping / needs significant rework

PROMPT_EOF
```

## Step 5 — Append the diff and plan

```bash
echo "" >> /tmp/codex-code-review-prompt.md
echo "## Plan (intent behind this code)" >> /tmp/codex-code-review-prompt.md
echo "" >> /tmp/codex-code-review-prompt.md
cat "<plan-file-path>" >> /tmp/codex-code-review-prompt.md
echo "" >> /tmp/codex-code-review-prompt.md
echo "## Code diff to review" >> /tmp/codex-code-review-prompt.md
echo "" >> /tmp/codex-code-review-prompt.md
cat /tmp/codex-code-review-diff.patch >> /tmp/codex-code-review-prompt.md
```

## Step 6 — Run Codex

```bash
cd <project-root>
codex --model gpt-5.4-high --quiet "Read the file /tmp/codex-code-review-prompt.md. It contains a code review prompt, a development plan, and a code diff. Perform an adversarial code review following the criteria specified. Be specific — cite exact files, line numbers, and code snippets." 2>&1 | tee /tmp/codex-code-review-output.md
```

If the diff is very large, run Codex directly against the repo instead:
```bash
codex --model gpt-5.4-high --quiet "You are doing an adversarial code review. Read /tmp/codex-code-review-prompt.md for review criteria and the plan. Then examine the actual source files in this repo that were changed (listed in the diff). Focus on security, correctness, and performance. Be specific." 2>&1 | tee /tmp/codex-code-review-output.md
```

If Codex fails or can't process the input, instruct the user to run it manually in a second terminal.

## Step 7 — Present findings

Read and present the output organized by severity:
1. **Critical findings** — must fix before PR
2. **Bug findings** — should fix before PR
3. **Improvements** — fix if time allows
4. Your (Claude's) assessment of each finding — agree or disagree with reasoning

## Step 8 — Save review output

```bash
cp /tmp/codex-code-review-output.md docs/superpowers/plans/YYYY-MM-DD-<slug>-codex-code-review.md
```

Do NOT commit — review artifacts are working files that will be committed with the PR.

## What NOT to do

- Do NOT implement fixes during this step — this is review only
- Do NOT dismiss findings without explanation
- Do NOT run this before all work units are complete — partial reviews waste Codex's analysis
- Do NOT use Claude models — the value is cross-model verification

## After Review

Tell the user: "Codex code review is complete. Use the **Code Review Triage** template (`docs/superpowers/templates/code-review-triage.md`) to categorize findings, create sub-issues for fixes, and implement changes."

**Print the inputs for the next step on the screen** for the human to easily copy/paste into the next template:
- **Plan path:** (use actual path)
- **Codex code review output path:** `docs/superpowers/plans/YYYY-MM-DD-<slug>-codex-code-review.md` (use actual path)
- **Feature branch:** (use actual branch name)
- **Epic name:** (use actual epic name)
- **GitHub epic issue:** #<number> (use actual issue number)
