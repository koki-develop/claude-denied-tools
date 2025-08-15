import * as github from "@actions/github";
import type * as octokit from "@octokit/plugin-rest-endpoint-methods";

type Octokit = ReturnType<typeof github.getOctokit>;

export type Comment =
  octokit.RestEndpointMethodTypes["issues"]["listComments"]["response"]["data"][number];

type Config = {
  owner: string;
  repo: string;
  token: string;
};

type ListIssueCommentsParams = {
  issueNumber: number;
};

type CreateCommentParams = {
  issueNumber: number;
  body: string;
};

type UpdateCommentParams = {
  commentId: number;
  body: string;
};

export class GitHub {
  private readonly _octokit: Octokit;
  private readonly _owner: string;
  private readonly _repo: string;

  constructor(config: Config) {
    this._octokit = github.getOctokit(config.token);
    this._owner = config.owner;
    this._repo = config.repo;
  }

  async listIssueComments(params: ListIssueCommentsParams): Promise<Comment[]> {
    const { data } = await this._octokit.rest.issues.listComments({
      owner: this._owner,
      repo: this._repo,
      issue_number: params.issueNumber,
    });
    return data;
  }

  async createComment(params: CreateCommentParams): Promise<void> {
    await this._octokit.rest.issues.createComment({
      owner: this._owner,
      repo: this._repo,
      issue_number: params.issueNumber,
      body: params.body,
    });
  }

  async updateComment(params: UpdateCommentParams): Promise<void> {
    await this._octokit.rest.issues.updateComment({
      owner: this._owner,
      repo: this._repo,
      comment_id: params.commentId,
      body: params.body,
    });
  }
}
