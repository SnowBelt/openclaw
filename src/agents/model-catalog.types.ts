/**
 * Shared model catalog row types.
 * Used by discovery, browsing, visibility, and provider-auth code so renderers
 * and filters agree on stable model metadata.
 */
import type {
  ModelApi,
  ModelCompatConfig,
  ModelMediaInputConfig,
  ModelRouteConfig,
} from "../config/types.models.js";

/** Input modalities a catalog entry can advertise. */
export type ModelInputType = "text" | "image" | "audio" | "video" | "document";

/** Unknown routes are never assumed to be local, included, or free. */
export type ModelRouteKind = "local" | "subscription" | "metered" | "unknown";

export type ModelCertificationState = "candidate" | "certified" | "unlisted";

/** Normalized model metadata exposed by the agent model catalog. */
export type ModelCatalogEntry = {
  id: string;
  name: string;
  provider: string;
  alias?: string;
  api?: ModelApi;
  /** Internal transport fact used to derive route; stripped from public RPC results. */
  baseUrl?: string;
  /** Internal configured route fact; stripped from public RPC results. */
  routeConfig?: ModelRouteConfig;
  contextWindow?: number;
  contextTokens?: number;
  reasoning?: boolean;
  input?: ModelInputType[];
  params?: Record<string, unknown>;
  compat?: ModelCompatConfig;
  mediaInput?: ModelMediaInputConfig;
  route?: ModelRouteKind;
  certification?: ModelCertificationState;
};
