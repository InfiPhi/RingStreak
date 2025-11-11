import { SDK } from "@ringcentral/sdk";
import type Platform from "@ringcentral/sdk/lib/platform/Platform";
import type { AuthData } from "@ringcentral/sdk/lib/platform/Auth";
import { env } from "./env.js";
import { loadToken, saveToken } from "./tokenStore.js";

let baseSdk: SDK | null = null;

export function rcSdk() {
  if (baseSdk) return baseSdk;
  baseSdk = new SDK({
    server: env.RC_SERVER,
    clientId: env.RC_CLIENT_ID,
    clientSecret: env.RC_CLIENT_SECRET,
  });
  return baseSdk;
}

export function getPlatform(): Platform {
  return rcSdk().platform();
}

export async function getAuthedPlatform(): Promise<Platform | null> {
  const platform = getPlatform();
  const stored = loadToken();
  if (!stored) return null;
  await platform.auth().setData({
    token_type: stored.token_type || "Bearer",
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    expires_in: stored.expires_in ? String(stored.expires_in) : undefined,
    expire_time: stored.expires_at,
  });
  try {
    const valid = await platform.auth().accessTokenValid();
    if (!valid) {
      await platform.refresh();
      const data = await platform.auth().data();
      persistAuthData(data);
    }
  } catch (e) {
    console.warn("Refresh failed, please sign in again:", (e as Error).message);
    return null;
  }
  return platform;
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

export async function loginWithAuthCode(code: string): Promise<void> {
  const platform = getPlatform();
  const redirectUri = `${env.APP_BASE_URL}${env.REDIRECT_PATH}`;
  await platform.login({ code, redirect_uri: redirectUri });
  const data = await platform.auth().data();
  if (!data.access_token || !data.refresh_token) {
    throw new Error("OAuth exchange did not return tokens");
  }
  persistAuthData(data);
}

export async function createOrRenewSubscription(webhookUrl: string, existingPlatform?: Platform) {
  const platform = existingPlatform || (await getAuthedPlatform());
  if (!platform) throw new Error("Not authenticated; please sign in first");

  const body = {
    eventFilters: ["/restapi/v1.0/account/~/extension/~/telephony/sessions"],
    deliveryMode: {
      transportType: "WebHook",
      address: webhookUrl,
    },
    expiresIn: 7 * 24 * 60 * 60,
  };
  const resp = await platform.post("/restapi/v1.0/subscription", body);
  return resp.json();
}

function persistAuthData(data: AuthData) {
  if (!data.access_token || !data.refresh_token) return;
  const expiresIn = data.expires_in ? Number(data.expires_in) : undefined;
  const expireTime = data.expire_time || (expiresIn ? Date.now() + expiresIn * 1000 : undefined);
  saveToken({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type,
    expires_in: expiresIn,
    expires_at: expireTime,
    owner_id: data.owner_id,
    endpoint_id: data.endpoint_id,
  });
}
