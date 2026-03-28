import type { Request, Response } from "express";
import Stripe from "stripe";
import { config } from "../config.js";
import { ensureUserForStripe, updateSubscriptionByStripe, type SubscriptionStatus } from "../db/users.js";
import { logger } from "../logger.js";

const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;

function mapStripeStatus(status: string): SubscriptionStatus {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due") return "past_due";
  return "canceled";
}

export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  if (!stripe || !config.stripeWebhookSecret) {
    res.status(503).json({ error: "Stripe not configured" });
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (typeof sig !== "string") {
    res.status(400).json({ error: "Missing stripe-signature" });
    return;
  }

  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, config.stripeWebhookSecret);
  } catch (e) {
    logger.warn({ err: e }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        if (userId && customerId) {
          await ensureUserForStripe(userId, customerId, "active");
          logger.info({ userId, customerId }, "checkout.session.completed");
        } else {
          logger.warn({ sessionId: session.id }, "checkout.session.completed missing client_reference_id or customer");
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.cognito_sub;
        if (!userId) {
          logger.warn({ subscriptionId: sub.id }, "subscription event missing metadata.cognito_sub");
          break;
        }
        const status =
          event.type === "customer.subscription.deleted"
            ? "canceled"
            : mapStripeStatus(sub.status);
        await updateSubscriptionByStripe(userId, { subscriptionStatus: status });
        logger.info({ userId, status }, "subscription event");
        break;
      }
      default:
        logger.debug({ type: event.type }, "Stripe webhook ignored");
    }
    res.json({ received: true });
  } catch (e) {
    logger.error({ err: e }, "Stripe webhook handler error");
    res.status(500).json({ error: "Webhook handler failed" });
  }
}
