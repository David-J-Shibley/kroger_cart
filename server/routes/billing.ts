import type { Request, Response } from "express";
import Stripe from "stripe";
import { config } from "../config.js";
import {
  ensureUserForStripe,
  getUser,
  type SubscriptionStatus,
} from "../db/users.js";
import { logger } from "../logger.js";

const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;

/** Cognito access tokens often lack `email`; username fallback is not valid for Stripe customer_email. */
function stripeSafeCustomerEmail(raw: string | undefined): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return undefined;
  return s;
}

export async function postCheckoutSession(req: Request, res: Response): Promise<void> {
  if (!stripe || !config.stripePriceId) {
    res.status(503).json({ error: "Stripe billing not configured" });
    return;
  }
  const base = config.appPublicUrl || `${req.protocol}://${req.get("host")}`;
  const userId = req.appUserId;
  const customerEmail = stripeSafeCustomerEmail(req.appUserEmail);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: config.stripePriceId, quantity: 1 }],
      success_url: `${base}/index.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/index.html?checkout=canceled`,
      client_reference_id: userId,
      ...(customerEmail ? { customer_email: customerEmail } : {}),
      subscription_data: {
        metadata: { cognito_sub: userId },
      },
    });
    res.json({ url: session.url });
  } catch (e) {
    logger.error({ err: e }, "Stripe checkout.session.create failed");
    res.status(502).json({ error: e instanceof Error ? e.message : "Stripe error" });
  }
}

function mapStripeSubscriptionStatus(status: string): SubscriptionStatus {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due") return "past_due";
  return "canceled";
}

/**
 * After Checkout redirect, confirm session with Stripe and write subscription to DynamoDB.
 * Webhooks are unreliable on localhost; this makes paid users active immediately.
 */
export async function postSyncCheckoutSession(req: Request, res: Response): Promise<void> {
  if (!stripe) {
    res.status(503).json({ error: "Stripe not configured" });
    return;
  }
  const userId = req.appUserId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
  if (!sessionId) {
    res.status(400).json({ error: "Missing sessionId" });
    return;
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });
    if (session.client_reference_id !== userId) {
      res.status(403).json({ error: "Session does not belong to this account" });
      return;
    }
    const customerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
    if (!customerId) {
      res.status(400).json({ error: "Checkout session has no customer" });
      return;
    }
    let status: SubscriptionStatus = "canceled";
    const sub = session.subscription;
    if (typeof sub === "object" && sub !== null && "status" in sub) {
      status = mapStripeSubscriptionStatus((sub as Stripe.Subscription).status);
    } else if (session.mode === "subscription" && session.payment_status === "paid") {
      status = "active";
    }
    await ensureUserForStripe(userId, customerId, status);
    const rec = await getUser(userId);
    if (status === "active" && rec?.subscriptionStatus !== "active") {
      res.status(502).json({
        error:
          "Subscription could not be saved. Check DYNAMODB_USERS_TABLE, DYNAMODB_REGION (or AWS_REGION), and IAM credentials.",
      });
      return;
    }
    res.json({ ok: true, subscriptionStatus: rec?.subscriptionStatus ?? status });
  } catch (e) {
    logger.error({ err: e, sessionId }, "sync checkout session failed");
    res.status(502).json({ error: e instanceof Error ? e.message : "Stripe error" });
  }
}

export async function postBillingPortal(req: Request, res: Response): Promise<void> {
  if (!stripe) {
    res.status(503).json({ error: "Stripe not configured" });
    return;
  }
  const userId = req.appUserId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const user = await getUser(userId);
  if (!user?.stripeCustomerId) {
    res.status(400).json({ error: "No Stripe customer yet — subscribe first." });
    return;
  }
  const base = config.appPublicUrl || `${req.protocol}://${req.get("host")}`;
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${base}/index.html`,
    });
    res.json({ url: session.url });
  } catch (e) {
    logger.error({ err: e }, "Stripe billingPortal.sessions.create failed");
    res.status(502).json({ error: e instanceof Error ? e.message : "Stripe error" });
  }
}
