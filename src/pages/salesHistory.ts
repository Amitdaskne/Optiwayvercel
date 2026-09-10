import { initAuthGuard } from "../lib/auth";
import { renderAppLayout, Toast } from "../components/layout";
import { dbService, Sale, Prescription, Customer, Order, Receipt, StoreSettings, ensureArray, formatDateStr, ensureDateString } from "../lib/db";
import { downloadSalesHistoryListPDF, downloadSalesListCSV, printThermalReceiptDirect, downloadInvoicePDF, downloadPrescriptionPDF, printInvoiceDirect } from "../lib/exportUtils";
import { sendSaleWhatsAppPrompt } from "../lib/whatsapp";

let allSales: Sale[] = [];
let selectedSale: Sale | null = null;
let quickConfirmSaleTarget: Sale | null = null;
let confirmedSaleForDownload: Sale | null = null;
let confirmedRxForDownload: Prescription | null = null;
let storeSettings: StoreSettings | null = null;
let activeDateFilter: "all" | "today" | "yesterday" | "week" | "month" = "all";

initAuthGuard({
  onUserReady: async (user) => {
    renderAppLayout("sales-history", "Sales History & Completed Bills", user);
    await loadSalesHistory();
  }
});

async function loadSalesHistory() {
  try {
    storeSettings = await dbService.getSettings();
    allSales = await dbService.getList<Sale>("sales");

    // Sort newest first
    allSales.sort((a, b) => new Date(ensureDateString(b.saleDate, b.createdAt)).getTime() - new Date(ensureDateString(a.saleDate, a.createdAt)).getTime());

    updateMetrics();
    renderSales();
    setupEvents();

    // Check deep linking e.g. sales-history.html?saleId=xyz
    const urlParams = new URLSearchParams(window.location.search);
    const saleIdParam = urlParams.get("saleId");
    if (saleIdParam) {
      const match = allSales.find(s => s.id === saleIdParam || s.saleNumber === saleIdParam);
      if (match) openSaleDetailModal(match);
    }
  } catch (err) {
    console.error("Failed to load sales history:", err);
    Toast.show("Failed to load sales transactions.", "error");
  }
}

function updateMetrics() {
  const filtered = getFilteredSales();

  const totalRevenue = filtered.reduce((sum, s) => sum + (s.grandTotal || 0), 0);
  const totalDiscounts = filtered.reduce((sum, s) => sum + (s.discountTotal || 0), 0);
  
  const cashCollected = filtered
    .filter(s => s.paymentMethod === "Cash")
    .reduce((sum, s) => sum + (s.advanceAmount || s.grandTotal || 0), 0);

  const digitalCollected = filtered
    .filter(s => s.paymentMethod === "UPI" || s.paymentMethod === "Card")
    .reduce((sum, s) => sum + (s.advanceAmount || s.grandTotal || 0), 0);

  const revEl = document.getElementById("stat-sales-revenue");
  if (revEl) revEl.innerText = `RS ${totalRevenue.toFixed(2)}`;

  const countSubEl = document.getElementById("stat-sales-count-sub");
  if (countSubEl) countSubEl.innerText = `${filtered.length} total bill${filtered.length === 1 ? "" : "s"}`;

  const cashEl = document.getElementById("stat-cash-collected");
  if (cashEl) cashEl.innerText = `RS ${cashCollected.toFixed(2)}`;

  const digitalEl = document.getElementById("stat-digital-collected");
  if (digitalEl) digitalEl.innerText = `RS ${digitalCollected.toFixed(2)}`;

  const discEl = document.getElementById("stat-discount-total");
  if (discEl) discEl.innerText = `RS ${totalDiscounts.toFixed(2)}`;
}

function getFilteredSales(): Sale[] {
  const searchQuery = (document.getElementById("filter-search") as HTMLInputElement)?.value.trim().toLowerCase() || "";
  const paymentMethodFilter = (document.getElementById("filter-method") as HTMLSelectElement)?.value || "All";
  const fromDateFilter = (document.getElementById("filter-from-date") as HTMLInputElement)?.value || "";
  const toDateFilter = (document.getElementById("filter-to-date") as HTMLInputElement)?.value || "";

  const todayStr = new Date().toISOString().slice(0, 10);
  
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const monthAgoStr = monthAgo.toISOString().slice(0, 10);

  return allSales.filter(s => {
    const saleDateStr = formatDateStr(s.saleDate || s.createdAt, "");

    // Preset Date Filter
    let matchPreset = true;
    if (activeDateFilter === "today") {
      matchPreset = saleDateStr === todayStr;
    } else if (activeDateFilter === "yesterday") {
      matchPreset = saleDateStr === yesterdayStr;
    } else if (activeDateFilter === "week") {
      matchPreset = saleDateStr >= weekAgoStr;
    } else if (activeDateFilter === "month") {
      matchPreset = saleDateStr >= monthAgoStr;
    }

    // Custom Date Range
    let matchCustomDate = true;
    if (fromDateFilter && saleDateStr < fromDateFilter) matchCustomDate = false;
    if (toDateFilter && saleDateStr > toDateFilter) matchCustomDate = false;

    // Payment Method
    const matchPayment = paymentMethodFilter === "All" || s.paymentMethod === paymentMethodFilter;

    // Search Query (Search Bill #, Customer Name, Mobile, or purchased Item)
    const itemsMatch = ensureArray(s.items).some(i => (i.productName || "").toLowerCase().includes(searchQuery));
    const matchSearch = !searchQuery ||
      (s.saleNumber || "").toLowerCase().includes(searchQuery) ||
      (s.customerName || "").toLowerCase().includes(searchQuery) ||
      (s.customerMobile || "").includes(searchQuery) ||
      itemsMatch;

    return matchPreset && matchCustomDate && matchPayment && matchSearch;
  });
}

