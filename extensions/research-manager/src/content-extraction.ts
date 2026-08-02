import { createHash } from "node:crypto";
import { fetchWithSsrFGuard, type SsrFPolicy } from "openclaw/plugin-sdk/ssrf-runtime";
import {
  htmlToMarkdown,
  normalizeWhitespace,
  sanitizeHtml,
  stripInvisibleUnicode,
} from "openclaw/plugin-sdk/web-content-extractor";
import type { ResolvedResearchManagerConfig } from "./config.js";

type ReadabilityResult = {
  title?: string | null;
  content?: string | null;
  textContent?: string | null;
};

type PdfPage = {
  getTextContent(): Promise<{ items: Array<{ str?: unknown }> }>;
};

type PdfDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
};

export type ExtractedWebContent = {
  finalUrl: string;
  title?: string;
  text: string;
  contentType: string;
  sha256: string;
  promptInjectionSignals: string[];
};

const INJECTION_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  {
    id: "ignore-instructions",
    pattern: /ignore\s+(all\s+)?(previous|prior|system)\s+instructions/i,
  },
  { id: "role-override", pattern: /you\s+are\s+now\s+(an?|the)\s+/i },
  {
    id: "tool-directive",
    pattern: /(?:call|invoke|use)\s+(?:the\s+)?(?:tool|shell|browser|terminal)/i,
  },
  {
    id: "secret-request",
    pattern: /(?:reveal|print|send|exfiltrate).{0,40}(?:secret|token|password|api.?key)/i,
  },
  { id: "prompt-marker", pattern: /(?:system|assistant|developer)\s*(?:prompt|message)\s*:/i },
];

function detectPromptInjection(text: string): string[] {
  return INJECTION_PATTERNS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.id);
}

async function readBodyWithinLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`source exceeds ${maxBytes} byte limit`);
  }
  if (!response.body) {
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > maxBytes) {
      throw new Error(`source exceeds ${maxBytes} byte limit`);
    }
    return body;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("source byte limit exceeded");
        throw new Error(`source exceeds ${maxBytes} byte limit`);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function extractHtml(html: string, url: string): Promise<{ title?: string; text: string }> {
  const cleanHtml = await sanitizeHtml(html.slice(0, 1_000_000));
  try {
    const [{ Readability }, { parseHTML }] = await Promise.all([
      import("@mozilla/readability"),
      import("linkedom"),
    ]);
    const { document } = parseHTML(cleanHtml);
    try {
      Object.defineProperty(document, "baseURI", { value: url, configurable: true });
    } catch {
      // Relative links are nonessential to text extraction.
    }
    const parsed = new Readability(document as unknown as Document, {
      charThreshold: 0,
    }).parse() as ReadabilityResult | null;
    if (parsed?.content) {
      const markdown = htmlToMarkdown(parsed.content);
      const text = stripInvisibleUnicode(markdown.text);
      if (text.trim()) {
        return { title: parsed.title ?? markdown.title, text };
      }
    }
  } catch {
    // Fall through to the bounded sanitizer renderer.
  }
  const rendered = htmlToMarkdown(cleanHtml);
  return {
    title: rendered.title,
    text: stripInvisibleUnicode(rendered.text),
  };
}

async function extractPdf(data: Uint8Array, maxChars: number): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = (await pdfjs.getDocument({ data }).promise) as PdfDocument;
  const pages: string[] = [];
  let length = 0;
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 60); pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => (typeof item.str === "string" ? item.str : ""))
      .filter(Boolean)
      .join(" ");
    if (!text) {
      continue;
    }
    const remaining = maxChars - length;
    if (remaining <= 0) {
      break;
    }
    pages.push(text.slice(0, remaining));
    length += Math.min(text.length, remaining);
  }
  return normalizeWhitespace(pages.join("\n\n"));
}

function normalizeContentType(value: string | null): string {
  return (value ?? "application/octet-stream").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export async function fetchAndExtractSource(params: {
  url: string;
  config: ResolvedResearchManagerConfig;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  policy?: SsrFPolicy;
  guardedFetchImpl?: typeof fetchWithSsrFGuard;
}): Promise<ExtractedWebContent> {
  const parsed = new URL(params.url);
  if (parsed.username || parsed.password) {
    throw new Error("credential-bearing source URLs are rejected");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`unsupported source protocol ${parsed.protocol}`);
  }
  if (params.config.retrieval.requireHttps && parsed.protocol !== "https:") {
    throw new Error("non-HTTPS source rejected by retrieval policy");
  }

  const guarded = await (params.guardedFetchImpl ?? fetchWithSsrFGuard)({
    url: parsed.toString(),
    init: {
      method: "GET",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/pdf,text/plain,application/json;q=0.9,*/*;q=0.2",
        "user-agent": "OpenClaw Research Manager/1.0",
      },
    },
    timeoutMs: params.config.retrieval.fetchTimeoutMs,
    signal: params.signal,
    fetchImpl: params.fetchImpl,
    requireHttps: params.config.retrieval.requireHttps,
    maxRedirects: 3,
    policy: params.policy,
    auditContext: "research-manager.source-fetch",
  });
  try {
    if (!guarded.response.ok) {
      throw new Error(`source returned HTTP ${guarded.response.status}`);
    }
    const contentType = normalizeContentType(guarded.response.headers.get("content-type"));
    const body = await readBodyWithinLimit(
      guarded.response,
      params.config.retrieval.maxBytesPerSource,
    );
    let text = "";
    let title: string | undefined;
    if (contentType === "application/pdf" || guarded.finalUrl.toLowerCase().endsWith(".pdf")) {
      text = await extractPdf(body, params.config.retrieval.maxCharsPerSource);
    } else {
      const decoded = new TextDecoder("utf-8", { fatal: false }).decode(body);
      if (contentType.includes("html") || /<html[\s>]/i.test(decoded.slice(0, 500))) {
        const extracted = await extractHtml(decoded, guarded.finalUrl);
        title = extracted.title;
        text = extracted.text;
      } else if (
        contentType.startsWith("text/") ||
        contentType.includes("json") ||
        contentType.includes("xml")
      ) {
        text = stripInvisibleUnicode(normalizeWhitespace(decoded));
      } else {
        throw new Error(`unsupported source content type ${contentType || "unknown"}`);
      }
    }
    text = text.slice(0, params.config.retrieval.maxCharsPerSource).trim();
    if (!text) {
      throw new Error("source contained no extractable text");
    }
    return {
      finalUrl: guarded.finalUrl,
      title,
      text,
      contentType,
      sha256: createHash("sha256").update(text).digest("hex"),
      promptInjectionSignals: detectPromptInjection(text),
    };
  } finally {
    await guarded.release();
  }
}
