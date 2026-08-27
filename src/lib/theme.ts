/**
 * OPTIWAY Optical Management System - Universal Theme Color Engine
 * Provides 24+ curated presets, custom hex pickers, and dynamic CSS variable injection.
 */

export interface ThemeColorPreset {
  id: string;
  name: string;
  hex: string;
  category: "Classic & Blue" | "Green & Teal" | "Warm & Earth" | "Red & Rose" | "Purple & Violet" | "Neutral & Dark";
}

export const THEME_COLOR_PRESETS: ThemeColorPreset[] = [
  // Classic & Blue
  { id: "optiway-blue", name: "Optiway Royal Blue", hex: "#1f6feb", category: "Classic & Blue" },
  { id: "azure-blue", name: "Electric Azure", hex: "#2563eb", category: "Classic & Blue" },
  { id: "sky-sapphire", name: "Sky Sapphire", hex: "#0284c7", category: "Classic & Blue" },
  { id: "navy-marine", name: "Deep Navy Marine", hex: "#1e3a8a", category: "Classic & Blue" },
  { id: "aegean-cyan", name: "Aegean Sea", hex: "#0891b2", category: "Classic & Blue" },
  
  // Green & Teal
  { id: "emerald-vision", name: "Emerald Vision", hex: "#059669", category: "Green & Teal" },
  { id: "deep-teal", name: "Ocean Teal", hex: "#0d9488", category: "Green & Teal" },
  { id: "fresh-jade", name: "Fresh Jade", hex: "#10b981", category: "Green & Teal" },
  { id: "forest-pine", name: "Forest Pine", hex: "#047857", category: "Green & Teal" },
  { id: "olive-lime", name: "Olive Citrus", hex: "#65a30d", category: "Green & Teal" },

  // Warm & Earth
  { id: "sunset-amber", name: "Sunset Amber", hex: "#d97706", category: "Warm & Earth" },
  { id: "warm-bronze", name: "Warm Bronze", hex: "#b45309", category: "Warm & Earth" },
  { id: "imperial-gold", name: "Imperial Gold", hex: "#ca8a04", category: "Warm & Earth" },
  { id: "terracotta", name: "Copper Terracotta", hex: "#c2410c", category: "Warm & Earth" },
  { id: "tangerine", name: "Vibrant Tangerine", hex: "#ea580c", category: "Warm & Earth" },

  // Red & Rose
  { id: "ruby-crimson", name: "Ruby Crimson", hex: "#dc2626", category: "Red & Rose" },
  { id: "rose-velvet", name: "Rose Velvet", hex: "#e11d48", category: "Red & Rose" },
  { id: "magenta-fuchsia", name: "Magenta Orchid", hex: "#db2777", category: "Red & Rose" },
  { id: "berry-plum", name: "Berry Plum", hex: "#86198f", category: "Red & Rose" },

  // Purple & Violet
  { id: "electric-violet", name: "Electric Violet", hex: "#7c3aed", category: "Purple & Violet" },
  { id: "royal-orchid", name: "Royal Purple", hex: "#9333ea", category: "Purple & Violet" },
  { id: "indigo-twilight", name: "Indigo Twilight", hex: "#4f46e5", category: "Purple & Violet" },
  { id: "midnight-indigo", name: "Midnight Iris", hex: "#4338ca", category: "Purple & Violet" },

  // Neutral & Dark
  { id: "slate-titanium", name: "Slate Titanium", hex: "#475569", category: "Neutral & Dark" },
  { id: "midnight-obsidian", name: "Midnight Obsidian", hex: "#0f172a", category: "Neutral & Dark" }
];