function renderSales() {
  const filtered = getFilteredSales();
  const countIndicator = document.getElementById("sales-count-indicator");
  if (countIndicator) {
    countIndicator.innerText = `Showing ${filtered.length} bill${filtered.length === 1 ? "" : "s"} recorded`;
  }

  renderDesktopTable(filtered);
  renderMobileCards(filtered);
  updateMetrics();
}

function renderDesktopTable(sales: Sale[]) {
  const tbody = document.getElementById("tbl-sales-body");
  if (!tbody) return;

  if (sales.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="p-8 text-center text-slate-400">
          <div class="flex flex-col items-center justify-center space-y-2">
            <svg class="w-8 h-8 text-slate-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <p class="font-medium text-xs">No sales transactions match the selected filters.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = sales.map(s => {
    const itemsSummary = ensureArray(s.items).map(i => `${i.productName} (x${i.quantity})`).join(", ") || "General Eyewear";
    const truncItems = itemsSummary.length > 28 ? itemsSummary.slice(0, 26) + ".." : itemsSummary;
    const isPending = s.status !== "Completed" || (s.pendingAmount || 0) > 0;

    return `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="p-3.5">
          <span class="font-extrabold text-blue-600 font-mono text-xs">${s.saleNumber || s.id}</span>
        </td>
        <td class="p-3.5 text-slate-600 whitespace-nowrap">${s.saleDate || formatDateStr(s.createdAt, "—")}</td>
        <td class="p-3.5">
          <span class="font-bold text-slate-900 block">${s.customerName || "Walk-in Customer"}</span>
          <span class="text-[11px] text-slate-500 font-mono">${s.customerMobile || "No mobile"}</span>
        </td>
        <td class="p-3.5">
          <span class="text-slate-800 font-medium" title="${itemsSummary}">${truncItems}</span>
        </td>
        <td class="p-3.5 text-center">
          <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${getPaymentBadgeClass(s.paymentMethod)}">
            ${s.paymentMethod || "Cash"}
          </span>
        </td>
        <td class="p-3.5 text-right font-medium text-slate-600 whitespace-nowrap">RS ${(s.subtotal || 0).toFixed(2)}</td>
        <td class="p-3.5 text-right text-rose-600 font-medium whitespace-nowrap">RS ${(s.discountTotal || 0).toFixed(2)}</td>
        <td class="p-3.5 text-right font-extrabold text-slate-900 whitespace-nowrap">RS ${(s.grandTotal || 0).toFixed(2)}</td>
        <td class="p-3.5 text-center">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${getStatusBadgeClass(s.status)}">
            ${s.status || "Completed"}
          </span>
          ${isPending && (s.pendingAmount || 0) > 0 ? `<span class="block text-[9px] text-rose-600 font-bold mt-0.5">Due: ${(s.pendingAmount || 0).toFixed(0)}</span>` : ""}
        </td>
        <td class="p-3.5 text-right space-x-1 whitespace-nowrap">
          ${isPending ? `
            <button class="btn-confirm-sale px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-[11px] transition-all inline-flex items-center gap-1 shadow-2xs cursor-pointer active:scale-95" data-id="${s.id}" title="Confirm Sale & Settle Balance">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Confirm</span>
            </button>
          ` : ""}
          <button class="btn-whatsapp-sale px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold rounded-lg text-[11px] transition-colors inline-flex items-center gap-1 cursor-pointer active:scale-95 shadow-2xs" data-id="${s.id}" title="Send Bill to Customer on WhatsApp">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span>WhatsApp</span>
          </button>
          <button class="btn-pdf-invoice px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-bold rounded-lg text-[11px] transition-colors inline-flex items-center gap-1 cursor-pointer active:scale-95 shadow-2xs" data-id="${s.id}" title="Download PDF Tax Invoice">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <span>Invoice</span>
          </button>
          <button class="btn-pdf-rx px-2.5 py-1 ${s.prescriptionId ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border-indigo-200' : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'} border font-bold rounded-lg text-[11px] transition-colors inline-flex items-center gap-1 cursor-pointer active:scale-95 shadow-2xs" data-id="${s.id}" title="Download Prescription PDF">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            <span>Rx</span>
          </button>
          <button class="btn-view-sale px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[11px] transition-colors cursor-pointer active:scale-95" data-id="${s.id}">
            Details
          </button>
        </td>
      </tr>
    `;
  }).join("");

  attachTableEventListeners(tbody);
}

