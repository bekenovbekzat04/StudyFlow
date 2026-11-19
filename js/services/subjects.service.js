import { supabaseClient } from "../config/supabase.js";

export async function loadSubjects(userId) {
  const { data, error } = await supabaseClient.from("subjects")
    .select("id,user_id,name,color").eq("user_id", userId).order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function subjectNameExists(userId, name, excludedId = null) {
  const normalizedName = String(name || "").trim().normalize("NFKC").toLowerCase();
  const { data, error } = await supabaseClient.from("subjects").select("id,name")
    .eq("user_id", userId);
  if (error) throw error;
  return (data || []).some(subject => String(subject.id) !== String(excludedId) &&
    String(subject.name || "").trim().normalize("NFKC").toLowerCase() === normalizedName);
}

export async function resolveTaskSubject(userId, selectedId) {
  if (!selectedId) return null;
  const subject = await supabaseClient.from("subjects").select("id,user_id,name,color")
    .eq("id", selectedId).eq("user_id", userId).maybeSingle();
  if (subject.error) throw subject.error;
  if (!subject.data) throw new Error("That subject is no longer available. Refresh and try again.");
  return subject.data;
}

export async function saveSubject(userId, subjectId, name, color) {
  if (subjectId != null) {
    const { data, error } = await supabaseClient.from("subjects").update({ name, color })
      .eq("id", subjectId).eq("user_id", userId).select("id,user_id,name,color").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Subject was not found or you do not have permission to edit it.");
    return data;
  }
  const { data, error } = await supabaseClient.from("subjects")
    .insert({ user_id: userId, name, color }).select("id,user_id,name,color").single();
  if (error) throw error;
  return data;
}

export async function deleteSubject(userId, subjectId) {
  const linkedTask = await supabaseClient.from("tasks").select("id")
    .eq("user_id", userId).eq("subject_id", subjectId).is("deleted_at", null).limit(1);
  if (linkedTask.error) throw linkedTask.error;
  if (linkedTask.data?.length) {
    throw new Error("This subject still has tasks. Reassign or delete those tasks first; no tasks were changed.");
  }
  const { data, error } = await supabaseClient.from("subjects").delete()
    .eq("id", subjectId).eq("user_id", userId).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Subject was not found or you do not have permission to delete it.");
}
