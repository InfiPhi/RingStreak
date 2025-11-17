import fetch from "node-fetch";
import { env } from "./env.js";
import { RcSubscription, RcToken, getSub, getToken, putSub, putToken, removeSub } from "./store.js";

const AUTH_EARLY_MS = 60 * 1000;
const SUB_RENEW_EARLY_MS = 24 * 60 * 60 * 1000;

function authHeaders() {
  const basic = Buffer.from(`${env.RC_CLIENT_ID}:${env.RC_CLIENT_SECRET}`).toString("base64");
  return { Authorization: `Basic ${basic}` };
}

function rcUrl(pathname: string) {
  return `${env.RC_SERVER}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export function buildAuthUrl(): string {
  const redirectUri = `${env.APP_BASE_URL}${env.REDIRECT_PATH}`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.RC_CLIENT_ID,
    redirect_uri: redirectUri,
    prompt: "login",
  });
  return `${env.RC_SERVER}/restapi/oauth/authorize?${params.toString()}`;
}

export async function loginWithAuthCode(code: string): Promise<{ userId: string; token: RcToken }> {
  const redirectUri = `${env.APP_BASE_URL}${env.REDIRECT_PATH}`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const tokenResp = await fetch(rcUrl("/restapi/oauth/token"), {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text().catch(() => "");
    throw new Error(`OAuth exchange failed: ${tokenResp.status} ${text}`);
  }

  const data: any = await tokenResp.json();
  if (!data?.access_token || !data?.refresh_token) {
    throw new Error("OAuth exchange did not return tokens");
  }

  const expiresIn = Number(data.expires_in || data.expiresIn || 0);
  const ttl = Math.max(expiresIn * 1000, AUTH_EARLY_MS);
  const expires_at = Date.now() + Math.max(ttl - AUTH_EARLY_MS, 0);
  const userId = await fetchUserId(data.access_token);

  const token: RcToken = {
    userId,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at,
    scope: data.scope,
  };

  putToken(token);
  return { userId, token };
}

export async function refreshUserToken(userId: string): Promise<RcToken> {
  const existing = getToken(userId);
  if (!existing) throw new Error(`No token found for user ${userId}`);

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: existing.refresh_token,
  });

  const resp = await fetch(rcUrl("/restapi/oauth/token"), {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Refresh failed for ${userId}: ${resp.status} ${text}`);
  }

  const data: any = await resp.json();
  if (!data?.access_token) {
    throw new Error(`Refresh missing access_token for ${userId}`);
  }

  const expiresIn = Number(data.expires_in || data.expiresIn || 0);
  const ttl = Math.max(expiresIn * 1000, AUTH_EARLY_MS);
  const updated: RcToken = {
    userId,
    access_token: data.access_token,
    refresh_token: data.refresh_token || existing.refresh_token,
    expires_at: Date.now() + Math.max(ttl - AUTH_EARLY_MS, 0),
    scope: data.scope || existing.scope,
  };
  putToken(updated);
  return updated;
}

export async function ensureValidAccess(userId: string): Promise<RcToken> {
  const token = getToken(userId);
  if (!token) throw new Error(`User ${userId} not signed in`);
  if (token.expires_at - Date.now() <= AUTH_EARLY_MS) {
    return refreshUserToken(userId);
  }
  return token;
}

export async function createOrRenewUserSubscription(
  userId: string,
  webhookUrl: string
): Promise<RcSubscription> {
  const token = await ensureValidAccess(userId);
  const current = getSub(userId);
  const stillValid = current && current.expiresAt - Date.now() > SUB_RENEW_EARLY_MS;
  if (current && stillValid) return current;

  const body = {
    eventFilters: ["/restapi/v1.0/account/~/extension/~/telephony/sessions"],
    deliveryMode: {
      transportType: "WebHook",
      address: webhookUrl,
    },
    expiresIn: 7 * 24 * 60 * 60,
  };

  const endpoint = current?.id
    ? rcUrl(`/restapi/v1.0/subscription/${current.id}`)
    : rcUrl("/restapi/v1.0/subscription");
  const method = current?.id ? "PUT" : "POST";

  const resp = await fetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    // If renew fails (e.g., expired), try a fresh create
    if (current?.id) {
      removeSub(userId);
      return createOrRenewUserSubscription(userId, webhookUrl);
    }
    const text = await resp.text().catch(() => "");
    throw new Error(`Subscription failed for ${userId}: ${resp.status} ${text}`);
  }

  const data: any = await resp.json();
  const expiresIn = Number(data?.expiresIn || data?.expires_in || 0);
  const expiresAt =
    data?.expirationTime && typeof data.expirationTime === "string"
      ? new Date(data.expirationTime).getTime()
      : Date.now() + Math.max(expiresIn * 1000, SUB_RENEW_EARLY_MS);

  const saved: RcSubscription = {
    userId,
    id: String(data?.id),
    expiresAt,
  };
  putSub(saved);
  return saved;
}

async function fetchUserId(accessToken: string): Promise<string> {
  const resp = await fetch(rcUrl("/restapi/v1.0/account/~/extension/~"), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Failed to fetch user identity: ${resp.status} ${text}`);
  }
  const data: any = await resp.json();
  const userId = data?.id || data?.extensionId || data?.extensionNumber || data?.ownerId;
  if (!userId) throw new Error("Unable to resolve user identity from RingCentral");
  return String(userId);
}
