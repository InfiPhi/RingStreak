import fs from "fs";
import os from "os";
import path from "path";

type TokenData = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
  owner_id?: string;
  endpoint_id?: string;
  expires_at?: number;
};

const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), ".ringstreak");
const FILE_PATH = path.join(DATA_DIR, "tokens.json");

export function loadToken(): TokenData | null {
  try {
    const file = fs.readFileSync(FILE_PATH, "utf8");
    const data: TokenData = JSON.parse(file);
    return data && data.access_token ? data : null;
  } catch {
    return null;
  }
}

export function saveToken(token: TokenData) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE_PATH, JSON.stringify(token, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save token:", (e as Error).message);
  }
}

export function clearToken() {
  try {
    fs.unlinkSync(FILE_PATH);
  } catch {
    // ignore
  }
}
