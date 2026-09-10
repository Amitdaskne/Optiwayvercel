import { getCurrentUser, logoutUser, UserProfile } from "../lib/auth";
import { getIconSvg } from "../lib/icons";
import { initTheme } from "../lib/theme";
import { dbService } from "../lib/db";

interface NavItem {
  key: string;
  label: string;
  href: string;
  iconName: string;
}

const navItems: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "dashboard.html", iconName: "layout" },
  { key: "sales", label: "New Sale / POS", href: "sales.html", iconName: "shoppingCart" },
  { key: "orders", label: "Pending Orders", href: "orders.html", iconName: "clock" },
  { key: "sales-history", label: "Sales History", href: "sales-history.html", iconName: "history" },
  { key: "customers", label: "Customers Directory", href: "customers.html", iconName: "users" },
  { key: "products", label: "Product Catalog", href: "products.html", iconName: "glasses" },
  { key: "inventory", label: "Inventory Stock", href: "inventory.html", iconName: "boxes" },
  { key: "purchase-bills", label: "Purchase Bills", href: "purchase-bills.html", iconName: "fileText" },
  { key: "prescriptions", label: "Prescriptions", href: "prescriptions.html", iconName: "eye" },
  { key: "suppliers", label: "Suppliers", href: "suppliers.html", iconName: "truck" },
  { key: "expenses", label: "Expenses", href: "expenses.html", iconName: "receipt" },
  { key: "reports", label: "Analytics & Reports", href: "reports.html", iconName: "barChart" },
  { key: "invoice", label: "Invoice Generator", href: "invoice.html", iconName: "fileText" },
  { key: "settings", label: "Store Settings", href: "settings.html", iconName: "settings" },
];

function getBrandInfo(): { logoUrl: string; storeName: string } {
  let logoUrl = "";
  let storeName = "OPTIWAY";
  try {
    logoUrl = localStorage.getItem("optiway_logo_url") || "";
    storeName = localStorage.getItem("optiway_store_name") || "OPTIWAY";
    if (!logoUrl || storeName === "OPTIWAY") {
      const localDb = localStorage.getItem("optiway_local_db");
      if (localDb) {
        const parsed = JSON.parse(localDb);
        if (parsed?.settings?.logoUrl) logoUrl = parsed.settings.logoUrl;
        if (parsed?.settings?.storeName) storeName = parsed.settings.storeName;
      }
    }
  } catch {
    // Ignore cache error
  }
  return { logoUrl, storeName };
}

