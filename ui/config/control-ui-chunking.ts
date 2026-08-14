// Control UI config module wires control ui chunking behavior.
export function normalizeModuleId(id: string): string {
  return id.replace(/\\/g, "/");
}

function moduleIdIncludesPackage(id: string, packageName: string): boolean {
  const normalized = normalizeModuleId(id);
  return (
    normalized.includes(`/node_modules/${packageName}/`) ||
    normalized.includes(`/openclaw-pnpm-node-modules/${packageName}/`)
  );
}

const CONTROL_UI_FEATURE_CHUNKS = [
  ["/ui/src/ui/controllers/kalshi-dashboard.ts", "kalshi-dashboard-runtime"],
  ["/ui/src/ui/controllers/pcc.ts", "pcc-runtime"],
  ["/ui/src/ui/controllers/workboard.ts", "workboard-runtime"],
  ["/ui/src/ui/controllers/book-writer-dashboard.ts", "book-writer-runtime"],
] as const;

export function controlUiManualChunk(id: string): string | undefined {
  const normalized = normalizeModuleId(id);
  for (const [sourcePath, chunkName] of CONTROL_UI_FEATURE_CHUNKS) {
    if (normalized.includes(sourcePath)) {
      return chunkName;
    }
  }

  if (
    moduleIdIncludesPackage(id, "lit") ||
    moduleIdIncludesPackage(id, "lit-html") ||
    moduleIdIncludesPackage(id, "@lit/reactive-element")
  ) {
    return "lit-runtime";
  }

  if (
    moduleIdIncludesPackage(id, "highlight.js") ||
    moduleIdIncludesPackage(id, "markdown-it") ||
    moduleIdIncludesPackage(id, "markdown-it-task-lists") ||
    moduleIdIncludesPackage(id, "dompurify") ||
    moduleIdIncludesPackage(id, "entities") ||
    moduleIdIncludesPackage(id, "linkify-it") ||
    moduleIdIncludesPackage(id, "mdurl") ||
    moduleIdIncludesPackage(id, "punycode.js") ||
    moduleIdIncludesPackage(id, "uc.micro")
  ) {
    return "markdown-runtime";
  }

  if (moduleIdIncludesPackage(id, "zod") || moduleIdIncludesPackage(id, "json5")) {
    return "config-runtime";
  }

  if (
    moduleIdIncludesPackage(id, "@noble/ed25519") ||
    moduleIdIncludesPackage(id, "@noble/hashes") ||
    moduleIdIncludesPackage(id, "ipaddr.js")
  ) {
    return "gateway-runtime";
  }

  return undefined;
}
