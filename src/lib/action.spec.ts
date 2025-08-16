import type { Context } from "@actions/github/lib/context";
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-code";
import { describe, expect, it } from "vitest";
import { _extractDeniedTools, _renderReports } from "./action";

describe("_extractDeniedTools", () => {
  it("should extract a single denied tool", () => {
    const logs: SDKMessage[] = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "Bash",
              input: { command: "rm -rf /", description: "Delete everything" },
            },
          ],
        },
      } as SDKAssistantMessage,
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              is_error: true,
              content: "You want to use Bash but you haven't granted it yet.",
            },
          ],
        },
      } as SDKUserMessage,
    ];

    const result = _extractDeniedTools(logs);
    expect(result).toEqual([
      {
        name: "Bash",
        input: { command: "rm -rf /", description: "Delete everything" },
      },
    ]);
  });

  it("should extract multiple denied tools", () => {
    const logs: SDKMessage[] = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "Read",
              input: { file_path: "/etc/passwd" },
            },
            {
              type: "tool_use",
              id: "tool_2",
              name: "Write",
              input: { file_path: "/tmp/test.txt", content: "test content" },
            },
          ],
        },
      } as SDKAssistantMessage,
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              is_error: true,
              content:
                "Claude requested permissions to use Read, but you haven't granted it yet.",
            },
            {
              type: "tool_result",
              tool_use_id: "tool_2",
              is_error: true,
              content:
                "Claude requested permissions to use Write, but you haven't granted it yet.",
            },
          ],
        },
      } as SDKUserMessage,
    ];

    const result = _extractDeniedTools(logs);
    expect(result).toEqual([
      {
        name: "Read",
        input: { file_path: "/etc/passwd" },
      },
      {
        name: "Write",
        input: { file_path: "/tmp/test.txt", content: "test content" },
      },
    ]);
  });

  it("should return empty array when no tools are denied", () => {
    const logs: SDKMessage[] = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "Grep",
              input: { pattern: "test", path: "." },
            },
          ],
        },
      } as SDKAssistantMessage,
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              is_error: false,
              content: "Found 3 matches",
            },
          ],
        },
      } as SDKUserMessage,
    ];

    const result = _extractDeniedTools(logs);

    expect(result).toEqual([]);
  });

  it("should detect 'has been denied' pattern", () => {
    const logs: SDKMessage[] = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "Delete",
              input: { path: "/important/file.txt" },
            },
          ],
        },
      } as SDKAssistantMessage,
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              is_error: true,
              content: "Permission to use Delete has been denied.",
            },
          ],
        },
      } as SDKUserMessage,
    ];

    const result = _extractDeniedTools(logs);
    expect(result).toEqual([
      {
        name: "Delete",
        input: { path: "/important/file.txt" },
      },
    ]);
  });

  it("should not detect non-permission errors", () => {
    const logs: SDKMessage[] = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "Read",
              input: { file_path: "/nonexistent.txt" },
            },
            {
              type: "tool_use",
              id: "tool_2",
              name: "Write",
              input: { file_path: "/tmp/test.txt", content: "test" },
            },
          ],
        },
      } as SDKAssistantMessage,
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              is_error: true,
              content: "File not found",
            },
            {
              type: "tool_result",
              tool_use_id: "tool_2",
              is_error: true,
              content: "Disk is full",
            },
          ],
        },
      } as SDKUserMessage,
    ];

    const result = _extractDeniedTools(logs);
    expect(result).toEqual([]);
  });

  it("should handle multiple messages in sequence", () => {
    const logs: SDKMessage[] = [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "ToolA",
              input: { param: "value1" },
            },
          ],
        },
      } as SDKAssistantMessage,
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              is_error: true,
              content: "This command requires approval",
            },
          ],
        },
      } as SDKUserMessage,
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool_2",
              name: "ToolB",
              input: { param: "value2" },
            },
          ],
        },
      } as SDKAssistantMessage,
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_2",
              is_error: false,
              content: "Success",
            },
          ],
        },
      } as SDKUserMessage,
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool_3",
              name: "ToolC",
              input: { param: "value3" },
            },
          ],
        },
      } as SDKAssistantMessage,
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_3",
              is_error: true,
              content: "You want to use ToolC but you haven't granted it yet.",
            },
          ],
        },
      } as SDKUserMessage,
    ];

    const result = _extractDeniedTools(logs);
    expect(result).toEqual([
      { name: "ToolA", input: { param: "value1" } },
      { name: "ToolC", input: { param: "value3" } },
    ]);
  });
});

