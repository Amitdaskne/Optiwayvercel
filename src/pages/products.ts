import { initAuthGuard } from "../lib/auth";
import { renderAppLayout, Toast } from "../components/layout";
import { dbService, Product, PendingProduct, Supplier } from "../lib/db";
import { uploadImageToCloudinary } from "../lib/cloudinary";
import { BarcodePrinter, Sticker79x10Item } from "../lib/barcodePrinter";
import { ExcelProductImporter } from "../lib/excelProductImporter";
import { PurchaseBillScanner } from "../lib/purchaseBillScanner";

let productsList: Product[] = [];
let pendingList: PendingProduct[] = [];
let suppliersList: Supplier[] = [];
let editingProductId: string | null = null;
let activeTab: "live" | "pending" = "live";
let storeName = "OPTIWAY OPTICAL";

const selectedLiveIds = new Set<string>();
const selectedPendingIds = new Set<string>();

initAuthGuard({
  onUserReady: async (user) => {
    renderAppLayout("products", "Product Catalog", user);
    await loadProductsData();
  }
});

async function loadProductsData() {
  try {
    const settings = await dbService.getSettings();
    if (settings && settings.storeName) {
      storeName = settings.storeName;
    }
    
    productsList = await dbService.getList<Product>("products");
    pendingList = await dbService.getList<PendingProduct>("pendingProducts");
    suppliersList = await dbService.getList<Supplier>("suppliers");

    // Clean up selections
    const currentLiveIds = new Set(productsList.map(p => p.id));
    for (const id of selectedLiveIds) {
      if (!currentLiveIds.has(id)) selectedLiveIds.delete(id);
    }

    const currentPendingIds = new Set(pendingList.map(p => p.id));
    for (const id of selectedPendingIds) {
      if (!currentPendingIds.has(id)) selectedPendingIds.delete(id);
    }

    updateTabBadges();
    renderProductsTable();
    renderPendingTable();
    populateBillFilterDropdown();
    setupEvents();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("action") === "add") {
      openAddProductModal();
    } else if (urlParams.get("tab") === "pending") {
      switchTab("pending");
    }
  } catch (err) {
    console.error("Failed to load products data:", err);
    Toast.show("Failed to load product catalog.", "error");
  }
}

function updateTabBadges() {
  const liveCountEl = document.getElementById("badge-live-count");
  const pendingCountEl = document.getElementById("badge-pending-count");
  if (liveCountEl) liveCountEl.innerText = String(productsList.length);
  if (pendingCountEl) pendingCountEl.innerText = String(pendingList.length);
}

function switchTab(tab: "live" | "pending") {
  activeTab = tab;
  const tabLive = document.getElementById("tab-btn-live")!;
  const tabPending = document.getElementById("tab-btn-pending")!;
  const viewLive = document.getElementById("view-live-catalog")!;
  const viewPending = document.getElementById("view-pending-queue")!;

  if (tab === "live") {
    tabLive.classList.add("border-blue-600", "text-blue-600");
    tabLive.classList.remove("border-transparent", "text-slate-500");
    tabPending.classList.remove("border-amber-500", "text-amber-600");
    tabPending.classList.add("border-transparent", "text-slate-500");
    viewLive.classList.remove("hidden");
    viewPending.classList.add("hidden");
    renderProductsTable();
  } else {
    tabPending.classList.add("border-amber-500", "text-amber-600");
    tabPending.classList.remove("border-transparent", "text-slate-500");
    tabLive.classList.remove("border-blue-600", "text-blue-600");
    tabLive.classList.add("border-transparent", "text-slate-500");
    viewPending.classList.remove("hidden");
    viewLive.classList.add("hidden");
    renderPendingTable();
  }
}

// ----------------------------------------------------
// LIVE CATALOG RENDERING & SELECTION
// ----------------------------------------------------
function getFilteredLiveList(): Product[] {
  const query = (document.getElementById("prod-search") as HTMLInputElement)?.value.trim().toLowerCase() || "";
  const categoryFilter = (document.getElementById("prod-cat-filter") as HTMLSelectElement)?.value || "All";

  return productsList.filter(p => {
    const matchSearch = (p.name || "").toLowerCase().includes(query) ||
                        (p.modelNumber || p.sku || "").toLowerCase().includes(query) ||
                        (p.brand || "").toLowerCase().includes(query) ||
                        (p.billNumber || "").toLowerCase().includes(query) ||
                        (p.supplierLedgerId || "").toLowerCase().includes(query);
    const matchCat = categoryFilter === "All" || p.category === categoryFilter;
    return matchSearch && matchCat;
  });
}

function updateLiveSelectionState() {
  const filtered = getFilteredLiveList();
  const countEl = document.getElementById("live-selection-count");
  const stickersLabel = document.getElementById("btn-live-stickers-label");
  const masterChk = document.getElementById("live-chk-master") as HTMLInputElement;

  let selectedInFiltered = 0;
  filtered.forEach(p => {
    if (selectedLiveIds.has(p.id)) selectedInFiltered++;
  });

  if (countEl) {
    countEl.innerText = `${selectedInFiltered} of ${filtered.length} items selected`;
  }
  if (stickersLabel) {
    stickersLabel.innerText = selectedInFiltered > 0 
      ? `Generate 79x10mm Stickers (${selectedInFiltered} selected)` 
      : `Generate 79x10mm Stickers (All ${filtered.length})`;
  }
  if (masterChk) {
    masterChk.checked = filtered.length > 0 && selectedInFiltered === filtered.length;
    masterChk.indeterminate = selectedInFiltered > 0 && selectedInFiltered < filtered.length;
  }
}

