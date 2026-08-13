import "../../extension/style.css";

const source = globalThis.chrome?.runtime?.getURL?.("library.html") || "library.html";
const response = await fetch(source);
if (!response.ok) throw new Error(`Unable to load shared library markup (${response.status})`);
const documentText = await response.text();
const template = document.createElement("template");
template.innerHTML = documentText;
template.content.querySelectorAll("script").forEach((script) => script.remove());
document.body.append(template.content);
document.body.classList.add(document.body.dataset.surface || "library");
await import("../../extension/library.js");
