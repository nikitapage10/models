// Small DOM helpers shared by the lab's workspaces.

export const $ = (s, el = document) => el.querySelector(s);

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

export function toast(text) {
  const t = h("div", { class: "toast", role: "status", text });
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

/** A labelled slider with a number box, kept in sync. `get`/`set` read and write the value. */
export function slider({ id, label, min, max, step, get, set, title }) {
  const range = h("input", { type: "range", id, min, max, step, value: get(), "aria-label": label });
  const num = h("input", { type: "number", min, max, step, value: get(), "aria-label": label + " value" });
  const apply = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    set(n);
    range.value = n;
    num.value = n;
  };
  range.addEventListener("input", () => apply(range.value));
  num.addEventListener("change", () => apply(num.value));
  return h("div", { class: "slider", title }, h("label", { for: id, text: label }), range, num);
}

/** A sensible range for a default value. */
export function rangeFor(v, key = "") {
  if (/speed|freq/i.test(key)) return { min: 0, max: Math.max(4, v * 3), step: 0.05 };
  if (Math.abs(v) <= 1) return { min: Math.min(0, v * 3, -0.5), max: Math.max(1, v * 3), step: 0.01 };
  return { min: Math.min(0, v * 2), max: Math.max(1, v * 3), step: Math.abs(v) >= 10 ? 1 : 0.05 };
}

const pretty = (k) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

/**
 * Sliders for every number in `obj` (nested objects become groups, arrays of numbers become one slider each),
 * writing straight into the object. `skip` names keys to leave out. `onChange` fires after any edit.
 */
export function paramsUI(obj, prefix, { skip = [], onChange = () => {}, docs = {} } = {}) {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (skip.includes(k)) continue;
    const id = `${prefix}-${k}`.replace(/[^\w-]/g, "_");
    if (typeof v === "number") {
      const r = rangeFor(v, k);
      out.push(slider({ id, label: pretty(k), ...r, get: () => obj[k], set: (n) => ((obj[k] = n), onChange()), title: docs[k] }));
    } else if (Array.isArray(v) && v.every((x) => typeof x === "number")) {
      const g = h("details", { class: "group", open: v.length <= 3 }, h("summary", { text: pretty(k) }));
      v.forEach((_, i) => {
        const r = rangeFor(v[i], k);
        g.append(slider({ id: `${id}-${i}`, label: `${pretty(k)} ${v.length === 3 ? "xyz"[i] : i + 1}`, ...r, get: () => obj[k][i], set: (n) => ((obj[k][i] = n), onChange()) }));
      });
      out.push(g);
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      const g = h("details", { class: "group" }, h("summary", { text: pretty(k) }));
      g.append(...paramsUI(v, id, { onChange, docs }));
      out.push(g);
    }
  }
  return out;
}

export const clone = (o) => JSON.parse(JSON.stringify(o));

/** Write every value from `src` into `dst` in place (so modules holding a reference to `dst` see the change). */
export function assignDeep(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === "object" && !Array.isArray(v) && dst[k] && typeof dst[k] === "object") assignDeep(dst[k], v);
    else dst[k] = Array.isArray(v) ? [...v] : v;
  }
}

export async function copyText(text, where) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied. Paste it to Claude.");
  } catch {
    const ta = h("textarea", { readonly: true });
    ta.value = text;
    where.prepend(ta);
    ta.select();
    toast("Select all and copy the text above.");
  }
}

export function download(name, blob) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
}

export function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) ?? "null");
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
}
