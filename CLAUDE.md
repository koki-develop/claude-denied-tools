# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `bun install` - Install dependencies
- `bun run test` - Run tests with Vitest
- `bun run lint` - Check code with Biome linter
- `bun run fmt` - Format code with Biome (auto-fix with prebuild hook)
- `bun run build` - Build the action with @vercel/ncc (outputs to `dist/`)

### Release Process
1. Build the action: `bun run build`
2. Add dist files: `git add dist/index.js dist/index.js.map dist/licenses.txt`
3. Commit changes: `git commit -m "Build"`
4. Trigger release workflow:
   - Patch: `gh workflow run release.yml -f level=patch`
   - Minor: `gh workflow run release.yml -f level=minor`
   - Major: `gh workflow run release.yml -f level=major`

## Architecture

This is a GitHub Action that monitors Claude Code execution logs and reports denied tool permissions to PRs/Issues.

### Core Components

**Entry Point** (`src/main.ts`):
- Reads GitHub Action inputs: `github-token`, `claude-code-execution-file`, `sticky-comment`, and `skip-comment`
- Instantiates Action class with configuration
- Handles errors and sets action failure status
- Returns outputs: `report` (markdown report) and `denied-tools` (JSON list)

**Action Logic** (`src/lib/action.ts`):
- Main orchestrator that processes Claude Code execution logs
- Extracts denied tool uses from SDK message logs
- Creates or updates PR/Issue comments with denied tools report (can be disabled with `skip-comment`)
- Renders reports as collapsible markdown sections with tool details
- Supports sticky comments mode to update existing comments across runs

**GitHub API** (`src/lib/github.ts`):
- Wrapper around GitHub's Octokit API
- Handles PR/Issue comment operations (list, create, update)
- Manages authentication and repository context

### Key Implementation Details

- **Tool Denial Detection**: Parses Claude Code SDK messages looking for:
  - Tool use attempts in assistant messages (`tool_use` content type)
  - Permission denial errors in user messages (specific error pattern)
  
- **Comment Management**: 
  - Uses HTML comment markers (`<!-- CLAUDE_DENIED_TOOLS -->`) to identify bot comments
  - Stores report data as JSON in HTML comments for persistence
  - Updates existing comments with new reports rather than creating duplicates

- **Report Format**: Collapsible sections showing:
  - GitHub Actions run ID with link
  - Table of denied tools with their input parameters
  - Accumulates reports across multiple runs in single comment

### Dependencies
- `@actions/core` - GitHub Actions toolkit
- `@actions/github` - GitHub API client
- `@anthropic-ai/claude-code` - Claude Code SDK types

### Build System
- Uses Bun as package manager and runtime
- TypeScript with ESNext target
- Biome for linting and formatting
- @vercel/ncc for bundling into single file
- Husky for git hooks

### GitHub Action Configuration
- `github-token`: GitHub token for API access (defaults to `github.token`)
- `claude-code-execution-file`: Path to Claude Code execution log file (required)
- `sticky-comment`: Update existing comment instead of creating new ones (default: false)
- `skip-comment`: Skip creating/updating PR/Issue comments (default: false)