import { loadProfile, saveDetectedTimezone, updateProfileAndAuth } from "../services/auth.service.js";
import { escapeHTML, getErrorMessage } from "../utils/helpers.js";
import { t, translateDocument, getLanguage } from "../utils/i18n.js";
import { $ } from "../utils/dom.js";

const PROFILE_FIELDS = ["full_name", "bio", "university", "major", "year", "timezone"];

export function initProfileSettings({ state, onProfileChanged, auth }) {
  const dialog = document.createElement("dialog");
  dialog.id = "profile-settings-dialog";
  dialog.className = "profile-settings-dialog";
  dialog.innerHTML = `
    <form id="profile-settings-form" class="profile-settings-form" novalidate>
      <div class="profile-settings-heading">
        <div><span class="eyebrow" data-i18n="layout.workspace">Workspace</span><h2 data-i18n="profile.title">Profile settings</h2><p data-i18n="profile.subtitle">Manage your personal and regional information.</p></div>
        <button type="button" class="close-button" id="profile-settings-close" aria-label="${t("layout.close")}" data-i18n-aria="layout.close">&#215;</button>
      </div>
      <div class="profile-settings-status" id="profile-settings-status" role="status" aria-live="polite"></div>
      <section class="profile-settings-section">
        <h3 data-i18n="profile.personal">Personal information</h3>
        <div class="profile-settings-grid">
          <label class="profile-settings-field profile-settings-field-wide"><span data-i18n="profile.fullName">Full name</span><input name="full_name" autocomplete="name" maxlength="100" required aria-describedby="profile-error-full-name"><small class="profile-field-error" id="profile-error-full-name"></small></label>
          <label class="profile-settings-field profile-settings-field-wide"><span data-i18n="profile.bio">About me</span><textarea name="bio" maxlength="1000" rows="3" placeholder="A little about you" data-i18n-placeholder="profile.bioPlaceholder"></textarea><small class="profile-field-error" id="profile-error-bio"></small></label>
          <label class="profile-settings-field"><span data-i18n="profile.university">University</span><input name="university" maxlength="160" placeholder="Your university" data-i18n-placeholder="profile.universityPlaceholder"></label>
          <label class="profile-settings-field"><span data-i18n="profile.major">Major</span><input name="major" maxlength="160" placeholder="Your field of study" data-i18n-placeholder="profile.majorPlaceholder"></label>
          <label class="profile-settings-field"><span data-i18n="profile.year">Study year</span><input name="year" maxlength="40" placeholder="e.g. Year 2" data-i18n-placeholder="profile.yearPlaceholder"></label>
        </div>
      </section>
      <section class="profile-settings-section">
        <h3 data-i18n="profile.regional">Regional preferences</h3>
        <label class="profile-settings-field"><span class="profile-timezone-heading"><span data-i18n="profile.timezone">Timezone</span><time id="profile-timezone-clock" data-i18n-aria="profile.localTime" aria-label="Current time in selected timezone">--:--</time></span><input name="timezone" list="profile-timezone-options" maxlength="80" placeholder="Search or enter an IANA timezone" data-i18n-placeholder="profile.timezonePlaceholder" aria-describedby="profile-timezone-hint profile-error-timezone"><datalist id="profile-timezone-options"></datalist><small class="profile-field-error" id="profile-error-timezone"></small></label>
        <p class="profile-settings-hint" id="profile-timezone-hint" data-i18n="profile.timezoneHint">Detected automatically when no timezone is saved.</p>
      </section>
      <section class="profile-settings-section">
        <h3 data-i18n="profile.account">Account information</h3>
        <div class="profile-settings-grid">
          <label class="profile-settings-field"><span data-i18n="profile.email">Email address</span><input name="email" type="email" readonly></label>
          <label class="profile-settings-field"><span data-i18n="profile.registered">Registered</span><input name="registered" readonly></label>
        </div>
      </section>
      <div class="profile-settings-actions"><button type="button" class="secondary-button" id="profile-settings-cancel" data-i18n="profile.cancel">Cancel</button><button type="submit" class="primary-button" id="profile-settings-save" data-i18n="profile.save">Save changes</button></div>
    </form>`;
  document.body.append(dialog);

  const form = $("#profile-settings-form", dialog);
  const status = $("#profile-settings-status", dialog);
  const saveButton = $("#profile-settings-save", dialog);
  const editButton = $("#profile-edit");
  let baseline = null;
  let busy = false;
  let statusState = null;
  let errorMessages = null;
  let clockInterval = null;

  function removeLanguageControls() {
    dialog.querySelectorAll("select.language-select,[data-language-select],.sf-auth-language").forEach(control => control.remove());
  }
  removeLanguageControls();

  function currentValues() {
    return Object.fromEntries(PROFILE_FIELDS.map(field => [field, form.elements[field].value.trim()]));
  }

  function isDirty() {
    if (!baseline) return false;
    const values = currentValues();
    return PROFILE_FIELDS.some(field => values[field] !== baseline[field]);
  }

  function setStatus(key, variables = {}, type = "") {
    errorMessages = null;
    statusState = key ? { key, variables, type } : null;
    status.textContent = key ? t(key, variables) : "";
    status.classList.toggle("error", type === "error");
  }

  function setFieldError(field, message = "") {
    const target = $(`#profile-error-${field === "full_name" ? "full-name" : field}`, dialog);
    if (target) target.textContent = message;
    const input = form.elements[field];
    if (input) input.setAttribute("aria-invalid", String(Boolean(message)));
  }

  function detectTimezone() {
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return isValidTimezone(timezone) ? timezone : "";
    } catch (_) {
      return "";
    }
  }

  function isValidTimezone(value) {
    if (!value) return false;
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());
      return true;
    } catch (_) {
      return false;
    }
  }

  function updateTimezoneClock() {
    const clock = $("#profile-timezone-clock", dialog);
    const timezone = form.elements.timezone.value.trim();
    if (!timezone || !isValidTimezone(timezone)) {
      clock.textContent = "--:--";
      clock.removeAttribute("datetime");
      return;
    }
    try {
      const now = new Date();
      const locale = getLanguage() === "kk" ? "kk-KZ" : getLanguage() === "ru" ? "ru-RU" : "en-US";
      clock.textContent = new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }).format(now);
      clock.dateTime = now.toISOString();
    } catch (_) {
      clock.textContent = "--:--";
      clock.removeAttribute("datetime");
    }
  }

  function stopTimezoneClock() {
    if (clockInterval !== null) {
      window.clearInterval(clockInterval);
      clockInterval = null;
    }
  }

  function startTimezoneClock() {
    stopTimezoneClock();
    updateTimezoneClock();
    clockInterval = window.setInterval(updateTimezoneClock, 60_000);
  }

  function populateTimezoneOptions() {
    const datalist = $("#profile-timezone-options", dialog);
    let zones = [];
    try {
      if (typeof Intl.supportedValuesOf === "function") zones = Intl.supportedValuesOf("timeZone");
    } catch (_) { /* Manual IANA input remains available. */ }
    datalist.innerHTML = zones.map(zone => `<option value="${escapeHTML(zone)}"></option>`).join("");
  }

  function formatRegistrationDate(value) {
    if (!value) return t("profile.none");
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t("profile.none");
    const locale = getLanguage() === "kk" ? "kk-KZ" : getLanguage() === "ru" ? "ru-RU" : "en-US";
    return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(date);
  }

  function fillForm(profile, user) {
    const values = {};
    PROFILE_FIELDS.forEach(field => {
      values[field] = String(profile?.[field] ?? (field === "full_name" ? user.user_metadata?.full_name || "" : "")).trim();
      form.elements[field].value = values[field];
      setFieldError(field);
    });
    form.elements.email.value = user.email || "";
    form.elements.registered.value = formatRegistrationDate(user.created_at);
    baseline = values;
  }

  async function loadCurrentProfile() {
    const user = state.user;
    let profile = state.profile?.id === user.id
      ? state.profile
      : await loadProfile(user.id);
    if (state.user?.id !== user.id) return null;
    if (!profile) throw new Error(t("profile.notFound"));
    let timezoneWarning = "";
    if (!String(profile.timezone || "").trim()) {
      const detected = detectTimezone();
      if (detected) {
        try {
          const updatedProfile = await saveDetectedTimezone(user.id, detected);
          profile = updatedProfile || await loadProfile(user.id) || profile;
        } catch (error) {
          timezoneWarning = getErrorMessage(error);
        }
      }
    }
    if (state.user?.id !== user.id) return null;
    state.profile = profile;
    auth.renderProfile(user, profile);
    return { profile, timezoneWarning };
  }

  async function open() {
    if (!state.user || busy || dialog.open) return;
    removeLanguageControls();
    setStatus("profile.loading");
    saveButton.disabled = true;
    form.querySelectorAll("input,textarea").forEach(input => { input.disabled = true; });
    dialog.showModal();
    try {
      const { profile, timezoneWarning } = await loadCurrentProfile();
      if (!profile || !state.user) return;
      fillForm(profile, state.user);
      if (dialog.open) startTimezoneClock();
      if (timezoneWarning) setStatus("profile.saveError", { error: timezoneWarning }, "error");
      else setStatus("");
    } catch (error) {
      setStatus("profile.loadError", { error: getErrorMessage(error) }, "error");
      fillForm(state.profile, state.user);
      if (dialog.open) startTimezoneClock();
    } finally {
      form.querySelectorAll("input,textarea").forEach(input => { input.disabled = false; });
      saveButton.disabled = false;
      form.elements.email.disabled = false;
      form.elements.registered.disabled = false;
    }
  }

  function close(force = false) {
    if (busy && !force) return false;
    if (!force && isDirty() && !window.confirm(t("profile.unsavedConfirm"))) return false;
    form.reset();
    baseline = null;
    setStatus("");
    stopTimezoneClock();
    if (dialog.open) dialog.close();
    return true;
  }

  function requestClose() { close(false); }

  function validate() {
    let valid = true;
    const fullName = form.elements.full_name.value.trim();
    if (!fullName) {
      setFieldError("full_name", t("profile.nameRequired"));
      form.elements.full_name.focus();
      valid = false;
    }
    const timezone = form.elements.timezone.value.trim();
    if (timezone && !isValidTimezone(timezone)) {
      setFieldError("timezone", t("profile.timezoneInvalid"));
      if (valid) form.elements.timezone.focus();
      valid = false;
    }
    return valid;
  }

  function valuesToPatch(values) {
    const patch = {};
    PROFILE_FIELDS.forEach(field => {
      if (values[field] === baseline[field]) return;
      patch[field] = field === "full_name" ? values[field] : values[field] || null;
    });
    return patch;
  }

  async function save(event) {
    event.preventDefault();
    if (busy || !state.user || !validate()) return;
    const user = state.user;
    const patch = valuesToPatch(currentValues());
    if (!Object.keys(patch).length) {
      setStatus("");
      return;
    }
    busy = true;
    saveButton.disabled = true;
    form.querySelectorAll("input,textarea").forEach(input => { input.disabled = true; });
    setStatus("profile.saving");
    try {
      const result = await updateProfileAndAuth(user, patch);
      if (state.user?.id !== user.id) return;
      state.user = result.user || state.user;
      if (result.profile) state.profile = result.profile;
      onProfileChanged(state.user, state.profile);
      if (result.profile) fillForm(result.profile, state.user);
      if (result.errors.length) {
        errorMessages = result.errors.map(({ source, error }) => ({
          key: source === "profile" ? "profile.saveError" : source === "auth" ? "profile.authUpdateError" : "profile.refreshError",
          error: getErrorMessage(error)
        }));
        renderErrors();
      } else {
        setStatus("profile.saveSuccess");
        close(true);
      }
    } catch (error) {
      setStatus("profile.saveError", { error: getErrorMessage(error) }, "error");
    } finally {
      busy = false;
      form.querySelectorAll("input,textarea").forEach(input => { input.disabled = false; });
      form.elements.email.disabled = false;
      form.elements.registered.disabled = false;
      saveButton.disabled = false;
    }
  }

  function onEditClick() {
    auth.closeProfilePopover();
    open();
  }
  const closeButton = $("#profile-settings-close", dialog);
  const cancelButton = $("#profile-settings-cancel", dialog);
  function onDialogCancel(event) { event.preventDefault(); requestClose(); }
  function onTimezoneInput(event) {
    const field = event.target.name;
    if (field === "full_name" || field === "timezone") setFieldError(field);
    if (field === "timezone") updateTimezoneClock();
  }
  function onBeforeUnload(event) {
    if (!dialog.open || !isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  }
  editButton.addEventListener("click", onEditClick);
  closeButton.addEventListener("click", requestClose);
  cancelButton.addEventListener("click", requestClose);
  dialog.addEventListener("cancel", onDialogCancel);
  dialog.addEventListener("close", stopTimezoneClock);
  form.addEventListener("submit", save);
  form.addEventListener("input", onTimezoneInput);
  window.addEventListener("beforeunload", onBeforeUnload);
  populateTimezoneOptions();

  function refreshLanguage() {
    removeLanguageControls();
    translateDocument(dialog);
    closeButton.setAttribute("aria-label", t("layout.close"));
    if (errorMessages) renderErrors();
    else if (statusState) setStatus(statusState.key, statusState.variables, statusState.type);
    if (form.elements.registered.value && state.user?.created_at) form.elements.registered.value = formatRegistrationDate(state.user.created_at);
    if (dialog.open) updateTimezoneClock();
  }

  function renderErrors() {
    statusState = null;
    status.textContent = errorMessages.map(item => t(item.key, { error: item.error })).join(" ");
    status.classList.add("error");
  }

  function destroy() {
    stopTimezoneClock();
    editButton.removeEventListener("click", onEditClick);
    closeButton.removeEventListener("click", requestClose);
    cancelButton.removeEventListener("click", requestClose);
    dialog.removeEventListener("cancel", onDialogCancel);
    dialog.removeEventListener("close", stopTimezoneClock);
    form.removeEventListener("submit", save);
    form.removeEventListener("input", onTimezoneInput);
    window.removeEventListener("beforeunload", onBeforeUnload);
    dialog.remove();
  }

  return { open, close, refreshLanguage, destroy };
}
