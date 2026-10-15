import { createClient } from "@supabase/supabase-js";
import type { CrmAnalytics, CrmData } from "../types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

const requestedAuthMode = import.meta.env.VITE_AUTH_MODE?.trim().toLowerCase();
export const isMockAuthEnabled = import.meta.env.DEV
  && (requestedAuthMode === "mock" || (!requestedAuthMode && !supabaseUrl && !supabaseAnonKey));
export const mockSessionStorageKey = "northstar-crm-demo-session";
const mockAccessToken = "northstar-local-demo-token";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

const apiBase = (import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace(/\/+$/, "");

async function getAccessToken(): Promise<string> {
  if (isMockAuthEnabled) {
    if (window.sessionStorage.getItem(mockSessionStorageKey) !== "active") {
      throw new Error("Start a local demo session before using the CRM.");
    }
    return mockAccessToken;
  }

  if (!supabase) throw new Error("Supabase is not configured. Add the VITE_SUPABASE variables to .env.local.");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again to continue.");
  return token;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(apiBase + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = response.status === 413
      ? "CRM data exceeds the API request size limit. Try importing fewer rows at a time."
      : typeof payload?.message === "string" ? payload.message : "The CRM service could not complete the request.";
    throw new Error(message);
  }
  return payload as T;
}

export async function getWorkspace(): Promise<CrmData> {
  const result = await apiRequest<{ data: CrmData }>("/crm/workspace");
  return result.data;
}

export async function getAnalytics(date: string): Promise<CrmAnalytics> {
  const result = await apiRequest<CrmAnalytics>("/crm/analytics?date=" + encodeURIComponent(date));
  return result;
}

let pendingWrite: Promise<unknown> = Promise.resolve();

export function saveWorkspace(workspace: CrmData): Promise<void> {
  const nextWrite = pendingWrite.then(() =>
    apiRequest<{ saved: boolean }>("/crm/workspace", {
      method: "PUT",
      body: JSON.stringify({ data: workspace }),
    }),
  ).then(() => undefined);
  pendingWrite = nextWrite.catch(() => undefined);
  return nextWrite;
}
