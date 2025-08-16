import fs from "node:fs";
import * as core from "@actions/core";
import * as github from "@actions/github";
import type { SDKMessage } from "@anthropic-ai/claude-code";
import { type Comment, GitHub } from "./github";

type ActionConfig = {
  githubToken: string;
};

type ActionInputs = {
  claudeCodeExecutionFile: string;
  stickyComment: boolean;
};

type Report = {
  runId: number;
  deniedTools: ToolUse[];
};

type ToolUse = {
  name: string;
  input: Record<string, unknown>;
};

export class Action {
  private readonly _gh: GitHub;

  constructor(config: ActionConfig) {
    this._gh = new GitHub({
      token: config.githubToken,
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
    });
  }

  async run(inputs: ActionInputs): Promise<void> {
    core.debug("Starting Action.run()");
    core.debug(`Input file: ${inputs.claudeCodeExecutionFile}`);

    const issueNumber = this._getIssueNumber();
    core.debug(`Issue/PR number: ${issueNumber}`);

    const logs = this._readClaudeCodeExecutionFile(
      inputs.claudeCodeExecutionFile,
    );
    core.debug(`Read ${logs.length} SDK messages from execution file`);

    const deniedTools = this._extractDeniedTools(logs);
    core.debug(`Found ${deniedTools.length} denied tool uses`);
    if (deniedTools.length > 0) {
      core.debug(
        `Denied tools: ${JSON.stringify(deniedTools.map((t) => t.name))}`,
      );
    }

    const report: Report = {
      runId: github.context.runId,
      deniedTools,
    };
    core.debug(`Created report for run ID: ${github.context.runId}`);

    if (inputs.stickyComment) {
      const comment = await this._getLatestComment(issueNumber);
      if (comment) {
        core.debug(`Found existing comment (ID: ${comment.id})`);
        // Update existing comment with new report
        const reports = this._extractReports(comment);
        core.debug(`Extracted ${reports.length} existing reports from comment`);
        const rendered = this._renderReports([report, ...reports]);
        await this._gh.updateComment({
          commentId: comment.id,
          body: rendered,
        });
        core.debug(`Updated comment ${comment.id} with new report`);
        return;
      }
      core.debug("No existing comment found, creating new one");
    }

    // Create new comment
    const reports = [report];
    await this._gh.createComment({
      issueNumber: issueNumber,
      body: this._renderReports(reports),
    });
    core.debug(`Created new comment on issue/PR #${issueNumber}`);
  }

  private _getIssueNumber(): number {
    const eventName = github.context.eventName;
    const payload = github.context.payload;
    core.debug(`GitHub event: ${eventName}`);

    switch (eventName) {
      case "pull_request":
      case "pull_request_review":
      case "pull_request_review_comment":
        // For PR events, use payload.pull_request?.number
        if (payload.pull_request?.number) {
          core.debug(
            `Found PR number from payload: ${payload.pull_request.number}`,
          );
          return payload.pull_request.number;
        }
        break;

      case "issue_comment":
      case "issues":
        // For Issue or Issue comment events, use payload.issue?.number
        // Note: issue_comment uses the same property for both PR comments and Issue comments
        if (payload.issue?.number) {
          core.debug(
            `Found issue number from payload: ${payload.issue.number}`,
          );
          return payload.issue.number;
        }
        break;
    }

    throw new Error(`Unable to get PR/Issue number from event: ${eventName}`);
  }

  private _readClaudeCodeExecutionFile(filePath: string): SDKMessage[] {
    core.debug(`Reading Claude Code execution file: ${filePath}`);
    const content = fs.readFileSync(filePath, "utf-8");
    const messages = JSON.parse(content);
    core.debug(`Successfully parsed ${messages.length} messages`);
    return messages;
  }

