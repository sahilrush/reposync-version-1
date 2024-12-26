"use server";

import { streamText } from "ai";
import { createStreamableValue } from "ai/rsc";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateEmbedding } from "@/lib/gemini";
import { db } from "@/server/db";
import { octokit } from "@/lib/github";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export async function askQuestion(question: string, projectId: string) {
  // Track API usage
  await db.usage.create({
    data: {
      projectId,
      apiRequests: 1,
    },
  });

  const stream = createStreamableValue();

  const queryVector = await generateEmbedding(question);
  const vectorQuery = `[${queryVector.join(",")}]`;

  const result = (await db.$queryRaw`
    SELECT "fileName", "sourceCode", "summary",
    1 - ("summaryEmbedding" <=> ${vectorQuery}::vector(768)) AS similarity
    FROM "SourceCodeEmbedding"
    WHERE "projectId" = ${projectId}
    AND "summaryEmbedding" IS NOT NULL
    ORDER BY "summaryEmbedding" <=> ${vectorQuery}::vector(768)
    LIMIT 10
  `) as { fileName: string; sourceCode: string; summary: string }[];

  if (result.length === 0) {
    stream.update("I don't have enough context to answer your question.");
    stream.done();
    return {
      output: stream.value,
      filesReferences: [],
    };
  }

  let context = "";
  for (const doc of result) {
    context += `source:${doc.fileName}\ncode content:${doc.sourceCode}\n summary of file: ${doc.summary}\n\n`;
  }

  (async () => {
    const { textStream } = await streamText({
      model: google(`gemini-1.5-flash`),
      prompt: `
            You are a ai code assistant who answers questions about the codebase. Your target audience is a technical intern who is looking to understand the codebase.
                    AI assistant is a brand new, powerful, human-like artificial intelligence.
The traits of AI include expert knowledge, helpfulness, cleverness, and articulateness.
AI is a well-behaved and well-mannered individual.
AI is always friendly, kind, and inspiring, and he is eager to provide vivid and thoughtful responses to the user.
AI has the sum of all knowledge in their brain, and is able to accurately answer nearly any question about any topic in conversation.
If the question is asking about code or a specific file, AI will provide the detailed answer, giving step by step instructions, including code snippets.
START CONTEXT BLOCK
${context}
END OF CONTEXT BLOCK

START QUESTION
${question}
END OF QUESTION
AI assistant will take into account any CONTEXT BLOCK that is provided in a conversation.
If the context does not provide answer to question, The AI assistant will say , "I am sorry, I do not have enough information to answer your question."
AI assistant will not apologize for previous response. but instead will indicated new information was gained.
AI assistant will not invent anything that is not drawn directly  from the context.
Answer in markdown syntax, with code snippets if needed. Be as detailed as possible when answering. make sure there is no ambiguity in the answer.
            `,
    });
    for await (const delta of textStream) {
      stream.update(delta);
    }
    stream.done();
  })();

  return {
    output: stream.value,
    filesReferences: result,
  };
}

export async function getProjectUsage(projectId: string) {
  const usage = await db.usage.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });

  // Calculate storage used by source code embeddings
  const storageUsed = await db.sourceCodeEmbedding.aggregate({
    where: { projectId },
    _sum: {
      _count: true,
    },
  });

  // Get team member count
  const teamMembers = await db.userToProject.count({
    where: { projectId },
  });

  // Get API request count for last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const apiRequests = await db.usage.findMany({
    where: {
      projectId,
      createdAt: {
        gte: thirtyDaysAgo,
      },
    },
  });

  return {
    apiRequests: apiRequests.reduce((acc, curr) => acc + curr.apiRequests, 0),
    storageUsed: (storageUsed._sum._count || 0) * 1024, // Approximate storage in bytes
    teamMemberCount: teamMembers,
    limits: {
      apiRequestsLimit: 1000,
      storageLimit: 10 * 1024 * 1024 * 1024, // 10GB in bytes
      teamMemberLimit: 10,
    },
  };
}

export async function getProjectStats(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      commits: {
        orderBy: { commitDate: "desc" },
        take: 1,
        select: {
          summary: true,
          commitDate: true,
        },
      },
    },
  });

  if (!project?.githubUrl) {
    return defaultStats();
  }

  try {
    // Extract owner and repo from GitHub URL
    const [owner, repo] = project.githubUrl
      .replace("https://github.com/", "")
      .split("/");

    // Refresh GitHub token if needed
    await refreshGithubTokenIfNeeded();

    // Get repository information including default branch
    const { data: repoData } = await octokit.rest.repos.get({
      owner,
      repo,
    });

    // Get contributors count
    const { data: contributors } = await octokit.rest.repos.listContributors({
      owner,
      repo,
      per_page: 100,
    });

    // Get latest commit
    const { data: commits } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: 1,
    });

    // Get total files count recursively
    const totalFiles = await countFiles(owner, repo, repoData.default_branch);

    return {
      totalFiles,
      lastUpdated: commits[0]
        ? new Date(commits[0].commit.author?.date || "")
        : null,
      activeBranch: repoData.default_branch,
      contributors: contributors.length,
      lastCommitSummary: project.commits[0]?.summary || null,
    };
  } catch (error) {
    console.error("Error fetching GitHub stats:", error);
    return defaultStats();
  }
}

// Add this function to handle GitHub token refresh
async function refreshGithubTokenIfNeeded() {
  try {
    // Check if token is still valid
    await octokit.rest.users.getAuthenticated();
  } catch (error) {
    if (error.status === 401) {
      // Token is invalid or expired, refresh it
      // You'll need to implement your GitHub OAuth flow here
      console.error("GitHub token needs refresh");
      // For now, we'll just throw an error
      throw new Error("GitHub token needs to be refreshed");
    }
    throw error;
  }
}

function defaultStats() {
  return {
    totalFiles: 0,
    lastUpdated: null,
    activeBranch: "main",
    contributors: 0,
    lastCommitSummary: null,
  };
}

// Helper function to count files recursively
async function countFiles(
  owner: string,
  repo: string,
  branch: string,
  path: string = "",
): Promise<number> {
  try {
    const { data: contents } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    let count = 0;
    const items = Array.isArray(contents) ? contents : [contents];

    for (const item of items) {
      if (item.type === "file") {
        // Skip certain files
        if (
          !item.name.match(
            /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|\.git.*|\.env.*|node_modules)$/,
          )
        ) {
          count++;
        }
      } else if (
        item.type === "dir" &&
        !item.name.match(/^(node_modules|\.git|\.next|build|dist)$/)
      ) {
        // Skip certain directories but recursively count files in others
        count += await countFiles(owner, repo, branch, item.path);
      }
    }

    return count;
  } catch (error) {
    console.error(`Error counting files in ${path}:`, error);
    return 0;
  }
}
