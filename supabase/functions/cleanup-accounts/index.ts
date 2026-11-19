import { createClient } from "npm:@supabase/supabase-js@2";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a[i % (a.length || 1)] || 0) ^ (b[i % (b.length || 1)] || 0);
  return diff === 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const expectedToken = Deno.env.get("ACCOUNT_CLEANUP_TOKEN") || "";
  const suppliedToken = request.headers.get("x-studyflow-cleanup-token") || "";
  if (!expectedToken || !constantTimeEqual(suppliedToken, expectedToken)) return json({ error: "Unauthorized" }, 401);
  if (Deno.env.get("ACCOUNT_STORAGE_AUDIT_CONFIRMED") !== "true") {
    return json({ error: "Verify user-owned Storage and database resources before enabling cleanup" }, 503);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Cleanup is not configured" }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const cutoff = new Date(Date.now() - 30 * DAY_MS).toISOString();

  const { data: expiredProfiles, error: expiredError } = await admin.from("profiles")
    .select("id")
    .not("deletion_requested_at", "is", null)
    .lte("deletion_requested_at", cutoff)
    .limit(PAGE_SIZE);
  if (expiredError) return json({ error: "Could not list expired requests" }, 500);

  let claimFailures = 0;
  for (const candidate of expiredProfiles || []) {
    const { error } = await admin.rpc(
      "studyflow_account_deletion_claim_20261118",
      { p_user_id: candidate.id },
    );
    if (error) claimFailures += 1;
  }

  const { data: queued, error: queueError } = await admin
    .from("studyflow_account_deletion_queue_20261118")
    .select("user_id,deletion_requested_at,claimed_at")
    .lte("deletion_requested_at", cutoff)
    .order("queued_at", { ascending: true })
    .limit(PAGE_SIZE);
  if (queueError) return json({ error: "Could not load cleanup queue" }, 500);

  let deleted = 0;
  let failed = claimFailures;
  for (const item of queued || []) {
    const userId = item.user_id as string;
    const requestAt = new Date(item.deletion_requested_at as string);
    const claimedAt = new Date(item.claimed_at as string);
    if (!Number.isFinite(claimedAt.getTime())
      || Number.isNaN(requestAt.getTime())
      || requestAt.getTime() > Date.now() - 30 * DAY_MS) {
      failed += 1;
      continue;
    }
    const exactRequestAt = requestAt.toISOString();

    const { data: currentProfile, error: profileReadError } = await admin.from("profiles")
      .select("id,deletion_requested_at").eq("id", userId).maybeSingle();
    if (profileReadError) { failed += 1; continue; }
    if (currentProfile) {
      const currentRequest = new Date(currentProfile.deletion_requested_at || "");
      if (Number.isNaN(currentRequest.getTime())
        || currentRequest.toISOString() !== exactRequestAt
        || currentRequest.getTime() > Date.now() - 30 * DAY_MS) {
        // Preserve the claim for investigation; never silently discard it.
        failed += 1;
        continue;
      }
    }

    // Dependent rows are removed first; any failure leaves the queue for retry.
    const { error: tasksError } = await admin.from("tasks").delete().eq("user_id", userId);
    if (tasksError) { failed += 1; continue; }
    const { error: subjectsError } = await admin.from("subjects").delete().eq("user_id", userId);
    if (subjectsError) { failed += 1; continue; }
    const { error: profileDeleteError } = await admin.from("profiles").delete()
      .eq("id", userId).eq("deletion_requested_at", exactRequestAt);
    if (profileDeleteError) { failed += 1; continue; }

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId);
    const isAlreadyGone = authDeleteError && (authDeleteError.status === 404 || /not found|user.*does not exist/i.test(authDeleteError.message));
    if (authDeleteError && !isAlreadyGone) { failed += 1; continue; }
    const { error: queueDeleteError } = await admin
      .from("studyflow_account_deletion_queue_20261118")
      .delete().eq("user_id", userId);
    if (queueDeleteError) { failed += 1; continue; }
    deleted += 1;
  }

  return json({ processed: queued?.length || 0, deleted, failed });
});
