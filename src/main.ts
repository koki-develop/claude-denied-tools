import * as core from "@actions/core";
import { runAction } from "./lib/action";

export const main = async () => {
  try {
    const inputs = {
      githubToken: core.getInput("github-token", {
        required: true,
        trimWhitespace: true,
      }),
      claudeCodeExecutionFile: core.getInput("claude-code-execution-file", {
        required: true,
        trimWhitespace: true,
      }),
      stickyComment:
        core.getInput("sticky-comment", { trimWhitespace: true }) === "true",
      skipComment:
        core.getInput("skip-comment", { trimWhitespace: true }) === "true",
    } as const;

    const outputs = await runAction(
      {
        githubToken: inputs.githubToken,
      },
      {
        claudeCodeExecutionFile: inputs.claudeCodeExecutionFile,
        stickyComment: inputs.stickyComment,
        skipComment: inputs.skipComment,
      },
    );

    core.setOutput("report", outputs.report);
    core.setOutput("denied-tools", JSON.stringify(outputs.deniedTools));
    core.setOutput("found", outputs.found.toString());
    core.summary.addRaw(outputs.report, true).write();
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      throw error;
    }
  }
};

await main();