function buildBrandHeaderHtml(isMobile = false): string {
  const { logoUrl, storeName } = getBrandInfo();
  const initial = (storeName || "O").charAt(0).toUpperCase();

  if (logoUrl) {
    return `
      <div class="flex items-center gap-2.5 overflow-hidden min-w-0">
        <div class="h-10 max-w-[80px] px-1.5 py-0.5 rounded-lg bg-white border border-slate-200 overflow-hidden flex items-center justify-center shadow-2xs shrink-0">
          <img src="${logoUrl}" alt="${storeName}" class="max-h-full max-w-full w-auto h-auto object-contain" />
        </div>
        <div class="min-w-0 flex-1">
          <span class="text-sm font-bold tracking-tight text-[#1f6feb] block truncate leading-tight">${storeName}</span>
          <span class="text-[10px] text-slate-500 block truncate font-medium">Optical Store</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="flex items-center gap-2.5 overflow-hidden min-w-0">
      <div id="${isMobile ? 'mobile' : 'sidebar'}-brand-badge" class="w-8 h-8 rounded-lg bg-[#1f6feb] flex items-center justify-center text-white font-bold text-base shadow-2xs shrink-0">
        ${initial}
      </div>
      <div class="min-w-0 flex-1">
        <span class="text-base font-bold tracking-tight text-[#1f6feb] block truncate leading-tight">${storeName}</span>
      </div>
    </div>
  `;
}

export function renderAppLayout(activeKey: string, pageTitle: string, user: UserProfile) {
  const sidebarContainer = document.getElementById("app-sidebar");
  const headerContainer = document.getElementById("app-header");

  if (sidebarContainer) {
    sidebarContainer.innerHTML = buildSidebarHtml(activeKey, user);
  }

  if (headerContainer) {
    headerContainer.innerHTML = buildHeaderHtml(pageTitle, user);
  }

  // Setup mobile sidebar drawer toggle
  setupMobileDrawerEvents();

  // Listen for dynamic settings updates to refresh brand branding live
  window.addEventListener("optiway:settings-updated", () => {
    refreshBrandElements();
  });

  // Background refresh of store settings from database to guarantee fresh logo & color
  dbService.getSettings().then((settings) => {
    if (settings) {
      refreshBrandElements();
    }
  }).catch(() => {});
}

function refreshBrandElements() {
  const desktopContainer = document.getElementById("sidebar-brand-container");
  if (desktopContainer) {
    desktopContainer.innerHTML = buildBrandHeaderHtml(false);
  }
  const mobileContainer = document.getElementById("mobile-brand-container");
  if (mobileContainer) {
    mobileContainer.innerHTML = buildBrandHeaderHtml(true);
  }
  const headerBadge = document.getElementById("header-store-badge");
  if (headerBadge) {
    const { logoUrl, storeName } = getBrandInfo();
    headerBadge.innerHTML = `
      ${logoUrl ? `<img src="${logoUrl}" alt="Logo" class="h-4 max-w-[36px] w-auto object-contain shrink-0" />` : `<span class="w-2 h-2 rounded-full bg-[#1f6feb] animate-pulse"></span>`}
      <span class="truncate max-w-[170px] font-medium">${storeName || "Main Branch"}</span>
    `;
  }
}

function buildSidebarHtml(activeKey: string, user: UserProfile): string {
  const mainItems = navItems.slice(0, 10); // dashboard, sales, orders, sales-history, customers, products, inventory, purchase-bills, prescriptions, suppliers
  const adminItems = navItems.slice(10);   // expenses, reports, invoice, settings

  const renderNavGroup = (items: NavItem[]) => items.map(item => {
    const isActive = item.key === activeKey;
    const activeClass = isActive 
      ? "bg-[#f0f7ff] text-[#1f6feb] border-r-4 border-[#1f6feb] font-semibold" 
      : "text-[#6b7280] hover:bg-gray-50 hover:text-[#111827] font-medium";
    
    return `
      <a href="${item.href}" class="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${activeClass}">
        <span class="shrink-0">${getIconSvg(item.iconName, isActive ? "text-[#1f6feb]" : "text-[#6b7280]")}</span>
        <span class="truncate">${item.label}</span>
      </a>
    `;
  }).join("");

  return `
    <!-- Desktop Sidebar -->
    <aside class="hidden lg:flex flex-col w-[240px] bg-white border-r border-[#e5e7eb] shrink-0 h-screen sticky top-0 z-30 select-none">
      <!-- Brand Header with Store Logo or Badge -->
      <div id="sidebar-brand-container" class="h-16 flex items-center px-4 border-b border-[#e5e7eb] gap-3 overflow-hidden">
        ${buildBrandHeaderHtml(false)}
      </div>

      <!-- Navigation links -->
      <nav class="flex-1 overflow-y-auto py-3">
        <div class="px-4 mb-1.5 text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Main Menu</div>
        ${renderNavGroup(mainItems)}

        <div class="px-4 mt-5 mb-1.5 text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Administration</div>
        ${renderNavGroup(adminItems)}
      </nav>

      <!-- User Info & Logout -->
      <div class="p-3.5 border-t border-[#e5e7eb] bg-gray-50/70 space-y-2.5">
        <div class="flex items-center justify-between min-w-0">
          <div class="min-w-0 pr-2">
            <p class="text-xs font-semibold text-[#111827] truncate">${user.displayName}</p>
            <p class="text-[11px] text-[#6b7280] truncate">${user.email || "store@optiway.com"}</p>
          </div>
        </div>
        <button id="btn-logout" title="Sign Out" class="w-full py-2 px-3 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 hover:text-rose-800 border border-rose-200 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-2xs">
          ${getIconSvg("logOut", "w-4 h-4 text-rose-600")}
          <span>Logout</span>
        </button>
      </div>
    </aside>

    <!-- Mobile Drawer Overlay & Sidebar -->
    <div id="mobile-drawer" class="fixed inset-0 z-50 lg:hidden hidden">
      <div id="mobile-overlay" class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity cursor-pointer"></div>
      <div class="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-white flex flex-col z-50 border-r border-[#e5e7eb] shadow-2xl animate-in slide-in-from-left duration-200">
        <div class="h-16 flex items-center justify-between px-4 border-b border-[#e5e7eb]">
          <div id="mobile-brand-container" class="min-w-0 flex-1 mr-2">
            ${buildBrandHeaderHtml(true)}
          </div>
          <button id="btn-close-mobile-drawer" class="p-2 text-[#6b7280] hover:text-[#111827] hover:bg-slate-100 rounded-lg cursor-pointer shrink-0" aria-label="Close menu">
            ${getIconSvg("x", "w-5 h-5")}
          </button>
        </div>
        <nav class="flex-1 overflow-y-auto py-3 touch-scroll">
          <div class="px-4 mb-1.5 text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Main Menu</div>
          ${renderNavGroup(mainItems)}

          <div class="px-4 mt-5 mb-1.5 text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">Administration</div>
          ${renderNavGroup(adminItems)}
        </nav>
        <div class="p-4 border-t border-[#e5e7eb] bg-gray-50 space-y-2.5 safe-bottom">
          <div class="min-w-0">
            <p class="text-xs font-semibold text-[#111827] truncate">${user.displayName}</p>
            <p class="text-[11px] text-[#6b7280] truncate">${user.email || "store@optiway.com"}</p>
          </div>
          <button id="btn-logout-mobile" title="Sign Out" class="w-full py-2.5 px-3 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg cursor-pointer transition-colors flex items-center justify-center gap-2 border border-rose-200 shadow-2xs" aria-label="Sign Out">
            ${getIconSvg("logOut", "w-4 h-4 text-rose-600")}
            <span>Logout</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Mobile Bottom Navigation Bar (Visible on mobile/tablet screens < lg) -->
    <nav id="mobile-bottom-nav" class="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-1 py-1 flex items-center justify-around shadow-[0_-4px_12px_rgba(0,0,0,0.05)] safe-bottom select-none">
      <a href="dashboard.html" class="flex flex-col items-center justify-center py-1 px-1.5 rounded-lg transition-colors min-w-[52px] min-h-[44px] ${activeKey === 'dashboard' ? 'text-[#1f6feb] font-bold' : 'text-slate-500 hover:text-slate-900'}">
        <span class="mb-0.5">${getIconSvg('layout', activeKey === 'dashboard' ? 'text-[#1f6feb] w-5 h-5' : 'text-slate-500 w-5 h-5')}</span>
        <span class="text-[10px] tracking-tight">Home</span>
      </a>
      <a href="sales.html" class="flex flex-col items-center justify-center py-1 px-1.5 rounded-lg transition-colors min-w-[52px] min-h-[44px] ${activeKey === 'sales' ? 'text-[#1f6feb] font-bold' : 'text-slate-500 hover:text-slate-900'}">
        <span class="mb-0.5">${getIconSvg('shoppingCart', activeKey === 'sales' ? 'text-[#1f6feb] w-5 h-5' : 'text-slate-500 w-5 h-5')}</span>
        <span class="text-[10px] tracking-tight">POS</span>
      </a>
      <a href="orders.html" class="flex flex-col items-center justify-center py-1 px-1.5 rounded-lg transition-colors min-w-[52px] min-h-[44px] ${activeKey === 'orders' ? 'text-[#1f6feb] font-bold' : 'text-slate-500 hover:text-slate-900'}">
        <span class="mb-0.5">${getIconSvg('clock', activeKey === 'orders' ? 'text-[#1f6feb] w-5 h-5' : 'text-slate-500 w-5 h-5')}</span>
        <span class="text-[10px] tracking-tight">Pending</span>
      </a>
      <a href="sales-history.html" class="flex flex-col items-center justify-center py-1 px-1.5 rounded-lg transition-colors min-w-[52px] min-h-[44px] ${activeKey === 'sales-history' ? 'text-[#1f6feb] font-bold' : 'text-slate-500 hover:text-slate-900'}">
        <span class="mb-0.5">${getIconSvg('history', activeKey === 'sales-history' ? 'text-[#1f6feb] w-5 h-5' : 'text-slate-500 w-5 h-5')}</span>
        <span class="text-[10px] tracking-tight">History</span>
      </a>
      <button id="btn-bottom-menu-toggle" type="button" class="flex flex-col items-center justify-center py-1 px-1.5 rounded-lg transition-colors min-w-[52px] min-h-[44px] text-slate-600 hover:text-slate-900 cursor-pointer">
        <span class="mb-0.5">${getIconSvg('menu', 'text-slate-600 w-5 h-5')}</span>
        <span class="text-[10px] tracking-tight">Menu</span>
      </button>
    </nav>
  `;
}

function buildHeaderHtml(pageTitle: string, user: UserProfile): string {
  const currentDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const { logoUrl, storeName } = getBrandInfo();

  return `
    <header class="h-16 bg-white border-b border-[#e5e7eb] px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20 shadow-2xs select-none">
      <div class="flex items-center gap-3">
        <button id="btn-toggle-mobile-drawer" class="lg:hidden p-2 text-[#6b7280] hover:bg-gray-100 rounded-lg">
          ${getIconSvg("menu", "w-5 h-5")}
        </button>
        <div class="flex items-center gap-3">
          <h1 class="text-base font-bold text-[#111827] leading-tight">${pageTitle}</h1>
          <div class="hidden md:block h-4 w-[1px] bg-[#e5e7eb]"></div>
          <span class="hidden md:block text-xs font-medium text-[#6b7280]">${currentDate}</span>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <div id="header-store-badge" class="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-[#f0f7ff] border border-[#1f6feb]/20 text-[#1f6feb] text-xs font-medium">
          ${logoUrl ? `<img src="${logoUrl}" alt="Logo" class="h-4 max-w-[36px] w-auto object-contain shrink-0" />` : `<span class="w-2 h-2 rounded-full bg-[#1f6feb] animate-pulse"></span>`}
          <span class="truncate max-w-[170px]">${storeName || "Main Branch"}</span>
        </div>

        <div class="flex items-center gap-2 pl-3 border-l border-[#e5e7eb]">
          <div class="w-8 h-8 rounded-full bg-[#1f6feb] text-white font-bold text-xs flex items-center justify-center shadow-2xs">
            ${(user.displayName || "O").slice(0, 2).toUpperCase()}
          </div>
          <span class="hidden sm:inline text-xs font-semibold text-[#111827]">${user.displayName}</span>
          <button id="btn-logout-header" title="Logout / Sign Out" class="ml-1 sm:ml-2 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs">
            ${getIconSvg("logOut", "w-3.5 h-3.5 text-rose-600")}
            <span class="hidden xs:inline font-medium">Logout</span>
          </button>
        </div>
      </div>
    </header>
  `;
}

function setupMobileDrawerEvents() {
  const toggleBtn = document.getElementById("btn-toggle-mobile-drawer");
  const bottomMenuToggleBtn = document.getElementById("btn-bottom-menu-toggle");
  const closeBtn = document.getElementById("btn-close-mobile-drawer");
  const drawer = document.getElementById("mobile-drawer");
  const overlay = document.getElementById("mobile-overlay");

  const openDrawer = () => drawer?.classList.remove("hidden");
  const closeDrawer = () => drawer?.classList.add("hidden");

  toggleBtn?.addEventListener("click", openDrawer);
  bottomMenuToggleBtn?.addEventListener("click", openDrawer);
  closeBtn?.addEventListener("click", closeDrawer);
  overlay?.addEventListener("click", closeDrawer);

  document.getElementById("btn-logout")?.addEventListener("click", () => logoutUser());
  document.getElementById("btn-logout-mobile")?.addEventListener("click", () => logoutUser());
  document.getElementById("btn-logout-header")?.addEventListener("click", () => logoutUser());
}

// Global Toast System without emojis
export const Toast = {
  show(message: string, type: "success" | "error" | "info" = "info", duration = 3500) {
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.className = "fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-md w-full px-4 pointer-events-none";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    let bgClass = "bg-slate-900 text-white border-slate-800";
    let iconName = "alertCircle";

    if (type === "success") {
      bgClass = "bg-emerald-900 text-emerald-50 border-emerald-700";
      iconName = "check";
    } else if (type === "error") {
      bgClass = "bg-rose-900 text-rose-50 border-rose-700";
      iconName = "alertCircle";
    }

    toast.className = `flex items-center gap-3 p-3.5 rounded-lg border shadow-lg text-sm font-medium transition-all transform duration-200 ease-out translate-y-2 opacity-0 pointer-events-auto ${bgClass}`;
    toast.innerHTML = `
      <span class="shrink-0">${getIconSvg(iconName, "w-4 h-4")}</span>
      <span class="flex-1">${message}</span>
      <button class="text-slate-300 hover:text-white text-xs px-1" onclick="this.parentElement.remove()">
        ${getIconSvg("x", "w-3.5 h-3.5")}
      </button>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.remove("translate-y-2", "opacity-0");
    });

    setTimeout(() => {
      toast.classList.add("opacity-0", "translate-y-2");
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }
};
