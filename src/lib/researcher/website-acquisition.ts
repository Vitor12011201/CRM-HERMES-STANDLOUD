import { EvidenceSourceType } from "@/generated/prisma/enums";

import {
  maxResearchSourceSnapshotContentLength,
  maxResearchSourceSnapshotTitleLength,
  researchSourceSnapshotSchema,
  type ResearchSourceSnapshot,
} from "./contracts";

export const maxWebsiteRedirects = 3;
export const websiteAcquisitionTimeoutMs = 10_000;
export const maxWebsiteResponseBytes = 1_048_576;
export const maxWebsiteJsonLdBlocks = 5;
export const maxWebsiteJsonLdEntities = 20;
export const maxWebsiteSourceFieldLength = 500;
export const maxWebsiteMetadataSectionLength = 2_000;
export const maxWebsiteStructuredDataSectionLength = 4_000;

const acceptedContentTypes = new Set(["text/html", "text/plain"]);
const blockedHostnameSuffixes = [".localhost", ".local", ".localdomain", ".internal"];

export type WebsiteFetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type WebsiteAcquisitionRequest = {
  url: string;
  fetchImplementation?: WebsiteFetchImplementation;
  timeoutMs?: number;
};

export type WebsiteAcquisitionErrorCode =
  | "INVALID_URL"
  | "UNSAFE_URL"
  | "TOO_MANY_REDIRECTS"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE"
  | "EMPTY_CONTENT";

/** Controlled errors intentionally contain a code only, never source content or transport details. */
export class WebsiteAcquisitionError extends Error {
  constructor(public readonly code: WebsiteAcquisitionErrorCode) {
    super(code);
    this.name = "WebsiteAcquisitionError";
  }
}

function acquisitionError(code: WebsiteAcquisitionErrorCode): never {
  throw new WebsiteAcquisitionError(code);
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;

  const octets = parts.map(Number);
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null;
}

function isUnsafeIpv4(octets: number[]): boolean {
  const [first, second] = octets;

  return first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 168))
    || (first === 198 && (second === 18 || second === 19));
}

function isUnsafeIpv6(hostname: string): boolean {
  const value = hostname.toLowerCase();

  return value === "::"
    || value === "::1"
    || value.startsWith("fc")
    || value.startsWith("fd")
    || /^fe[89ab][0-9a-f]*:/.test(value)
    || value.startsWith("::ffff:");
}

function isUnsafeHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!normalized) return true;

  if (
    normalized === "localhost"
    || normalized === "metadata"
    || normalized === "metadata.google.internal"
    || normalized === "ip6-localhost"
    || blockedHostnameSuffixes.some((suffix) => normalized.endsWith(suffix))
  ) {
    return true;
  }

  const ipv4 = parseIpv4(normalized);
  if (ipv4) return isUnsafeIpv4(ipv4);
  if (normalized.includes(":")) return isUnsafeIpv6(normalized);

  // Single-label hosts are typically local search domains, not public websites.
  return !normalized.includes(".");
}

/**
 * Validates URL-level SSRF controls before every request and redirect.
 * DNS resolution/rebinding cannot be reliably verified in the Worker runtime
 * without a trusted resolver, so hostname destinations remain an operational
 * egress-control responsibility in addition to these fail-closed checks.
 */
export function parseSafeWebsiteUrl(value: string): URL {
  if (typeof value !== "string" || value.trim() === "" || value.trim() !== value) {
    return acquisitionError("INVALID_URL");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return acquisitionError("INVALID_URL");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || !url.hostname
    || url.username
    || url.password
  ) {
    return acquisitionError("INVALID_URL");
  }

  if (isUnsafeHostname(url.hostname)) return acquisitionError("UNSAFE_URL");

  url.hash = "";
  return url;
}

function getContentType(response: Response): string {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function hasOversizedContentLength(response: Response): boolean {
  const value = response.headers.get("content-length")?.trim();
  if (!value || !/^\d+$/.test(value)) return false;
  return Number(value) > maxWebsiteResponseBytes;
}

async function readBodyWithinLimit(response: Response): Promise<Uint8Array> {
  if (hasOversizedContentLength(response)) return acquisitionError("RESPONSE_TOO_LARGE");

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxWebsiteResponseBytes) return acquisitionError("RESPONSE_TOO_LARGE");
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxWebsiteResponseBytes) {
        await reader.cancel();
        return acquisitionError("RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };

  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (_match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized in namedEntities) return namedEntities[normalized];

    const numericValue = normalized.startsWith("#x")
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    if (!Number.isInteger(numericValue) || numericValue < 0 || numericValue > 0x10ffff) return "";

    try {
      return String.fromCodePoint(numericValue);
    } catch {
      return "";
    }
  });
}

