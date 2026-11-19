import { signUp, signIn, signOut, restoreSession, onAuthStateChange } from "../services/auth.service.js";
import { escapeHTML, getErrorMessage, getInitials } from "../utils/helpers.js";
import { $ } from "../utils/dom.js";
import { t, getLanguage } from "../utils/i18n.js";

export function initAuth({ onAuthenticated, onSignedOut, onWarning }) {
  const screen = document.createElement("section");
  screen.className = "sf-auth-screen hidden";
  screen.innerHTML = `<div class="sf-auth-card"><div class="sf-auth-brand">study<span>flow</span></div><label class="sf-auth-language"><span class="sr-only">${t("layout.language")}</span><select class="language-select" data-language-select aria-label="${t("layout.language")}"><option value="en">English</option><option value="ru">Русский</option><option value="kk">Қазақша</option></select></label><p class="sf-auth-intro">Your studies, organized in one place.</p><div class="sf-auth-tabs"><button type="button" class="active" data-auth-mode="login">Log in</button><button type="button" data-auth-mode="signup">Create account</button></div><form class="sf-auth-form" novalidate><label class="sf-name-wrap hidden">Full name<input name="full_name" autocomplete="name" maxlength="100" placeholder="Your name"></label><label>Email address<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>Password<input name="password" type="password" autocomplete="current-password" required minlength="6" placeholder="At least 6 characters"></label><button class="sf-auth-submit" type="submit">Log in</button></form><p class="sf-auth-message" role="status" aria-live="polite"></p><p class="sf-auth-foot">Secure sign in powered by Supabase</p></div>`;
  document.body.insertBefore(screen, document.body.firstChild);

  const message = $(".sf-auth-message", screen);
  const form = $("form", screen);
  const submit = $(".sf-auth-submit", screen);
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
      $("#profile-popover-name").textContent = currentProfile?.full_name || currentProfileUser.user_metadata?.full_name || t("auth.student");
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
    message.textContent = text || "";
    message.className = `sf-auth-message${type ? ` ${type}` : ""}`;
  }

  function setMode(mode) {
    const signupMode = mode === "signup";
    screen.querySelectorAll("[data-auth-mode]").forEach(button => button.classList.toggle("active", button.dataset.authMode === mode));
    $(".sf-name-wrap", screen).classList.toggle("hidden", !signupMode);
    $('[name="full_name"]', screen).required = signupMode;
    $('[name="password"]', screen).autocomplete = signupMode ? "new-password" : "current-password";
    submit.textContent = signupMode ? t("auth.register") : t("auth.login");
    screen.querySelectorAll("[data-auth-mode]").forEach(button => { button.textContent = t(button.dataset.authMode === "signup" ? "auth.register" : "auth.login"); });
    setMessage("");
  }

  function setDashboardVisible(visible) {
    screen.classList.toggle("hidden", visible);
    $(".app-shell")?.classList.toggle("hidden", !visible);
  }

  function renderProfile(user, profile) {
    currentProfileUser = user;
    currentProfile = profile;
    const fullName = profile?.full_name || user.user_metadata?.full_name || t("auth.student");
    const email = user.email || "";
    const firstName = fullName.trim().split(/\s+/)[0] || "Student";
    const hour = new Date().getHours();
    const greeting = t(hour < 12 ? "dashboard.greetingMorning" : hour < 18 ? "dashboard.greetingAfternoon" : "dashboard.greetingEvening");
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
      avatar.textContent = getInitials(fullName, email);
      avatar.setAttribute("aria-label", `${fullName} (${email})`);
    });
    refreshProfilePopover();
  }

  screen.querySelectorAll("[data-auth-mode]").forEach(button => button.addEventListener("click", () => setMode(button.dataset.authMode)));
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
          setMessage(t("auth.confirm"), "success");
        } else if (result.user) {
          renderProfile(result.user, result.profile);
          if (result.profileError) onWarning(`${t("auth.profileError", { error: getErrorMessage(result.profileError) })}`, true);
          await onAuthenticated(result.user, result.profile);
          setDashboardVisible(true);
        } else {
          setMessage(t("auth.confirmGeneric"), "success");
        }
      } else {
        const result = await signIn(email, password);
        renderProfile(result.user, result.profile);
        if (result.profileError) onWarning(`${t("auth.profileError", { error: getErrorMessage(result.profileError) })}`, true);
        await onAuthenticated(result.user, result.profile);
        setDashboardVisible(true);
      }
    } catch (error) {
      setMessage(t("errors.auth", { error: getErrorMessage(error) }), "error");
    } finally {
      busy = false;
      submit.disabled = false;
      submit.textContent = $("[data-auth-mode=signup]", screen).classList.contains("active") ? t("auth.register") : t("auth.login");
    }
  });

  const authSubscription = onAuthStateChange(event => {
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
    screen.querySelector(".sf-auth-foot").textContent = t("auth.secure");
    screen.querySelectorAll("[data-auth-mode]").forEach(button => { button.textContent = t(button.dataset.authMode === "signup" ? "auth.register" : "auth.login"); });
    const labels = screen.querySelectorAll(".sf-auth-form label");
    labels[0].childNodes[0].textContent = t("auth.fullName");
    labels[1].childNodes[0].textContent = t("auth.email");
    labels[2].childNodes[0].textContent = t("auth.password");
    $('[name="full_name"]', screen).placeholder = t("auth.yourName");
    $('[name="email"]', screen).placeholder = t("auth.emailPlaceholder");
    $('[name="password"]', screen).placeholder = t("auth.passwordPlaceholder");
    if (!busy) submit.textContent = signupMode ? t("auth.register") : t("auth.login");
    if (currentProfileUser) renderProfile(currentProfileUser, currentProfile);
    else refreshProfilePopover();
  }
  refreshLanguage();

  return {
    restore: restoreSession,
    setDashboardVisible,
    renderProfile,
    closeProfilePopover,
    setMessage,
    refreshLanguage,
    get subscription() { return authSubscription; }
  };
}