export const DEFAULT_THEME_COLOR = "#1f6feb";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    clean = clean.split("").map(c => c + c).join("");
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) {
    return { r: 31, g: 111, b: 235 }; // fallback #1f6feb
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function adjustBrightness(hex: string, percent: number): string {
  const { r, g, b } = hexToRgb(hex);
  const factor = 1 + percent / 100;
  const newR = Math.min(255, Math.max(0, Math.round(r * factor)));
  const newG = Math.min(255, Math.max(0, Math.round(g * factor)));
  const newB = Math.min(255, Math.max(0, Math.round(b * factor)));
  return `#${((1 << 24) + (newR << 16) + (newG << 8) + newB).toString(16).slice(1)}`;
}

/**
 * Applies the given theme color globally by setting CSS custom properties and injecting override rules
 */
export function applyThemeColor(hex: string) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#")) {
    hex = DEFAULT_THEME_COLOR;
  }

  const { r, g, b } = hexToRgb(hex);
  const hoverHex = adjustBrightness(hex, -15);
  const activeHex = adjustBrightness(hex, -25);
  const root = document.documentElement;

  // Set CSS Variables
  root.style.setProperty("--theme-primary", hex);
  root.style.setProperty("--theme-primary-hover", hoverHex);
  root.style.setProperty("--theme-primary-active", activeHex);
  root.style.setProperty("--theme-primary-rgb", `${r}, ${g}, ${b}`);
  root.style.setProperty("--theme-primary-light", `rgba(${r}, ${g}, ${b}, 0.08)`);
  root.style.setProperty("--theme-primary-light-15", `rgba(${r}, ${g}, ${b}, 0.15)`);
  root.style.setProperty("--theme-primary-light-25", `rgba(${r}, ${g}, ${b}, 0.25)`);
  root.style.setProperty("--theme-primary-border", `rgba(${r}, ${g}, ${b}, 0.3)`);

  // Cache in localStorage for zero-latency load on all pages
  try {
    localStorage.setItem("optiway_theme_color", hex);
  } catch {
    // Ignore storage quota errors
  }

  // Dynamic style injection for comprehensive coverage across layout, buttons, links, active tabs
  let styleEl = document.getElementById("optiway-dynamic-theme-overrides") as HTMLStyleElement;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "optiway-dynamic-theme-overrides";
    document.head.appendChild(styleEl);
  }

  styleEl.innerHTML = `
    :root {
      --primary-color: ${hex};
      --primary-hover: ${hoverHex};
      --primary-rgb: ${r}, ${g}, ${b};
    }

    /* Core Brand Accents */
    .bg-\\[\\#1f6feb\\], .bg-blue-600 {
      background-color: ${hex} !important;
    }
    .hover\\:bg-\\[\\#1f6feb\\]:hover, .hover\\:bg-blue-700:hover {
      background-color: ${hoverHex} !important;
    }
    .text-\\[\\#1f6feb\\], .text-blue-600, .text-blue-700 {
      color: ${hex} !important;
    }
    .border-\\[\\#1f6feb\\], .border-blue-600, .border-blue-500 {
      border-color: ${hex} !important;
    }
    .bg-\\[\\#f0f7ff\\], .bg-blue-50 {
      background-color: rgba(${r}, ${g}, ${b}, 0.08) !important;
    }
    .border-blue-200, .border-blue-300 {
      border-color: rgba(${r}, ${g}, ${b}, 0.25) !important;
    }
    .bg-blue-100 {
      background-color: rgba(${r}, ${g}, ${b}, 0.16) !important;
    }

    /* Active Tab Highlights & Sidebar selection */
    .tab-btn.active, .tab-link.active {
      border-color: ${hex} !important;
      color: ${hex} !important;
    }
    .tab-btn.active span[class*="bg-blue-100"],
    .tab-link.active span[class*="bg-blue-100"] {
      background-color: rgba(${r}, ${g}, ${b}, 0.18) !important;
      color: ${hex} !important;
    }

    /* Input Focus Rings */
    input:focus, select:focus, textarea:focus {
      border-color: ${hex} !important;
      box-shadow: 0 0 0 2px rgba(${r}, ${g}, ${b}, 0.2) !important;
    }

    /* Primary Buttons */
    .btn-primary, button.bg-blue-600 {
      background-color: ${hex} !important;
      color: #ffffff !important;
    }
    .btn-primary:hover, button.bg-blue-600:hover {
      background-color: ${hoverHex} !important;
    }
    .btn-primary:active, button.bg-blue-600:active {
      background-color: ${activeHex} !important;
    }

    /* Active Nav Items in layout */
    #app-sidebar a[class*="border-[#1f6feb]"],
    #mobile-drawer a[class*="border-[#1f6feb]"] {
      background-color: rgba(${r}, ${g}, ${b}, 0.08) !important;
      color: ${hex} !important;
      border-right-color: ${hex} !important;
    }
  `;
}

/**
 * Initializes theme immediately on page load from cached settings
 */
export function initTheme() {
  try {
    const cached = localStorage.getItem("optiway_theme_color");
    if (cached) {
      applyThemeColor(cached);
      return;
    }
    const localDb = localStorage.getItem("optiway_local_db");
    if (localDb) {
      const parsed = JSON.parse(localDb);
      if (parsed?.settings?.themeColor) {
        applyThemeColor(parsed.settings.themeColor);
        return;
      }
    }
  } catch {
    // Ignore error
  }
  applyThemeColor(DEFAULT_THEME_COLOR);
}

// Auto-run on module evaluation
initTheme();