function renderMobileCards(sales: Sale[]) {
  const container = document.getElementById("sales-mobile-container");
  if (!container) return;

  if (sales.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
        <p class="font-medium text-xs">No sales transactions found.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = sales.map(s => {
    const itemsSummary = ensureArray(s.items).map(i => `${i.productName} (x${i.quantity})`).join(", ") || "General Eyewear";
    const isPending = s.status !== "Completed" || (s.pendingAmount || 0) > 0;

    return `
      <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-mono font-bold text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">${s.saleNumber}</span>
            <span class="text-[11px] text-slate-500">${s.saleDate || "—"}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${getPaymentBadgeClass(s.paymentMethod)}">
              ${s.paymentMethod || "Cash"}
            </span>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${getStatusBadgeClass(s.status)}">
              ${s.status || "Completed"}
            </span>
          </div>
        </div>

        <div class="border-y border-slate-100 py-2.5 space-y-1">
          <div class="flex justify-between items-start">
            <span class="font-bold text-sm text-slate-900">${s.customerName || "Walk-in Customer"}</span>
            <span class="font-mono text-xs text-slate-500">${s.customerMobile || ""}</span>
          </div>
          <p class="text-xs text-slate-600">${itemsSummary}</p>
        </div>

        <div class="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl">
          <div>
            <span class="text-[10px] text-slate-500 font-semibold block">Subtotal / Disc</span>
            <span class="text-xs text-slate-600">RS ${(s.subtotal || 0).toFixed(2)} - RS ${(s.discountTotal || 0).toFixed(2)}</span>
          </div>
          <div class="text-right">
            <span class="text-[10px] text-slate-500 font-semibold block">Net Grand Total</span>
            <span class="text-sm font-extrabold text-blue-600">RS ${(s.grandTotal || 0).toFixed(2)}</span>
            ${isPending && (s.pendingAmount || 0) > 0 ? `<span class="block text-[10px] text-rose-600 font-bold">Due: RS ${(s.pendingAmount || 0).toFixed(2)}</span>` : ""}
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          ${isPending ? `
            <button class="btn-confirm-sale col-span-2 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shadow-2xs" data-id="${s.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Confirm Sale</span>
            </button>
          ` : ""}
          <button class="btn-whatsapp-sale py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold rounded-xl text-xs transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shadow-2xs" data-id="${s.id}">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span>WhatsApp</span>
          </button>
          <button class="btn-pdf-invoice py-2 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-bold rounded-xl text-xs transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shadow-2xs" data-id="${s.id}">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <span>PDF Invoice</span>
          </button>
          <button class="btn-pdf-rx py-2 ${s.prescriptionId ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border-indigo-200' : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'} border font-bold rounded-xl text-xs transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shadow-2xs" data-id="${s.id}">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            <span>PDF Rx</span>
          </button>
          <button class="btn-view-sale ${isPending ? 'col-span-2' : 'col-span-2'} py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs transition-colors text-center cursor-pointer active:scale-95" data-id="${s.id}">
            View Details
          </button>
        </div>
      </div>
    `;
  }).join("");

  attachTableEventListeners(container);
}

function attachTableEventListeners(parentEl: HTMLElement) {
  // WhatsApp Share
  parentEl.querySelectorAll(".btn-whatsapp-sale").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      const match = allSales.find(s => s.id === id);
      if (match) {
        let rx: Prescription | null = null;
        if (match.prescriptionId) {
          rx = await dbService.getItem<Prescription>("prescriptions", match.prescriptionId);
        }
        sendSaleWhatsAppPrompt(match, rx, storeSettings);
      }
    });
  });

  // Details Modal
  parentEl.querySelectorAll(".btn-view-sale").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const match = allSales.find(s => s.id === id);
      if (match) openSaleDetailModal(match);
    });
  });

  // Download PDF Invoice
  parentEl.querySelectorAll(".btn-pdf-invoice").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      if (id) await handleDownloadInvoicePDF(id);
    });
  });

  // Download PDF Prescription
  parentEl.querySelectorAll(".btn-pdf-rx").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      if (id) await handleDownloadPrescriptionPDF(id);
    });
  });

  // Quick Confirm Sale
  parentEl.querySelectorAll(".btn-confirm-sale").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      const match = allSales.find(s => s.id === id);
      if (match) openQuickConfirmSale(match);
    });
  });
}