function renderProductsTable() {
  const tbody = document.getElementById("tbl-products-body")!;
  const filtered = getFilteredLiveList();

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="p-8 text-center text-slate-400">No products found in live catalog.</td></tr>`;
    updateLiveSelectionState();
    return;
  }

  tbody.innerHTML = filtered.map(p => `
    <tr class="hover:bg-slate-50 transition-colors">
      <td class="p-3.5 text-center">
        <input type="checkbox" class="live-prod-chk rounded border-slate-300 cursor-pointer" data-id="${p.id}" ${selectedLiveIds.has(p.id) ? "checked" : ""} />
      </td>
      <td class="p-3.5">
        ${p.imageUrl 
          ? `<img src="${p.imageUrl}" alt="${p.name || "Product"}" class="w-10 h-10 object-cover rounded-lg border border-slate-200" />`
          : `<div class="w-10 h-10 bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center font-bold text-slate-400 text-xs">${(p.category || "PR").slice(0, 2).toUpperCase()}</div>`
        }
      </td>
      <td class="p-3.5">
        <span class="font-bold text-slate-900 block">${p.name || "Unnamed Product"}</span>
        <div class="flex flex-wrap items-center gap-1.5 mt-0.5">
          <span class="text-[11px] text-slate-500 font-mono">Model: ${p.modelNumber || p.sku || "N/A"}</span>
          ${p.barcode ? `<span class="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200">EAN: ${p.barcode}</span>` : ''}
          ${p.hsnCode ? `<span class="text-[10px] font-mono text-amber-700 bg-amber-50 px-1 py-0.2 rounded border border-amber-200">HSN: ${p.hsnCode}</span>` : ''}
        </div>
      </td>
      <td class="p-3.5 font-medium text-slate-700">${p.category || "General"}</td>
      <td class="p-3.5 text-slate-600">
        <div class="font-medium text-slate-800">${p.brand || "—"} ${p.model ? `(${p.model})` : ""}</div>
        <div class="flex flex-wrap items-center gap-1 mt-0.5">
          ${p.size ? `<span class="px-1.5 py-0.2 bg-sky-50 text-sky-700 border border-sky-200 rounded text-[10px] font-mono">Sz: ${p.size}</span>` : ''}
          ${p.color ? `<span class="px-1.5 py-0.2 bg-purple-50 text-purple-700 border border-purple-200 rounded text-[10px]">Col: ${p.color}</span>` : ''}
        </div>
      </td>
      <td class="p-3.5">
        <span class="font-mono font-bold text-blue-700 block text-[11px]">${p.billNumber || "—"}</span>
        <span class="font-mono text-purple-700 text-[10px]">${p.supplierLedgerId ? `Ledger: ${p.supplierLedgerId}` : ""}</span>
      </td>
      <td class="p-3.5 font-bold text-slate-900">RS ${(p.sellingPrice || 0).toFixed(2)}</td>
      <td class="p-3.5 text-slate-500">RS ${(p.purchasePrice || 0).toFixed(2)}</td>
      <td class="p-3.5">
        <span class="font-bold ${(p.stockQuantity || 0) <= (p.minStockLevel || 0) ? "text-rose-600" : "text-slate-900"}">
          ${p.stockQuantity || 0}
        </span>
        <span class="text-[10px] text-slate-400 block">Min: ${p.minStockLevel || 0}</span>
      </td>
      <td class="p-3.5">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${p.status === "Active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}">
          ${p.status || "Active"}
        </span>
      </td>
      <td class="p-3.5 text-right space-x-1.5 whitespace-nowrap">
        <button class="btn-download-barcode-direct font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded text-xs transition-colors cursor-pointer inline-flex items-center gap-1 shadow-2xs" data-id="${p.id}" title="Direct download single self-selected 79x10mm optical sticker tag">
          <svg class="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          Sticker
        </button>
        <button class="btn-print-barcode font-bold text-slate-700 hover:text-blue-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 px-2 py-1 rounded text-xs transition-colors cursor-pointer" data-id="${p.id}">
          Print
        </button>
        <button class="btn-edit-prod font-bold text-blue-600 hover:underline text-xs cursor-pointer" data-id="${p.id}">Edit</button>
        <button class="btn-del-prod font-bold text-rose-600 hover:underline text-xs cursor-pointer" data-id="${p.id}">Delete</button>
      </td>
    </tr>
  `).join("");

  // Checkbox events
  tbody.querySelectorAll<HTMLInputElement>(".live-prod-chk").forEach(chk => {
    chk.addEventListener("change", () => {
      const id = chk.getAttribute("data-id")!;
      if (chk.checked) {
        selectedLiveIds.add(id);
      } else {
        selectedLiveIds.delete(id);
      }
      updateLiveSelectionState();
    });
  });

  // Direct single item sticker generation
  tbody.querySelectorAll(".btn-download-barcode-direct").forEach(btn => {
    btn.addEventListener("click", async () => {
      const prodId = btn.getAttribute("data-id")!;
      const prod = productsList.find(p => p.id === prodId);
      if (prod) {
        const detailParts = [];
        if (prod.model) detailParts.push(prod.model);
        if (prod.size) detailParts.push(`Sz: ${prod.size}`);
        if (prod.color) detailParts.push(`Col: ${prod.color}`);
        const modelStr = detailParts.join(" ") || prod.model || prod.name || "";
        const barcodeNum = prod.barcode || prod.id || "000000";

        Toast.show(`Downloading 79x10mm optical sticker for ${prod.name}...`, "info");
        await BarcodePrinter.downloadExact79x10mmPdf([{
          brand: prod.brand || prod.category || "OptiWay",
          price: `RS ${prod.sellingPrice || 0}`,
          model: modelStr,
          barcodeCode: barcodeNum,
          type: "CODE128",
          storeName: storeName
        }], `sticker_${barcodeNum}.pdf`);
        Toast.show(`Sticker tag downloaded!`, "success");
      }
    });
  });

  tbody.querySelectorAll(".btn-print-barcode").forEach(btn => {
    btn.addEventListener("click", () => {
      const prodId = btn.getAttribute("data-id")!;
      const prod = productsList.find(p => p.id === prodId);
      if (prod) {
        BarcodePrinter.openPrintModal(prod, storeName);
      }
    });
  });

  tbody.querySelectorAll(".btn-edit-prod").forEach(btn => {
    btn.addEventListener("click", () => openEditProductModal(btn.getAttribute("data-id")!));
  });

  tbody.querySelectorAll(".btn-del-prod").forEach(btn => {
    btn.addEventListener("click", () => deleteProduct(btn.getAttribute("data-id")!));
  });

  updateLiveSelectionState();
}

// ----------------------------------------------------
// PENDING QUEUE RENDERING & SELECTION
// ----------------------------------------------------
function populateBillFilterDropdown() {
  const billFilter = document.getElementById("pending-bill-filter") as HTMLSelectElement;
  if (!billFilter) return;

  const currentVal = billFilter.value;
  const uniqueBills = Array.from(new Set(pendingList.map(p => p.billNumber).filter(Boolean))) as string[];

  billFilter.innerHTML = `
    <option value="All">All Bill Numbers (${pendingList.length} items)</option>
    ${uniqueBills.map(b => `<option value="${b}">Bill: ${b}</option>`).join("")}
  `;

  if (uniqueBills.includes(currentVal)) {
    billFilter.value = currentVal;
  }
}

function getFilteredPendingList(): PendingProduct[] {
  const query = (document.getElementById("pending-search") as HTMLInputElement)?.value.trim().toLowerCase() || "";
  const billFilter = (document.getElementById("pending-bill-filter") as HTMLSelectElement)?.value || "All";

  return pendingList.filter(p => {
    const matchSearch = (p.name || "").toLowerCase().includes(query) ||
                        (p.modelNumber || p.sku || "").toLowerCase().includes(query) ||
                        (p.brand || "").toLowerCase().includes(query) ||
                        (p.billNumber || "").toLowerCase().includes(query) ||
                        (p.supplierLedgerId || "").toLowerCase().includes(query) ||
                        (p.supplierName || "").toLowerCase().includes(query);
    const matchBill = billFilter === "All" || p.billNumber === billFilter;
    return matchSearch && matchBill;
  });
}

function updatePendingSelectionState() {
  const filtered = getFilteredPendingList();
  const countEl = document.getElementById("pending-selection-count");
  const stickersLabel = document.getElementById("btn-pending-stickers-label");
  const confirmLabel = document.getElementById("btn-pending-confirm-label");
  const masterChk = document.getElementById("pending-chk-master") as HTMLInputElement;

  let selectedInFiltered = 0;
  filtered.forEach(p => {
    if (selectedPendingIds.has(p.id)) selectedInFiltered++;
  });

  if (countEl) {
    countEl.innerText = `${selectedInFiltered} of ${filtered.length} items selected`;
  }
  if (stickersLabel) {
    stickersLabel.innerText = selectedInFiltered > 0 
      ? `Generate 79x10mm Stickers (${selectedInFiltered} selected)` 
      : `Generate 79x10mm Stickers (All ${filtered.length})`;
  }
  if (confirmLabel) {
    confirmLabel.innerText = selectedInFiltered > 0
      ? `Confirm Selected (${selectedInFiltered}) to Live Stock`
      : `Confirm All (${filtered.length}) to Live Stock`;
  }
  if (masterChk) {
    masterChk.checked = filtered.length > 0 && selectedInFiltered === filtered.length;
    masterChk.indeterminate = selectedInFiltered > 0 && selectedInFiltered < filtered.length;
  }
}

// ----------------------------------------------------
// NON-BLOCKING CONFIRMATION DIALOG
// ----------------------------------------------------
function showConfirmDialog(options: {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const existing = document.getElementById("custom-confirm-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "custom-confirm-modal";
  modal.className = "fixed inset-0 bg-slate-900/75 backdrop-blur-xs z-50 flex items-center justify-center p-4";
  modal.innerHTML = `
    <div class="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 border border-slate-200 shadow-2xl">
      <div class="flex items-start gap-3.5">
        <div class="w-10 h-10 rounded-xl ${options.isDestructive ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'} flex items-center justify-center shrink-0">
          ${options.isDestructive 
            ? '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>'
            : '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>'
          }
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="font-bold text-slate-900 text-sm leading-snug">${options.title}</h4>
          <p class="text-xs text-slate-600 mt-1 leading-relaxed">${options.message}</p>
        </div>
      </div>
      <div class="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
        <button id="modal-btn-cancel" class="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer min-h-[36px]">
          ${options.cancelText || 'Cancel'}
        </button>
        <button id="modal-btn-confirm" class="px-4 py-2 text-xs font-bold text-white ${options.isDestructive ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'} rounded-lg shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5 min-h-[36px]">
          <span id="modal-btn-confirm-text">${options.confirmText || 'Confirm'}</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const cancelBtn = modal.querySelector("#modal-btn-cancel") as HTMLButtonElement;
  const confirmBtn = modal.querySelector("#modal-btn-confirm") as HTMLButtonElement;
  const confirmTextEl = modal.querySelector("#modal-btn-confirm-text") as HTMLElement;

  const close = () => modal.remove();
  cancelBtn.addEventListener("click", close);

  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    confirmTextEl.innerText = "Processing...";
    try {
      await options.onConfirm();
      close();
    } catch (err: any) {
      Toast.show(err.message || "Action failed", "error");
      confirmBtn.disabled = false;
      confirmTextEl.innerText = options.confirmText || 'Confirm';
    }
  });
}

