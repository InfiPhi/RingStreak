export type RcToken = {
  userId: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope?: string;
};

export type RcSubscription = {
  userId: string;
  id: string;
  expiresAt: number;
};

const tokens = new Map<string, RcToken>();
const subs = new Map<string, RcSubscription>();

export function putToken(token: RcToken) {
  tokens.set(token.userId, token);
}

export function getToken(userId: string): RcToken | null {
  return tokens.get(userId) || null;
}

export function allTokens(): RcToken[] {
  return Array.from(tokens.values());
}

export function removeToken(userId: string) {
  tokens.delete(userId);
}

export function putSub(sub: RcSubscription) {
  subs.set(sub.userId, sub);
}

export function getSub(userId: string): RcSubscription | null {
  return subs.get(userId) || null;
}

export function allSubs(): RcSubscription[] {
  return Array.from(subs.values());
}

export function removeSub(userId: string) {
  subs.delete(userId);
}
