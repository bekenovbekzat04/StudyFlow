let filterDropdownCount = 0;

function tintColor(color) {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color || "");
  if (!match) return "#f5f4fb";
  const raw = match[1].length === 3 ? [...match[1]].map(char => char + char).join("") : match[1];
  const channels = [0, 2, 4].map(index => parseInt(raw.slice(index, index + 2), 16));
  return `#${channels.map(channel => Math.round(255 - (255 - channel) * .12).toString(16).padStart(2, "0")).join("")}`;
}

function safeClass(value) {
  return /^[\w-]+$/.test(value) ? value : "default";
}

export function enhanceFilterDropdown(select, { variant = "neutral", getMeta = () => null } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = `filter-dropdown filter-dropdown-${safeClass(variant)}`;
  select.parentNode.insertBefore(wrapper, select);
  wrapper.append(select);
  select.classList.add("filter-select-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "filter-dropdown-trigger";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const menu = document.createElement("div");
  menu.className = "filter-dropdown-menu";
  menu.id = `filter-options-${++filterDropdownCount}`;
  menu.setAttribute("role", "listbox");
  menu.classList.add("hidden");
  trigger.setAttribute("aria-controls", menu.id);
  wrapper.append(trigger, menu);

  function optionMeta(option) {
    const meta = getMeta(option.value) || {};
    return { color: meta.color || "", className: safeClass(meta.className || option.value || "default") };
  }

  function refresh() {
    const options = Array.from(select.options);
    const selected = options.find(option => option.value === select.value) || options[0];
    const label = select.getAttribute("aria-label") || select.closest(".tasks-filter-field")?.querySelector("span")?.textContent || "Filter";
    trigger.setAttribute("aria-label", label);
    trigger.replaceChildren();
    if (selected) {
      const meta = optionMeta(selected);
      trigger.className = `filter-dropdown-trigger filter-dropdown-trigger-${safeClass(variant)} filter-dropdown-trigger-${meta.className}`;
      trigger.append(createOptionContent(selected, meta));
    }
    menu.setAttribute("aria-label", label);
    menu.replaceChildren(...options.map(option => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `filter-option ${option.selected ? "is-selected" : ""} filter-option-${optionMeta(option).className}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option.value === select.value));
      const meta = optionMeta(option);
      if (meta.color) {
        item.style.setProperty("--filter-color", meta.color);
        item.style.setProperty("--filter-tint", tintColor(meta.color));
        item.dataset.hasColor = "true";
      }
      item.append(createOptionContent(option, meta));
      item.addEventListener("click", () => {
        select.value = option.value;
        close();
        refresh();
        select.dispatchEvent(new Event("change", { bubbles: true }));
        trigger.focus();
      });
      item.addEventListener("keydown", event => onOptionKeydown(event, item));
      return item;
    }));
  }

  function createOptionContent(option, meta) {
    if (option.dataset.primary && option.dataset.secondary) {
      const content = document.createElement("span");
      content.className = "filter-task-option";
      const primary = document.createElement("strong");
      primary.className = "filter-task-option-primary";
      primary.textContent = option.dataset.primary;
      const secondary = document.createElement("small");
      secondary.className = "filter-task-option-secondary";
      secondary.textContent = option.dataset.secondary;
      content.append(primary, secondary);
      return content;
    }
    const content = document.createElement("span");
    content.className = "filter-option-content";
    const dot = document.createElement("i");
    dot.className = "filter-option-dot";
    dot.setAttribute("aria-hidden", "true");
    if (meta.color) dot.style.backgroundColor = meta.color;
    content.append(dot, document.createTextNode(option.textContent));
    return content;
  }

  function close({ returnFocus = false } = {}) {
    menu.classList.add("hidden");
    wrapper.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    if (returnFocus) trigger.focus();
  }

  function open() {
    refresh();
    menu.classList.remove("hidden");
    wrapper.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    const rect = trigger.getBoundingClientRect();
    const menuWidth = menu.getBoundingClientRect().width;
    const horizontalOffset = Math.max(8 - rect.left, Math.min(0, window.innerWidth - 8 - rect.left - menuWidth));
    menu.style.left = `${horizontalOffset}px`;
    const menuHeight = Math.min(menu.scrollHeight, 320);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    menu.dataset.placement = spaceBelow < menuHeight + 10 && spaceAbove > spaceBelow ? "top" : "bottom";
    const selected = menu.querySelector('[aria-selected="true"]');
    (selected || menu.querySelector('[role="option"]'))?.focus();
  }

  function onOptionKeydown(event, item) {
    const options = Array.from(menu.querySelectorAll('[role="option"]'));
    const index = options.indexOf(item);
    let next = null;
    if (event.key === "ArrowDown") next = options[Math.min(index + 1, options.length - 1)];
    else if (event.key === "ArrowUp") next = options[Math.max(index - 1, 0)];
    else if (event.key === "Home") next = options[0];
    else if (event.key === "End") next = options[options.length - 1];
    else if (event.key === "Escape") close({ returnFocus: true });
    if (next) { event.preventDefault(); next.focus(); }
  }

  trigger.addEventListener("click", () => trigger.getAttribute("aria-expanded") === "true" ? close() : open());
  trigger.addEventListener("keydown", event => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (trigger.getAttribute("aria-expanded") !== "true") open();
      else (event.key === "ArrowUp" ? menu.querySelector('[role="option"]:last-child') : menu.querySelector('[role="option"]'))?.focus();
    } else if (event.key === "Escape") close();
  });
  select.addEventListener("change", refresh);
  document.addEventListener("pointerdown", event => {
    if (!wrapper.contains(event.target)) close();
  });
  refresh();
  return { refresh, close };
}
