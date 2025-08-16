import * as core from "@actions/core";
import { Action } from "./lib/action";

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

    const action = new Action({
      githubToken: inputs.githubToken,
    });

    const outputs = await action.run({
      claudeCodeExecutionFile: inputs.claudeCodeExecutionFile,
      stickyComment: inputs.stickyComment,
      skipComment: inputs.skipComment,
    });

    core.setOutput("report", outputs.report);
    core.setOutput("denied-tools", JSON.stringify(outputs.deniedTools));
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
