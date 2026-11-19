import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DAY_MS = 24 * 60 * 60 * 1000;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
  } catch (_) {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return response({ error: "Account recovery is not configured" }, 503);

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return response({ error: "Authentication required" }, 401);

  const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return response({ error: "Session is invalid or expired" }, 401);
  const user = authData.user;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: { action?: string };
  try { body = await request.json(); } catch (_) { return response({ error: "Invalid request body" }, 400); }
  const action = body.action;

  if (action === "status") {
    const [profileResult, claimResult] = await Promise.all([
      admin.from("profiles").select("id,deletion_requested_at").eq("id", user.id).maybeSingle(),
      admin.from("studyflow_account_deletion_queue_20261118")
        .select("deletion_requested_at,claimed_at").eq("user_id", user.id).maybeSingle()
    ]);
    if (profileResult.error) return response({ error: "Could not read account status" }, 500);
    if (claimResult.error) return response({ error: "Could not read account recovery status" }, 500);
    const claimedAt = claimResult.data?.claimed_at;
    const requestedAtValue = claimedAt
      ? claimResult.data?.deletion_requested_at
      : profileResult.data?.deletion_requested_at;
    if (!requestedAtValue) return response({ pendingDeletion: null });
    const requestedAt = new Date(requestedAtValue);
    if (Number.isNaN(requestedAt.getTime())) return response({ error: "Invalid deletion request timestamp" }, 500);
    return response({ pendingDeletion: {
      requestedAt: requestedAt.toISOString(),
      deletionDeadline: new Date(requestedAt.getTime() + 30 * DAY_MS).toISOString(),
      state: claimedAt ? "claimed" : "pending",
    } });
  }

  if (action === "request") {
    const providers = user.app_metadata?.providers || [];
    if (user.app_metadata?.provider !== "email" && !providers.includes("email")) {
      return response({ error: "Password reauthentication is not supported for this sign-in provider" }, 400);
    }
    // getUser above validates the signed token; inspect its AMR only afterward.
    const claims = decodeJwtPayload(token);
    const amr = Array.isArray(claims?.amr) ? claims.amr as Array<Record<string, unknown>> : [];
    const nowSeconds = Math.floor(Date.now() / 1000);
    const recentlyPasswordAuthenticated = amr.some(item => item.method === "password"
      && typeof item.timestamp === "number"
      && nowSeconds >= item.timestamp
      && nowSeconds - item.timestamp <= 10 * 60);
    if (!recentlyPasswordAuthenticated) return response({ error: "Please sign in again with your password before scheduling deletion" }, 401);

    const { data: updated, error } = await admin.from("profiles")
      .update({ deletion_requested_at: new Date().toISOString() })
      .eq("id", user.id).is("deletion_requested_at", null)
      .select("id,deletion_requested_at").maybeSingle();
    if (error) return response({ error: "Could not schedule account deletion" }, 500);
    if (!updated) return response({ error: "Account deletion is already scheduled" }, 409);
    const requestedAt = new Date(updated.deletion_requested_at);
    return response({ pendingDeletion: {
      requestedAt: requestedAt.toISOString(),
      deletionDeadline: new Date(requestedAt.getTime() + 30 * DAY_MS).toISOString(),
    } });
  }

  if (action === "restore") {
    const { data: result, error } = await admin.rpc(
      "studyflow_account_deletion_restore_20261118",
      { p_user_id: user.id },
    );
    if (error) return response({ error: "Could not restore account access" }, 500);
    if (result?.status === "claimed") {
      return response({ status: "claimed", pendingDeletion: {
        requestedAt: result.requestedAt,
        deletionDeadline: result.deletionDeadline,
        state: "claimed",
      } });
    }
    if (result?.status === "expired") return response({ status: "expired" });
    if (result?.status === "not_pending") return response({ status: "not_pending" });
    if (result?.status !== "restored" || !result.profile) return response({ error: "Could not restore account access" }, 500);
    return response({ status: "restored", profile: result.profile });
  }

  return response({ error: "Unknown account recovery action" }, 400);
});
