// server/routes/mealPlanJobs.ts
import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { buildMealPlanPrompt, mealPlanNumPredict } from "../../client/meal-plan.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { resolveCognitoUserContext } from "../session/resolveContext.js";

type JobStatus = "pending" | "running" | "succeeded" | "failed";

interface MealPlanJob {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  prefs: any; // MealPlanPrefs shape
  accessToken?: string;
  resultText?: string;
  error?: string;
}

const jobs = new Map<string, MealPlanJob>();

export async function postMealPlanJob(req: Request, res: Response): Promise<void> {
  const userId = (req as any).appUserId ?? (req as any).user?.id ?? "anonymous";
  const prefs = req.body;
  const ctx = await resolveCognitoUserContext(req);
  const id = uuidv4();
  const now = new Date().toISOString();

  const job: MealPlanJob = {
    id,
    userId,
    createdAt: now,
    updatedAt: now,
    status: "pending",
    prefs,
    accessToken: ctx?.accessToken,
  };
  jobs.set(id, job);

  // Kick off background work, but don't await it.
  void runMealPlanJob(job).catch((err) => {
    logger.error({ err, jobId: id }, "meal_plan_job_background_error");
  });

  res.status(202).json({ jobId: id });
}

export function getMealPlanJob(req: Request, res: Response): void {
  const id = req.params.jobId;
  const job = jobs.get(id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    resultText: job.status === "succeeded" ? job.resultText : undefined,
    error: job.status === "failed" ? job.error : undefined,
  });
}

export function listMealPlanJobs(req: Request, res: Response): void {
  const userId = (req as any).appUserId ?? (req as any).user?.id ?? "anonymous";
  const all = Array.from(jobs.values())
    .filter((j) => j.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(
    all.map((j) => ({
      jobId: j.id,
      status: j.status,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      prefs: j.prefs,
      error: j.status === "failed" ? j.error : undefined,
    }))
  );
}

async function runMealPlanJob(job: MealPlanJob): Promise<void> {
  job.status = "running";
  job.updatedAt = new Date().toISOString();

  try {
    const prefs = job.prefs;
    const prompt = buildMealPlanPrompt(prefs);
    const numPredict = mealPlanNumPredict(prefs);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (job.accessToken) {
      headers.Authorization = `Bearer ${job.accessToken}`;
    }

    const response = await fetch(
      config.appPublicUrl.replace(/\/+$/, "") + "/llm-api/api/chat",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          stream: false,
          options: { num_predict: numPredict },
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      job.status = "failed";
      job.error = `HTTP ${response.status}: ${body.slice(0, 300)}`;
      job.updatedAt = new Date().toISOString();
      return;
    }

    const raw = await response.text();
    let text = "";
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as { message?: { content?: string }; error?: string };
        if (obj.error) {
          throw new Error(obj.error);
        }
        if (obj.message?.content) {
          text += obj.message.content;
        }
      } catch {
        // ignore lines that aren't JSON
      }
    }
    
    job.status = "succeeded";
    job.resultText = text;
    job.updatedAt = new Date().toISOString();
  } catch (err) {
    logger.error({ err, jobId: job.id }, "meal_plan_job_failed");
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.updatedAt = new Date().toISOString();
  }
}