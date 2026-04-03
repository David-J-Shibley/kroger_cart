// server/routes/mealPlanJobs.ts
import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { buildMealPlanPrompt, mealPlanNumPredict } from "../../client/meal-plan.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { resolveCognitoUserContext } from "../session/resolveContext.js";

type JobStatus = "pending" | "running" | "succeeded" | "failed";
type MealPlanJobKind = "full" | "regenerate";

interface MealPlanRegeneratePayload {
  dishId: string;
  plan: unknown;
  notes: string;
}

interface MealPlanJob {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  kind: MealPlanJobKind;
  prefs: any;
  regenerate?: MealPlanRegeneratePayload;
  accessToken?: string;
  resultText?: string;
  error?: string;
}

const jobs = new Map<string, MealPlanJob>();

function buildRegenerateMealPrompt(payload: MealPlanRegeneratePayload): string {
  const { dishId, plan, notes } = payload;
  const planJson = JSON.stringify(plan);
  let currentMealSummary = "";
  try {
    const p = plan as { days?: { meals?: { dishId?: string; type?: string; name?: string; ingredients?: unknown }[] }[] };
    outer: for (const day of p.days ?? []) {
      for (const meal of day.meals ?? []) {
        if (meal?.dishId === dishId) {
          currentMealSummary = JSON.stringify(
            {
              dishId: meal.dishId,
              type: meal.type,
              name: meal.name,
              ingredients: meal.ingredients,
            },
            null,
            2
          );
          break outer;
        }
      }
    }
  } catch {
    /* ignore */
  }

  return (
    "You are updating an existing meal plan.\n\n" +
    "The current structured plan is below as JSON (PLAN_JSON). You must return an updated PLAN_JSON in exactly the same shape (no extra fields, no comments, no trailing commas, and no additional text before or after the JSON).\n\n" +
    "Existing PLAN_JSON:\n" +
    planJson +
    "\n\n" +
    "User dietary notes and preferences (you must continue to respect these strictly):\n" +
    (notes || "(none specified)") +
    "\n\n" +
    "Task:\n" +
    '- Replace exactly one meal whose dishId is "' +
    dishId +
    '" with a new dish.\n' +
    "- Keep all other days and meals unchanged.\n" +
    "- The new dish must be meaningfully different from the current one shown below (different main protein or base, and not just small wording changes).\n" +
    "- Do NOT reuse the existing dish name or a trivially similar variation.\n" +
    "- The new dish should fit the same meal type (breakfast, lunch, or dinner) and feel consistent with the rest of the plan.\n" +
    "- Update the grocery.ingredients array so it reflects the full set of ingredients after this change, with each consolidated ingredient listed exactly once.\n" +
    "- Do not change any other structure, and do not include recipes text or headings—only the updated PLAN_JSON object.\n\n" +
    "Current meal to replace (for reference; make the new dish clearly different from this):\n" +
    (currentMealSummary || "(current meal not found by dishId; still replace by dishId)") +
    "\n\n" +
    "Now respond with ONLY the updated PLAN_JSON as a single compact JSON object (no surrounding prose)."
  );
}

export async function postMealPlanJob(req: Request, res: Response): Promise<void> {
  const userId = (req as any).appUserId ?? (req as any).user?.id ?? "anonymous";
  const body = req.body;
  const ctx = await resolveCognitoUserContext(req);
  const id = uuidv4();
  const now = new Date().toISOString();

  const isRegenerate =
    body &&
    body.regenerate === true &&
    typeof body.dishId === "string" &&
    body.dishId.trim() !== "" &&
    body.plan !== null &&
    typeof body.plan === "object";

  let job: MealPlanJob;

  if (isRegenerate) {
    job = {
      id,
      userId,
      createdAt: now,
      updatedAt: now,
      status: "pending",
      kind: "regenerate",
      prefs: { regenerateMeal: true, dishId: String(body.dishId).trim() },
      regenerate: {
        dishId: String(body.dishId).trim(),
        plan: body.plan,
        notes: typeof body.notes === "string" ? body.notes.slice(0, 800) : "",
      },
      accessToken: ctx?.accessToken,
    };
  } else {
    job = {
      id,
      userId,
      createdAt: now,
      updatedAt: now,
      status: "pending",
      kind: "full",
      prefs: body,
      accessToken: ctx?.accessToken,
    };
  }

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
      jobKind: j.kind,
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
    let prompt: string;
    let numPredict: number;
    if (job.kind === "regenerate" && job.regenerate) {
      prompt = buildRegenerateMealPrompt(job.regenerate);
      numPredict = 2048;
    } else {
      prompt = buildMealPlanPrompt(job.prefs);
      numPredict = mealPlanNumPredict(job.prefs);
    }

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