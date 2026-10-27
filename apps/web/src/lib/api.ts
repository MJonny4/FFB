import { z } from "@ffb/contracts";
export const apiBase =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-FFB-Client", "web");
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers,
      credentials: "include",
      signal: init.signal ?? AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("The server could not be reached. Try again when your connection returns.");
  }
  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status})`,
    );
  const parsed = schema.safeParse(payload);
  if (!parsed.success)
    throw new Error("The server returned an unsupported response. Please refresh.");
  return parsed.data;
}
export const accepted = z.object({ accepted: z.boolean() });
export const success = z.object({}).passthrough();
export function refresh() {
  window.dispatchEvent(new Event("ffb:refresh"));
}
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export const coins = (value: number) => new Intl.NumberFormat("en-GB").format(value);

export const assetUrl = (path: string) => `${apiBase}${path}`;
