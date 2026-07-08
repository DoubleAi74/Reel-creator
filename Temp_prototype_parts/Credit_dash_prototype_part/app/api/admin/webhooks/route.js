import { NextResponse } from "next/server";

import { serializeWebhookEvent } from "../../../../lib/admin/serialize-webhook-event.mjs";
import { connectToDatabase } from "../../../../lib/db/mongoose.mjs";
import { WebhookEvent } from "../../../../lib/models/WebhookEvent.mjs";

function parseLimit(value) {
  const parsedValue = Number.parseInt(value ?? "50", 10);

  if (!Number.isInteger(parsedValue)) {
    return 50;
  }

  return Math.min(Math.max(parsedValue, 1), 100);
}

export async function GET(request) {
  await connectToDatabase();

  const url = new URL(request.url);
  const events = await WebhookEvent.find({})
    .sort({ createdAt: -1 })
    .limit(parseLimit(url.searchParams.get("limit")))
    .lean();

  return NextResponse.json({
    events: events.map(serializeWebhookEvent),
  });
}