  private _extractDeniedTools(logs: SDKMessage[]): ToolUse[] {
    core.debug("Extracting denied tools from SDK messages");
    const toolUses: Record<
      string,
      { name: string; input: Record<string, unknown> }
    > = {};
    const deniedToolUseIds: string[] = [];

    for (const log of logs) {
      // Collect tool use attempts from assistant messages
      if (log.type === "assistant" && Array.isArray(log.message.content)) {
        for (const item of log.message.content) {
          if (item.type === "tool_use") {
            toolUses[item.id] = { name: item.name, input: item.input };
            core.debug(`Found tool use: ${item.name} (ID: ${item.id})`);
          }
        }
      }

      // Find permission denial errors in user messages
      if (log.type === "user" && Array.isArray(log.message.content)) {
        for (const item of log.message.content) {
          if (item.type === "tool_result" && item.is_error && item.content) {
            if (
              item.content.endsWith(" but you haven't granted it yet.") ||
              item.content.includes(" requires approval") ||
              item.content.includes(" require approval") ||
              item.content.endsWith(" has been denied.")
            ) {
              deniedToolUseIds.push(item.tool_use_id);
              core.debug(`Found denied tool use ID: ${item.tool_use_id}`);
              core.debug(`Denial message: ${item.content}`);
            }
          }
        }
      }
    }

    const deniedTools = deniedToolUseIds.map((id) => toolUses[id]);
    core.debug(`Total denied tools found: ${deniedTools.length}`);
    return deniedTools;
  }

  private async _getLatestComment(
    issueNumber: number,
  ): Promise<Comment | null> {
    core.debug(`Fetching comments for issue/PR #${issueNumber}`);
    const comments = await this._gh.listIssueComments({
      issueNumber,
    });
    core.debug(`Found ${comments.length} total comments`);

    // Search in reverse order (from newest to oldest)
    for (const comment of comments.reverse()) {
      if (comment.body?.trim().endsWith("<!-- CLAUDE_DENIED_TOOLS -->")) {
        core.debug(`Found existing bot comment (ID: ${comment.id})`);
        return comment;
      }
    }

    core.debug("No existing bot comment found");
    return null;
  }

  private _extractReports(comment: Comment): Report[] {
    core.debug(`Extracting reports from comment ${comment.id}`);
    if (comment.body == null) {
      core.debug("Comment body is null, returning empty array");
      return [];
    }

    const lines = comment.body.trim().split("\n");
    if (lines.length < 2) {
      return [];
    }

    // JSON is in the second-to-last line
    const jsonLine = lines[lines.length - 2];
    const match = jsonLine.match(/^<!-- (.+) -->$/);
    if (!match) {
      return [];
    }

    try {
      const reports = JSON.parse(match[1]);
      if (!Array.isArray(reports)) {
        core.debug("Parsed data is not an array, returning empty array");
        return [];
      }
      core.debug(`Successfully extracted ${reports.length} reports`);
      return reports;
    } catch (error) {
      core.debug(`Failed to parse reports JSON: ${error}`);
      return [];
    }
  }

  private _renderReports(reports: Report[]): string {
    core.debug(`Rendering ${reports.length} reports`);
    const lines: string[] = [];

    // Header
    lines.push("## 🚫 Permission Denied Tool Executions");
    lines.push("");
    lines.push(
      "The following tool executions that Claude Code attempted were blocked due to insufficient permissions.",
    );
    lines.push("Consider adding them to `allowed_tools` if needed.");

    // Each report as collapsible section
    for (const report of reports) {
      if (report.deniedTools.length === 0) {
        core.debug(`Skipping report for run ${report.runId} (no denied tools)`);
        continue;
      }
      core.debug(
        `Rendering report for run ${report.runId} with ${report.deniedTools.length} denied tools`,
      );

      const owner = github.context.repo.owner;
      const repo = github.context.repo.repo;
      const runUrl = `https://github.com/${owner}/${repo}/actions/runs/${report.runId}`;
      const toolCount = report.deniedTools.length;
      const toolText = toolCount === 1 ? "1 tool" : `${toolCount} tools`;
      const summary = `Run <a href="${runUrl}">#${report.runId}</a> - ${toolText} denied`;

      lines.push("");
      if (reports.length > 1) {
        lines.push("<details>");
        lines.push(`<summary>${summary}</summary>`);
      } else {
        lines.push(summary);
      }

      lines.push("");
      lines.push("| Tool | Input |");
      lines.push("| --- | --- |");

      for (const tool of report.deniedTools) {
        const inputStr = JSON.stringify(tool.input);
        // Escape backticks and pipes for markdown
        const escapedInput = inputStr
          .replace(/`/g, "\\`")
          .replace(/\|/g, "\\|");
        lines.push(`| \`${tool.name}\` | \`${escapedInput}\` |`);
      }

      if (reports.length > 1) {
        lines.push("");
        lines.push("</details>");
      }
    }

    // Metadata for future parsing
    lines.push("");
    lines.push(`<!-- ${JSON.stringify(reports)} -->`);
    lines.push("<!-- CLAUDE_DENIED_TOOLS -->");

    return lines.join("\n");
  }
}
