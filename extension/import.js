/**
 * Dependency-free bookmark import parsers.
 *
 * `parseImportText(text, metadata)` returns `{ format, items, invalid }`.
 * Every item has `link`, `title`, `tags`, `note`, `description`, `favorite`,
 * `createdAt`, and `collectionPath` (an array of folder names). Invalid entries are kept
 * out of `items` and reported as `{ index, reason, value }`; indices are
 * zero-based source record/line indices (the CSV header counts as a record,
 * and HTML indices count bookmark anchors).
 *
 * JSON private-bookmarks backups are intentionally not parsed here.
 */

const FORMAT_ALIASES = new Map([
  ["html", "html"], ["htm", "html"], ["text/html", "html"],
  ["csv", "csv"], ["text/csv", "csv"],
  ["txt", "txt"], ["text", "txt"], ["text/plain", "txt"],
  ["json", "json"], ["application/json", "json"],
  ["enex", "enex"], ["application/enex+xml", "enex"], ["application/xml", "enex"], ["text/xml", "enex"],
]);

const HEADER_ALIASES = {
  link: new Set(["url", "link", "href", "uri"]),
  title: new Set(["title", "name"]),
  tags: new Set(["tag", "tags", "label", "labels"]),
  description: new Set(["description", "desc", "summary"]),
  note: new Set(["note", "notes"]),
  favorite: new Set(["favorite", "favourite", "starred", "star", "important", "isfavorite"]),
  collectionPath: new Set(["collection", "collectionpath", "folder", "folderpath", "group", "path"]),
};

const TRUE_VALUES = new Set(["1", "true", "yes", "y", "on", "star", "starred", "favorite", "favourite", "*"]);

function metadataOptions(metadata) {
  if (typeof metadata !== "string") return metadata && typeof metadata === "object" ? metadata : {};
  if (normalizedFormat(metadata)) return { format: metadata };
  return fileExtension(metadata) ? { name: metadata } : { format: metadata };
}

