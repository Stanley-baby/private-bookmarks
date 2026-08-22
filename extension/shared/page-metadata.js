export function extractPageMetadata() {
  const meta = (...names) => [...document.querySelectorAll(names.map((name) => `meta[property="${name}"],meta[name="${name}"]`).join(","))].at(-1)?.content?.trim();
  const absolute = (value) => {
    try { return new URL(value, location.href).href; } catch { return ""; }
  };
  const cover = meta("og:image", "twitter:image", "twitter:image:src");
  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((node) => {
    try { return JSON.parse(node.textContent); } catch { return []; }
  }).flat();
  const structured = jsonLd.find((item) => item?.headline || item?.name) || {};
  const structuredImage = typeof structured.image === "string" ? structured.image : structured.image?.url || "";
  const structuredType = String(structured["@type"] || "").toLocaleLowerCase();
  const pageType = String(meta("og:type") || "").toLocaleLowerCase();
  const type = meta("og:video") ? "video" : meta("og:audio") ? "audio" : pageType.includes("article") || structuredType.includes("article") ? "article" : "link";
  const images = [...document.images].filter((image) => image.complete && image.naturalWidth >= 100 && image.naturalHeight >= 100).map((image) => image.currentSrc || image.src).slice(0, 9);
  const media = [...new Set([cover, structuredImage, ...images].map(absolute).filter(Boolean))];
  return {
    link: location.href,
    type,
    language: document.documentElement.lang || meta("language", "content-language") || "",
    title: meta("og:title", "twitter:title") || structured.headline || structured.name || document.title,
    description: meta("og:description", "twitter:description", "description") || structured.description || "",
    cover: absolute(cover || structuredImage || images[0]),
    media,
  };
}
