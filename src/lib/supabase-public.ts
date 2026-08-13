import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  const missing = [
    ...(!supabaseUrl ? ["VITE_SUPABASE_URL"] : []),
    ...(!supabasePublishableKey ? ["VITE_SUPABASE_PUBLISHABLE_KEY"] : []),
  ];
  throw new Error(`Missing public Supabase environment variable(s): ${missing.join(", ")}`);
}

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: typeof window !== "undefined" ? localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});