describe("_renderReports", () => {
  const context = {
    runId: 123456,
    repo: {
      owner: "test-owner",
      repo: "test-repo",
    },
  } as Context;

  it("should render a single report without collapsible section", () => {
    const reports = [
      {
        runId: 123456,
        deniedTools: [
          { name: "ToolA", input: { param1: "value1", param2: 123 } },
          { name: "ToolB", input: { key: "value" } },
        ],
      },
    ];

    const result = _renderReports(context, reports);

    expect(result).toEqual(
      `
## 🚫 Permission Denied Tool Executions

The following tool executions that Claude Code attempted were blocked due to insufficient permissions.
Consider adding them to \`allowed_tools\` if needed.

Run <a href="https://github.com/test-owner/test-repo/actions/runs/123456">#123456</a> - 2 tools denied

| Tool | Input |
| --- | --- |
| \`ToolA\` | \`{"param1":"value1","param2":123}\` |
| \`ToolB\` | \`{"key":"value"}\` |
`.trim(),
    );
  });

  it("should render multiple reports with collapsible sections", () => {
    const reports = [
      {
        runId: 123456,
        deniedTools: [{ name: "ToolA", input: { param1: "value1" } }],
      },
      {
        runId: 789012,
        deniedTools: [
          { name: "ToolB", input: { param2: "value2" } },
          { name: "ToolC", input: { param3: "value3" } },
        ],
      },
    ];

    const result = _renderReports(context, reports);

    expect(result).toEqual(
      `
## 🚫 Permission Denied Tool Executions

The following tool executions that Claude Code attempted were blocked due to insufficient permissions.
Consider adding them to \`allowed_tools\` if needed.

<details>
<summary>Run <a href="https://github.com/test-owner/test-repo/actions/runs/123456">#123456</a> - 1 tool denied</summary>

| Tool | Input |
| --- | --- |
| \`ToolA\` | \`{"param1":"value1"}\` |

</details>

<details>
<summary>Run <a href="https://github.com/test-owner/test-repo/actions/runs/789012">#789012</a> - 2 tools denied</summary>

| Tool | Input |
| --- | --- |
| \`ToolB\` | \`{"param2":"value2"}\` |
| \`ToolC\` | \`{"param3":"value3"}\` |

</details>
`.trim(),
    );
  });

  it("should escape special characters in tool inputs", () => {
    const reports = [
      {
        runId: 123456,
        deniedTools: [
          {
            name: "ToolWithSpecialChars",
            input: {
              backtick: "value`with`backticks",
              pipe: "value|with|pipes",
              both: "value`with|both`characters|",
            },
          },
        ],
      },
    ];

    const result = _renderReports(context, reports);

    expect(result).toEqual(
      `
## 🚫 Permission Denied Tool Executions

The following tool executions that Claude Code attempted were blocked due to insufficient permissions.
Consider adding them to \`allowed_tools\` if needed.

Run <a href="https://github.com/test-owner/test-repo/actions/runs/123456">#123456</a> - 1 tool denied

| Tool | Input |
| --- | --- |
| \`ToolWithSpecialChars\` | \`{"backtick":"value\\\`with\\\`backticks","pipe":"value\\|with\\|pipes","both":"value\\\`with\\|both\\\`characters\\|"}\` |
`.trim(),
    );
  });
});