function renderPendingTable() {
  const tbody = document.getElementById("tbl-pending-body")!;
  const filtered = getFilteredPendingList();

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="p-8 text-center text-slate-400">
          <div class="max-w-xs mx-auto space-y-2">
            <p class="font-bold text-slate-600 text-sm">No Pending Products in Queue</p>
            <p class="text-xs text-slate-400">Import an Excel sheet or add pending intake items to stage and generate stickers before stock confirmation.</p>
          </div>
        </td>
      </tr>
    `;
    updatePendingSelectionState();
    return;
  }

  tbody.innerHTML = filtered.map(p => `
    <tr class="hover:bg-amber-50/40 transition-colors">
      <td class="p-3.5 text-center">
        <input type="checkbox" class="pending-prod-chk rounded border-amber-300 cursor-pointer" data-id="${p.id}" ${selectedPendingIds.has(p.id) ? "checked" : ""} />
      </td>
      <td class="p-3.5">
        <span class="font-mono font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded text-[11px] block w-fit">
          ${p.billNumber || "<span class='text-slate-400 font-normal italic'>Unassigned</span>"}
        </span>
      </td>
      <td class="p-3.5">
        <span class="font-mono font-bold text-purple-700 text-xs block">${p.supplierLedgerId || "—"}</span>
        <span class="text-[11px] text-slate-500">${p.supplierName || "—"}</span>
      </td>
      <td class="p-3.5">
        <span class="font-bold text-slate-900 block">${p.name}</span>
        <div class="flex flex-wrap items-center gap-1.5 mt-0.5">
          <span class="text-[11px] text-slate-500 font-mono">Model: ${p.modelNumber || p.sku || "N/A"}</span>
          ${p.barcode ? `<span class="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200">EAN: ${p.barcode}</span>` : ''}
          ${p.hsnCode ? `<span class="text-[10px] font-mono text-amber-700 bg-amber-50 px-1 py-0.2 rounded border border-amber-200">HSN: ${p.hsnCode}</span>` : ''}
        </div>
      </td>
      <td class="p-3.5 font-medium text-slate-700">${p.category || "General"}</td>
      <td class="p-3.5 text-slate-600">
        <div class="font-medium text-slate-800">${p.brand || "—"} ${p.model ? `(${p.model})` : ""}</div>
        <div class="flex flex-wrap items-center gap-1 mt-0.5">
          ${p.size ? `<span class="px-1.5 py-0.2 bg-sky-50 text-sky-700 border border-sky-200 rounded text-[10px] font-mono">Sz: ${p.size}</span>` : ''}
          ${p.color ? `<span class="px-1.5 py-0.2 bg-purple-50 text-purple-700 border border-purple-200 rounded text-[10px]">Col: ${p.color}</span>` : ''}
        </div>
      </td>
      <td class="p-3.5 text-right font-bold text-slate-900">RS ${(p.sellingPrice || 0).toFixed(2)}</td>
      <td class="p-3.5 text-right text-slate-500">RS ${(p.purchasePrice || 0).toFixed(2)}</td>
      <td class="p-3.5 text-right font-bold text-amber-900">
        <span class="px-2 py-0.5 bg-amber-100 rounded text-xs">${p.stockQuantity || 0}</span>
      </td>
      <td class="p-3.5 text-right space-x-1.5 whitespace-nowrap">
        <button class="btn-print-pending-single px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded font-bold text-xs transition-colors cursor-pointer inline-flex items-center gap-1 shadow-2xs" data-id="${p.id}" title="Direct download single self-selected 79x10mm optical sticker tag">
          <svg class="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          Sticker
        </button>
        <button class="btn-confirm-pending px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold text-xs shadow-2xs transition-colors cursor-pointer" data-id="${p.id}" title="Confirm item into active live stock">
          ✓ Confirm
        </button>
        <button class="btn-del-pending text-rose-600 hover:underline font-bold text-xs cursor-pointer ml-1" data-id="${p.id}">
          ✕ Reject
        </button>
      </td>
    </tr>
  `).join("");

  // Checkbox events
  tbody.querySelectorAll<HTMLInputElement>(".pending-prod-chk").forEach(chk => {
    chk.addEventListener("change", () => {
      const id = chk.getAttribute("data-id")!;
      if (chk.checked) {
        selectedPendingIds.add(id);
      } else {
        selectedPendingIds.delete(id);
      }
      updatePendingSelectionState();
    });
  });

  // Single item pending print sticker (single self selection)
  tbody.querySelectorAll(".btn-print-pending-single").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id")!;
      const pendingItem = pendingList.find(p => p.id === id);
      if (pendingItem) {
        const detailParts = [];
        if (pendingItem.model) detailParts.push(pendingItem.model);
        if (pendingItem.size) detailParts.push(`Sz: ${pendingItem.size}`);
        if (pendingItem.color) detailParts.push(`Col: ${pendingItem.color}`);
        const modelStr = detailParts.join(" ") || pendingItem.model || pendingItem.name || "";
        const barcodeNum = pendingItem.barcode || pendingItem.id || "000000";

        Toast.show(`Generating 79x10mm optical sticker for ${pendingItem.name}...`, "info");
        await BarcodePrinter.downloadExact79x10mmPdf([{
          brand: pendingItem.brand || pendingItem.category || "OptiWay",
          price: `RS ${pendingItem.sellingPrice || 0}`,
          model: modelStr,
          barcodeCode: barcodeNum,
          type: "CODE128",
          storeName: storeName
        }], `sticker_pending_${barcodeNum}.pdf`);
        Toast.show(`Sticker downloaded!`, "success");
      }
    });
  });

  // Single item confirm to stock
  tbody.querySelectorAll(".btn-confirm-pending").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const targetBtn = btn as HTMLButtonElement;
      const id = targetBtn.getAttribute("data-id")!;
      const pendingItem = pendingList.find(p => p.id === id);
      if (!pendingItem) return;

      const originalHtml = targetBtn.innerHTML;
      targetBtn.disabled = true;
      targetBtn.innerHTML = `↻ Confirming...`;

      try {
        await dbService.confirmPendingProduct(id);
        selectedPendingIds.delete(id);
        Toast.show(`Confirmed "${pendingItem.name}" to Live Stock!`, "success");
        await loadProductsData();
      } catch (err: any) {
        console.error("Confirm pending error:", err);
        Toast.show("Confirmation failed: " + err.message, "error");
        targetBtn.disabled = false;
        targetBtn.innerHTML = originalHtml;
      }
    });
  });

  // Single item reject/delete from pending
  tbody.querySelectorAll(".btn-del-pending").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id")!;
      const pendingItem = pendingList.find(p => p.id === id);
      if (!pendingItem) return;

      showConfirmDialog({
        title: `Remove Pending Product?`,
        message: `Are you sure you want to reject and remove "${pendingItem.name}" (Model: ${pendingItem.modelNumber || pendingItem.sku || 'N/A'}) from the pending queue?`,
        confirmText: "Reject & Delete",
        isDestructive: true,
        onConfirm: async () => {
          await dbService.deleteItem("pendingProducts", id);
          selectedPendingIds.delete(id);
          Toast.show(`Removed "${pendingItem.name}" from pending queue.`, "info");
          await loadProductsData();
        }
      });
    });
  });

  updatePendingSelectionState();
}

// ----------------------------------------------------
// BATCH PENDING ACTIONS
// ----------------------------------------------------
async function handleConfirmPendingSelection() {
  const filtered = getFilteredPendingList();
  const selectedItems = filtered.filter(p => selectedPendingIds.has(p.id));
  const targetItems = selectedItems.length > 0 ? selectedItems : filtered;

  if (targetItems.length === 0) {
    Toast.show("No pending products to confirm.", "info");
    return;
  }

  const isSelection = selectedItems.length > 0;
  const count = targetItems.length;

  showConfirmDialog({
    title: isSelection ? `Confirm ${count} Selected Item(s) to Live Stock` : `Confirm All ${count} Pending Item(s) to Live Stock`,
    message: `All ${count} item(s) will be merged into active inventory with updated stock quantities and purchase/selling prices.`,
    confirmText: `Confirm & Move to Live Stock`,
    isDestructive: false,
    onConfirm: async () => {
      const ids = targetItems.map(p => p.id);
      const res = await dbService.confirmAllPendingProducts(ids);
      ids.forEach(id => selectedPendingIds.delete(id));
      
      if (res.errors && res.errors.length > 0) {
        Toast.show(`Confirmed ${res.confirmedCount} item(s). ${res.errors.length} error(s) occurred.`, "info");
      } else {
        Toast.show(`Successfully confirmed ${res.confirmedCount} product(s) into Live Stock!`, "success");
      }
      
      await loadProductsData();
      switchTab("live");
    }
  });
}

async function handlePrintPendingStickersSelection() {
  const filtered = getFilteredPendingList();
  const selectedItems = filtered.filter(p => selectedPendingIds.has(p.id));
  const targetItems = selectedItems.length > 0 ? selectedItems : filtered;

  if (targetItems.length === 0) {
    Toast.show("No pending products available to generate stickers for.", "error");
    return;
  }

  const stickerItems: Sticker79x10Item[] = targetItems.map(p => {
    const detailParts = [];
    if (p.model) detailParts.push(p.model);
    if (p.size) detailParts.push(`Sz: ${p.size}`);
    if (p.color) detailParts.push(`Col: ${p.color}`);
    const modelStr = detailParts.join(" ") || p.model || p.name || "";
    const barcodeNum = p.barcode || p.id || "000000";

    return {
      brand: p.brand || p.category || "OptiWay",
      price: `RS ${p.sellingPrice || 0}`,
      model: modelStr,
      barcodeCode: barcodeNum,
      type: "CODE128",
      storeName: storeName
    };
  });

  Toast.show(`Generating ${stickerItems.length} 79x10mm optical stickers...`, "info");
  const filename = `pending_stickers_${stickerItems.length}_tags.pdf`;
  await BarcodePrinter.downloadExact79x10mmPdf(stickerItems, filename);
  Toast.show(`Downloaded ${stickerItems.length} sticker(s) in PDF!`, "success");
}

async function handleRejectPendingSelection() {
  const filtered = getFilteredPendingList();
  const selectedItems = filtered.filter(p => selectedPendingIds.has(p.id));

  if (selectedItems.length === 0) {
    Toast.show("Please select pending items to reject using the checkboxes.", "info");
    return;
  }

  showConfirmDialog({
    title: `Reject ${selectedItems.length} Selected Pending Product(s)?`,
    message: `Are you sure you want to permanently remove these ${selectedItems.length} item(s) from the pending queue?`,
    confirmText: "Reject Selected",
    isDestructive: true,
    onConfirm: async () => {
      for (const item of selectedItems) {
        await dbService.deleteItem("pendingProducts", item.id);
        selectedPendingIds.delete(item.id);
      }
      Toast.show(`Rejected and removed ${selectedItems.length} pending items.`, "info");
      await loadProductsData();
    }
  });
}

// ----------------------------------------------------
// BATCH LIVE ACTIONS
// ----------------------------------------------------
async function handlePrintLiveStickersSelection() {
  const filtered = getFilteredLiveList();
  const selectedItems = filtered.filter(p => selectedLiveIds.has(p.id));
  const targetItems = selectedItems.length > 0 ? selectedItems : filtered;

  if (targetItems.length === 0) {
    Toast.show("No products found to generate stickers for.", "error");
    return;
  }

  const stickerItems: Sticker79x10Item[] = targetItems.map(p => {
    const detailParts = [];
    if (p.model) detailParts.push(p.model);
    if (p.size) detailParts.push(`Sz: ${p.size}`);
    if (p.color) detailParts.push(`Col: ${p.color}`);
    const modelStr = detailParts.join(" ") || p.model || p.name || "";
    const barcodeNum = p.barcode || p.id || "000000";

    return {
      brand: p.brand || p.category || "OptiWay",
      price: `RS ${p.sellingPrice || 0}`,
      model: modelStr,
      barcodeCode: barcodeNum,
      type: "CODE128",
      storeName: storeName
    };
  });

  Toast.show(`Generating ${stickerItems.length} 79x10mm optical stickers...`, "info");
  const filename = `live_stickers_${stickerItems.length}_tags.pdf`;
  await BarcodePrinter.downloadExact79x10mmPdf(stickerItems, filename);
  Toast.show(`Downloaded ${stickerItems.length} sticker(s) in PDF!`, "success");
}

function handleLiveBulkBarcodeModal() {
  const filtered = getFilteredLiveList();
  const selectedItems = filtered.filter(p => selectedLiveIds.has(p.id));
  const targetItems = selectedItems.length > 0 ? selectedItems : filtered;

  if (targetItems.length === 0) {
    Toast.show("No products selected for barcode tags.", "error");
    return;
  }

  BarcodePrinter.openBulkPrintModal(targetItems, storeName);
}

// ----------------------------------------------------
// EVENT SETUP
// ----------------------------------------------------
function setupEvents() {
  // Tabs
  document.getElementById("tab-btn-live")?.addEventListener("click", () => switchTab("live"));
  document.getElementById("tab-btn-pending")?.addEventListener("click", () => switchTab("pending"));

  // Live Filters & Selection
  document.getElementById("prod-search")?.addEventListener("input", renderProductsTable);
  document.getElementById("prod-cat-filter")?.addEventListener("change", renderProductsTable);
  
  document.getElementById("live-chk-master")?.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    const filtered = getFilteredLiveList();
    filtered.forEach(p => {
      if (checked) selectedLiveIds.add(p.id);
      else selectedLiveIds.delete(p.id);
    });
    renderProductsTable();
  });

  document.getElementById("btn-live-select-all")?.addEventListener("click", () => {
    const filtered = getFilteredLiveList();
    filtered.forEach(p => selectedLiveIds.add(p.id));
    renderProductsTable();
  });

  document.getElementById("btn-live-deselect-all")?.addEventListener("click", () => {
    selectedLiveIds.clear();
    renderProductsTable();
  });

  document.getElementById("btn-live-print-selected-stickers")?.addEventListener("click", handlePrintLiveStickersSelection);
  document.getElementById("btn-live-bulk-barcode")?.addEventListener("click", handleLiveBulkBarcodeModal);

  // Pending Filters & Selection
  document.getElementById("pending-search")?.addEventListener("input", renderPendingTable);
  document.getElementById("pending-bill-filter")?.addEventListener("change", renderPendingTable);

  document.getElementById("pending-chk-master")?.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    const filtered = getFilteredPendingList();
    filtered.forEach(p => {
      if (checked) selectedPendingIds.add(p.id);
      else selectedPendingIds.delete(p.id);
    });
    renderPendingTable();
  });

  document.getElementById("btn-pending-select-all")?.addEventListener("click", () => {
    const filtered = getFilteredPendingList();
    filtered.forEach(p => selectedPendingIds.add(p.id));
    renderPendingTable();
  });

  document.getElementById("btn-pending-deselect-all")?.addEventListener("click", () => {
    selectedPendingIds.clear();
    renderPendingTable();
  });

  document.getElementById("btn-confirm-all-pending")?.addEventListener("click", handleConfirmPendingSelection);
  document.getElementById("btn-print-all-pending-stickers")?.addEventListener("click", handlePrintPendingStickersSelection);
  document.getElementById("btn-pending-batch-reject")?.addEventListener("click", handleRejectPendingSelection);

  // Top Buttons
  document.getElementById("btn-open-add-prod")?.addEventListener("click", openAddProductModal);
  
  // AI Direct Purchase Bill Scanner (PDF/JPG/PNG)
  document.getElementById("btn-scan-purchase-bill")?.addEventListener("click", () => {
    PurchaseBillScanner.openModal({
      defaultDestination: activeTab,
      onSuccess: async (bill) => {
        await loadProductsData();
        if (bill.destination === "pending") {
          switchTab("pending");
        } else {
          switchTab("live");
        }
      }
    });
  });

  // Excel Import & Export
  document.getElementById("btn-open-excel-import")?.addEventListener("click", () => {
    ExcelProductImporter.openImportModal(productsList, async (destination) => {
      await loadProductsData();
      if (destination === "pending") {
        switchTab("pending");
      }
    });
  });

  document.getElementById("btn-export-excel")?.addEventListener("click", () => {
    const filtered = getFilteredLiveList();
    const selectedItems = filtered.filter(p => selectedLiveIds.has(p.id));
    const targetItems = selectedItems.length > 0 ? selectedItems : productsList;
    ExcelProductImporter.exportProductsToExcel(targetItems, `optiway_catalog_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  document.getElementById("btn-open-stk-gen-modal")?.addEventListener("click", () => {
    const filtered = getFilteredLiveList();
    const selectedItems = filtered.filter(p => selectedLiveIds.has(p.id));
    const targetItems = selectedItems.length > 0 ? selectedItems : productsList;
    BarcodePrinter.open79x10mmStickerGeneratorModal(targetItems, storeName);
  });

  document.getElementById("btn-open-bulk-barcodes")?.addEventListener("click", () => {
    BarcodePrinter.openBulkPrintModal(productsList, storeName);
  });
  document.getElementById("btn-close-prod-modal")?.addEventListener("click", closeProductModal);
  document.getElementById("btn-cancel-prod-modal")?.addEventListener("click", closeProductModal);

  // Handle Cloudinary Image Upload
  const fileInput = document.getElementById("p-image-file") as HTMLInputElement;
  const urlInput = document.getElementById("p-image-url") as HTMLInputElement;
  const progressBox = document.getElementById("upload-progress-container")!;
  const progressBar = document.getElementById("upload-progress-bar")!;
  const progressText = document.getElementById("upload-status-text")!;

  fileInput?.addEventListener("change", async () => {
    if (!fileInput.files || fileInput.files.length === 0) return;

    const file = fileInput.files[0];
    progressBox.classList.remove("hidden");
    progressBar.style.width = "0%";
    progressText.innerText = "Uploading to Cloudinary...";

    try {
      const uploadedUrl = await uploadImageToCloudinary(file, (percent) => {
        progressBar.style.width = `${percent}%`;
        progressText.innerText = `Uploading image... ${percent}%`;
      });

      urlInput.value = uploadedUrl;
      progressText.innerText = "Upload complete!";
      Toast.show("Image uploaded to Cloudinary.", "success");
    } catch (err: any) {
      console.error("Cloudinary upload failed:", err);
      progressText.innerText = "Upload failed.";
      Toast.show(err.message || "Failed to upload image.", "error");
    }
  });

  // Save Product Form
  document.getElementById("form-prod")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = (document.getElementById("p-name") as HTMLInputElement).value.trim();
    const modelNumber = (document.getElementById("p-sku") as HTMLInputElement).value.trim();
    const barcode = (document.getElementById("p-barcode") as HTMLInputElement)?.value.trim() || undefined;
    const hsnCode = (document.getElementById("p-hsn") as HTMLInputElement)?.value.trim() || undefined;
    const size = (document.getElementById("p-size") as HTMLInputElement)?.value.trim() || undefined;
    const color = (document.getElementById("p-color") as HTMLInputElement)?.value.trim() || undefined;
    const category = (document.getElementById("p-category") as HTMLSelectElement).value as Product["category"];
    const brand = (document.getElementById("p-brand") as HTMLInputElement).value.trim();
    const model = (document.getElementById("p-model") as HTMLInputElement).value.trim();
    const supplierName = (document.getElementById("p-supplier") as HTMLInputElement).value.trim();
    const billNumber = (document.getElementById("p-bill-number") as HTMLInputElement)?.value.trim() || "";
    const supplierLedgerId = (document.getElementById("p-supplier-ledger") as HTMLInputElement)?.value.trim() || "";
    const sellingPrice = parseFloat((document.getElementById("p-selling") as HTMLInputElement).value) || 0;
    const purchasePrice = parseFloat((document.getElementById("p-purchase") as HTMLInputElement).value) || 0;
    const stockQuantity = parseInt((document.getElementById("p-stock") as HTMLInputElement).value) || 0;
    const minStockLevel = parseInt((document.getElementById("p-minstock") as HTMLInputElement).value) || 5;
    const imageUrl = (document.getElementById("p-image-url") as HTMLInputElement).value.trim();

    const targetDest = (document.querySelector('input[name="prod-add-target"]:checked') as HTMLInputElement)?.value || "live";

    if (!name || !modelNumber) {
      Toast.show("Product name and Model Number are required.", "error");
      return;
    }

    if (targetDest === "pending" && !editingProductId) {
      // Create Pending Product
      const pendingPayload: Partial<PendingProduct> = {
        name,
        modelNumber,
        sku: modelNumber,
        barcode: barcode || `890${Math.floor(100000000 + Math.random() * 900000000)}`,
        hsnCode,
        size,
        color,
        category,
        brand,
        model,
        supplierName,
        supplierLedgerId,
        billNumber,
        sellingPrice,
        purchasePrice,
        stockQuantity,
        minStockLevel,
        imageUrl,
        status: "Pending",
        batchId: `MAN-${Date.now().toString().slice(-6)}`,
        importDate: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      await dbService.saveItem("pendingProducts", pendingPayload);
      Toast.show(`Product "${name}" staged in Pending Queue for barcode printing.`, "success");
      closeProductModal();
      await loadProductsData();
      switchTab("pending");
    } else {
      // Save directly to Live Catalog
      const payload: Partial<Product> = {
        id: editingProductId || undefined,
        name,
        modelNumber,
        sku: modelNumber,
        barcode: barcode || `890${Math.floor(100000000 + Math.random() * 900000000)}`,
        hsnCode,
        size,
        color,
        category,
        brand,
        model,
        supplierName,
        supplierLedgerId,
        billNumber,
        sellingPrice,
        purchasePrice,
        stockQuantity,
        minStockLevel,
        imageUrl,
        status: "Active",
        createdAt: new Date().toISOString()
      };

      await dbService.saveItem("products", payload);
      Toast.show(`Product "${name}" saved to Live Catalog.`, "success");
      closeProductModal();
      await loadProductsData();
      switchTab("live");
    }
  });

  document.getElementById("btn-gen-prod-barcode")?.addEventListener("click", () => {
    const barcodeInput = document.getElementById("p-barcode") as HTMLInputElement;
    if (barcodeInput) {
      barcodeInput.value = `890${Math.floor(100000000 + Math.random() * 900000000)}`;
    }
  });
}

