import { supabaseClient } from "../config/supabase.js";
import { hasSavedLanguage, setLanguage, t } from "../utils/i18n.js";

async function upsertProfile(user, fullName) {
  const name = (fullName || (user.user_metadata && user.user_metadata.full_name) || user.email || "Student").trim();
  const languageSelect = document.getElementById("language-select");
  const language = languageSelect && ["en", "ru", "kk"].includes(languageSelect.value) ? languageSelect.value : "en";
  const { data, error } = await supabaseClient.from("profiles")
    .upsert({ id: user.id, full_name: name, preferred_language: language }, { onConflict: "id" })
    .select(PROFILE_COLUMNS).single();
  if (error) throw error;
  return data;
}

const PROFILE_COLUMNS = "id,full_name,preferred_language,created_at,bio,university,major,year,timezone";

export async function signUp(email, password, fullName) {
  const result = await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  if (result.error) throw result.error;
  const profileResult = result.data.user && result.data.session
    ? await tryUpsertProfile(result.data.user, fullName)
    : { profile: null, profileError: null };
  return { ...result.data, ...profileResult };
}

export async function signIn(email, password) {
  const result = await supabaseClient.auth.signInWithPassword({ email, password });
  if (result.error) throw result.error;
  const profileResult = await syncProfileLanguageAndUpsert(result.data.user);
  return { ...result.data, ...profileResult };
}

export function signOut() {
  return supabaseClient.auth.signOut();
}

export async function restoreSession() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  if (!data.session?.user) return { user: null, profile: null };
  const profileResult = await syncProfileLanguageAndUpsert(data.session.user);
  return { user: data.session.user, ...profileResult };
}

async function tryUpsertProfile(user, fullName) {
  try {
    return { profile: await upsertProfile(user, fullName), profileError: null };
  } catch (profileError) {
    return { profile: { full_name: fullName || user.user_metadata?.full_name || user.email }, profileError };
  }
}

async function syncProfileLanguageAndUpsert(user) {
  try {
    const { data, error } = await supabaseClient.from("profiles")
      .select(PROFILE_COLUMNS).eq("id", user.id).maybeSingle();
    if (error) throw error;
    if (!data) return tryUpsertProfile(user);
    if (!hasSavedLanguage() && ["en", "ru", "kk"].includes(data.preferred_language)) {
      setLanguage(data.preferred_language);
      const selector = document.getElementById("language-select");
      if (selector) selector.value = data.preferred_language;
    }
    return { profile: data, profileError: null };
  } catch (profileError) {
    // A failed read is not proof that the row is missing. Avoid an upsert here:
    // it can overwrite nullable profile fields when the failure was transient.
    return { profile: null, profileError };
  }
}

export function onAuthStateChange(callback) {
  return supabaseClient.auth.onAuthStateChange(callback);
}

export async function savePreferredLanguage(user, language, fullName) {
  const { data, error } = await supabaseClient.from("profiles").update({ preferred_language: language })
    .eq("id", user.id).select("id").maybeSingle();
  if (error) throw error;
  if (data) return;
  const name = (fullName || user.user_metadata?.full_name || user.email || "Student").trim();
  await upsertProfile(user, name);
}

export async function loadProfile(userId) {
  const { data, error } = await supabaseClient.from("profiles")
    .select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveProfileFields(userId, fields) {
  const allowed = ["full_name", "bio", "university", "major", "year", "timezone"];
  const patch = Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.includes(key)));
  if (!Object.keys(patch).length) return loadProfile(userId);
  const { data, error } = await supabaseClient.from("profiles").update(patch)
    .eq("id", userId).select(PROFILE_COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(t("profile.notFound"));
  return data;
}

export async function saveDetectedTimezone(userId, timezone) {
  const { data, error } = await supabaseClient.from("profiles").update({ timezone })
    .eq("id", userId).is("timezone", null).select(PROFILE_COLUMNS).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateProfileAndAuth(user, fields) {
  const errors = [];
  let refreshedProfile = null;
  let profileWriteFailed = false;
  const writes = [saveProfileFields(user.id, fields).then(profile => { refreshedProfile = profile; }).catch(error => {
    profileWriteFailed = true;
    errors.push({ source: "profile", error });
  })];
  const nameChanged = Object.prototype.hasOwnProperty.call(fields, "full_name");
  if (nameChanged) {
    writes.push((async () => {
      const { error } = await supabaseClient.auth.updateUser({ data: { full_name: fields.full_name } });
      if (error) throw error;
    })().catch(error => errors.push({ source: "auth", error })));
  }
  await Promise.all(writes);

  let refreshedUser = user;
  const refreshes = [];
  if (nameChanged) {
    refreshes.push(supabaseClient.auth.getUser().then(result => {
      if (result.error) throw result.error;
      if (result.data.user) refreshedUser = result.data.user;
    }).catch(error => errors.push({ source: "authRefresh", error })));
  }
  if (profileWriteFailed || !refreshedProfile) {
    refreshes.push(loadProfile(user.id).then(profile => {
      refreshedProfile = profile;
      if (!profile) throw new Error(t("profile.notFound"));
    }).catch(error => errors.push({ source: "profileRefresh", error })));
  }
  await Promise.all(refreshes);
  return { user: refreshedUser, profile: refreshedProfile, errors };
}
