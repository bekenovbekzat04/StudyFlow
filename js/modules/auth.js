import { signUp, signIn, signOut, restoreSession, onAuthStateChange, requestPasswordReset, updatePassword } from "../services/auth.service.js";
import { escapeHTML, getErrorMessage, getInitials, getAuthErrorKind } from "../utils/helpers.js";
import { $ } from "../utils/dom.js";
import { t, getLanguage } from "../utils/i18n.js";

export function initAuth({ onAuthenticated, onSignedOut, onWarning }) {
  const screen = document.createElement("section");
  screen.className = "sf-auth-screen hidden";
  screen.innerHTML = `<div class="sf-auth-card"><div class="sf-auth-brand">study<span>flow</span></div><label class="sf-auth-language"><span class="sr-only">${t("layout.language")}</span><select class="language-select" data-language-select aria-label="${t("layout.language")}"><option value="en">English</option><option value="ru">Русский</option><option value="kk">Қазақша</option></select></label><p class="sf-auth-intro">Your studies, organized in one place.</p><div class="sf-auth-tabs"><button type="button" class="active" data-auth-mode="login">Log in</button><button type="button" data-auth-mode="signup">Create account</button></div><form class="sf-auth-form" novalidate><label class="sf-name-wrap hidden">Full name<input name="full_name" autocomplete="name" maxlength="100" placeholder="Your name"></label><label>Email address<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>Password<input name="password" type="password" autocomplete="current-password" required minlength="6" placeholder="At least 6 characters"></label><button type="button" class="sf-auth-forgot-link" data-forgot-password>Forgot password?</button><button class="sf-auth-submit" type="submit">Log in</button></form><form class="sf-auth-alt-view sf-auth-forgot-view hidden" novalidate><h2 data-auth-forgot-title>Forgot password?</h2><p data-auth-forgot-copy></p><label>Email address<input name="forgot_email" type="email" autocomplete="email" required placeholder="you@example.com"></label><button class="sf-auth-submit" type="submit" data-auth-forgot-submit>Send reset link</button><button type="button" class="sf-auth-back-link" data-auth-forgot-back>Back to login</button></form><form class="sf-auth-alt-view sf-auth-reset-view hidden" novalidate><h2 data-auth-reset-title>Set a new password</h2><p data-auth-reset-copy></p><label>New password<input name="reset_password" type="password" autocomplete="new-password" required minlength="6"></label><label>Confirm password<input name="reset_password_confirm" type="password" autocomplete="new-password" required minlength="6"></label><button class="sf-auth-submit" type="submit" data-auth-reset-submit>Update password</button></form><p class="sf-auth-message" role="status" aria-live="polite"></p><p class="sf-auth-foot"></p></div>`;
  document.body.insertBefore(screen, document.body.firstChild);

  const message = $(".sf-auth-message", screen);
  const form = $("form", screen);
  const submit = $(".sf-auth-submit", screen);
  const forgotView = $(".sf-auth-forgot-view", screen);
  const resetView = $(".sf-auth-reset-view", screen);
  const authTabs = $(".sf-auth-tabs", screen);
  let authView = "login";
  let busy = false;
  let currentProfileUser = null;
  let currentProfile = null;
  const profileButton = $(".profile-button");
  const profilePopover = $("#profile-popover");
  const profileLogout = $("#profile-logout", profilePopover);

  function closeProfilePopover() {
    profilePopover.classList.add("hidden");
    profileButton.setAttribute("aria-expanded", "false");
  }

  function refreshProfilePopover() {
    if (currentProfileUser) {
      const profileName = String(currentProfile?.full_name || "").trim();
      const metadataName = String(currentProfileUser.user_metadata?.full_name || "").trim();
      $("#profile-popover-name").textContent = profileName || metadataName || t("auth.student");
      $("#profile-popover-email").textContent = currentProfileUser.email || "";
    }
    $("#profile-popover-language").textContent = ({ en: "English", ru: "Русский", kk: "Қазақша" })[getLanguage()];
    $("#profile-edit").textContent = t("profile.edit");
    profileLogout.textContent = t("layout.logout");
    profilePopover.setAttribute("aria-label", t("layout.profile"));
  }

  profileButton.addEventListener("click", () => {
    const opening = profilePopover.classList.contains("hidden");
    profilePopover.classList.toggle("hidden", !opening);
    profileButton.setAttribute("aria-expanded", String(opening));
    if (opening) refreshProfilePopover();
  });
  profileLogout.addEventListener("click", async () => {
    closeProfilePopover();
    profileLogout.disabled = true;
    try {
      const result = await signOut();
      if (result.error) throw result.error;
    } catch (error) {
      onWarning(t("auth.logoutError", { error: getErrorMessage(error) }), true);
    } finally {
      profileLogout.disabled = false;
    }
  });
  document.addEventListener("click", event => {
    if (!profilePopover.classList.contains("hidden") && !profilePopover.contains(event.target) && !profileButton.contains(event.target)) closeProfilePopover();
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeProfilePopover(); });

  function setMessage(text, type = "") {
    message.className = `sf-auth-message${type ? ` ${type}` : ""}`;
    if (type === "confirmation" || type === "forgot" || type === "reset") {
      const noticeType = type;
      const title = t(noticeType === "confirmation"
        ? "auth.confirmTitle"
        : noticeType === "forgot"
          ? "auth.forgotSuccessTitle"
          : "auth.resetSuccessTitle");
      const copy = text || "";
      const spam = noticeType === "confirmation"
        ? `<p class="sf-auth-notice-spam">${escapeHTML(t("auth.confirmSpam"))}</p>`
        : "";
      message.innerHTML = `<div class="sf-auth-notice-card"><span class="sf-auth-notice-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m7 9 5 4 5-4M19 3l2 2-2 2"></path></svg></span><div><strong>${escapeHTML(title)}</strong><p>${escapeHTML(copy)}</p>${spam}</div></div>`;
      message.className = `sf-auth-message success ${noticeType}`;
      return;
    }
    message.textContent = text || "";
  }

  function setMode(mode) {
    authView = mode;
    const signupMode = mode === "signup";
    authTabs.classList.remove("hidden");
    form.classList.remove("hidden");
    forgotView.classList.add("hidden");
    resetView.classList.add("hidden");
    screen.querySelector(".sf-auth-intro").classList.remove("hidden");
    screen.querySelectorAll("[data-auth-mode]").forEach(button => button.classList.toggle("active", button.dataset.authMode === mode));
    $(".sf-name-wrap", screen).classList.toggle("hidden", !signupMode);
    $('[name="full_name"]', screen).required = signupMode;
    $('[name="password"]', screen).autocomplete = signupMode ? "new-password" : "current-password";
    submit.textContent = signupMode ? t("auth.register") : t("auth.login");
    screen.querySelectorAll("[data-auth-mode]").forEach(button => { button.textContent = t(button.dataset.authMode === "signup" ? "auth.register" : "auth.login"); });
    setMessage("");
  }

  function recoveryRedirectUrl() {
    const url = new URL(location.pathname, location.origin);
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  function setForgotMode() {
    authView = "forgot";
    authTabs.classList.add("hidden");
    form.classList.add("hidden");
    resetView.classList.add("hidden");
    forgotView.classList.remove("hidden");
    screen.querySelector(".sf-auth-intro").classList.add("hidden");
    $('[name="forgot_email"]', screen).value = "";
    setMessage("");
  }

  function setResetMode(errorText = "") {
    authView = "reset";
    authTabs.classList.add("hidden");
    form.classList.add("hidden");
    forgotView.classList.add("hidden");
    resetView.classList.remove("hidden");
    screen.querySelector(".sf-auth-intro").classList.add("hidden");
    $('[name="reset_password"]', screen).value = "";
    $('[name="reset_password_confirm"]', screen).value = "";
    setMessage(errorText, errorText ? "error" : "");
  }

  function setDashboardVisible(visible) {
    screen.classList.toggle("hidden", visible);
    $(".app-shell")?.classList.toggle("hidden", !visible);
  }

  function renderProfile(user, profile) {
    currentProfileUser = user;
    currentProfile = profile;
    const profileName = String(profile?.full_name || "").trim();
    const metadataName = String(user.user_metadata?.full_name || "").trim();
    const actualName = profileName || metadataName;
    const fullName = actualName || t("auth.student");
    const email = user.email || "";
    const firstName = actualName ? actualName.split(/\s+/)[0] : t("auth.student");
    let hour = new Date().getHours();
    const timezone = String(profile?.timezone || "").trim();
    if (timezone) {
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          hour: "2-digit",
          hourCycle: "h23"
        }).formatToParts(new Date());
        const hourPart = parts.find(part => part.type === "hour");
        if (hourPart) {
          const timezoneHour = Number(hourPart.value);
          if (Number.isInteger(timezoneHour) && timezoneHour >= 0 && timezoneHour <= 23) hour = timezoneHour;
        }
      } catch (_) {}
    }
    const greetingKey = hour >= 5 && hour < 12
      ? "dashboard.greetingMorning"
      : hour >= 12 && hour < 18
        ? "dashboard.greetingAfternoon"
        : hour >= 18 && hour < 23
          ? "dashboard.greetingEvening"
          : "dashboard.greetingNight";
    const greeting = t(greetingKey);
    const title = $("#welcome-title");
    title.replaceChildren();
    title.append(document.createTextNode(`${greeting}, ${firstName} `));
    const sparkle = document.createElement("span");
    sparkle.setAttribute("aria-hidden", "true");
    sparkle.textContent = "✦";
    title.append(sparkle);
    const profileCopy = $(".profile-copy");
    if (profileCopy) {
      profileCopy.replaceChildren();
      const name = document.createElement("strong");
      const mail = document.createElement("small");
      name.textContent = fullName;
      mail.textContent = email;
      profileCopy.append(name, mail);
    }
    document.querySelectorAll(".avatar").forEach(avatar => {
      avatar.textContent = getInitials(actualName, email);
      avatar.setAttribute("aria-label", `${fullName} (${email})`);
    });
    refreshProfilePopover();
  }

  screen.querySelectorAll("[data-auth-mode]").forEach(button => button.addEventListener("click", () => setMode(button.dataset.authMode)));
  $("[data-forgot-password]", screen).addEventListener("click", setForgotMode);
  $("[data-auth-forgot-back]", screen).addEventListener("click", () => setMode("login"));
  forgotView.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    const email = String($('[name="forgot_email"]', screen).value || "").trim();
    if (!email) return;
    busy = true;
    const forgotSubmit = $("[data-auth-forgot-submit]", screen);
    forgotSubmit.disabled = true;
    forgotSubmit.textContent = t("auth.wait");
    setMessage("");
    try {
      await requestPasswordReset(email, recoveryRedirectUrl());
      setMessage(t("auth.forgotSuccessCopy"), "forgot");
    } catch (error) {
      const kind = getAuthErrorKind(error);
      setMessage(kind === "rateLimited"
        ? t("auth.rateLimited")
        : t("auth.resetRequestError"), "error");
    } finally {
      busy = false;
      forgotSubmit.disabled = false;
      forgotSubmit.textContent = t("auth.forgotSubmit");
    }
  });
  resetView.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    const password = String($('[name="reset_password"]', screen).value || "");
    const confirmation = String($('[name="reset_password_confirm"]', screen).value || "");
    if (password.length < 6) {
      setMessage(t("auth.resetPasswordShort"), "error");
      return;
    }
    if (password !== confirmation) {
      setMessage(t("auth.resetPasswordMismatch"), "error");
      return;
    }
    busy = true;
    const resetSubmit = $("[data-auth-reset-submit]", screen);
    resetSubmit.disabled = true;
    resetSubmit.textContent = t("auth.resetUpdating");
    setMessage("");
    try {
      await updatePassword(password);
      await signOut();
      history.replaceState({}, document.title, recoveryRedirectUrl());
      setMode("login");
      setMessage(t("auth.resetSuccessCopy"), "reset");
    } catch (error) {
      const kind = getAuthErrorKind(error);
      setMessage(kind === "rateLimited"
        ? t("auth.rateLimited")
        : kind === "weakPassword"
          ? t("auth.weakPassword")
        : kind === "invalidRecovery"
          ? t("auth.resetInvalid")
          : t("auth.resetUpdateError"), "error");
    } finally {
      busy = false;
      resetSubmit.disabled = false;
      resetSubmit.textContent = t("auth.resetSubmit");
    }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const fullName = String(data.get("full_name") || "").trim();
    const signupMode = $("[data-auth-mode=signup]", screen).classList.contains("active");
    busy = true;
    submit.disabled = true;
    submit.textContent = t("auth.wait");
    setMessage(signupMode ? t("auth.creating") : t("auth.signingIn"));
    try {
      if (signupMode) {
        const result = await signUp(email, password, fullName);
        if (result.user && !result.session) {
          const identities = Array.isArray(result.user.identities) ? result.user.identities : null;
          if (identities && identities.length === 0) setMessage(t("auth.duplicateRegistration"), "error");
          else setMessage(t("auth.confirm"), "confirmation");
        } else if (result.user) {
          renderProfile(result.user, result.profile);
          if (result.profileError) onWarning(`${t("auth.profileError", { error: getErrorMessage(result.profileError) })}`, true);
          await onAuthenticated(result.user, result.profile);
          setDashboardVisible(true);
        } else {
          setMessage(t("auth.confirmGeneric"), "confirmation");
        }
      } else {
        const result = await signIn(email, password);
        renderProfile(result.user, result.profile);
        if (result.profileError) onWarning(`${t("auth.profileError", { error: getErrorMessage(result.profileError) })}`, true);
        await onAuthenticated(result.user, result.profile);
        setDashboardVisible(true);
      }
    } catch (error) {
      const kind = getAuthErrorKind(error);
      if (signupMode && kind === "weakPassword") {
        setMessage(t("auth.weakPassword"), "error");
      } else if (signupMode && kind === "duplicateRegistration") {
        setMessage(t("auth.duplicateRegistration"), "error");
      } else if (!signupMode && kind === "emailNotConfirmed") {
        setMessage(t("auth.emailNotConfirmed"), "error");
      } else if (!signupMode && kind === "invalidCredentials") {
        setMessage(t("auth.invalidCredentials"), "error");
      } else if (kind === "rateLimited") {
        setMessage(t("auth.rateLimited"), "error");
      } else {
        setMessage(t("errors.auth", { error: getErrorMessage(error) }), "error");
      }
    } finally {
      busy = false;
      submit.disabled = false;
      submit.textContent = $("[data-auth-mode=signup]", screen).classList.contains("active") ? t("auth.register") : t("auth.login");
    }
  });

  const authSubscription = onAuthStateChange(event => {
    if (event === "PASSWORD_RECOVERY") {
      setDashboardVisible(false);
      setResetMode("");
      return;
    }
    if (event === "SIGNED_OUT") {
      setDashboardVisible(false);
      setMode("login");
      onSignedOut();
    }
  });

  function refreshLanguage() {
    const signupMode = $(`[data-auth-mode=signup]`, screen).classList.contains("active");
    const authLanguage = $("[data-language-select]", screen);
    authLanguage.value = document.getElementById("language-select").value;
    authLanguage.setAttribute("aria-label", t("layout.language"));
    screen.querySelector(".sf-auth-language .sr-only").textContent = t("layout.language");
    screen.querySelector(".sf-auth-intro").textContent = t("auth.intro");
    screen.querySelector(".sf-auth-foot").textContent = "";
    screen.querySelectorAll("[data-auth-mode]").forEach(button => { button.textContent = t(button.dataset.authMode === "signup" ? "auth.register" : "auth.login"); });
    const labels = screen.querySelectorAll(".sf-auth-form label");
    labels[0].childNodes[0].textContent = t("auth.fullName");
    labels[1].childNodes[0].textContent = t("auth.email");
    labels[2].childNodes[0].textContent = t("auth.password");
    $('[name="full_name"]', screen).placeholder = t("auth.yourName");
    $('[name="email"]', screen).placeholder = t("auth.emailPlaceholder");
    $('[name="password"]', screen).placeholder = t("auth.passwordPlaceholder");
    $("[data-forgot-password]", screen).textContent = t("auth.forgotPassword");
    $("[data-auth-forgot-title]", screen).textContent = t("auth.forgotTitle");
    $("[data-auth-forgot-copy]", screen).textContent = t("auth.forgotCopy");
    $("[data-auth-forgot-submit]", screen).textContent = t("auth.forgotSubmit");
    $("[data-auth-forgot-back]", screen).textContent = t("auth.forgotBack");
    $("[data-auth-reset-title]", screen).textContent = t("auth.resetTitle");
    $("[data-auth-reset-copy]", screen).textContent = t("auth.resetCopy");
    $("[data-auth-reset-submit]", screen).textContent = t("auth.resetSubmit");
    $('[name="forgot_email"]', screen).placeholder = t("auth.emailPlaceholder");
    forgotView.querySelector("label").childNodes[0].textContent = t("auth.email");
    const resetLabels = resetView.querySelectorAll("label");
    resetLabels[0].childNodes[0].textContent = t("auth.resetPassword");
    resetLabels[1].childNodes[0].textContent = t("auth.resetPasswordConfirm");
    if (!busy) submit.textContent = signupMode ? t("auth.register") : t("auth.login");
    if (currentProfileUser) renderProfile(currentProfileUser, currentProfile);
    else refreshProfilePopover();
  }
  refreshLanguage();

  const recoveryHash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const recoveryQuery = new URLSearchParams(location.search);
  const recoveryError = recoveryHash.get("error") || recoveryHash.get("error_code") || recoveryQuery.get("error") || recoveryQuery.get("error_code");
  const recoveryRequested = recoveryHash.get("type") === "recovery" || recoveryQuery.get("type") === "recovery";
  if (recoveryError) {
    setDashboardVisible(false);
    setResetMode(t("auth.resetInvalid"));
  } else if (recoveryRequested) {
    setDashboardVisible(false);
    setResetMode();
  }

  return {
    restore: restoreSession,
    setDashboardVisible,
    renderProfile,
    closeProfilePopover,
    setMessage,
    refreshLanguage,
    isRecoveryActive: () => authView === "reset",
    get subscription() { return authSubscription; }
  };
}





