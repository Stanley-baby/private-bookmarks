import "../../extension/style.css";

const surface = document.body?.dataset.surface || "library";
const marker = `surface-${surface}`;
// Mark the host before the shared library module renders so surface CSS never races the first paint.
document.documentElement.dataset.surface = surface;
document.documentElement.classList.add(marker);
document.body.dataset.surface = surface;
document.body.classList.add(marker);

const source = globalThis.chrome?.runtime?.getURL?.("library.html") || "library.html";
const response = await fetch(source);
if (!response.ok) throw new Error(`Unable to load shared library markup (${response.status})`);
const documentText = await response.text();
const template = document.createElement("template");
template.innerHTML = documentText;
template.content.querySelectorAll("script").forEach((script) => script.remove());
document.body.append(template.content);
await import("../../extension/library.js");