function openAddProductModal() {
  editingProductId = null;
  document.getElementById("modal-prod-title")!.innerText = "Add New Product";
  (document.getElementById("form-prod") as HTMLFormElement).reset();
  
  const destBox = document.getElementById("box-prod-destination");
  if (destBox) destBox.classList.remove("hidden");

  // Auto-generate fresh default barcode
  const barcodeInput = document.getElementById("p-barcode") as HTMLInputElement;
  if (barcodeInput) {
    barcodeInput.value = `890${Math.floor(100000000 + Math.random() * 900000000)}`;
  }

  // Pre-fill today's bill number format if empty
  const billInput = document.getElementById("p-bill-number") as HTMLInputElement;
  if (billInput) {
    billInput.value = `BIL-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-01`;
  }

  document.getElementById("upload-progress-container")?.classList.add("hidden");
  document.getElementById("modal-prod")?.classList.remove("hidden");
}

function openEditProductModal(id: string) {
  const match = productsList.find(p => p.id === id);
  if (!match) return;

  editingProductId = id;
  document.getElementById("modal-prod-title")!.innerText = "Edit Product";
  (document.getElementById("p-name") as HTMLInputElement).value = match.name;
  (document.getElementById("p-sku") as HTMLInputElement).value = match.modelNumber || match.sku || "";
  (document.getElementById("p-barcode") as HTMLInputElement).value = match.barcode || `890${Math.floor(100000000 + Math.random() * 900000000)}`;
  (document.getElementById("p-hsn") as HTMLInputElement).value = match.hsnCode || "";
  (document.getElementById("p-size") as HTMLInputElement).value = match.size || "";
  (document.getElementById("p-color") as HTMLInputElement).value = match.color || "";
  (document.getElementById("p-category") as HTMLSelectElement).value = match.category;
  (document.getElementById("p-brand") as HTMLInputElement).value = match.brand || "";
  (document.getElementById("p-model") as HTMLInputElement).value = match.model || "";
  (document.getElementById("p-supplier") as HTMLInputElement).value = match.supplierName || "";
  (document.getElementById("p-bill-number") as HTMLInputElement).value = match.billNumber || "";
  (document.getElementById("p-supplier-ledger") as HTMLInputElement).value = match.supplierLedgerId || "";
  (document.getElementById("p-selling") as HTMLInputElement).value = String(match.sellingPrice || 0);
  (document.getElementById("p-purchase") as HTMLInputElement).value = String(match.purchasePrice || 0);
  (document.getElementById("p-stock") as HTMLInputElement).value = String(match.stockQuantity || 0);
  (document.getElementById("p-minstock") as HTMLInputElement).value = String(match.minStockLevel || 5);
  (document.getElementById("p-image-url") as HTMLInputElement).value = match.imageUrl || "";

  const destBox = document.getElementById("box-prod-destination");
  if (destBox) destBox.classList.add("hidden");

  document.getElementById("upload-progress-container")?.classList.add("hidden");
  document.getElementById("modal-prod")?.classList.remove("hidden");
}

function closeProductModal() {
  document.getElementById("modal-prod")?.classList.add("hidden");
  editingProductId = null;
}

async function deleteProduct(id: string) {
  const match = productsList.find(p => p.id === id);
  if (!match) return;

  showConfirmDialog({
    title: `Delete Product "${match.name}"?`,
    message: `Are you sure you want to permanently delete this product (Model: ${match.modelNumber || match.sku}) from your live catalog?`,
    confirmText: "Delete Product",
    isDestructive: true,
    onConfirm: async () => {
      await dbService.deleteItem("products", id);
      Toast.show(`Product "${match.name}" removed from catalog.`, "success");
      await loadProductsData();
    }
  });
}