function getPaymentBadgeClass(mode?: string): string {
  switch (mode) {
    case "Cash":
      return "bg-emerald-100 text-emerald-800";
    case "UPI":
      return "bg-teal-100 text-teal-800";
    case "Card":
      return "bg-purple-100 text-purple-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function getStatusBadgeClass(status?: string): string {
  switch (status) {
    case "Completed":
      return "bg-emerald-100 text-emerald-800";
    case "Pending Fulfillment":
      return "bg-amber-100 text-amber-800";
    case "Cancelled":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function setupEvents() {
  // Date Preset Tabs
  const dateTabs = [
    { id: "tab-date-all", key: "all" as const },
    { id: "tab-date-today", key: "today" as const },
    { id: "tab-date-yesterday", key: "yesterday" as const },
    { id: "tab-date-week", key: "week" as const },
    { id: "tab-date-month", key: "month" as const },
  ];

  dateTabs.forEach(t => {
    document.getElementById(t.id)?.addEventListener("click", () => {
      activeDateFilter = t.key;
      // Clear custom date inputs when clicking preset
      (document.getElementById("filter-from-date") as HTMLInputElement).value = "";
      (document.getElementById("filter-to-date") as HTMLInputElement).value = "";

      dateTabs.forEach(item => {
        const btn = document.getElementById(item.id);
        if (item.key === activeDateFilter) {
          btn?.classList.remove("bg-slate-100", "text-slate-700");
          btn?.classList.add("bg-blue-600", "text-white");
        } else {
          btn?.classList.remove("bg-blue-600", "text-white");
          btn?.classList.add("bg-slate-100", "text-slate-700");
        }
      });
      renderSales();
    });
  });

  // Inputs
  document.getElementById("filter-search")?.addEventListener("input", renderSales);
  document.getElementById("filter-method")?.addEventListener("change", renderSales);
  document.getElementById("filter-from-date")?.addEventListener("change", () => {
    activeDateFilter = "all";
    renderSales();
  });
  document.getElementById("filter-to-date")?.addEventListener("change", () => {
    activeDateFilter = "all";
    renderSales();
  });

  // Reset Filters
  document.getElementById("btn-reset-filters")?.addEventListener("click", () => {
    (document.getElementById("filter-search") as HTMLInputElement).value = "";
    (document.getElementById("filter-method") as HTMLSelectElement).value = "All";
    (document.getElementById("filter-from-date") as HTMLInputElement).value = "";
    (document.getElementById("filter-to-date") as HTMLInputElement).value = "";
    activeDateFilter = "all";
    dateTabs.forEach(item => {
      const btn = document.getElementById(item.id);
      if (item.key === "all") {
        btn?.classList.remove("bg-slate-100", "text-slate-700");
        btn?.classList.add("bg-blue-600", "text-white");
      } else {
        btn?.classList.remove("bg-blue-600", "text-white");
        btn?.classList.add("bg-slate-100", "text-slate-700");
      }
    });
    renderSales();
  });

  // Modal controls
  document.getElementById("btn-modal-sale-whatsapp")?.addEventListener("click", async () => {
    if (!selectedSale) return;
    let rx: Prescription | null = null;
    if (selectedSale.prescriptionId) {
      rx = await dbService.getItem<Prescription>("prescriptions", selectedSale.prescriptionId);
    }
    sendSaleWhatsAppPrompt(selectedSale, rx, storeSettings);
  });
  document.getElementById("btn-inv-confirm-whatsapp")?.addEventListener("click", () => {
    if (confirmedSaleForDownload) {
      sendSaleWhatsAppPrompt(confirmedSaleForDownload, confirmedRxForDownload, storeSettings);
    } else if (selectedSale) {
      sendSaleWhatsAppPrompt(selectedSale, null, storeSettings);
    }
  });
  document.getElementById("btn-close-sale-modal")?.addEventListener("click", closeSaleDetailModal);
  document.getElementById("btn-print-thermal-receipt")?.addEventListener("click", printThermalReceipt);

  // Modal Action Buttons
  document.getElementById("btn-modal-confirm-sale")?.addEventListener("click", () => {
    if (selectedSale) {
      const target = selectedSale;
      closeSaleDetailModal();
      openQuickConfirmSale(target);
    }
  });

  document.getElementById("btn-modal-download-invoice-pdf")?.addEventListener("click", async () => {
    if (selectedSale) {
      await handleDownloadInvoicePDF(selectedSale.id);
    }
  });

  document.getElementById("btn-modal-download-rx-pdf")?.addEventListener("click", async () => {
    if (selectedSale) {
      await handleDownloadPrescriptionPDF(selectedSale.id);
    }
  });

  // Quick Confirm Modal Controls
  document.getElementById("btn-close-quick-confirm-sale")?.addEventListener("click", closeQuickConfirmSale);
  document.getElementById("btn-cancel-quick-confirm-sale")?.addEventListener("click", closeQuickConfirmSale);
  document.getElementById("btn-submit-quick-confirm-sale")?.addEventListener("click", submitQuickConfirmSale);

  // Invoice Download Popup controls
  document.getElementById("btn-inv-confirm-download-pdf")?.addEventListener("click", handleConfirmModalDownloadPDF);
  document.getElementById("btn-inv-confirm-print")?.addEventListener("click", handleConfirmModalPrint);
  document.getElementById("btn-inv-confirm-close")?.addEventListener("click", closeInvoiceDownloadConfirmationModal);

  // Export controls
  document.getElementById("btn-export-csv")?.addEventListener("click", () => {
    const filtered = getFilteredSales();
    if (filtered.length === 0) {
      Toast.show("No sales records to export.", "info");
      return;
    }
    downloadSalesListCSV(filtered, "OPTIWAY_Sales_History");
    Toast.show(`Exported ${filtered.length} sales records to CSV.`, "success");
  });

  document.getElementById("btn-export-pdf")?.addEventListener("click", async () => {
    const filtered = getFilteredSales();
    if (filtered.length === 0) {
      Toast.show("No sales records to export.", "info");
      return;
    }
    await downloadSalesHistoryListPDF(filtered, storeSettings, "OPTIWAY SALES HISTORY MASTER LOG");
    Toast.show(`Generated PDF report with ${filtered.length} bills.`, "success");
  });
}

async function openSaleDetailModal(sale: Sale) {
  selectedSale = sale;
  const modal = document.getElementById("modal-sale-detail")!;
  document.getElementById("modal-sale-title")!.innerText = `Invoice: ${sale.saleNumber || sale.id}`;
  document.getElementById("modal-sale-sub")!.innerText = `Customer: ${sale.customerName} (${sale.customerMobile || "No mobile"})`;

  const modalBody = document.getElementById("modal-sale-body")!;

  let rxHtml = "";
  let attachedRx: Prescription | null = null;

  if (sale.prescriptionId) {
    attachedRx = await dbService.getItem<Prescription>("prescriptions", sale.prescriptionId);
  } else if (sale.customerId) {
    // Attempt lookup by customer
    const rxList = await dbService.getList<Prescription>("prescriptions");
    attachedRx = rxList.find(r => r.customerId === sale.customerId) || null;
  }

  if (attachedRx) {
    rxHtml = `
      <div class="border border-blue-200 bg-blue-50/50 rounded-xl p-3 space-y-2">
        <div class="flex justify-between items-center text-blue-900 font-bold text-xs border-b border-blue-100 pb-1.5">
          <span class="inline-flex items-center gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            Prescription Refractive Record
          </span>
          <div class="flex items-center gap-2">
            <span>PD: ${attachedRx.pd ? attachedRx.pd + "mm" : "N/A"}</span>
            <button id="btn-modal-rx-inline-download" class="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[10px] font-bold inline-flex items-center gap-1 transition-colors cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>
              <span>Download PDF Rx</span>
            </button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2 text-[11px]">
          <div class="bg-white p-2 rounded-lg border border-blue-100">
            <span class="font-bold text-blue-800 block">Right Eye (OD)</span>
            <div class="text-slate-700 mt-1">SPH: <strong>${attachedRx.rightEye?.sph || "0.00"}</strong> | CYL: <strong>${attachedRx.rightEye?.cyl || "0.00"}</strong></div>
            <div class="text-slate-700">AXIS: <strong>${attachedRx.rightEye?.axis || "—"}°</strong> | ADD: <strong>+${attachedRx.rightEye?.add || "0.00"}</strong></div>
          </div>
          <div class="bg-white p-2 rounded-lg border border-blue-100">
            <span class="font-bold text-indigo-800 block">Left Eye (OS)</span>
            <div class="text-slate-700 mt-1">SPH: <strong>${attachedRx.leftEye?.sph || "0.00"}</strong> | CYL: <strong>${attachedRx.leftEye?.cyl || "0.00"}</strong></div>
            <div class="text-slate-700">AXIS: <strong>${attachedRx.leftEye?.axis || "—"}°</strong> | ADD: <strong>+${attachedRx.leftEye?.add || "0.00"}</strong></div>
          </div>
        </div>
      </div>
    `;
  }

  const isPending = sale.status !== "Completed" || (sale.pendingAmount || 0) > 0;

  modalBody.innerHTML = `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
      <div>
        <p class="text-[10px] text-slate-500 font-bold uppercase">Date & Time</p>
        <p class="text-xs font-bold text-slate-900 mt-0.5">${sale.saleDate || formatDateStr(sale.createdAt, "—")}</p>
      </div>
      <div>
        <p class="text-[10px] text-slate-500 font-bold uppercase">Payment Mode</p>
        <p class="text-xs font-extrabold text-teal-700 mt-0.5">${sale.paymentMethod || "Cash"}</p>
      </div>
      <div>
        <p class="text-[10px] text-slate-500 font-bold uppercase">Payment Status</p>
        <p class="text-xs font-bold text-slate-900 mt-0.5">${sale.status || "Completed"}</p>
      </div>
      <div>
        <p class="text-[10px] text-slate-500 font-bold uppercase">Grand Total</p>
        <p class="text-sm font-extrabold text-blue-600 mt-0.5">RS ${(sale.grandTotal || 0).toFixed(2)}</p>
      </div>
    </div>

    ${rxHtml}

    <div class="border border-slate-200 rounded-xl overflow-hidden">
      <div class="bg-slate-100 px-3 py-2 font-bold text-slate-700 uppercase text-[10px]">
        Purchased Line Items
      </div>
      <div class="p-3 space-y-2 divide-y divide-slate-100">
        ${ensureArray(sale.items).map(i => `
          <div class="flex justify-between items-center text-xs pt-1.5 first:pt-0">
            <div>
              <span class="font-bold text-slate-900">${i.productName}</span>
              ${i.lensDetails ? `<span class="text-[11px] text-blue-700 font-medium block">Lens: ${i.lensDetails}</span>` : ""}
              <span class="text-slate-500 text-[11px] block">Qty: ${i.quantity} &times; RS ${(i.price || 0).toFixed(2)} ${i.discount ? `(Disc: RS ${i.discount.toFixed(2)})` : ""}</span>
            </div>
            <span class="font-bold text-slate-900">RS ${(i.total || 0).toFixed(2)}</span>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5 text-xs">
      <div class="flex justify-between text-slate-600">
        <span>Subtotal:</span>
        <span class="font-bold text-slate-800">RS ${(sale.subtotal || 0).toFixed(2)}</span>
      </div>
      <div class="flex justify-between text-slate-600">
        <span>Discount:</span>
        <span class="font-bold text-rose-600">- RS ${(sale.discountTotal || 0).toFixed(2)}</span>
      </div>
      <div class="flex justify-between text-slate-600">
        <span>Tax (GST):</span>
        <span class="font-bold text-slate-800">RS ${(sale.taxTotal || 0).toFixed(2)}</span>
      </div>
      <div class="flex justify-between text-xs font-bold text-slate-700 border-t border-slate-200 pt-1.5">
        <span>Advance Paid:</span>
        <span class="text-emerald-700">RS ${(sale.advanceAmount || (isPending ? 0 : sale.grandTotal) || 0).toFixed(2)}</span>
      </div>
      ${isPending && (sale.pendingAmount || 0) > 0 ? `
        <div class="flex justify-between text-xs font-black text-rose-600">
          <span>Pending Balance Due:</span>
          <span>RS ${(sale.pendingAmount || 0).toFixed(2)}</span>
        </div>
      ` : ""}
      <div class="flex justify-between text-sm font-extrabold text-slate-900 border-t border-slate-200 pt-1.5">
        <span>Total Net Bill:</span>
        <span class="text-blue-600">RS ${(sale.grandTotal || 0).toFixed(2)}</span>
      </div>
    </div>
  `;

  // Attach inline download if present
  document.getElementById("btn-modal-rx-inline-download")?.addEventListener("click", async () => {
    await handleDownloadPrescriptionPDF(sale.id);
  });

  // Modal action buttons visibility & states
  const confirmBtn = document.getElementById("btn-modal-confirm-sale");
  if (confirmBtn) {
    if (isPending) {
      confirmBtn.classList.remove("hidden");
    } else {
      confirmBtn.classList.add("hidden");
    }
  }

  // Set link to full invoice
  const invLink = document.getElementById("link-view-full-invoice") as HTMLAnchorElement;
  if (invLink) {
    invLink.href = `invoice.html?saleId=${sale.id}`;
  }

  modal.classList.remove("hidden");
}

function closeSaleDetailModal() {
  document.getElementById("modal-sale-detail")?.classList.add("hidden");
  selectedSale = null;
}

function printThermalReceipt() {
  if (!selectedSale) return;
  printThermalReceiptDirect(selectedSale, storeSettings);
}

// ----------------------------------------------------
// QUICK CONFIRM & SETTLEMENT MODAL
// ----------------------------------------------------
function openQuickConfirmSale(sale: Sale) {
  quickConfirmSaleTarget = sale;
  const modal = document.getElementById("modal-quick-confirm-sale");
  if (!modal) return;

  const saleIdInput = document.getElementById("quick-confirm-sale-id") as HTMLInputElement;
  const custLabel = document.getElementById("quick-confirm-sale-customer");
  const totalLabel = document.getElementById("quick-confirm-sale-total");
  const advLabel = document.getElementById("quick-confirm-sale-advance");
  const pendLabel = document.getElementById("quick-confirm-sale-pending");
  const noteInput = document.getElementById("quick-confirm-sale-note") as HTMLInputElement;

  const total = sale.grandTotal || 0;
  const advance = sale.advanceAmount || (sale.status === "Completed" ? total : 0);
  const pending = (sale.pendingAmount !== undefined && sale.pendingAmount !== null)
    ? sale.pendingAmount
    : Math.max(0, total - advance);

  if (saleIdInput) saleIdInput.value = sale.id;
  if (custLabel) custLabel.innerText = `${sale.customerName || "Customer"} (${sale.customerMobile || "No mobile"})`;
  if (totalLabel) totalLabel.innerText = `RS ${total.toFixed(2)}`;
  if (advLabel) advLabel.innerText = `RS ${advance.toFixed(2)}`;
  if (pendLabel) pendLabel.innerText = `RS ${pending.toFixed(2)}`;
  if (noteInput) noteInput.value = `Balance settlement of RS ${pending.toFixed(2)} for ${sale.saleNumber || sale.id}`;

  modal.classList.remove("hidden");
}

function closeQuickConfirmSale() {
  const modal = document.getElementById("modal-quick-confirm-sale");
  if (modal) modal.classList.add("hidden");
  quickConfirmSaleTarget = null;
}

async function submitQuickConfirmSale() {
  if (!quickConfirmSaleTarget) {
    Toast.show("No sale selected for confirmation.", "error");
    return;
  }

  const sale = quickConfirmSaleTarget;
  const submitBtn = document.getElementById("btn-submit-quick-confirm-sale") as HTMLButtonElement;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = "Confirming...";
  }

  try {
    const selectedMode = (document.querySelector('input[name="quick-sale-pay-mode"]:checked') as HTMLInputElement)?.value as "Cash" | "UPI" | "Card" || "Cash";
    const note = (document.getElementById("quick-confirm-sale-note") as HTMLInputElement)?.value.trim() || "";

    const prevPending = sale.pendingAmount || Math.max(0, (sale.grandTotal || 0) - (sale.advanceAmount || 0));

    // 1. Update Sale record
    sale.advanceAmount = sale.grandTotal || 0;
    sale.pendingAmount = 0;
    sale.status = "Completed";
    sale.paymentMethod = selectedMode;
    if (note) {
      sale.notes = sale.notes ? `${sale.notes} | ${note}` : note;
    }
    await dbService.saveItem("sales", sale);

    // 2. If Customer exists, balance customer ledger
    if (sale.customerId) {
      const customer = await dbService.getItem<Customer>("customers", sale.customerId);
      if (customer && customer.outstandingBalance) {
        customer.outstandingBalance = Math.max(0, (customer.outstandingBalance || 0) - prevPending);
        await dbService.saveItem("customers", customer);
      }
    }

    // 3. If Order linked, update Order status
    if (sale.orderId) {
      const order = await dbService.getItem<Order>("orders", sale.orderId);
      if (order) {
        order.status = "Completed";
        order.paymentStatus = "Fully-paid";
        order.advancePaid = order.grandTotal;
        order.pendingBalance = 0;
        await dbService.saveItem("orders", order);
      }
    }

    // 4. Create Settlement Receipt
    const receipt: Receipt = {
      id: "REC-" + Date.now().toString().slice(-6),
      receiptNumber: "REC-SL-" + Date.now().toString().slice(-4),
      orderId: sale.orderId,
      saleId: sale.id,
      customerId: sale.customerId || "WALKIN",
      customerName: sale.customerName || "Customer",
      customerMobile: sale.customerMobile || "N/A",
      date: new Date().toISOString(),
      totalAmount: sale.grandTotal || 0,
      advanceAmount: sale.grandTotal || 0,
      pendingAmount: 0,
      paymentMethod: selectedMode,
      itemsSummary: ensureArray(sale.items).map(i => `${i.productName} (x${i.quantity})`).join(", ") || "General Eyewear",
      createdAt: new Date().toISOString()
    };
    await dbService.saveItem("receipts", receipt);

    Toast.show(`Sale ${sale.saleNumber || sale.id} confirmed & fully settled!`, "success");
    closeQuickConfirmSale();

    // Reload list and re-render
    allSales = await dbService.getList<Sale>("sales");
    allSales.sort((a, b) => new Date(ensureDateString(b.saleDate, b.createdAt)).getTime() - new Date(ensureDateString(a.saleDate, a.createdAt)).getTime());
    renderSales();

    // Fetch Rx if available and show Invoice Download confirmation popup
    let rx: Prescription | null = null;
    if (sale.prescriptionId) {
      rx = await dbService.getItem<Prescription>("prescriptions", sale.prescriptionId);
    } else if (sale.customerId && sale.customerId !== "WALKIN" && sale.customerId !== "c_walkin") {
      const rxList = await dbService.getList<Prescription>("prescriptions");
      rx = rxList.find(r => r.customerId === sale.customerId) || null;
    }
    showInvoiceDownloadConfirmationModal(sale, rx);
  } catch (err) {
    console.error("Failed to confirm sale:", err);
    Toast.show("Failed to confirm sale settlement.", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span>Confirm Settlement</span>
      `;
    }
  }
}

function showInvoiceDownloadConfirmationModal(sale: Sale, rx: Prescription | null) {
  confirmedSaleForDownload = sale;
  confirmedRxForDownload = rx;

  const modal = document.getElementById("modal-invoice-download-confirmation");
  if (!modal) return;

  const invNumEl = document.getElementById("inv-confirm-number");
  const ordNumEl = document.getElementById("inv-confirm-order-ref");
  const custNameEl = document.getElementById("inv-confirm-cust-name");
  const custMobileEl = document.getElementById("inv-confirm-cust-mobile");
  const amountEl = document.getElementById("inv-confirm-amount");
  const payModeEl = document.getElementById("inv-confirm-paymode");
  const itemsContainer = document.getElementById("inv-confirm-items-list");
  const rxBadgeEl = document.getElementById("inv-confirm-rx-badge");
  const viewInvoiceLink = document.getElementById("btn-inv-confirm-view-page") as HTMLAnchorElement;
  const downloadBtnText = document.getElementById("btn-inv-confirm-download-text");

  const invNumber = (sale.saleNumber || "OPT-SL-0000").replace("OPT-SL-", "OPT-INV-");
  if (invNumEl) invNumEl.innerText = invNumber;
  if (ordNumEl) ordNumEl.innerText = sale.saleNumber || (sale.orderId ? `Order #${sale.orderId}` : sale.id);
  if (custNameEl) custNameEl.innerText = sale.customerName || "Customer";
  if (custMobileEl) custMobileEl.innerText = sale.customerMobile ? `• ${sale.customerMobile}` : "(No phone)";
  if (amountEl) amountEl.innerText = `RS ${(sale.grandTotal || 0).toFixed(2)}`;
  if (payModeEl) payModeEl.innerText = sale.paymentMethod || "Cash";
  if (downloadBtnText) downloadBtnText.innerText = "Download Invoice PDF";

  if (viewInvoiceLink) {
    viewInvoiceLink.href = `invoice.html?saleId=${sale.id}`;
  }

  if (itemsContainer) {
    const items = ensureArray(sale.items);
    if (items.length > 0) {
      itemsContainer.innerHTML = items.map(item => `
        <div class="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0">
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span class="font-semibold text-slate-800">${item.productName}</span>
            <span class="text-slate-400 font-mono text-[11px]">&times;${item.quantity}</span>
          </div>
          <span class="font-bold text-slate-900">RS ${(item.total || 0).toFixed(2)}</span>
        </div>
      `).join("");
    } else {
      itemsContainer.innerHTML = `<p class="text-slate-400 italic text-xs py-1">Eyewear Order Items</p>`;
    }
  }

  if (rxBadgeEl) {
    if (rx) {
      rxBadgeEl.classList.remove("hidden");
    } else {
      rxBadgeEl.classList.add("hidden");
    }
  }

  modal.classList.remove("hidden");
}

function closeInvoiceDownloadConfirmationModal() {
  document.getElementById("modal-invoice-download-confirmation")?.classList.add("hidden");
  confirmedSaleForDownload = null;
  confirmedRxForDownload = null;
}

async function handleConfirmModalDownloadPDF() {
  if (!confirmedSaleForDownload) {
    Toast.show("No invoice data available to download.", "error");
    return;
  }
  const btn = document.getElementById("btn-inv-confirm-download-pdf") as HTMLButtonElement;
  const btnText = document.getElementById("btn-inv-confirm-download-text");
  
  if (btn) btn.disabled = true;
  if (btnText) btnText.innerText = "Generating PDF...";

  try {
    await downloadInvoicePDF(confirmedSaleForDownload, confirmedRxForDownload, storeSettings);
    Toast.show(`Invoice PDF downloaded for ${confirmedSaleForDownload.saleNumber || confirmedSaleForDownload.id}!`, "success");
    if (btnText) btnText.innerText = "✓ Downloaded Again";
  } catch (err) {
    console.error("Failed to download invoice PDF:", err);
    Toast.show("Failed to generate invoice PDF.", "error");
    if (btnText) btnText.innerText = "Download Invoice PDF";
  } finally {
    if (btn) btn.disabled = false;
  }
}

function handleConfirmModalPrint() {
  if (!confirmedSaleForDownload) return;
  printInvoiceDirect(confirmedSaleForDownload, confirmedRxForDownload, storeSettings);
}

// ----------------------------------------------------
// PDF GENERATION HANDLERS
// ----------------------------------------------------
async function handleDownloadInvoicePDF(saleId: string) {
  try {
    const sale = allSales.find(s => s.id === saleId) || await dbService.getItem<Sale>("sales", saleId);
    if (!sale) {
      Toast.show("Sale record not found.", "error");
      return;
    }

    Toast.show(`Generating Invoice PDF for ${sale.saleNumber || sale.id}...`, "info");

    let rx: Prescription | null = null;
    if (sale.prescriptionId) {
      rx = await dbService.getItem<Prescription>("prescriptions", sale.prescriptionId);
    } else if (sale.customerId) {
      const rxList = await dbService.getList<Prescription>("prescriptions");
      rx = rxList.find(r => r.customerId === sale.customerId) || null;
    }

    await downloadInvoicePDF(sale, rx, storeSettings);
    Toast.show(`Invoice PDF downloaded for ${sale.saleNumber || sale.id}.`, "success");
  } catch (err) {
    console.error("Failed to download invoice PDF:", err);
    Toast.show("Failed to generate invoice PDF.", "error");
  }
}

async function handleDownloadPrescriptionPDF(saleId: string) {
  try {
    const sale = allSales.find(s => s.id === saleId) || await dbService.getItem<Sale>("sales", saleId);
    if (!sale) {
      Toast.show("Sale record not found.", "error");
      return;
    }

    let rx: Prescription | null = null;
    if (sale.prescriptionId) {
      rx = await dbService.getItem<Prescription>("prescriptions", sale.prescriptionId);
    }

    // If not directly linked by prescriptionId, search by customer ID or patient name
    if (!rx && sale.customerId) {
      const rxList = await dbService.getList<Prescription>("prescriptions");
      rx = rxList.find(r => r.customerId === sale.customerId) || null;
    }

    if (!rx && sale.customerName) {
      const rxList = await dbService.getList<Prescription>("prescriptions");
      rx = rxList.find(r => (r.customerName || "").toLowerCase() === (sale.customerName || "").toLowerCase()) || null;
    }

    if (!rx) {
      // Check if custom lens details are on the items
      const lensItem = ensureArray(sale.items).find(i => i.lensDetails || i.prescriptionText);
      if (lensItem) {
        rx = {
          id: "RX-GEN-" + (sale.saleNumber || sale.id),
          customerId: sale.customerId || "CUST-WALKIN",
          customerName: sale.customerName || "Patient",
          prescriptionDate: sale.saleDate || sale.createdAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
          rightEye: { sph: "0.00", cyl: "0.00", axis: "—", add: "0.00" },
          leftEye: { sph: "0.00", cyl: "0.00", axis: "—", add: "0.00" },
          notes: lensItem.lensDetails || lensItem.prescriptionText || "Optical prescription specifications",
          createdAt: sale.createdAt || new Date().toISOString()
        };
      }
    }

    if (!rx) {
      Toast.show(`No prescription record attached to bill ${sale.saleNumber || sale.id}.`, "info");
      return;
    }

    Toast.show(`Generating Optical Prescription PDF for ${sale.customerName}...`, "info");

    let customer: Customer | null = null;
    if (sale.customerId) {
      customer = await dbService.getItem<Customer>("customers", sale.customerId);
    }

    await downloadPrescriptionPDF(rx, customer, storeSettings);
    Toast.show(`Prescription PDF downloaded successfully!`, "success");
  } catch (err) {
    console.error("Failed to download prescription PDF:", err);
    Toast.show("Failed to generate prescription PDF.", "error");
  }
}
