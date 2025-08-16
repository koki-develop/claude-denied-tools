# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Setup
- `bun install --frozen-lockfile` - Install dependencies with lock file

### Development
- `bun run test` - Run all tests with Vitest
- `bun run test src/lib/action.spec.ts` - Run a specific test file
- `bun run lint` - Check code with Biome linter
- `bun run fmt` - Format code with Biome (automatically runs before build)
- `bun run build` - Build the action with @vercel/ncc (outputs to `dist/`)

### Release Process
Releases are managed automatically via release-please workflow when changes are pushed to main branch.
- The workflow creates release PRs automatically
- Merging a release PR triggers a new release
- Major version tags are synchronized automatically after release

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