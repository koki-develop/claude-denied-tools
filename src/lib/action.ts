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
  skipComment: boolean;
};

type ActionOutputs = {
  report: string;
  deniedTools: ToolUse[];
};

type Report = {
  runId: number;
  deniedTools: ToolUse[];
};

type ToolUse = {
  name: string;
  input: Record<string, unknown>;
};

function commentFooter(reports: Report[]) {
  const lines = [
    "",
    `<!-- ${JSON.stringify(reports)} -->`,
    "<!-- CLAUDE_DENIED_TOOLS -->",
  ];
  return lines.join("\n");
}

export class Action {
  private readonly _gh: GitHub;

  constructor(config: ActionConfig) {
    this._gh = new GitHub({
      token: config.githubToken,
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
    });
  }

  async run(inputs: ActionInputs): Promise<ActionOutputs> {
    const issueNumber = this._getIssueNumber();
    core.info(`Issue/PR number: ${issueNumber}`);

    const logs = this._readClaudeCodeExecutionFile(
      inputs.claudeCodeExecutionFile,
    );
    core.info(`Read ${logs.length} SDK messages from execution file`);

    const deniedTools = this._extractDeniedTools(logs);
    core.info(`Found ${deniedTools.length} denied tool uses`);
    if (deniedTools.length > 0) {
      core.debug(
        `Denied tools: ${JSON.stringify(deniedTools.map((t) => t.name))}`,
      );
    } else {
      core.info("No denied tools found");
      return { report: "No denied tools found", deniedTools: [] };
    }

    const report: Report = {
      runId: github.context.runId,
      deniedTools,
    };

    // Skip comment creation if requested
    if (inputs.skipComment) {
      core.info("Skipping comment creation");
      return { report: this._renderReports([report]), deniedTools };
    }

    if (inputs.stickyComment) {
      const comment = await this._getLatestComment(issueNumber);
      if (comment) {
        core.info(`Found existing comment (ID: ${comment.id})`);
        // Update existing comment with new report
        const reports = this._extractReports(comment);
        core.info(`Extracted ${reports.length} existing reports from comment`);
        const rendered = this._renderReports([report, ...reports]);
        await this._gh.updateComment({
          commentId: comment.id,
          body: rendered + commentFooter([report, ...reports]),
        });
        core.info(`Updated comment ${comment.id} with new report`);
        return { report: rendered, deniedTools };
      }
      core.info("No existing comment found, creating new one");
    }

    // Create new comment
    const rendered = this._renderReports([report]);
    await this._gh.createComment({
      issueNumber: issueNumber,
      body: rendered + commentFooter([report]),
    });
    core.info(`Created new comment on issue/PR #${issueNumber}`);
    return { report: rendered, deniedTools };
  }

  private _getIssueNumber(): number {
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

  private _readClaudeCodeExecutionFile(filePath: string): SDKMessage[] {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  }

  private _extractDeniedTools(logs: SDKMessage[]): ToolUse[] {
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
          if (item.type === "tool_result" && item.is_error && item.content) {
            if (
              item.content.endsWith(" but you haven't granted it yet.") ||
              item.content.includes(" requires approval") ||
              item.content.includes(" require approval") ||
              item.content.endsWith(" has been denied.")
            ) {
              deniedToolUseIds.push(item.tool_use_id);
            }
          }
        }
      }
    }

    return deniedToolUseIds.map((id) => toolUses[id]);
  }

  private async _getLatestComment(
    issueNumber: number,
  ): Promise<Comment | null> {
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

  private _extractReports(comment: Comment): Report[] {
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

  private _renderReports(reports: Report[]): string {
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
        continue;
      }

      const runUrl = `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}/actions/runs/${report.runId}`;
      const toolText =
        report.deniedTools.length === 1
          ? "1 tool"
          : `${report.deniedTools.length} tools`;
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

    return lines.join("\n");
  }
}
