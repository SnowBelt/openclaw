/**
 * Narrow, type-only gateway frame contracts.
 *
 * Keep these structural types aligned with `schema/frames.ts`. Runtime schema
 * code asserts bidirectional assignability so public consumers can depend on
 * the frame envelopes without importing the complete protocol schema graph.
 */
import type { GatewayClientInfo } from "./client-info.js";

export type ConnectParams = {
  minProtocol: number;
  maxProtocol: number;
  client: GatewayClientInfo;
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  pathEnv?: string;
  role?: string;
  scopes?: string[];
  device?: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce: string;
  };
  auth?: {
    token?: string;
    bootstrapToken?: string;
    deviceToken?: string;
    password?: string;
    approvalRuntimeToken?: string;
    agentRuntimeIdentityToken?: string;
  };
  locale?: string;
  userAgent?: string;
};

export type ErrorShape = {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
};

export type RequestFrame = {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
};

export type StateVersion = {
  presence: number;
  health: number;
};

export type EventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: StateVersion;
};

export type PresenceEntry = {
  host?: string;
  ip?: string;
  version?: string;
  platform?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  mode?: string;
  lastInputSeconds?: number;
  reason?: string;
  tags?: string[];
  text?: string;
  ts: number;
  deviceId?: string;
  roles?: string[];
  scopes?: string[];
  instanceId?: string;
};

export type Snapshot = {
  presence: PresenceEntry[];
  health: unknown;
  stateVersion: StateVersion;
  uptimeMs: number;
  configPath?: string;
  stateDir?: string;
  sessionDefaults?: {
    defaultAgentId: string;
    mainKey: string;
    mainSessionKey: string;
    scope?: string;
  };
  authMode?: "none" | "token" | "password" | "trusted-proxy";
  updateAvailable?: {
    currentVersion: string;
    latestVersion: string;
    channel: string;
  };
};

export type HelloOk = {
  type: "hello-ok";
  protocol: number;
  server: {
    version: string;
    connId: string;
  };
  features: {
    methods: string[];
    events: string[];
    capabilities?: string[];
  };
  snapshot: Snapshot;
  controlUiTabs?: Array<{
    pluginId: string;
    id: string;
    label: string;
    description?: string;
    icon?: string;
    path?: string;
    group?: "control" | "agent";
    order?: number;
  }>;
  pluginSurfaceUrls?: Record<string, string>;
  auth: {
    deviceToken?: string;
    role: string;
    scopes: string[];
    issuedAtMs?: number;
    deviceTokens?: Array<{
      deviceToken: string;
      role: string;
      scopes: string[];
      issuedAtMs: number;
    }>;
  };
  policy: {
    maxPayload: number;
    maxBufferedBytes: number;
    tickIntervalMs: number;
  };
};
