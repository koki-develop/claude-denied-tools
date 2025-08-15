import fs from "node:fs";
import * as github from "@actions/github";
import type { SDKMessage } from "@anthropic-ai/claude-code";
import { type Comment, GitHub } from "./github";

type ActionConfig = {
  githubToken: string;
};

type ActionInputs = {
  claudeCodeExecutionFile: string;
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
    const issueNumber = this._getIssueNumber();

    const logs = this._readClaudeCodeExecutionFile(
      inputs.claudeCodeExecutionFile,
    );
    const deniedTools = this._extractDeniedTools(logs);
    const report: Report = {
      runId: github.context.runId,
      deniedTools,
    };

    const comment = await this._getLatestComment(issueNumber);
    if (comment) {
      // Update existing comment with new report
      const reports = this._extractReports(comment);
      const rendered = this._renderReports([...reports, report]);
      await this._gh.updateComment({
        commentId: comment.id,
        body: rendered,
      });
    } else {
      // Create new comment
      const reports = [report];
      await this._gh.createComment({
        issueNumber: issueNumber,
        body: this._renderReports(reports),
      });
    }
  }

  _getIssueNumber(): number {
    const eventName = github.context.eventName;
    const payload = github.context.payload;

    switch (eventName) {
      case "pull_request":
      case "pull_request_review":
      case "pull_request_review_comment":
        // For PR events, use payload.pull_request?.number
        if (payload.pull_request?.number) {
          return payload.pull_request.number;
        }
        break;

      case "issue_comment":
      case "issues":
        // For Issue or Issue comment events, use payload.issue?.number
        // Note: issue_comment uses the same property for both PR comments and Issue comments
        if (payload.issue?.number) {
          return payload.issue.number;
        }
        break;
    }

    throw new Error(`Unable to get PR/Issue number from event: ${eventName}`);
  }

  _readClaudeCodeExecutionFile(filePath: string): SDKMessage[] {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  }

  _extractDeniedTools(logs: SDKMessage[]): ToolUse[] {
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
          }
        }
      }

      // Find permission denial errors in user messages
      if (log.type === "user" && Array.isArray(log.message.content)) {
        for (const item of log.message.content) {
          if (
            item.type === "tool_result" &&
            item.is_error &&
            item.content &&
            item.content.startsWith("Claude requested permissions to use ") &&
            item.content.endsWith(", but you haven't granted it yet.")
          ) {
            deniedToolUseIds.push(item.tool_use_id);
          }
        }
      }
    }

    return deniedToolUseIds.map((id) => toolUses[id]);
  }

  async _getLatestComment(issueNumber: number): Promise<Comment | null> {
    const comments = await this._gh.listIssueComments({
      issueNumber,
    });

    // Search in reverse order (from newest to oldest)
    for (const comment of comments.reverse()) {
      if (comment.body?.trim().endsWith("<!-- CLAUDE_DENIED_TOOLS -->")) {
        return comment;
      }
    }

    return null;
  }

  _extractReports(comment: Comment): Report[] {
    if (comment.body == null) {
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
        return [];
      }
      return reports;
    } catch {
      return [];
    }
  }

  _renderReports(reports: Report[]): string {
    const lines: string[] = [];

    // Header
    lines.push("## 🚫 Permission Denied Tool Executions");
    lines.push("");
    lines.push(
      "The following tool executions that Claude Code attempted were blocked due to insufficient permissions.",
    );
    lines.push("Consider adding them to `allowed_tools` if needed.");
    lines.push("");

    // Each report as collapsible section
    for (const report of reports) {
      if (report.deniedTools.length === 0) {
        continue;
      }

      const owner = github.context.repo.owner;
      const repo = github.context.repo.repo;
      const runUrl = `https://github.com/${owner}/${repo}/actions/runs/${report.runId}`;
      const toolCount = report.deniedTools.length;
      const toolText = toolCount === 1 ? "1 tool" : `${toolCount} tools`;

      lines.push("<details>");
      lines.push(
        `<summary>Run <a href="${runUrl}">#${report.runId}</a> - ${toolText} denied</summary>`,
      );
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

      lines.push("");
      lines.push("</details>");
      lines.push("");
    }

    // Metadata for future parsing
    lines.push(`<!-- ${JSON.stringify(reports)} -->`);
    lines.push("<!-- CLAUDE_DENIED_TOOLS -->");

    return lines.join("\n");
  }
}
