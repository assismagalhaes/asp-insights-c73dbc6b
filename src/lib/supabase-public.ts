import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const PUBLIC_SUPABASE_URL = "https://rdasrnvwedasshiahjuy.supabase.co";
const PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkYXNybnZ3ZWRhc3NoaWFoanV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3ODAxNDYsImV4cCI6MjA5NjM1NjE0Nn0.KMzVfW-MOO14Jzls66NFpsRw6TQgT1zy81USY_R9qNQ";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: typeof window !== "undefined" ? localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});