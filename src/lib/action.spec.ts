import type { Context } from "@actions/github/lib/context";
import { describe, expect, it } from "vitest";
import { _renderReports } from "./action";

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
