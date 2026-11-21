import { loadSubjects, saveSubject, deleteSubject, subjectNameExists } from "../services/subjects.service.js";
import { $, showToast } from "../utils/dom.js";
import { escapeHTML, validSubjectColor, getErrorMessage } from "../utils/helpers.js";
import { t } from "../utils/i18n.js";

const SUBJECT_PALETTE = ["#7564e8", "#5b9bea", "#29a783", "#e59a3b", "#dc6d6d", "#7a879c", "#b46bd1", "#45a7b0", "#c88a5c", "#7c9b53", "#e271a2", "#5266b8"];

export function initSubjects({ state, onDataChanged }) {
  const pageContent = $(".page-content");
  const view = document.createElement("section");
  view.id = "subjects-page";
  view.className = "hidden";
  view.innerHTML = `<div class="subjects-toolbar"><div><h1>${t("subjects.title")}</h1><p>${t("subjects.subtitle")}</p></div><button type="button" class="primary-button" id="add-subject-button">${t("subjects.add")}</button></div><label class="subjects-search-field"><span aria-hidden="true">⌕</span><input id="subjects-search" type="search" placeholder="${t("subjects.searchPlaceholder")}" aria-label="${t("subjects.searchLabel")}"></label><div id="subjects-loading" class="subjects-loading hidden">${t("subjects.loading")}</div><div id="subjects-list" class="subjects-grid"></div><div id="subjects-empty" class="subjects-empty hidden">${t("subjects.empty")}</div>`;
  pageContent.append(view);

  const dialog = document.createElement("dialog");
  dialog.id = "subject-dialog";
  dialog.className = "subject-dialog";
  dialog.innerHTML = `<form id="subject-form" novalidate>
    <div class="dialog-heading"><div><span class="eyebrow">${t("layout.workspace")}</span><h2 id="subject-dialog-title">${t("subjects.add")}</h2></div><button type="button" class="close-button" id="close-subject-dialog" aria-label="${t("layout.close")}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg></button></div>
    <label class="field-label">${t("subjects.name")}<input id="subject-name" maxlength="80" aria-describedby="subject-name-error" aria-required="true" placeholder="${t("subjects.namePlaceholder")}"><span id="subject-name-error" class="field-error hidden" role="alert"></span></label>
    <div class="field-label subject-color-field"><span class="subject-color-label">${t("subjects.color")}</span><button type="button" class="subject-color-trigger" id="subject-color-trigger" aria-haspopup="dialog" aria-expanded="false"><span class="subject-color-trigger-swatch" id="subject-color-trigger-swatch"></span><span id="subject-color-trigger-value"></span><svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 7 5 5 5-5"></path></svg></button>
      <div class="subject-color-popover hidden" id="subject-color-popover" role="dialog" aria-label="${t("subjects.chooseColor")}"><div class="subject-color-popover-heading"><strong>${t("subjects.chooseColor")}</strong><button type="button" class="subject-color-close" id="close-subject-color" aria-label="${t("layout.close")}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg></button></div><div class="subject-color-grid" id="subject-color-swatches" role="group" aria-label="${t("subjects.chooseColor")}">${SUBJECT_PALETTE.map(color => `<button type="button" class="subject-color-option" data-color-option="${color}" style="--subject-color:${color}" aria-label="${t("subjects.colorOption", { color })}" aria-pressed="false" title="${color}"><span></span><svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 10 4 4 8-8"></path></svg></button>`).join("")}</div><label class="subject-custom-color"><span>${t("subjects.customColor")}</span><input id="subject-color" type="color" value="#7564e8" aria-label="${t("subjects.customColor")}" aria-describedby="subject-color-error"></label><span id="subject-color-error" class="field-error hidden" role="alert"></span></div>
    </div>
    <div class="dialog-actions"><button type="button" class="secondary-button" id="cancel-subject">${t("subjects.cancel")}</button><button type="submit" class="primary-button" id="save-subject">${t("subjects.create")}</button></div>
  </form>`;
  document.body.append(dialog);

  const list = $("#subjects-list", view);
  let searchTerm = "";
  const loading = $("#subjects-loading", view);
  const empty = $("#subjects-empty", view);
  let editingId = null;
  let busy = false;
  let fieldErrorKey = "";
  let colorErrorKey = "";
  const colorInput = $("#subject-color", dialog);
  const colorTrigger = $("#subject-color-trigger", dialog);
  const colorPopover = $("#subject-color-popover", dialog);
  const colorTriggerSwatch = $("#subject-color-trigger-swatch", dialog);
  const colorTriggerValue = $("#subject-color-trigger-value", dialog);

  function syncColorPicker() {
    const color = validSubjectColor(colorInput.value);
    colorTriggerSwatch.style.backgroundColor = color;
    colorTriggerValue.textContent = color.toUpperCase();
    colorTrigger.setAttribute("aria-label", `${t("subjects.chooseColor")}: ${color.toUpperCase()}`);
    colorPopover.querySelectorAll("[data-color-option]").forEach(option => {
      const selected = option.dataset.colorOption.toLowerCase() === color.toLowerCase();
      option.setAttribute("aria-pressed", String(selected));
      option.classList.toggle("is-selected", selected);
    });
  }

  function positionColorPicker() {
    if (colorPopover.classList.contains("hidden")) return;
    const triggerRect = colorTrigger.getBoundingClientRect();
    const popoverRect = colorPopover.getBoundingClientRect();
    const gap = 8;
    const maxLeft = Math.max(10, window.innerWidth - popoverRect.width - 10);
    const left = Math.min(Math.max(10, triggerRect.left), maxLeft);
    const below = triggerRect.bottom + gap;
    const top = below + popoverRect.height <= window.innerHeight - 10
      ? below
      : Math.max(10, triggerRect.top - popoverRect.height - gap);
    colorPopover.style.left = `${left}px`;
    colorPopover.style.top = `${top}px`;
  }

  function closeColorPicker(returnFocus = false) {
    colorPopover.classList.add("hidden");
    colorTrigger.setAttribute("aria-expanded", "false");
    if (returnFocus) colorTrigger.focus();
  }

  function openColorPicker() {
    syncColorPicker();
    colorPopover.classList.remove("hidden");
    colorTrigger.setAttribute("aria-expanded", "true");
    positionColorPicker();
    (colorPopover.querySelector("[aria-pressed='true']") || colorPopover.querySelector(".subject-color-option"))?.focus();
  }

  function setFieldError(message = "", key = "") {
    const input = $("#subject-name", dialog);
    const error = $("#subject-name-error", dialog);
    fieldErrorKey = key;
    input.setAttribute("aria-invalid", message ? "true" : "false");
    error.textContent = message;
    error.classList.toggle("hidden", !message);
  }

  function setColorError(message = "", key = "") {
    colorErrorKey = key;
    colorInput.setAttribute("aria-invalid", message ? "true" : "false");
    const error = $("#subject-color-error", dialog);
    error.textContent = message;
    error.classList.toggle("hidden", !message);
  }

  function render() {
    const counts = new Map();
    state.tasks.forEach(task => {
      if (task.subjectId != null) counts.set(String(task.subjectId), (counts.get(String(task.subjectId)) || 0) + 1);
    });
    const query = searchTerm.trim().normalize("NFKC").toLowerCase();
    const filteredSubjects = state.subjects.filter(subject => String(subject.name || "").normalize("NFKC").toLowerCase().includes(query));
    list.innerHTML = filteredSubjects.map(subject => {
      const color = validSubjectColor(subject.color);
      const count = counts.get(String(subject.id)) || 0;
      const whiteColor = color.toLowerCase() === "#ffffff";
      return `<article class="subject-card" style="--subject-color:${color}"><div class="subject-card-top"><span class="subject-color ${whiteColor ? "is-white" : ""}" style="background-color:${color}"></span><h2>${escapeHTML(subject.name)}</h2></div><p class="subject-task-count">${count} ${t(count === 1 ? "subjects.task" : "subjects.tasks")}</p><div class="subject-card-actions"><button type="button" data-subject-edit="${escapeHTML(subject.id)}">${t("subjects.edit")}</button><button type="button" class="subject-delete" data-subject-delete="${escapeHTML(subject.id)}">${t("tasks.delete")}</button></div></article>`;
    }).join("");
    empty.textContent = state.subjects.length && !filteredSubjects.length ? t("subjects.noMatches") : t("subjects.empty");
    empty.classList.toggle("hidden", filteredSubjects.length > 0 || !loading.classList.contains("hidden"));
    loading.classList.add("hidden");
  }

  function setNotice(text, type = "success") {
    if (text) showToast(text, type);
  }

  async function load({ reportError = true, renderAfter = true } = {}) {
    if (!state.user) return;
    const userId = state.user.id;
    try {
      state.subjects = await loadSubjects(userId);
      if (state.user?.id !== userId) return;
      if (renderAfter) render();
    } catch (error) {
      if (state.user?.id !== userId) return;
      state.subjects = [];
      if (renderAfter) render();
      if (reportError) setNotice(t("subjects.loadError", { error: getErrorMessage(error) }), "error");
    }
  }

  function showLoading() {
    loading.classList.remove("hidden");
    list.innerHTML = "";
    empty.classList.add("hidden");
  }

  function openForm(subject = null) {
    $("#subject-form", dialog).reset();
    setFieldError();
    setColorError();
    setNotice("");
    editingId = subject ? subject.id : null;
    $("#subject-dialog-title", dialog).textContent = subject ? t("subjects.edit") : t("subjects.add");
    $("#save-subject", dialog).textContent = subject ? t("subjects.save") : t("subjects.create");
    $("#subject-name", dialog).value = subject?.name || "";
    colorInput.value = validSubjectColor(subject?.color);
    syncColorPicker();
    closeColorPicker();
    dialog.showModal();
    if (!subject) requestAnimationFrame(() => { if (dialog.open && editingId === null) $("#subject-name", dialog).focus(); });
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || !state.user) return;
    const userId = state.user.id;
    const nameInput = $("#subject-name", dialog);
    const name = nameInput.value.trim();
    if (!name) {
      setFieldError(t("subjects.nameRequired"), "subjects.nameRequired");
      nameInput.focus();
      return;
    }
    const normalizedName = name.normalize("NFKC").toLowerCase();
    if (normalizedName === "general") {
      const message = t("subjects.reservedGeneral");
      setFieldError(message, "subjects.reservedGeneral");
      nameInput.focus();
      return;
    }
    const originalSubject = state.subjects.find(subject => String(subject.id) === String(editingId));
    if (colorInput.value.toLowerCase() === "#ffffff" && originalSubject?.color?.toLowerCase() !== "#ffffff") {
      setColorError(t("subjects.whiteColor"), "subjects.whiteColor");
      colorInput.focus();
      return;
    }
    setColorError();
    busy = true;
    const saveButton = $("#save-subject", dialog);
    saveButton.disabled = true;
    const isEditing = editingId !== null;
    try {
      const matchesName = subjectName => String(subjectName || "").trim().normalize("NFKC").toLowerCase() === normalizedName;
      const duplicate = state.subjects.some(subject => String(subject.id) !== String(editingId) && matchesName(subject.name));
      if (duplicate || await subjectNameExists(userId, name, editingId)) {
        const message = t("subjects.duplicate");
        setFieldError(message, "subjects.duplicate");
        nameInput.focus();
        return;
      }
      setFieldError();
      if (state.user?.id !== userId) return;
      const savedSubject = await saveSubject(userId, editingId, name, colorInput.value);
      if (state.user?.id !== userId) return;
      if (isEditing) {
        const index = state.subjects.findIndex(subject => String(subject.id) === String(editingId));
        if (index >= 0) state.subjects[index] = savedSubject;
      } else {
        state.subjects.push(savedSubject);
        state.subjects.sort((a, b) => a.name.localeCompare(b.name));
      }
      editingId = null;
      dialog.close();
      await onDataChanged({ type: "subjects" });
      setNotice(t(isEditing ? "subjects.updateSuccess" : "subjects.createSuccess"));
    } catch (error) {
      if (state.user?.id !== userId) return;
      if (error?.code === "23505") {
        setFieldError(t("subjects.duplicate"), "subjects.duplicate");
        nameInput.focus();
        return;
      }
      setNotice(t("subjects.saveError", { error: getErrorMessage(error) }), "error");
    } finally {
      busy = false;
      saveButton.disabled = false;
    }
  }

  async function remove(id) {
    if (busy || !state.user) return;
    const userId = state.user.id;
    const subject = state.subjects.find(item => String(item.id) === String(id));
    if (!subject || !window.confirm(t("subjects.deleteConfirm", { name: subject.name }))) return;
    busy = true;
    const deleteButton = Array.from(list.querySelectorAll("[data-subject-delete]"))
      .find(button => button.dataset.subjectDelete === String(id));
    if (deleteButton) deleteButton.disabled = true;
    try {
      await deleteSubject(userId, subject.id);
      if (state.user?.id !== userId) return;
      state.subjects = state.subjects.filter(item => String(item.id) !== String(id));
      await onDataChanged({ type: "subjects" });
      setNotice(t("subjects.deleteSuccess"));
    } catch (error) {
      if (state.user?.id !== userId) return;
      setNotice(t("subjects.deleteError", { error: getErrorMessage(error) }), "error");
    } finally { busy = false; if (deleteButton) deleteButton.disabled = false; }
  }

  $("#add-subject-button", view).addEventListener("click", () => openForm());
  $("#close-subject-dialog", dialog).addEventListener("click", () => { editingId = null; dialog.close(); });
  $("#cancel-subject", dialog).addEventListener("click", () => { editingId = null; dialog.close(); });
  colorTrigger.addEventListener("click", () => colorTrigger.getAttribute("aria-expanded") === "true" ? closeColorPicker() : openColorPicker());
  $("#close-subject-color", dialog).addEventListener("click", () => closeColorPicker(true));
  colorPopover.addEventListener("click", event => {
    const option = event.target.closest("[data-color-option]");
    if (!option) return;
    colorInput.value = option.dataset.colorOption;
    syncColorPicker();
    closeColorPicker(true);
  });
  colorInput.addEventListener("input", () => { syncColorPicker(); if (colorInput.value.toLowerCase() !== "#ffffff") setColorError(); });
  colorInput.addEventListener("change", () => { syncColorPicker(); if (colorInput.value.toLowerCase() !== "#ffffff") setColorError(); });
  colorPopover.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); closeColorPicker(true); } });
  document.addEventListener("pointerdown", event => {
    if (!colorPopover.classList.contains("hidden") && !colorPopover.contains(event.target) && !colorTrigger.contains(event.target)) closeColorPicker();
  });
  const repositionColorPicker = () => positionColorPicker();
  window.addEventListener("resize", repositionColorPicker);
  dialog.addEventListener("scroll", repositionColorPicker, true);
  $("#subject-name", dialog).addEventListener("input", event => {
    if (event.target.value.trim()) setFieldError();
  });
  $("#subject-form", dialog).addEventListener("submit", submit);
  $("#subjects-search", view).addEventListener("input", event => { searchTerm = event.target.value; render(); });
  list.addEventListener("click", event => {
    const edit = event.target.closest("[data-subject-edit]");
    if (edit) {
      const subject = state.subjects.find(item => String(item.id) === edit.dataset.subjectEdit);
      if (subject) openForm(subject);
      return;
    }
    const deleteButton = event.target.closest("[data-subject-delete]");
    if (deleteButton) remove(deleteButton.dataset.subjectDelete);
  });

  function refreshLanguage() {
    const toolbar = view.querySelector(".subjects-toolbar");
    toolbar.querySelector("h1").textContent = t("subjects.title");
    toolbar.querySelector("p").textContent = t("subjects.subtitle");
    $("#add-subject-button", view).textContent = t("subjects.add");
    $("#subjects-loading", view).textContent = t("subjects.loading");
    $("#subjects-search", view).placeholder = t("subjects.searchPlaceholder");
    $("#subjects-search", view).setAttribute("aria-label", t("subjects.searchLabel"));
    if (fieldErrorKey) setFieldError(t(fieldErrorKey), fieldErrorKey);
    if (colorErrorKey) setColorError(t(colorErrorKey), colorErrorKey);
    empty.textContent = state.subjects.length && !list.children.length ? t("subjects.noMatches") : t("subjects.empty");
    const labels = dialog.querySelectorAll(".field-label");
    labels[0].childNodes[0].textContent = t("subjects.name");
    dialog.querySelector(".subject-color-label").textContent = t("subjects.color");
    $("#subject-name", dialog).placeholder = t("subjects.namePlaceholder");
    colorInput.setAttribute("aria-label", t("subjects.customColor"));
    colorPopover.setAttribute("aria-label", t("subjects.chooseColor"));
    $("#subject-color-swatches", dialog).setAttribute("aria-label", t("subjects.chooseColor"));
    $("#close-subject-color", dialog).setAttribute("aria-label", t("layout.close"));
    dialog.querySelector(".subject-custom-color span").textContent = t("subjects.customColor");
    colorPopover.querySelector(".subject-color-popover-heading strong").textContent = t("subjects.chooseColor");
    colorPopover.querySelectorAll("[data-color-option]").forEach(option => option.setAttribute("aria-label", t("subjects.colorOption", { color: option.dataset.colorOption })));
    syncColorPicker();
    $("#close-subject-dialog", dialog).setAttribute("aria-label", t("layout.close"));
    $("#cancel-subject", dialog).textContent = t("subjects.cancel");
    $("#subject-dialog-title", dialog).textContent = editingId === null ? t("subjects.add") : t("subjects.edit");
    $("#save-subject", dialog).textContent = editingId === null ? t("subjects.create") : t("subjects.save");
    render();
  }
  refreshLanguage();

  return { view, dialog, load, render, showLoading, setNotice, refreshLanguage };
}