function normalizeVisibleText(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function limitedSourceText(value: string): string | undefined {
  const normalized = normalizeVisibleText(value).slice(0, maxWebsiteSourceFieldLength);
  return normalized || undefined;
}

function getHtmlAttribute(attributes: string, name: string): string | undefined {
  const expression = new RegExp(
    "\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>`]+))",
    "i",
  );
  const match = expression.exec(attributes);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

const allowedMetadataFields = [
  { attribute: "name", value: "description", label: "Description" },
  { attribute: "property", value: "og:title", label: "OpenGraph Title" },
  { attribute: "property", value: "og:description", label: "OpenGraph Description" },
  { attribute: "property", value: "og:url", label: "OpenGraph URL" },
] as const;

function extractMetadata(html: string): string[] {
  const head = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(html)?.[1] ?? "";
  const values = new Map<string, string>();
  const metaPattern = /<meta\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaPattern.exec(head))) {
    const attributes = match[1];
    const content = getHtmlAttribute(attributes, "content");
    if (!content) continue;

    for (const field of allowedMetadataFields) {
      const attributeValue = getHtmlAttribute(attributes, field.attribute);
      if (attributeValue?.toLowerCase() !== field.value || values.has(field.label)) continue;

      const value = limitedSourceText(content);
      if (value) values.set(field.label, value);
    }
  }

  return allowedMetadataFields.flatMap(({ label }) => {
    const value = values.get(label);
    return value ? [`${label}: ${value}`] : [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValues(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const unique = new Set<string>();

  for (const entry of values) {
    if (typeof entry !== "string") continue;
    const normalized = limitedSourceText(entry);
    if (normalized) unique.add(normalized);
  }

  return [...unique].slice(0, 5);
}

function joinSourceValues(values: string[]): string | undefined {
  const joined = values.join(", ").slice(0, maxWebsiteSourceFieldLength);
  return joined || undefined;
}

function collectJsonLdEntities(value: unknown, entities: Record<string, unknown>[]): void {
  if (entities.length >= maxWebsiteJsonLdEntities) return;

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectJsonLdEntities(entry, entities);
      if (entities.length >= maxWebsiteJsonLdEntities) return;
    }
    return;
  }

  if (!isRecord(value)) return;

  const graph = value["@graph"];
  const ownEntity = { ...value };
  delete ownEntity["@graph"];
  if (Object.keys(ownEntity).length > 0) entities.push(ownEntity);

  if (graph !== undefined) collectJsonLdEntities(graph, entities);
}

function extractAddress(value: unknown): string | undefined {
  const records = Array.isArray(value) ? value : [value];
  const addresses = records.flatMap((entry) => {
    if (typeof entry === "string") return stringValues(entry);
    if (!isRecord(entry)) return [];

    const parts = [
      ["streetAddress", "Street address"],
      ["addressLocality", "Locality"],
      ["addressRegion", "Region"],
      ["postalCode", "Postal code"],
      ["addressCountry", "Country"],
    ].flatMap(([field, label]) => {
      const text = joinSourceValues(stringValues(entry[field]));
      return text ? [`${label}: ${text}`] : [];
    });

    return parts.length > 0 ? [parts.join("; ")] : [];
  });

  return joinSourceValues(addresses);
}

function extractAreaServed(value: unknown): string | undefined {
  const values = (Array.isArray(value) ? value : [value]).flatMap((entry) => {
    if (typeof entry === "string") return stringValues(entry);
    if (!isRecord(entry)) return [];
    return stringValues(entry.name);
  });
  return joinSourceValues(values);
}

function extractOpeningHoursSpecification(value: unknown): string | undefined {
  const specifications = (Array.isArray(value) ? value : [value]).flatMap((entry) => {
    if (!isRecord(entry)) return [];

    const parts = [
      ["dayOfWeek", "Day"],
      ["opens", "Opens"],
      ["closes", "Closes"],
    ].flatMap(([field, label]) => {
      const text = joinSourceValues(stringValues(entry[field]));
      return text ? [`${label}: ${text}`] : [];
    });

    return parts.length > 0 ? [parts.join("; ")] : [];
  });

  return joinSourceValues(specifications);
}

function extractStructuredEntity(entity: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const scalarFields = [
    ["@type", "Type"],
    ["name", "Name"],
    ["description", "Description"],
    ["url", "URL"],
    ["telephone", "Telephone"],
    ["email", "Email"],
    ["openingHours", "Opening hours"],
    ["sameAs", "Same as"],
  ] as const;

  for (const [field, label] of scalarFields) {
    const text = joinSourceValues(stringValues(entity[field]));
    if (text) lines.push(`${label}: ${text}`);
  }

  const address = extractAddress(entity.address);
  if (address) lines.push(`Address: ${address}`);

  const areaServed = extractAreaServed(entity.areaServed);
  if (areaServed) lines.push(`Area served: ${areaServed}`);

  const openingHoursSpecification = extractOpeningHoursSpecification(entity.openingHoursSpecification);
  if (openingHoursSpecification) lines.push(`Opening hours specification: ${openingHoursSpecification}`);

  return lines;
}

function extractJsonLd(html: string): string[] {
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  const lines: string[] = [];
  let processedBlocks = 0;
  let match: RegExpExecArray | null;

  while ((match = scripts.exec(html)) && processedBlocks < maxWebsiteJsonLdBlocks) {
    const type = getHtmlAttribute(match[1], "type")?.toLowerCase();
    if (type !== "application/ld+json") continue;
    processedBlocks += 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(match[2]);
    } catch {
      continue;
    }

    const entities: Record<string, unknown>[] = [];
    collectJsonLdEntities(parsed, entities);
    for (const entity of entities) {
      lines.push(...extractStructuredEntity(entity));
      if (lines.join("\n").length >= maxWebsiteStructuredDataSectionLength) {
        return lines;
      }
    }
  }

  return lines;
}

function section(label: string, lines: string[]): string | undefined {
  const content = lines.join("\n").trim();
  return content ? `[${label}]\n${content}` : undefined;
}

function extractTitle(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (!match) return undefined;

  const title = normalizeVisibleText(match[1]).slice(0, maxResearchSourceSnapshotTitleLength);
  return title || undefined;
}

function extractWebsiteText(body: string, contentType: string): { title?: string; content: string } {
  if (contentType === "text/plain") {
    const visibleContent = body.replace(/\s+/g, " ").trim();
    const content = section("VISIBLE CONTENT", visibleContent ? [visibleContent] : [])
      ?.slice(0, maxResearchSourceSnapshotContentLength) ?? "";
    return { content };
  }

  const title = extractTitle(body);
  const metadata = extractMetadata(body);
  const structuredData = extractJsonLd(body);
  const visibleHtml = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|head|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(script|style|noscript|template)\b[^>]*\/>/gi, " ");
  const visibleContent = normalizeVisibleText(visibleHtml);
  const content = [
    section("VISIBLE CONTENT", visibleContent ? [visibleContent] : []),
    section("METADATA", metadata)?.slice(0, maxWebsiteMetadataSectionLength),
    section("STRUCTURED DATA / JSON-LD", structuredData)?.slice(0, maxWebsiteStructuredDataSectionLength),
  ].filter((value): value is string => Boolean(value)).join("\n\n")
    .slice(0, maxResearchSourceSnapshotContentLength);

  return { ...(title ? { title } : {}), content };
}

function getTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return websiteAcquisitionTimeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > websiteAcquisitionTimeoutMs) {
    return acquisitionError("INVALID_URL");
  }
  return timeoutMs;
}

/**
 * Deterministically acquires one public textual website into untrusted source
 * data. Visible content, allowlisted metadata, and allowlisted JSON-LD remain
 * explicitly labeled source data and are never executed. It performs no model
 * call, database write, browser rendering, or semantic interpretation.
 */
export async function acquireWebsiteSnapshot(
  request: WebsiteAcquisitionRequest,
): Promise<ResearchSourceSnapshot> {
  const fetchImplementation = request.fetchImplementation ?? fetch;
  const timeoutMs = getTimeoutMs(request.timeoutMs);
  let currentUrl = parseSafeWebsiteUrl(request.url);
  let redirects = 0;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new WebsiteAcquisitionError("TIMEOUT"));
    }, timeoutMs);
  });

  try {
    while (true) {
      let response: Response;
      try {
        response = await Promise.race([
          fetchImplementation(currentUrl.toString(), {
            method: "GET",
            redirect: "manual",
            credentials: "omit",
            headers: { Accept: "text/html, text/plain;q=0.9" },
            signal: controller.signal,
          }),
          timeoutPromise,
        ]);
      } catch (error) {
        if (error instanceof WebsiteAcquisitionError) throw error;
        if (controller.signal.aborted) return acquisitionError("TIMEOUT");
        return acquisitionError("NETWORK_ERROR");
      }

      if (response.status >= 300 && response.status < 400) {
        if (redirects >= maxWebsiteRedirects) return acquisitionError("TOO_MANY_REDIRECTS");

        const location = response.headers.get("location");
        if (!location) return acquisitionError("HTTP_ERROR");

        let redirectUrl: URL;
        try {
          redirectUrl = new URL(location, currentUrl);
        } catch {
          return acquisitionError("INVALID_URL");
        }
        currentUrl = parseSafeWebsiteUrl(redirectUrl.toString());
        redirects += 1;
        continue;
      }

      if (!response.ok) return acquisitionError("HTTP_ERROR");

      const contentType = getContentType(response);
      if (!acceptedContentTypes.has(contentType)) return acquisitionError("UNSUPPORTED_CONTENT_TYPE");

      let body: Uint8Array;
      try {
        body = await Promise.race([readBodyWithinLimit(response), timeoutPromise]);
      } catch (error) {
        if (error instanceof WebsiteAcquisitionError) throw error;
        if (controller.signal.aborted) return acquisitionError("TIMEOUT");
        return acquisitionError("NETWORK_ERROR");
      }

      const extracted = extractWebsiteText(new TextDecoder().decode(body), contentType);
      if (!extracted.content) return acquisitionError("EMPTY_CONTENT");

      const snapshot = researchSourceSnapshotSchema.safeParse({
        sourceType: EvidenceSourceType.WEBSITE,
        sourceUrl: currentUrl.toString(),
        ...extracted,
      });
      if (!snapshot.success) return acquisitionError("EMPTY_CONTENT");

      return snapshot.data;
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
