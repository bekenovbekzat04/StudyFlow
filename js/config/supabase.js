// Supabase JS v2 is loaded from the CDN before js/app.js in index.html.
// This static frontend config is public. Never put a Supabase secret or service-role key here.
const SUPABASE_URL = "https://xxoszflwsvmawivpylzb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_8uYY2P1DoLgjc2mXJhNMVA_6sSblWH3";

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  throw new Error("Supabase JS did not load. Check the CDN script in index.html.");
}

export const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
