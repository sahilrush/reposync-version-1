import { db } from "@/server/db";
import { Octokit } from "octokit";
import { aiSummarieCommit } from "./gemini";
import axios from "axios";

export const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

type Response = {
  commitHash: string;
  commitMessage: string;
  commitAuthorAvatar: string;
  commitDate: Date;
  commitAuthorName: string;
};

export const getCommitHashes = async (
  githubUrl: string,
): Promise<Response[]> => {
  // GitHub
  const [owner, repo] = githubUrl.split("/").slice(-2);
  if (!owner || !repo) {
    throw new Error("Invalid GitHub URL");
  }
  const { data } = await octokit.rest.repos.listCommits({
    owner,
    repo,
  });

  // Sort commits in descending order based on commit date
  const sortedCommits = data.sort(
    (a: any, b: any) =>
      new Date(b.commit.author.date).getTime() -
      new Date(a.commit.author.date).getTime(),
  ) as any[];

  return sortedCommits.slice(0, 10).map((commit: any) => ({
    commitHash: commit.sha as string,
    commitMessage: commit.commit.message ?? "",
    commitAuthorName: commit.commit?.author?.name ?? "",
    commitAuthorAvatar: commit?.author?.avatar_url ?? "",
    commitDate: commit.commit?.author?.date ?? "",
  }));
};

export const pollCommits = async (projectId: string) => {
  // Fetch GitHub URL for the project
  const { project, githubUrl } = await fetchProjectGitHubUrl(projectId);

  // Get the latest commit hashes
  const commitHashes = await getCommitHashes(githubUrl);

  // Filter out processed commits
  const unprocessedCommits = await filterUnprocessedCommits(
    projectId,
    commitHashes,
  );
  const summeryResponse = await Promise.allSettled(
    unprocessedCommits.map((commit) => {
      return summariseCommit(githubUrl, commit.commitHash);
    }),
  );

  const summaries = summeryResponse.map((response) => {
    if (response.status === "fulfilled") {
      return response.value as string;
    }
    return "";
  });

  const commits = await db.commit.createMany({
    data: summaries.map((summary, index) => {
      console.log(`Processing commit, ${index}`);
      return {
        projectId: projectId,
        commitHash: unprocessedCommits[index]!.commitHash,
        commitMessage: unprocessedCommits[index]!.commitMessage,
        commitAuthorName: unprocessedCommits[index]!.commitAuthorName,
        commitAuthorAvatar: unprocessedCommits[index]!.commitAuthorAvatar,
        commitDate: unprocessedCommits[index]!.commitDate,
        summary: summary,
      };
    }),
  });

  return commits;
};

async function summariseCommit(githubUrl: string, commitHash: string) {
  // Get the diff and pass the diff into AI
  const { data } = await axios.get(`${githubUrl}/commit/${commitHash}.diff`, {
    headers: {
      Accept: "application/vnd.github.v3.diff",
    },
  });
  return (await aiSummarieCommit(data)) || "";
}

async function fetchProjectGitHubUrl(projectId: string) {
  const project = await db.project.findUnique({
    where: {
      id: projectId,
    },
    select: {
      githubUrl: true,
    },
  });

  if (!project?.githubUrl) {
    throw new Error("Project has no GitHub URL");
  }

  return { project, githubUrl: project.githubUrl };
}

async function filterUnprocessedCommits(
  projectId: string,
  commitHashes: Response[],
) {
  // Fetch commits that have already been processed
  const processedCommits = await db.commit.findMany({
    where: {
      projectId, // Use the correct field name here
    },
  });

  // Filter out commits that have already been processed
  const unprocessedCommits = commitHashes.filter(
    (commit) =>
      !processedCommits.some(
        (processedCommit) => processedCommit.commitHash === commit.commitHash,
      ),
  );

  return unprocessedCommits;
}
