import { useEffect, useState, useCallback } from "react";
import type { z } from "@ffb/contracts";
import { request } from "../lib/api.ts";
export function useResource<T>(path: string | null, schema: z.ZodType<T>) {
  const [state, setState] = useState<{
    path: string | null;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ path, data: null, error: "", loading: !!path });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    let active = true,
      busy = false,
      pending = false;
    async function load() {
      if (!path) return;
      if (busy) {
        pending = true;
        return;
      }
      busy = true;
      try {
        const data = await request(path, schema);
        if (active) setState({ path, data, error: "", loading: false });
      } catch (error) {
        if (active)
          setState((previous) => ({
            path,
            data: previous.path === path ? previous.data : null,
            error: `${previous.path === path && previous.data ? "Showing the last confirmed data. " : ""}${error instanceof Error ? error.message : "Unable to load"}`,
            loading: false,
          }));
      } finally {
        busy = false;
        if (pending && active) {
          pending = false;
          void load();
        }
      }
    }
    const receive = () => void load();
    void load();
    window.addEventListener("ffb:refresh", receive);
    return () => {
      active = false;
      window.removeEventListener("ffb:refresh", receive);
    };
  }, [path, schema, revision]);
  return state.path === path
    ? { ...state, reload }
    : { path, data: null, error: "", loading: !!path, reload };
}
