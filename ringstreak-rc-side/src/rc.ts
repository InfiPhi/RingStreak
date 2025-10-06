import { SDK } from "@ringcentral/sdk";
import { env } from "./env.js";

let sdk: SDK | null = null;

export function rcSdk() {
  if (sdk) return sdk;
  sdk = new SDK({
    server: env.RC_SERVER,
    clientId: env.RC_CLIENT_ID!,
    clientSecret: env.RC_CLIENT_SECRET!,
  });
  return sdk!;
}

export async function ensureAuth() {
  const platform = rcSdk().platform();
  if (!env.RC_CLIENT_ID || !env.RC_CLIENT_SECRET) {
    throw new Error("Missing RC_CLIENT_ID/RC_CLIENT_SECRET in .env");
  }
  if (!env.RC_JWT) {
    throw new Error("Missing RC_JWT in .env (JWT auth is simplest for server apps)");
  }
  try {
    await platform.login({ jwt: env.RC_JWT });
  } catch (e: any) {
    const detail = e?.response?.data ? JSON.stringify(e.response.data) : e?.message;
    throw new Error(`RingCentral login failed: ${detail}`);
  }
}

export async function createOrRenewSubscription(webhookUrl: string) {
  const platform = rcSdk().platform();
  const body = {
    eventFilters: ["/restapi/v1.0/account/~/extension/~/telephony/sessions"],
    deliveryMode: { transportType: "WebHook", address: webhookUrl },
    expiresIn: 7 * 24 * 60 * 60,
  };
  const resp = await platform.post("/restapi/v1.0/subscription", body);
  return resp.json();
}

export async function fetchCallSummaryBySession(telephonySessionId: string) {
  await ensureAuth();
  const platform = rcSdk().platform();
  const dateFrom = new Date(Date.now() - 1000 * 60 * 60).toISOString();
  const query = { view: "Detailed", telephonySessionId, dateFrom };
  const resp = await platform.get("/restapi/v1.0/account/~/extension/~/call-log", query);
  const json: any = await resp.json();
  const rec = (json?.records || [])[0];
  if (!rec) return null;
  return {
    direction: rec.direction,
    from: rec.from?.phoneNumber || "",
    to: rec.to?.phoneNumber || "",
    result: rec.result,
    startTime: rec.startTime,
    durationSec: rec.duration || 0,
    recordingUrl: rec?.recording?.contentUri || null,
  };
}
