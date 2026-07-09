// Canonical custom dashboard surface inventory used by navigation and build proof.
export type DashboardSurface = {
  id: string;
  tab: string;
  path: string;
  label: string;
  assetPrefix: string;
  aliases?: readonly string[];
};

export const DASHBOARD_SURFACES = [
  {
    id: "pcc",
    tab: "pcc",
    path: "/pcc",
    label: "PCC",
    assetPrefix: "pcc-",
    aliases: ["/projects"],
  },
  {
    id: "app-studio",
    tab: "appStudio",
    path: "/app-studio",
    label: "App Studio",
    assetPrefix: "app-studio-dashboard-",
  },
  {
    id: "music-studio",
    tab: "musicStudio",
    path: "/music-studio",
    label: "Music Studio",
    assetPrefix: "music-studio-",
  },
  {
    id: "snes-studio",
    tab: "snesStudio",
    path: "/snes-studio",
    label: "SNES Studio",
    assetPrefix: "snes-studio-",
  },
  {
    id: "book-writer",
    tab: "bookWriter",
    path: "/book-writer",
    label: "Book Writer",
    assetPrefix: "book-writer-dashboard-",
  },
  {
    id: "kalshi",
    tab: "kalshi",
    path: "/kalshi",
    label: "Kalshi",
    assetPrefix: "kalshi-dashboard-",
  },
  {
    id: "pattern-lab",
    tab: "patternLab",
    path: "/pattern-lab",
    label: "Pattern Lab",
    assetPrefix: "pattern-lab-dashboard-",
  },
] as const satisfies readonly DashboardSurface[];

export const PCC_DASHBOARD_SURFACE = DASHBOARD_SURFACES[0];
