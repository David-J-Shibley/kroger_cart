// server/routes/mealPlanJobs.ts
import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { buildMealPlanPrompt, mealPlanNumPredict } from "../../client/meal-plan.js"; // or re‑implement prompt server-side
import { config } from "../config.js";
import { logger } from "../logger.js";
import { mergeAppAuth } from "../authed-fetch.js"; // if you have a shared helper for auth; otherwise plain fetch

type JobStatus = "pending" | "running" | "succeeded" | "failed";

interface MealPlanJob {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  prefs: any;        // MealPlanPrefs shape
  resultText?: string;
  error?: string;
}

const jobs = new Map<string, MealPlanJob>();

export function postMealPlanJob(req: Request, res: Response): void {
  const userId = (req as any).user?.id ?? "anonymous";
  const prefs = req.body;
  const id = uuidv4();
  const now = new Date().toISOString();

  const job: MealPlanJob = {
    id,
    userId,
    createdAt: now,
    updatedAt: now,
    status: "pending",
    prefs,
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

async function runMealPlanJob(job: MealPlanJob): Promise<void> {
  job.status = "running";
  job.updatedAt = new Date().toISOString();

  try {
    const prefs = job.prefs;
    const prompt = buildMealPlanPrompt(prefs);
    const numPredict = mealPlanNumPredict(prefs);

    const response = await fetch(
      config.appPublicUrl.replace(/\/+$/, "") +
        (config.llmProxyPrefix ?? "/llm-api") +
        "/api/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    // Featherless non-stream: either raw JSON with message/content or plain text.
    let text = raw.trim();
    try {
      const obj = JSON.parse(raw) as { message?: { content?: string } };
      if (obj?.message?.content) text = obj.message.content;
    } catch {
      /* raw is already text */
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