const STATUS_CACHE_LIMIT = 128;
const formattedStatusCache = new Map<string, string>();
const projectDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const updatedTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export function formatPccStatus(status: string | null | undefined): string {
  const value = typeof status === "string" ? status.trim() : "";
  if (!value) {
    return "Not recorded";
  }
  const cached = formattedStatusCache.get(value);
  if (cached) {
    return cached;
  }
  const formatted = value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  if (formattedStatusCache.size >= STATUS_CACHE_LIMIT) {
    formattedStatusCache.clear();
  }
  formattedStatusCache.set(value, formatted);
  return formatted;
}

export function formatPccProjectDate(value: string | undefined): string {
  if (!value) {
    return "No due date";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : projectDateFormatter.format(date);
}

export function formatPccUpdatedAt(value: number | null): string {
  return value ? `Updated ${updatedTimeFormatter.format(new Date(value))}` : "Not loaded yet";
}
