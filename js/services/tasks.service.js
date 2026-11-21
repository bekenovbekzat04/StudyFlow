import { supabaseClient } from "../config/supabase.js";
import { toDatabaseStatus } from "../utils/helpers.js";

const TASK_COLUMNS = "id,user_id,subject_id,title,description,due_date,status,priority,created_at,deleted_at,deleted_subject_name,deleted_subject_color";

export async function loadTasks(userId) {
  const { data, error } = await supabaseClient.from("tasks")
    .select(`${TASK_COLUMNS},task_subtasks(id,title,is_completed,position,created_at,updated_at)`)
    .eq("user_id", userId).is("deleted_at", null).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function saveTaskWithSubtasks(userId, taskId, task, subtasks) {
  const { data, error } = await supabaseClient.rpc("studyflow_save_task_with_subtasks_20261121", {
    p_task_id: taskId,
    p_subject_id: task.subject_id,
    p_title: task.title,
    p_description: task.description,
    p_due_date: task.due_date,
    p_status: toDatabaseStatus(task.status),
    p_priority: task.priority,
    p_subtasks: subtasks.map((subtask, position) => ({
      id: subtask.id || null,
      title: subtask.title,
      is_completed: Boolean(subtask.is_completed),
      position
    }))
  });
  if (error) throw error;
  if (!data?.task) throw new Error("Task was not saved.");
  return data.task;
}

export async function completeTaskWithSubtasks(userId, taskId) {
  const { data, error } = await supabaseClient.rpc("studyflow_complete_tasks_with_subtasks_20261121", {
    p_task_ids: [taskId]
  });
  if (error) throw error;
  if (!Array.isArray(data) || data.length !== 1) throw new Error("Task was not found or you do not have permission to update it.");
  return data[0];
}

export async function completeTasksWithSubtasks(userId, taskIds) {
  if (!taskIds.length) return [];
  const { data, error } = await supabaseClient.rpc("studyflow_complete_tasks_with_subtasks_20261121", {
    p_task_ids: taskIds
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function createTask(userId, task) {
  const status = toDatabaseStatus(task.status);
  if (status === "completed") {
    throw new Error("Use the transactional subtask-aware task save and completion paths.");
  }
  const { data, error } = await supabaseClient.from("tasks").insert({
    user_id: userId,
    subject_id: task.subject_id,
    title: task.title,
    description: task.description,
    due_date: task.due_date,
    status,
    priority: task.priority
  }).select(TASK_COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function updateTask(userId, taskId, task) {
  const status = toDatabaseStatus(task.status);
  if (status === "completed") {
    throw new Error("Use the transactional subtask-aware task save and completion paths.");
  }
  const { data, error } = await supabaseClient.from("tasks").update({
    subject_id: task.subject_id,
    title: task.title,
    description: task.description,
    due_date: task.due_date,
    status,
    priority: task.priority
  }).eq("id", taskId).eq("user_id", userId).is("deleted_at", null).select(TASK_COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Task was not found or you do not have permission to edit it.");
  return data;
}

export async function updateTaskStatus(userId, taskId, status) {
  const normalizedStatus = toDatabaseStatus(status);
  if (normalizedStatus === "completed") {
    throw new Error("Use completeTaskWithSubtasks for parent completion.");
  }
  const { data, error } = await supabaseClient.from("tasks")
    .update({ status: normalizedStatus })
    .eq("id", taskId).eq("user_id", userId).is("deleted_at", null).select(TASK_COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Task was not found or you do not have permission to update it.");
  return data;
}

export async function updateTasksStatus(userId, taskIds, status) {
  if (!taskIds.length) return [];
  const normalizedStatus = toDatabaseStatus(status);
  if (normalizedStatus === "completed") {
    throw new Error("Use completeTasksWithSubtasks for parent completion.");
  }
  const { data, error } = await supabaseClient.from("tasks")
    .update({ status: normalizedStatus })
    .eq("user_id", userId).is("deleted_at", null).in("id", taskIds)
    .select(TASK_COLUMNS);
  if (error) throw error;
  return data || [];
}

export async function archiveTask(userId, taskId) {
  const { data, error } = await supabaseClient.from("tasks").update({ deleted_at: new Date().toISOString() })
    .eq("id", taskId).eq("user_id", userId).is("deleted_at", null).select(TASK_COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Task was not found or you do not have permission to archive it.");
  return data;
}

export async function archiveTasks(userId, taskIds) {
  if (!taskIds.length) return [];
  const { data, error } = await supabaseClient.from("tasks").update({ deleted_at: new Date().toISOString() })
    .eq("user_id", userId).is("deleted_at", null).in("id", taskIds).select(TASK_COLUMNS);
  if (error) throw error;
  return data || [];
}

export async function loadArchivedTasks(userId) {
  const { data, error } = await supabaseClient.from("tasks")
    .select(TASK_COLUMNS).eq("user_id", userId).not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function restoreTask(userId, taskId) {
  const result = await restoreTasks(userId, [taskId]);
  if (!result.rows[0]) throw new Error("Archived task was not found or you do not have permission to restore it.");
  return { ...result.rows[0], _subjectRecreated: result.recreatedSubjectCount > 0, _restoredSubjects: result.subjects };
}

export async function restoreTasks(userId, taskIds, { completed = false } = {}) {
  if (!taskIds.length) return { rows: [], recreatedSubjectCount: 0 };
  const { data, error } = await supabaseClient.rpc("studyflow_restore_archived_tasks_20261119", {
    p_task_ids: taskIds,
    p_completed: completed
  });
  if (error) throw error;
  const rows = Array.isArray(data?.tasks) ? data.tasks : [];
  if (rows.length !== taskIds.length) throw new Error("Not every selected archived task could be restored.");
  return { rows, recreatedSubjectCount: Number(data?.recreated_subjects) || 0, subjects: Array.isArray(data?.subjects) ? data.subjects : [] };
}

export async function permanentlyDeleteArchivedTask(userId, taskId) {
  const { data, error } = await supabaseClient.from("tasks").delete()
    .eq("id", taskId).eq("user_id", userId).not("deleted_at", "is", null).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Archived task was not found or you do not have permission to delete it.");
}

export async function permanentlyDeleteArchivedTasks(userId, taskIds) {
  if (!taskIds.length) return [];
  const { data, error } = await supabaseClient.from("tasks").delete()
    .eq("user_id", userId).not("deleted_at", "is", null).in("id", taskIds).select("id");
  if (error) throw error;
  return data || [];
}