function textValue(value) {
  return value == null ? "" : String(value).trim();
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&#x([\da-f]+);?/gi, (_, code) => {
      const point = Number.parseInt(code, 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/&#(\d+);?/g, (_, code) => {
      const point = Number(code);
      return point <= 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/&(?:amp|#38);/gi, "&")
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&(?:lt|#60);/gi, "<")
    .replace(/&(?:gt|#62);/gi, ">")
    .replace(/&(?:nbsp|#160);/gi, " ");
}

function xmlElement(source, name) {
  return String(source).match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] || "";
}

function xmlElements(source, name) {
  const values = [];
  const pattern = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "gi");
  let match;
  while ((match = pattern.exec(String(source)))) values.push(match[1]);
  return values;
}

function xmlText(value) {
  return decodeHtml(String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function enexCreatedAt(value) {
  const raw = textValue(value);
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\d{3})?Z$/i);
  if (!match) return "";
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return "";
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function enexLinkCandidates(note, content) {
  const explicit = xmlText(xmlElement(note, "source-url"));
  const links = explicit ? [explicit] : [];
  for (const match of String(content).matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) links.push(decodeHtml(match[1]));
  const plainText = xmlText(content);
  for (const match of plainText.matchAll(/https?:\/\/[^\s<>"']+/gi)) links.push(match[0].replace(/[),.;!?]+$/, ""));
  return [...new Set(links.map(textValue).filter(Boolean))];
}

function enexResources(note) {
  const resources = [];
  const pattern = /<resource(?:\s[^>]*)?>([\s\S]*?)<\/resource>/gi;
  let match;
  while ((match = pattern.exec(String(note)))) {
    const source = match[1];
    const dataElement = source.match(/<data\b[^>]*>([\s\S]*?)<\/data>/i);
    const encoding = dataElement?.[0].match(/\bencoding\s*=\s*["']([^"']+)["']/i)?.[1]?.toLocaleLowerCase() || "";
    const data = String(dataElement?.[1] || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/\s+/g, "");
    const mime = textValue(xmlText(xmlElement(source, "mime"))).toLocaleLowerCase();
    const name = xmlText(xmlElement(xmlElement(source, "resource-attributes"), "file-name"));
    const error = !data ? "附件缺少数据" : encoding && encoding !== "base64" ? "仅支持 base64 附件" : !mime ? "附件缺少 MIME 类型" : "";
    resources.push({ mime, name, data, ...(error ? { error } : {}) });
  }
  return resources;
}

/** Parse an Evernote ENEX export. Notes without an HTTP(S) source URL are reported as invalid. */
export function parseEnex(source) {
  const items = [];
  const invalid = [];
  const notes = xmlElements(String(source), "note");
  if (!notes.length) return { items, invalid: [{ index: 0, reason: "invalid-enex", value: "" }] };
  notes.forEach((note, index) => {
    const title = xmlText(xmlElement(note, "title"));
    const content = xmlElement(note, "content");
    const metadata = note.replace(content, "");
    const description = xmlText(content);
    const tags = xmlElements(metadata, "tag").map(xmlText).filter(Boolean);
    const createdAt = enexCreatedAt(xmlElement(metadata, "created"));
    const resources = enexResources(note);
    const link = enexLinkCandidates(metadata, content).find((value) => /^https?:\/\//i.test(value));
    if (!link) {
      invalid.push({ index, reason: "missing-url", value: title });
      return;
    }
    const item = makeItem({ link, title, tags, description, createdAt, resources }, index, invalid);
    if (item) items.push(item);
  });
  return { items, invalid };
}

/**
 * Apply the same basic HTTP(S) URL rules as the bookmark API. This is also
 * useful to callers that need a stable key for duplicate detection.
 */
export function canonicalImportLink(value) {
  const input = textValue(value);
  if (!input) throw new TypeError("URL is required");
  const url = new URL(input);
  if (!/^https?:$/.test(url.protocol)) throw new TypeError("Only HTTP(S) links can be imported");

  url.username = "";
  url.password = "";
  url.hash = url.hash.startsWith("#:~:text=") ? "" : url.hash;
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function normalizeTags(value) {
  if (Array.isArray(value)) value = value.join(",");
  const seen = new Set();
  return textValue(value).split(/[,;|]/).map((tag) => tag.trim().replace(/^#+/, "")).filter((tag) => {
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeCollectionPath(value) {
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean);
  const path = textValue(value);
  return path ? path.split(/\s*(?:::|[/>\\])\s*/).map((part) => part.trim()).filter(Boolean) : [];
}

function normalizeFavorite(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return TRUE_VALUES.has(textValue(value).toLocaleLowerCase());
}

function makeItem(fields, index, invalid) {
  const rawLink = fields.link;
  let link;
  try {
    link = canonicalImportLink(rawLink);
  } catch {
    invalid.push({ index, reason: "invalid-url", value: textValue(rawLink) });
    return null;
  }
  return {
    link,
    title: textValue(fields.title),
    tags: normalizeTags(fields.tags),
    note: textValue(fields.note),
    description: textValue(fields.description),
    favorite: normalizeFavorite(fields.favorite),
    ...(textValue(fields.createdAt) ? { createdAt: textValue(fields.createdAt) } : {}),
    collectionPath: normalizeCollectionPath(fields.collectionPath),
    ...(Array.isArray(fields.resources) && fields.resources.length ? { resources: fields.resources } : {}),
  };
}

function isBlankRecord(fields) {
  return fields.every((field) => !textValue(field));
}

function htmlTokens(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    if (source[index] !== "<") {
      const start = index;
      while (index < source.length && source[index] !== "<") index += 1;
      tokens.push({ text: source.slice(start, index) });
      continue;
    }
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    let quote = "";
    let end = index + 1;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === "'" || character === '"') {
        quote = character;
      } else if (character === ">") {
        break;
      }
    }
    if (end >= source.length) {
      tokens.push({ text: source.slice(index) });
      break;
    }
    tokens.push({ tag: source.slice(index, end + 1) });
    index = end + 1;
  }
  return tokens;
}

function parseHtmlTag(source) {
  const match = source.match(/^<\s*(\/?)\s*([a-z][\w:-]*)([\s\S]*?)\s*(\/?)>$/i);
  if (!match) return null;
  const [, slash, name, body, selfClosing] = match;
  const attributes = {};
  if (!slash) {
    const pattern = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let attribute;
    while ((attribute = pattern.exec(body))) attributes[attribute[1].toLocaleLowerCase()] = decodeHtml(attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
  }
  return { name: name.toLocaleLowerCase(), closing: Boolean(slash), selfClosing: Boolean(selfClosing), attributes };
}

function parseHtmlText(source) {
  const items = [];
  const invalid = [];
  const folders = [];
  let pendingFolder = "";
  let heading = null;
  let anchor = null;
  let description = null;
  let lastItem = null;
  let anchorIndex = 0;

  const finishAnchor = () => {
    if (!anchor) return;
    const fields = {
      link: anchor.attributes.href,
      title: anchor.text,
      tags: anchor.attributes.tags,
      note: anchor.attributes.note,
      description: anchor.attributes.description,
      favorite: anchor.attributes.favorite ?? anchor.attributes.starred,
      collectionPath: folders.filter(Boolean),
    };
    const item = makeItem(fields, anchorIndex, invalid);
    anchorIndex += 1;
    if (item) {
      items.push(item);
      lastItem = item;
    } else lastItem = null;
    anchor = null;
  };

  const finishDescription = () => {
    if (!description) return;
    if (lastItem && !lastItem.description) lastItem.description = textValue(description.text).replace(/\s+/g, " ");
    description = null;
  };

  for (const token of htmlTokens(String(source))) {
    if (token.text != null) {
      const value = decodeHtml(token.text);
      if (anchor) anchor.text += value;
      else if (heading) heading.text += value;
      else if (description) description.text += value;
      continue;
    }
    const tag = parseHtmlTag(token.tag);
    if (!tag) continue;
    if (tag.closing) {
      if (tag.name === "a") finishAnchor();
      else if (tag.name === "h3" && heading) {
        pendingFolder = textValue(heading.text).replace(/\s+/g, " ");
        heading = null;
      } else if (tag.name === "dd") {
        finishDescription();
      } else if (tag.name === "dl" && folders.length) folders.pop();
      continue;
    }
    if (["a", "dd", "dl", "dt", "h3"].includes(tag.name)) finishDescription();
    if (tag.name === "h3") {
      heading = { text: "" };
      continue;
    }
    if (tag.name === "dl") {
      folders.push(pendingFolder);
      pendingFolder = "";
      continue;
    }
    if (tag.name === "a") {
      finishAnchor();
      anchor = { attributes: tag.attributes, text: "" };
      if (tag.selfClosing) finishAnchor();
      continue;
    }
    if (tag.name === "dd") {
      description = { text: "" };
      if (tag.selfClosing) description = null;
    }
  }
  finishAnchor();
  finishDescription();
  return { items, invalid };
}

function parseCsvRecords(source) {
  const records = [];
  let fields = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let malformed = false;
  let index = 0;

  const push = () => {
    if (fields.length || field) records.push({ fields: [...fields, field], index, malformed });
    fields = [];
    field = "";
    quoted = false;
    afterQuote = false;
    malformed = false;
    index += 1;
  };

  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (quoted) {
      if (character === '"' && source[cursor + 1] === '"') {
        field += '"';
        cursor += 1;
      } else if (character === '"') {
        quoted = false;
        afterQuote = true;
      } else field += character;
      continue;
    }
    if (afterQuote) {
      if (character === ",") {
        fields.push(field);
        field = "";
        afterQuote = false;
      } else if (character === "\n" || character === "\r") {
        fields.push(field);
        if (character === "\r" && source[cursor + 1] === "\n") cursor += 1;
        push();
      } else if (!/\s/.test(character)) {
        malformed = true;
        field += character;
        afterQuote = false;
      }
      continue;
    }
    if (character === '"' && !field.trim()) {
      field = "";
      quoted = true;
    } else if (character === ",") {
      fields.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[cursor + 1] === "\n") cursor += 1;
      push();
    } else field += character;
  }
  if (quoted) malformed = true;
  if (fields.length || field || malformed) push();
  return records;
}

function normalizeHeader(value) {
  return textValue(value).replace(/^\uFEFF/, "").toLocaleLowerCase().replace(/[\s_-]+/g, "");
}

function csvHeaderMap(headers) {
  const result = {};
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) if (!(field in result) && aliases.has(normalized)) result[field] = index;
  });
  return result;
}

/** Parse a CSV export whose first record contains field names. */
export function parseCsv(source) {
  const records = parseCsvRecords(String(source));
  const items = [];
  const invalid = [];
  const header = records.find((record) => !isBlankRecord(record.fields));
  if (!header) return { items, invalid };
  const columns = csvHeaderMap(header.fields);
  if (columns.link == null) {
    invalid.push({ index: header.index, reason: "missing-url-header", value: "" });
    return { items, invalid };
  }

  for (const record of records) {
    if (record.index <= header.index || isBlankRecord(record.fields)) continue;
    if (record.malformed) {
      invalid.push({ index: record.index, reason: "malformed-csv", value: record.fields.join(",") });
      continue;
    }
    const at = (field) => columns[field] == null ? "" : record.fields[columns[field]] ?? "";
    const item = makeItem({
      link: at("link"), title: at("title"), tags: at("tags"), note: at("note"), description: at("description"),
      favorite: at("favorite"), collectionPath: at("collectionPath"),
    }, record.index, invalid);
    if (item) items.push(item);
  }
  return { items, invalid };
}

/** Parse one HTTP(S) URL per nonblank, non-comment line. */
export function parseTxt(source) {
  const items = [];
  const invalid = [];
  String(source).replace(/^\uFEFF/, "").split(/\r\n?|\n/).forEach((line, index) => {
    const value = line.trim();
    if (!value || /^#|^\/\//.test(value)) return;
    const item = makeItem({ link: value }, index, invalid);
    if (item) items.push(item);
  });
  return { items, invalid };
}

/** Parse a Netscape bookmark HTML export, including nested H3/DL folders. */
export function parseHtmlBookmarks(source, options = {}) {
  // A caller may provide a preprocessor (useful for a host DOM adapter); the
  // built-in tokenizer keeps this parser usable in Node without dependencies.
  const adapted = typeof options?.htmlParser === "function" ? options.htmlParser(String(source)) : source;
  return parseHtmlText(typeof adapted === "string" ? adapted : String(source));
}

function normalizedFormat(value) {
  if (value == null) return "";
  const format = textValue(value).toLocaleLowerCase().split(";", 1)[0].replace(/^\./, "");
  return FORMAT_ALIASES.get(format) || "";
}

function fileExtension(value) {
  const name = textValue(value).split(/[?#]/, 1)[0];
  const match = name.match(/\.([a-z\d]+)$/i);
  return match ? match[1].toLocaleLowerCase() : "";
}

/** Detect supported import formats from metadata/content. */
export function detectImportFormat(source, metadata = {}) {
  const options = metadataOptions(metadata);
  const explicit = normalizedFormat(options.format);
  if (explicit) return explicit;
  if (textValue(options.format)) return "unknown";
  const type = normalizedFormat(options.type || options.mimeType || options.contentType);
  if (type) return type;
  const extension = normalizedFormat(fileExtension(options.name || options.fileName || options.filename));
  if (extension) return extension;
  const text = String(source ?? "").replace(/^\uFEFF/, "").trimStart();
  if (/^<en-export\b/i.test(text)) return "enex";
  if (/^(?:<!doctype\s+(?:html\b|netscape-bookmark-file\b)|<!--\s*doctype\s+html|<html\b|<head\b|<body\b|<dl\b|<dt\b|<a\b[^>]*\bhref\s*=)/i.test(text)) return "html";
  const firstLine = text.split(/\r\n?|\n/, 1)[0] || "";
  if (firstLine.includes(",") && /(?:^|,\s*)["']?(?:url|link|href|title|name|tags?|labels?|description|notes?|favorite|favourite|starred|folder|collection)["']?(?:\s*,|\s*$)/i.test(firstLine)) return "csv";
  return "txt";
}

/** Parse an import file for a preview; JSON backups remain a separate restore flow. */
export function parseImportText(source, metadata = {}) {
  if (typeof source !== "string") throw new TypeError("Import text must be a string");
  const options = metadataOptions(metadata);
  const format = detectImportFormat(source, options);
  if (format === "json") throw new TypeError("JSON backups are handled separately");
  const parser = format === "html" ? parseHtmlBookmarks : format === "csv" ? parseCsv : format === "txt" ? parseTxt : format === "enex" ? parseEnex : null;
  if (!parser) throw new TypeError(`Unsupported import format: ${format || "unknown"}`);
  return { format, ...parser(source, options) };
}

// Keep common spellings available to callers without duplicating parser code.
export const parseImportHtml = parseHtmlBookmarks;
export const parseImportHTML = parseHtmlBookmarks;
export const parseImportCsv = parseCsv;
export const parseImportCSV = parseCsv;
export const parseImportTxt = parseTxt;
export const parseImportTXT = parseTxt;
export const parseImportEnex = parseEnex;
export const parseImportENEX = parseEnex;
export const parseHtml = parseHtmlBookmarks;
export const parseCsvText = parseCsv;
export const parseTxtText = parseTxt;
export const parseHTML = parseHtmlBookmarks;
export const parseCSV = parseCsv;
export const parseTXT = parseTxt;
export const parseENEX = parseEnex;
