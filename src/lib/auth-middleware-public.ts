import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const PUBLIC_SUPABASE_URL = "https://rdasrnvwedasshiahjuy.supabase.co";
const PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkYXNybnZ3ZWRhc3NoaWFoanV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3ODAxNDYsImV4cCI6MjA5NjM1NjE0Nn0.KMzVfW-MOO14Jzls66NFpsRw6TQgT1zy81USY_R9qNQ";

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const SUPABASE_URL = process.env.SUPABASE_URL || PUBLIC_SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY =
      process.env.SUPABASE_PUBLISHABLE_KEY || PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    const request = getRequest();
    if (!request?.headers) {
      throw new Error("Unauthorized: No request headers available");
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new Error("Unauthorized: missing bearer token");
    }
    const token = authHeader.replace("Bearer ", "");
    if (!token) throw new Error("Unauthorized: No token provided");

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) {
      throw new Error("Unauthorized: Invalid token");
    }

    return next({
      context: { supabase, userId: data.claims.sub, claims: data.claims },
    });
  },
);
