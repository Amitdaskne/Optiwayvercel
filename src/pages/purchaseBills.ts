import { initAuthGuard } from "../lib/auth";
import { renderAppLayout, Toast } from "../components/layout";
import { dbService, PurchaseBill, PurchaseBillItem, Supplier, Product, PendingProduct, StoreSettings, generateUniqueSupplierLedgerId, validateSupplierLedgerId } from "../lib/db";
import { PurchaseBillScanner } from "../lib/purchaseBillScanner";
import { BarcodePrinter } from "../lib/barcodePrinter";
import { jsPDF } from "jspdf";

// State
let allBills: PurchaseBill[] = [];
let registeredSuppliers: Supplier[] = [];
let storeSettings: StoreSettings | null = null;
let selectedBillForDetail: PurchaseBill | null = null;

// Filter State
let currentCategoryFilter: "all" | "Frame" | "Lens" | "Contact Lens" | "Accessories" = "all";
let currentSearchQuery = "";
let currentSupplierFilter = "all";
let currentPaymentFilter = "all";
let currentDestinationFilter = "all";
let currentDatePeriod = "all";
let currentStartDate = "";
let currentEndDate = "";
let currentSortBy = "date-desc";
let currentViewMode: "bills" | "items" = "bills";

initAuthGuard({
  onUserReady: async (user) => {
    renderAppLayout("purchase-bills", "Purchase Bills & Stock Invoices", user);
    await loadAllData();
    setupEventListeners();
  }
});

async function loadAllData() {
  try {
    const [bills, suppliers, settings] = await Promise.all([
      dbService.getList<PurchaseBill>("purchaseBills"),
      dbService.getList<Supplier>("suppliers"),
      dbService.getItem<StoreSettings>("settings", "general")
    ]);

    allBills = bills || [];
    registeredSuppliers = suppliers || [];
    storeSettings = settings;

    // Populate supplier filter dropdown
    populateSupplierDropdown();

    // Refresh KPI metrics & tab badges
    updateKpiMetrics();

    // Render active view (Bills or Line Items)
    renderActiveView();
  } catch (err) {
    console.error("Failed to load purchase bills data:", err);
    Toast.show("Failed to load purchase bills records.", "error");
  }
}

function populateSupplierDropdown() {
  const select = document.getElementById("filter-supplier") as HTMLSelectElement;
  if (!select) return;

  const currentVal = select.value;
  const uniqueSuppliers = Array.from(new Set(allBills.map(b => b.supplierName).filter(Boolean))).sort();

  select.innerHTML = `<option value="all">All Optical Suppliers (${uniqueSuppliers.length})</option>` +
    uniqueSuppliers.map(name => `<option value="${name}" ${name === currentVal ? "selected" : ""}>${name}</option>`).join("");
}

function getFilteredBills(): PurchaseBill[] {
  let filtered = [...allBills];

  // 1. Category Filter (Frame, Lens, Contact Lens, Accessories)
  if (currentCategoryFilter !== "all") {
    filtered = filtered.filter(bill => {
      if (!bill.items || bill.items.length === 0) return false;
      return bill.items.some(item => {
        const cat = (item.category || "").toLowerCase();
        if (currentCategoryFilter === "Frame") return cat.includes("frame") || cat.includes("sunglass");
        if (currentCategoryFilter === "Lens") return cat.includes("lens") && !cat.includes("contact");
        if (currentCategoryFilter === "Contact Lens") return cat.includes("contact");
        if (currentCategoryFilter === "Accessories") return cat.includes("access") || cat.includes("clean") || cat.includes("case") || cat.includes("solution");
        return true;
      });
    });
  }

  // 2. Search Query (Bill #, Supplier Name, Ledger ID, Item Names, SKUs, Brands)
  if (currentSearchQuery.trim()) {
    const q = currentSearchQuery.trim().toLowerCase();
    filtered = filtered.filter(bill => {
      const matchBillNum = (bill.billNumber || "").toLowerCase().includes(q);
      const matchSup = (bill.supplierName || "").toLowerCase().includes(q);
      const matchLedger = (bill.supplierLedgerId || "").toLowerCase().includes(q);
      const matchNotes = (bill.notes || "").toLowerCase().includes(q);
      const matchItems = (bill.items || []).some(item => 
        (item.name || "").toLowerCase().includes(q) ||
        (item.modelNumber || "").toLowerCase().includes(q) ||
        (item.sku || "").toLowerCase().includes(q) ||
        (item.brand || "").toLowerCase().includes(q) ||
        (item.model || "").toLowerCase().includes(q)
      );
      return matchBillNum || matchSup || matchLedger || matchNotes || matchItems;
    });
  }

  // 3. Supplier Filter
  if (currentSupplierFilter !== "all") {
    filtered = filtered.filter(b => b.supplierName === currentSupplierFilter);
  }

  // 4. Payment Status Filter
  if (currentPaymentFilter !== "all") {
    filtered = filtered.filter(b => b.paymentStatus === currentPaymentFilter);
  }

  // 5. Destination Filter
  if (currentDestinationFilter !== "all") {
    filtered = filtered.filter(b => (b.destination || "live") === currentDestinationFilter);
  }

  // 6. Date Range Filter
  if (currentStartDate) {
    filtered = filtered.filter(b => (b.billDate || "").slice(0, 10) >= currentStartDate);
  }
  if (currentEndDate) {
    filtered = filtered.filter(b => (b.billDate || "").slice(0, 10) <= currentEndDate);
  }

  // 7. Sort Options
  filtered.sort((a, b) => {
    if (currentSortBy === "date-desc") {
      return new Date(b.billDate || b.createdAt).getTime() - new Date(a.billDate || a.createdAt).getTime();
    }
    if (currentSortBy === "date-asc") {
      return new Date(a.billDate || a.createdAt).getTime() - new Date(b.billDate || b.createdAt).getTime();
    }
    if (currentSortBy === "amount-desc") {
      return (b.grandTotal || 0) - (a.grandTotal || 0);
    }
    if (currentSortBy === "amount-asc") {
      return (a.grandTotal || 0) - (b.grandTotal || 0);
    }
    if (currentSortBy === "items-desc") {
      const countA = (a.items || []).reduce((acc, i) => acc + (i.quantity || 1), 0);
      const countB = (b.items || []).reduce((acc, i) => acc + (i.quantity || 1), 0);
      return countB - countA;
    }
    return 0;
  });

  return filtered;
}

function updateKpiMetrics() {
  let totalSpend = 0;
  let frameSpend = 0;
  let frameUnits = 0;
  let lensSpend = 0;
  let lensUnits = 0;
  let clSpend = 0;
  let clUnits = 0;
  let unpaidBalance = 0;
  let unpaidCount = 0;

  // Counts for category badges
  let countFrameBills = 0;
  let countLensBills = 0;
  let countClBills = 0;
  let countAccBills = 0;

  allBills.forEach(bill => {
    const bTotal = bill.grandTotal || 0;
    totalSpend += bTotal;

    if (bill.paymentStatus === "Unpaid") {
      unpaidBalance += bTotal;
      unpaidCount++;
    } else if (bill.paymentStatus === "Partial") {
      unpaidBalance += bTotal / 2;
      unpaidCount++;
    }

    let hasFrame = false;
    let hasLens = false;
    let hasCl = false;
    let hasAcc = false;

    (bill.items || []).forEach(item => {
      const cat = (item.category || "").toLowerCase();
      const qty = item.quantity || 1;
      const cost = (item.purchasePrice || 0) * qty;

      if (cat.includes("frame") || cat.includes("sunglass")) {
        hasFrame = true;
        frameSpend += cost;
        frameUnits += qty;
      } else if (cat.includes("contact")) {
        hasCl = true;
        clSpend += cost;
        clUnits += qty;
      } else if (cat.includes("lens")) {
        hasLens = true;
        lensSpend += cost;
        lensUnits += qty;
      } else {
        hasAcc = true;
      }
    });

    if (hasFrame) countFrameBills++;
    if (hasLens) countLensBills++;
    if (hasCl) countClBills++;
    if (hasAcc) countAccBills++;
  });

  // Update KPI Cards
  document.getElementById("stat-total-spend")!.innerText = `RS ${totalSpend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById("stat-total-count")!.innerText = `${allBills.length} Bills processed`;

  document.getElementById("stat-frame-spend")!.innerText = `RS ${frameSpend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById("stat-frame-units")!.innerText = `${frameUnits} Frame units`;

  document.getElementById("stat-lens-spend")!.innerText = `RS ${lensSpend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById("stat-lens-units")!.innerText = `${lensUnits} Lens pairs`;

  document.getElementById("stat-cl-spend")!.innerText = `RS ${clSpend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById("stat-cl-units")!.innerText = `${clUnits} CL packs`;

  document.getElementById("stat-unpaid-balance")!.innerText = `RS ${unpaidBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById("stat-unpaid-count")!.innerText = `${unpaidCount} Pending / Partial`;

  // Update Category Tab Badges
  document.getElementById("tab-badge-all")!.innerText = String(allBills.length);
  document.getElementById("tab-badge-frame")!.innerText = String(countFrameBills);
  document.getElementById("tab-badge-lens")!.innerText = String(countLensBills);
  document.getElementById("tab-badge-cl")!.innerText = String(countClBills);
  document.getElementById("tab-badge-acc")!.innerText = String(countAccBills);
}

function renderActiveView() {
  if (currentViewMode === "bills") {
    document.getElementById("container-bills-view")?.classList.remove("hidden");
    document.getElementById("container-items-view")?.classList.add("hidden");
    renderBillsTable();
  } else {
    document.getElementById("container-bills-view")?.classList.add("hidden");
    document.getElementById("container-items-view")?.classList.remove("hidden");
    renderItemsTable();
  }
}

function renderBillsTable() {
  const tbody = document.getElementById("tbl-bills-body")!;
  const countBadge = document.getElementById("filtered-records-count")!;
  const filtered = getFilteredBills();

  countBadge.innerText = `${filtered.length} of ${allBills.length}`;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="p-12 text-center">
          <div class="max-w-sm mx-auto space-y-3">
            <div class="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto shadow-2xs">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            </div>
            <p class="font-bold text-slate-800 text-sm">No Purchase Bills Found</p>
            <p class="text-xs text-slate-500">No purchase bills match your active category, date, or search criteria. Try clearing filters or scanning a new invoice.</p>
            <button id="btn-empty-scan" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-2xs cursor-pointer">
              Scan Purchase Bill Now
            </button>
          </div>
        </td>
      </tr>
    `;

    tbody.querySelector("#btn-empty-scan")?.addEventListener("click", () => {
      PurchaseBillScanner.openModal({
        defaultDestination: "live",
        onSuccess: async () => { await loadAllData(); }
      });
    });
    return;
  }

  tbody.innerHTML = filtered.map(bill => {
    // Categories summary badges
    const categoriesMap: Record<string, number> = {};
    let totalQty = 0;
    (bill.items || []).forEach(item => {
      const cat = item.category || "Frame";
      const qty = item.quantity || 1;
      categoriesMap[cat] = (categoriesMap[cat] || 0) + qty;
      totalQty += qty;
    });

    const categoryBadgesHtml = Object.entries(categoriesMap).map(([cat, qty]) => {
      let badgeClass = "bg-slate-100 text-slate-700";
      if (cat === "Frame") badgeClass = "bg-blue-50 text-blue-700 border border-blue-200/80";
      else if (cat === "Lens") badgeClass = "bg-purple-50 text-purple-700 border border-purple-200/80";
      else if (cat === "Contact Lens") badgeClass = "bg-emerald-50 text-emerald-700 border border-emerald-200/80";
      else if (cat === "Accessories") badgeClass = "bg-amber-50 text-amber-700 border border-amber-200/80";

      return `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${badgeClass}">${cat}: ${qty}</span>`;
    }).join(" ");

    // Payment Status badge
    let payClass = "bg-emerald-50 text-emerald-700 border border-emerald-200";
    if (bill.paymentStatus === "Unpaid") payClass = "bg-rose-50 text-rose-700 border border-rose-200";
    else if (bill.paymentStatus === "Partial") payClass = "bg-amber-50 text-amber-700 border border-amber-200";

    // Destination badge
    const dest = bill.destination || "live";
    const destClass = dest === "live" 
      ? "bg-blue-50 text-blue-700 border border-blue-200" 
      : "bg-purple-50 text-purple-700 border border-purple-200";

    return `
      <tr class="hover:bg-slate-50/80 transition-colors group">
        <td class="p-3.5">
          <button class="btn-view-bill font-mono font-extrabold text-xs text-blue-600 hover:text-blue-800 hover:underline cursor-pointer flex items-center gap-1" data-id="${bill.id}">
            <span>${bill.billNumber || "—"}</span>
          </button>
          <span class="text-[10px] text-slate-400 block mt-0.5">${bill.fileName || "OCR Scanned"}</span>
        </td>
        <td class="p-3.5">
          <div class="font-bold text-slate-900 text-xs">${bill.supplierName || "—"}</div>
          <span class="inline-block mt-0.5 font-mono text-[10px] font-bold text-blue-700 bg-blue-50/80 px-1.5 py-0.2 rounded border border-blue-200">${bill.supplierLedgerId || "LED-SUP"}</span>
        </td>
        <td class="p-3.5">
          <span class="text-xs font-semibold text-slate-800">${bill.billDate || (bill.createdAt || "").slice(0, 10)}</span>
          <span class="text-[10px] text-slate-400 block">${bill.dueDate ? `Due: ${bill.dueDate}` : bill.paymentMethod || "Bank"}</span>
        </td>
        <td class="p-3.5">
          <div class="flex flex-wrap gap-1 max-w-[200px]">
            ${categoryBadgesHtml || '<span class="text-[10px] text-slate-400">—</span>'}
          </div>
        </td>
        <td class="p-3.5 font-semibold text-slate-800 text-xs">
          ${(bill.items || []).length} lines
          <span class="text-[10px] text-slate-400 font-normal block">(${totalQty} units)</span>
        </td>
        <td class="p-3.5">
          <div class="font-extrabold text-slate-900 text-xs">RS ${(bill.grandTotal || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          ${bill.taxTotal ? `<span class="text-[10px] text-slate-400 block">Incl. RS ${bill.taxTotal.toFixed(2)} Tax</span>` : ""}
        </td>
        <td class="p-3.5">
          <span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold ${payClass}">${bill.paymentStatus || "Paid"}</span>
        </td>
        <td class="p-3.5">
          <span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold ${destClass}">${dest === "live" ? "Live Stock" : "Pending Queue"}</span>
        </td>
        <td class="p-3.5 text-right space-x-1.5 whitespace-nowrap">
          <button class="btn-view-bill px-2.5 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold rounded-lg text-xs transition-colors cursor-pointer" data-id="${bill.id}" title="Inspect Details">
            View
          </button>
          <button class="btn-print-bill-stickers px-2.5 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold rounded-lg text-xs transition-colors cursor-pointer" data-id="${bill.id}" title="Print 79x10mm Barcode Stickers">
            Stickers
          </button>
          <button class="btn-print-bill-receipt px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs transition-colors cursor-pointer" data-id="${bill.id}" title="Print Invoice">
            Invoice
          </button>
        </td>
      </tr>
    `;
  }).join("");

  // Attach Table Button Events
  tbody.querySelectorAll(".btn-view-bill").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const bill = allBills.find(b => b.id === id);
      if (bill) openBillDetailModal(bill);
    });
  });

  tbody.querySelectorAll(".btn-print-bill-stickers").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const bill = allBills.find(b => b.id === id);
      if (bill) printStickersForBill(bill);
    });
  });

  tbody.querySelectorAll(".btn-print-bill-receipt").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const bill = allBills.find(b => b.id === id);
      if (bill) printInvoiceReceipt(bill);
    });
  });
}

function renderItemsTable() {
  const tbody = document.getElementById("tbl-items-body")!;
  const countBadge = document.getElementById("filtered-items-count")!;
  const filteredBills = getFilteredBills();

  // Extract all matching items
  interface FlatItem {
    billId: string;
    billNumber: string;
    supplierName: string;
    billDate: string;
    item: PurchaseBillItem;
  }

  const flatItems: FlatItem[] = [];
  filteredBills.forEach(bill => {
    (bill.items || []).forEach(item => {
      // Check category tab filter at item level
      if (currentCategoryFilter !== "all") {
        const cat = (item.category || "").toLowerCase();
        let matches = false;
        if (currentCategoryFilter === "Frame" && (cat.includes("frame") || cat.includes("sunglass"))) matches = true;
        if (currentCategoryFilter === "Lens" && (cat.includes("lens") && !cat.includes("contact"))) matches = true;
        if (currentCategoryFilter === "Contact Lens" && cat.includes("contact")) matches = true;
        if (currentCategoryFilter === "Accessories" && (cat.includes("access") || cat.includes("clean") || cat.includes("case") || cat.includes("solution"))) matches = true;
        if (!matches) return;
      }
      flatItems.push({
        billId: bill.id,
        billNumber: bill.billNumber,
        supplierName: bill.supplierName,
        billDate: bill.billDate,
        item: item
      });
    });
  });

  countBadge.innerText = `${flatItems.length} Products`;

  if (flatItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="p-8 text-center text-slate-400">No matching optical line items found.</td></tr>`;
    return;
  }

  tbody.innerHTML = flatItems.map((fi, idx) => {
    const it = fi.item;
    const cat = it.category || "Frame";
    let catClass = "bg-slate-100 text-slate-700";
    if (cat === "Frame") catClass = "bg-blue-50 text-blue-700 border border-blue-200/80";
    else if (cat === "Lens") catClass = "bg-purple-50 text-purple-700 border border-purple-200/80";
    else if (cat === "Contact Lens") catClass = "bg-emerald-50 text-emerald-700 border border-emerald-200/80";
    else if (cat === "Accessories") catClass = "bg-amber-50 text-amber-700 border border-amber-200/80";

    const cost = it.purchasePrice || 0;
    const selling = it.sellingPrice || 0;
    const margin = selling > cost && cost > 0 ? (((selling - cost) / selling) * 100).toFixed(0) : "0";

    return `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="p-3.5">
          <span class="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 inline-block">${it.modelNumber || it.sku || "OPT-" + (idx + 100)}</span>
        </td>
        <td class="p-3.5">
          <div class="font-bold text-slate-900 text-xs">${it.name || "—"}</div>
          <span class="text-[11px] text-slate-500 block">${it.model || it.brand || "Standard optical specifications"}</span>
        </td>
        <td class="p-3.5">
          <span class="px-2 py-0.5 rounded-md text-[10px] font-extrabold ${catClass}">${cat}</span>
        </td>
        <td class="p-3.5">
          <span class="font-semibold text-slate-800 text-xs">${it.brand || "—"}</span>
        </td>
        <td class="p-3.5 font-bold text-slate-900 text-xs text-center">
          ${it.quantity || 1}
        </td>
        <td class="p-3.5 font-medium text-slate-700 text-xs">
          RS ${cost.toFixed(2)}
        </td>
        <td class="p-3.5 font-bold text-slate-900 text-xs">
          RS ${selling.toFixed(2)}
        </td>
        <td class="p-3.5">
          <span class="px-2 py-0.5 rounded font-bold text-[11px] ${parseFloat(margin) >= 40 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}">${margin}%</span>
        </td>
        <td class="p-3.5">
          <span class="font-bold text-slate-800 text-xs block">${fi.billNumber}</span>
          <span class="text-[10px] text-slate-500">${fi.supplierName}</span>
        </td>
        <td class="p-3.5 text-right">
          <button class="btn-print-single-item-sticker px-2.5 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold rounded-lg text-xs transition-colors cursor-pointer" data-sku="${it.modelNumber || it.sku || ''}" data-name="${it.name || ''}" data-brand="${it.brand || ''}" data-model="${it.model || ''}" data-price="${selling}" data-qty="${it.quantity || 1}">
            Sticker
          </button>
        </td>
      </tr>
    `;
  }).join("");

  // Single Item Sticker event
  tbody.querySelectorAll(".btn-print-single-item-sticker").forEach(btn => {
    btn.addEventListener("click", () => {
      const modelNum = btn.getAttribute("data-sku") || "OPT-1001";
      const name = btn.getAttribute("data-name") || "Optical Product";
      const brand = btn.getAttribute("data-brand") || "OptiWay";
      const model = btn.getAttribute("data-model") || "";
      const price = parseFloat(btn.getAttribute("data-price") || "0") || 0;
      const qty = parseInt(btn.getAttribute("data-qty") || "1", 10) || 1;

      const dummyProduct: Product = {
        id: modelNum,
        name: name,
        modelNumber: modelNum,
        sku: modelNum,
        category: "Frame",
        brand: brand,
        model: model,
        sellingPrice: price,
        purchasePrice: 0,
        stockQuantity: qty,
        minStockLevel: 2,
        status: "Active",
        createdAt: new Date().toISOString()
      };

      BarcodePrinter.openPrintModal(dummyProduct, storeSettings?.storeName || "OPTIWAY");
    });
  });
}

function openBillDetailModal(bill: PurchaseBill) {
  selectedBillForDetail = bill;
  const modal = document.getElementById("modal-bill-detail")!;

  document.getElementById("modal-detail-bill-num")!.innerText = bill.billNumber || "Purchase Bill";
  
  // Destination badge
  const destBadge = document.getElementById("modal-detail-dest-badge")!;
  destBadge.innerText = (bill.destination || "live") === "live" ? "Live Stock" : "Pending Queue";
  destBadge.className = `px-2 py-0.5 rounded-full text-[10px] font-extrabold ${bill.destination === "pending" ? "bg-purple-100 text-purple-800" : "bg-blue-100 text-blue-800"}`;

  // Payment badge
  const payBadge = document.getElementById("modal-detail-pay-badge")!;
  payBadge.innerText = bill.paymentStatus || "Paid";
  payBadge.className = `px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
    bill.paymentStatus === "Paid" ? "bg-emerald-100 text-emerald-800" :
    bill.paymentStatus === "Unpaid" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"
  }`;

  document.getElementById("modal-detail-supplier-meta")!.innerText = `${bill.supplierName} (${bill.supplierLedgerId || "LED-SUP"}) • Date: ${bill.billDate || bill.createdAt.slice(0, 10)}`;

  // Meta Grid
  document.getElementById("modal-meta-sup-name")!.innerText = bill.supplierName || "—";
  document.getElementById("modal-meta-sup-ledger")!.innerText = `${bill.supplierLedgerId || "LED-SUP"} ${bill.supplierTaxId ? `• ${bill.supplierTaxId}` : ""}`;
  document.getElementById("modal-meta-dates")!.innerText = `Date: ${bill.billDate || "—"}${bill.dueDate ? ` (Due: ${bill.dueDate})` : ""}`;
  document.getElementById("modal-meta-payment-method")!.innerText = bill.paymentMethod || "Bank Transfer";

  // Items table
  const itemsTbody = document.getElementById("modal-detail-items-tbody")!;
  const items = bill.items || [];
  document.getElementById("modal-detail-items-count")!.innerText = `${items.length} items (${items.reduce((s, i) => s + (i.quantity || 1), 0)} total units)`;

  itemsTbody.innerHTML = items.map(item => {
    const cat = item.category || "Frame";
    let catClass = "bg-blue-50 text-blue-700 border-blue-200";
    if (cat === "Lens") catClass = "bg-purple-50 text-purple-700 border-purple-200";
    else if (cat === "Contact Lens") catClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
    else if (cat === "Accessories") catClass = "bg-amber-50 text-amber-700 border-amber-200";

    const qty = item.quantity || 1;
    const cost = item.purchasePrice || 0;
    const lineTotal = cost * qty;

    return `
      <tr class="hover:bg-slate-50">
        <td class="p-2.5">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${catClass}">${cat}</span>
        </td>
        <td class="p-2.5">
          <div class="font-bold text-slate-900 text-xs">${item.name}</div>
          <span class="text-[11px] text-slate-500">${item.brand || ""} ${item.model || ""}</span>
        </td>
        <td class="p-2.5 font-mono text-xs font-bold text-slate-700">${item.modelNumber || item.sku || "—"}</td>
        <td class="p-2.5 text-center font-bold text-slate-900 text-xs">${qty}</td>
        <td class="p-2.5 text-right font-medium text-slate-800 text-xs">RS ${cost.toFixed(2)}</td>
        <td class="p-2.5 text-right font-bold text-slate-900 text-xs">RS ${(item.sellingPrice || 0).toFixed(2)}</td>
        <td class="p-2.5 text-right font-extrabold text-blue-700 text-xs">RS ${lineTotal.toFixed(2)}</td>
      </tr>
    `;
  }).join("");

  // Payment Status select
  const paySelect = document.getElementById("modal-change-payment-status") as HTMLSelectElement;
  paySelect.value = bill.paymentStatus || "Paid";

  // Notes
  const notesP = document.getElementById("modal-detail-notes")!;
  notesP.innerText = bill.notes ? `Remarks: ${bill.notes}` : "";

  // Totals
  document.getElementById("modal-detail-subtotal")!.innerText = `RS ${(bill.subtotal || bill.grandTotal || 0).toFixed(2)}`;
  document.getElementById("modal-detail-tax")!.innerText = `RS ${(bill.taxTotal || 0).toFixed(2)}`;
  document.getElementById("modal-detail-discount")!.innerText = `- RS ${(bill.discountTotal || 0).toFixed(2)}`;
  document.getElementById("modal-detail-grand-total")!.innerText = `RS ${(bill.grandTotal || 0).toFixed(2)}`;

  modal.classList.remove("hidden");
}

function closeBillDetailModal() {
  document.getElementById("modal-bill-detail")?.classList.add("hidden");
  selectedBillForDetail = null;
}

function setupEventListeners() {
  // AI Scan Trigger
  document.getElementById("btn-scan-ai-bill")?.addEventListener("click", () => {
    PurchaseBillScanner.openModal({
      defaultDestination: "live",
      onSuccess: async () => {
        await loadAllData();
      }
    });
  });

  // Manual Bill Trigger
  document.getElementById("btn-open-manual-bill")?.addEventListener("click", openManualBillModal);
  document.getElementById("btn-close-manual-bill")?.addEventListener("click", closeManualBillModal);
  document.getElementById("btn-cancel-manual-bill")?.addEventListener("click", closeManualBillModal);

  // Bill Detail Modal Close
  document.getElementById("btn-close-bill-detail")?.addEventListener("click", closeBillDetailModal);

  // Update Payment Status from Detail Modal
  document.getElementById("btn-modal-update-payment")?.addEventListener("click", async () => {
    if (!selectedBillForDetail) return;
    const newStatus = (document.getElementById("modal-change-payment-status") as HTMLSelectElement).value as "Paid" | "Unpaid" | "Partial";
    
    try {
      selectedBillForDetail.paymentStatus = newStatus;
      await dbService.saveItem("purchaseBills", selectedBillForDetail);
      Toast.show(`Payment status updated to "${newStatus}".`, "success");
      await loadAllData();
      openBillDetailModal(selectedBillForDetail);
    } catch (err) {
      console.error("Failed to update status:", err);
      Toast.show("Failed to update payment status.", "error");
    }
  });

  // Delete Bill from Modal
  document.getElementById("btn-modal-delete-bill")?.addEventListener("click", async () => {
    if (!selectedBillForDetail) return;
    if (!confirm(`Are you sure you want to delete purchase bill ${selectedBillForDetail.billNumber}? This will remove the record.`)) return;

    try {
      await dbService.deleteItem("purchaseBills", selectedBillForDetail.id);
      Toast.show(`Purchase bill ${selectedBillForDetail.billNumber} deleted.`, "success");
      closeBillDetailModal();
      await loadAllData();
    } catch (err) {
      console.error("Failed to delete bill:", err);
      Toast.show("Failed to delete purchase bill.", "error");
    }
  });

  // Print Stickers from Modal
  document.getElementById("btn-modal-print-stickers")?.addEventListener("click", () => {
    if (selectedBillForDetail) {
      printStickersForBill(selectedBillForDetail);
    }
  });

  // Print Invoice from Modal
  document.getElementById("btn-modal-print-invoice")?.addEventListener("click", () => {
    if (selectedBillForDetail) {
      printInvoiceReceipt(selectedBillForDetail);
    }
  });

  // Category Tabs Filter Pills
  document.querySelectorAll(".btn-category-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const cat = btn.getAttribute("data-cat") as any;
      currentCategoryFilter = cat;

      // Update button active styling
      document.querySelectorAll(".btn-category-tab").forEach(b => {
        b.className = "btn-category-tab px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs cursor-pointer flex items-center gap-1.5";
      });
      btn.className = "btn-category-tab px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 bg-blue-600 text-white shadow-2xs cursor-pointer flex items-center gap-1.5";

      renderActiveView();
    });
  });

  // Live Search Input
  const searchInput = document.getElementById("bill-search-input") as HTMLInputElement;
  searchInput?.addEventListener("input", () => {
    currentSearchQuery = searchInput.value;
    renderActiveView();
  });

  // Supplier Filter
  document.getElementById("filter-supplier")?.addEventListener("change", (e) => {
    currentSupplierFilter = (e.target as HTMLSelectElement).value;
    renderActiveView();
  });

  // Payment Filter
  document.getElementById("filter-payment-status")?.addEventListener("change", (e) => {
    currentPaymentFilter = (e.target as HTMLSelectElement).value;
    renderActiveView();
  });

  // Destination Filter
  document.getElementById("filter-destination")?.addEventListener("change", (e) => {
    currentDestinationFilter = (e.target as HTMLSelectElement).value;
    renderActiveView();
  });

  // View Mode Toggles
  const btnViewBills = document.getElementById("view-mode-bills")!;
  const btnViewItems = document.getElementById("view-mode-items")!;

  btnViewBills.addEventListener("click", () => {
    currentViewMode = "bills";
    btnViewBills.className = "px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white text-blue-600 shadow-2xs cursor-pointer flex-1 text-center";
    btnViewItems.className = "px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer flex-1 text-center";
    renderActiveView();
  });

  btnViewItems.addEventListener("click", () => {
    currentViewMode = "items";
    btnViewItems.className = "px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white text-blue-600 shadow-2xs cursor-pointer flex-1 text-center";
    btnViewBills.className = "px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer flex-1 text-center";
    renderActiveView();
  });

  // Date Preset Buttons
  document.querySelectorAll(".btn-date-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      const period = btn.getAttribute("data-period");
      currentDatePeriod = period || "all";

      document.querySelectorAll(".btn-date-preset").forEach(b => {
        b.className = "btn-date-preset px-2.5 py-1 rounded-lg font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer";
      });
      btn.className = "btn-date-preset px-2.5 py-1 rounded-lg font-bold bg-slate-900 text-white cursor-pointer";

      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const startInput = document.getElementById("filter-date-start") as HTMLInputElement;
      const endInput = document.getElementById("filter-date-end") as HTMLInputElement;

      if (period === "today") {
        currentStartDate = todayStr;
        currentEndDate = todayStr;
      } else if (period === "week") {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        currentStartDate = d.toISOString().slice(0, 10);
        currentEndDate = todayStr;
      } else if (period === "month") {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        currentStartDate = d.toISOString().slice(0, 10);
        currentEndDate = todayStr;
      } else {
        currentStartDate = "";
        currentEndDate = "";
      }

      if (startInput) startInput.value = currentStartDate;
      if (endInput) endInput.value = currentEndDate;

      renderActiveView();
    });
  });

  // Date inputs
  document.getElementById("filter-date-start")?.addEventListener("change", (e) => {
    currentStartDate = (e.target as HTMLInputElement).value;
    renderActiveView();
  });
  document.getElementById("filter-date-end")?.addEventListener("change", (e) => {
    currentEndDate = (e.target as HTMLInputElement).value;
    renderActiveView();
  });

  // Sort
  document.getElementById("filter-sort")?.addEventListener("change", (e) => {
    currentSortBy = (e.target as HTMLSelectElement).value;
    renderActiveView();
  });

  // Reset Filters
  document.getElementById("btn-reset-filters")?.addEventListener("click", () => {
    currentCategoryFilter = "all";
    currentSearchQuery = "";
    currentSupplierFilter = "all";
    currentPaymentFilter = "all";
    currentDestinationFilter = "all";
    currentDatePeriod = "all";
    currentStartDate = "";
    currentEndDate = "";
    currentSortBy = "date-desc";

    (document.getElementById("bill-search-input") as HTMLInputElement).value = "";
    (document.getElementById("filter-supplier") as HTMLSelectElement).value = "all";
    (document.getElementById("filter-payment-status") as HTMLSelectElement).value = "all";
    (document.getElementById("filter-destination") as HTMLSelectElement).value = "all";
    (document.getElementById("filter-date-start") as HTMLInputElement).value = "";
    (document.getElementById("filter-date-end") as HTMLInputElement).value = "";
    (document.getElementById("filter-sort") as HTMLSelectElement).value = "date-desc";

    document.querySelectorAll(".btn-category-tab").forEach((b, idx) => {
      b.className = idx === 0 
        ? "btn-category-tab px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 bg-blue-600 text-white shadow-2xs cursor-pointer"
        : "btn-category-tab px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs cursor-pointer flex items-center gap-1.5";
    });

    renderActiveView();
  });

  // Export CSV
  document.getElementById("btn-export-bills-csv")?.addEventListener("click", exportBillsToCSV);
}

// ----------------------------------------------------
// PRINT BARCODE STICKERS (79x10mm) FOR PURCHASE BILL
// ----------------------------------------------------
function printStickersForBill(bill: PurchaseBill) {
  if (!bill.items || bill.items.length === 0) {
    Toast.show("This purchase bill has no line items.", "error");
    return;
  }

  const productsForStickers: Product[] = bill.items.map((item, idx) => ({
    id: item.modelNumber || item.sku || `OPT-${idx + 100}`,
    name: item.name,
    modelNumber: item.modelNumber || item.sku || `OPT-${idx + 100}`,
    sku: item.modelNumber || item.sku || `OPT-${idx + 100}`,
    category: item.category || "Frame",
    brand: item.brand || bill.supplierName || "OptiWay",
    model: item.model || "",
    sellingPrice: item.sellingPrice || 0,
    purchasePrice: item.purchasePrice || 0,
    stockQuantity: item.quantity || 1,
    minStockLevel: item.minStockLevel || 3,
    supplierName: bill.supplierName,
    supplierLedgerId: bill.supplierLedgerId,
    billNumber: bill.billNumber,
    status: "Active",
    createdAt: bill.createdAt || new Date().toISOString()
  }));

  BarcodePrinter.openBulkPrintModal(productsForStickers, storeSettings?.storeName || "OPTIWAY");
}

// ----------------------------------------------------
// PRINT PURCHASE BILL INVOICE RECEIPT
// ----------------------------------------------------
function printInvoiceReceipt(bill: PurchaseBill) {
  const storeName = storeSettings?.storeName || "OPTIWAY Vision Care";
  const storePhone = storeSettings?.phone || "+1 (800) 555-6784";
  const storeEmail = storeSettings?.email || "contact@optiway.com";
  const storeAddress = storeSettings?.address || "742 Vision Avenue, Suite 100, New York, NY 10001";

  const printHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Purchase Invoice - ${bill.billNumber}</title>
      <style>
        body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 20px; color: #1e293b; font-size: 12px; }
        .header { border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; }
        .brand { font-size: 20px; font-weight: bold; color: #0284c7; }
        .subtext { font-size: 11px; color: #64748b; margin-top: 2px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
        .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; }
        .box-title { font-weight: bold; font-size: 11px; color: #475569; text-transform: uppercase; margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
        th { background: #f1f5f9; padding: 8px; text-align: left; font-size: 11px; font-weight: bold; border-bottom: 1px solid #cbd5e1; }
        td { padding: 8px; border-bottom: 1px solid #f1f5f9; font-size: 11px; }
        .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; }
        .badge-frame { background: #dbeafe; color: #1e40af; }
        .badge-lens { background: #f3e8ff; color: #6b21a8; }
        .badge-cl { background: #d1fae5; color: #065f46; }
        .badge-acc { background: #fef3c7; color: #92400e; }
        .totals { margin-left: auto; width: 240px; border-top: 1px solid #e2e8f0; padding-top: 8px; }
        .total-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .grand-total { font-size: 14px; font-weight: bold; color: #0284c7; border-top: 1px solid #cbd5e1; padding-top: 6px; }
        .footer { margin-top: 24px; text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 10px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="brand">${storeName}</div>
          <div class="subtext">${storeAddress}</div>
          <div class="subtext">${storePhone} • ${storeEmail}</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 16px; font-weight: bold; color: #0f172a;">PURCHASE INVOICE</div>
          <div style="font-size: 12px; font-weight: bold; color: #0284c7;"># ${bill.billNumber}</div>
          <div class="subtext">Date: ${bill.billDate || bill.createdAt.slice(0, 10)}</div>
        </div>
      </div>

      <div class="grid">
        <div class="box">
          <div class="box-title">Vendor / Supplier Details</div>
          <div style="font-weight: bold; font-size: 13px;">${bill.supplierName}</div>
          <div>Ledger Code: <b>${bill.supplierLedgerId || "LED-SUP"}</b></div>
          ${bill.supplierTaxId ? `<div>Tax ID: ${bill.supplierTaxId}</div>` : ""}
          ${bill.supplierPhone ? `<div>Phone: ${bill.supplierPhone}</div>` : ""}
        </div>
        <div class="box">
          <div class="box-title">Procurement Information</div>
          <div>Payment Status: <b>${bill.paymentStatus || "Paid"}</b></div>
          <div>Payment Method: <b>${bill.paymentMethod || "Bank Transfer"}</b></div>
          <div>Destination: <b>${bill.destination === "pending" ? "Pending Intake Queue" : "Live Stock Catalog"}</b></div>
          ${bill.dueDate ? `<div>Payment Due: ${bill.dueDate}</div>` : ""}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Item & Specifications</th>
            <th>Model Number</th>
            <th style="text-align:center;">Qty</th>
            <th style="text-align:right;">Unit Cost</th>
            <th style="text-align:right;">Selling MRP</th>
            <th style="text-align:right;">Total Cost</th>
          </tr>
        </thead>
        <tbody>
          ${(bill.items || []).map(item => {
            const cat = item.category || "Frame";
            let badgeStyle = "badge-frame";
            if (cat === "Lens") badgeStyle = "badge-lens";
            else if (cat === "Contact Lens") badgeStyle = "badge-cl";
            else if (cat === "Accessories") badgeStyle = "badge-acc";

            const qty = item.quantity || 1;
            const cost = item.purchasePrice || 0;
            return `
              <tr>
                <td><span class="badge ${badgeStyle}">${cat}</span></td>
                <td><b>${item.name}</b><br><span style="color:#64748b; font-size:10px;">${item.brand || ""} ${item.model || ""}</span></td>
                <td style="font-family:monospace;">${item.modelNumber || item.sku || "—"}</td>
                <td style="text-align:center; font-weight:bold;">${qty}</td>
                <td style="text-align:right;">RS ${cost.toFixed(2)}</td>
                <td style="text-align:right;">RS ${(item.sellingPrice || 0).toFixed(2)}</td>
                <td style="text-align:right; font-weight:bold;">RS ${(cost * qty).toFixed(2)}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>

      <div class="totals">
        <div class="total-row">
          <span>Subtotal:</span>
          <span>RS ${(bill.subtotal || bill.grandTotal || 0).toFixed(2)}</span>
        </div>
        ${bill.taxTotal ? `
          <div class="total-row">
            <span>Tax / GST:</span>
            <span>RS ${bill.taxTotal.toFixed(2)}</span>
          </div>
        ` : ""}
        ${bill.discountTotal ? `
          <div class="total-row" style="color:#059669;">
            <span>Discount:</span>
            <span>- RS ${bill.discountTotal.toFixed(2)}</span>
          </div>
        ` : ""}
        <div class="total-row grand-total">
          <span>Grand Total:</span>
          <span>RS ${(bill.grandTotal || 0).toFixed(2)}</span>
        </div>
      </div>

      <div class="footer">
        Generated automatically by OPTIWAY Optical Store Management System • Received & Verified into Stock
      </div>
    </body>
    </html>
  `;

  const iframe = document.getElementById("print-receipt-iframe") as HTMLIFrameElement;
  if (iframe) {
    iframe.contentWindow?.document.open();
    iframe.contentWindow?.document.write(printHtml);
    iframe.contentWindow?.document.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }, 300);
  }
}

// ----------------------------------------------------
// EXPORT TO CSV
// ----------------------------------------------------
function exportBillsToCSV() {
  const filtered = getFilteredBills();
  if (filtered.length === 0) {
    Toast.show("No bills to export.", "error");
    return;
  }

  const rows = [
    ["Bill Number", "Supplier Name", "Ledger ID", "Bill Date", "Payment Status", "Payment Method", "Items Count", "Subtotal", "Tax Total", "Grand Total", "Destination"]
  ];

  filtered.forEach(b => {
    rows.push([
      `"${b.billNumber || ""}"`,
      `"${b.supplierName || ""}"`,
      `"${b.supplierLedgerId || ""}"`,
      `"${b.billDate || ""}"`,
      `"${b.paymentStatus || "Paid"}"`,
      `"${b.paymentMethod || "Bank Transfer"}"`,
      `"${(b.items || []).length}"`,
      `"${(b.subtotal || 0).toFixed(2)}"`,
      `"${(b.taxTotal || 0).toFixed(2)}"`,
      `"${(b.grandTotal || 0).toFixed(2)}"`,
      `"${b.destination || "live"}"`
    ]);
  });

  const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `optiway_purchase_bills_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  Toast.show(`Exported ${filtered.length} purchase bills to CSV.`, "success");
}

// ----------------------------------------------------
// MANUAL OPTICAL PURCHASE BILL BUILDER
// ----------------------------------------------------
let manualItemCounter = 0;

function openManualBillModal() {
  const modal = document.getElementById("modal-manual-bill")!;
  const form = document.getElementById("form-manual-bill") as HTMLFormElement;
  form.reset();

  // Populate supplier select
  const supSelect = document.getElementById("man-sup-select") as HTMLSelectElement;
  supSelect.innerHTML = `<option value="">-- Select Registered Supplier --</option>` +
    registeredSuppliers.map(s => `<option value="${s.name}" data-ledger="${s.ledgerId || ''}">${s.name} (${s.ledgerId || 'LED'})</option>`).join("");

  supSelect.onchange = () => {
    const opt = supSelect.selectedOptions[0];
    if (opt && opt.value) {
      (document.getElementById("man-sup-name") as HTMLInputElement).value = opt.value;
      (document.getElementById("man-sup-ledger") as HTMLInputElement).value = opt.getAttribute("data-ledger") || "";
    }
  };

  const supNameInput = document.getElementById("man-sup-name") as HTMLInputElement;
  const supLedgerInput = document.getElementById("man-sup-ledger") as HTMLInputElement;

  supNameInput.oninput = () => {
    const entered = supNameInput.value.trim();
    const match = registeredSuppliers.find(s => s.name.toLowerCase() === entered.toLowerCase());
    if (match) {
      supLedgerInput.value = match.ledgerId;
    } else if (entered && (!supLedgerInput.value || supLedgerInput.value.startsWith("LED-"))) {
      supLedgerInput.value = generateUniqueSupplierLedgerId(entered, registeredSuppliers);
    }
  };

  // Defaults
  (document.getElementById("man-bill-number") as HTMLInputElement).value = `BIL-${Date.now().toString().slice(-6)}`;
  (document.getElementById("man-bill-date") as HTMLInputElement).value = new Date().toISOString().slice(0, 10);
  if (!supLedgerInput.value) {
    supLedgerInput.value = generateUniqueSupplierLedgerId("", registeredSuppliers);
  }

  // Clear items container & add 1 default row
  const container = document.getElementById("manual-items-container")!;
  container.innerHTML = "";
  manualItemCounter = 0;

  addManualItemRow("Frame");
  addManualItemRow("Lens");

  calculateManualBillTotals();

  // Attach Add Row button
  document.getElementById("btn-add-item-row")!.onclick = () => addManualItemRow("Frame");

  // Form submit handler
  form.onsubmit = async (e) => {
    e.preventDefault();
    await saveManualPurchaseBill();
  };

  modal.classList.remove("hidden");
}

function closeManualBillModal() {
  document.getElementById("modal-manual-bill")?.classList.add("hidden");
}

function addManualItemRow(defaultCategory: "Frame" | "Lens" | "Contact Lens" | "Accessories" = "Frame") {
  manualItemCounter++;
  const container = document.getElementById("manual-items-container")!;
  const rowId = `man-row-${manualItemCounter}`;

  const row = document.createElement("div");
  row.id = rowId;
  row.className = "p-3.5 bg-white border border-slate-200 rounded-xl space-y-2 shadow-2xs animate-in fade-in duration-100";

  let placeholderName = "Ray-Ban Wayfarer Classic";
  let placeholderModel = "RB2140 Black 50mm";
  if (defaultCategory === "Lens") {
    placeholderName = "Essilor Crizal Sapphire 1.6 Single Vision";
    placeholderModel = "1.60 Index Anti-Reflective Coating";
  } else if (defaultCategory === "Contact Lens") {
    placeholderName = "Acuvue Oasys 1-Day 30PK";
    placeholderModel = "HydraLuxe 8.5 BC Daily";
  }

  row.innerHTML = `
    <div class="flex items-center justify-between border-b border-slate-100 pb-2">
      <div class="flex items-center gap-2">
        <span class="font-bold text-slate-900 text-xs">Item #${manualItemCounter}</span>
        <select class="row-category px-2 py-0.5 text-xs font-bold rounded-md bg-slate-100 text-slate-800 border border-slate-200 outline-none">
          <option value="Frame" ${defaultCategory === "Frame" ? "selected" : ""}>Frame</option>
          <option value="Lens" ${defaultCategory === "Lens" ? "selected" : ""}>Lens</option>
          <option value="Contact Lens" ${defaultCategory === "Contact Lens" ? "selected" : ""}>Contact Lens</option>
          <option value="Accessories" ${defaultCategory === "Accessories" ? "selected" : ""}>Accessories</option>
        </select>
      </div>
      <button type="button" class="btn-remove-row text-rose-500 hover:text-rose-700 font-bold text-xs cursor-pointer">✕ Remove</button>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-4 gap-2.5 pt-1">
      <div class="sm:col-span-2">
        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Product Name *</label>
        <input type="text" class="row-name w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none" required placeholder="${placeholderName}" />
      </div>
      <div>
        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Model Number</label>
        <input type="text" class="row-sku w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none font-mono uppercase font-bold text-blue-700" placeholder="MOD-${Math.floor(1000 + Math.random() * 9000)}" />
      </div>
      <div>
        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Brand</label>
        <input type="text" class="row-brand w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none" placeholder="Ray-Ban / Zeiss / Acuvue" />
      </div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
      <div>
        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Model / Specs</label>
        <input type="text" class="row-model w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none" placeholder="${placeholderModel}" />
      </div>
      <div>
        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Quantity *</label>
        <input type="number" min="1" value="1" class="row-qty w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none font-bold text-slate-800" required />
      </div>
      <div>
        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Unit Purchase Cost (RS) *</label>
        <input type="number" step="0.01" min="0" value="0.00" class="row-cost w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none font-bold text-slate-800" required />
      </div>
      <div>
        <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Selling Price MRP (RS)</label>
        <input type="number" step="0.01" min="0" value="0.00" class="row-selling w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none font-bold text-blue-700" />
      </div>
    </div>
  `;

  container.appendChild(row);

  // Events for dynamic recalculation
  row.querySelector(".btn-remove-row")?.addEventListener("click", () => {
    row.remove();
    calculateManualBillTotals();
  });

  row.querySelectorAll("input").forEach(input => {
    input.addEventListener("input", calculateManualBillTotals);
  });

  // Cost to Selling Price auto-markup helper
  const costInput = row.querySelector(".row-cost") as HTMLInputElement;
  const sellingInput = row.querySelector(".row-selling") as HTMLInputElement;
  costInput.addEventListener("change", () => {
    const cost = parseFloat(costInput.value) || 0;
    if (cost > 0 && (!sellingInput.value || parseFloat(sellingInput.value) === 0)) {
      sellingInput.value = (cost * 1.8).toFixed(2); // standard 80% optical markup
      calculateManualBillTotals();
    }
  });

  calculateManualBillTotals();
}

function calculateManualBillTotals() {
  const rows = document.querySelectorAll("#manual-items-container > div");
  let grandTotal = 0;
  let totalUnits = 0;

  rows.forEach(row => {
    const qty = parseInt((row.querySelector(".row-qty") as HTMLInputElement)?.value || "1", 10) || 1;
    const cost = parseFloat((row.querySelector(".row-cost") as HTMLInputElement)?.value || "0") || 0;
    grandTotal += qty * cost;
    totalUnits += qty;
  });

  document.getElementById("man-calc-total")!.innerText = `RS ${grandTotal.toFixed(2)}`;
  document.getElementById("man-calc-items-count")!.innerText = `${totalUnits} units (${rows.length} line items)`;
}

async function saveManualPurchaseBill() {
  const supName = (document.getElementById("man-sup-name") as HTMLInputElement).value.trim();
  const supLedger = (document.getElementById("man-sup-ledger") as HTMLInputElement).value.trim() || "LED-SUP-01";
  const billNumber = (document.getElementById("man-bill-number") as HTMLInputElement).value.trim() || `BIL-${Date.now().toString().slice(-6)}`;
  const billDate = (document.getElementById("man-bill-date") as HTMLInputElement).value || new Date().toISOString().slice(0, 10);
  const paymentStatus = (document.getElementById("man-payment-status") as HTMLSelectElement).value as "Paid" | "Unpaid" | "Partial";
  const paymentMethod = (document.getElementById("man-payment-method") as HTMLSelectElement).value || "Bank Transfer";
  const notes = (document.getElementById("man-bill-notes") as HTMLInputElement).value.trim();

  const destRadio = document.querySelector('input[name="man-dest"]:checked') as HTMLInputElement;
  const destination = (destRadio?.value || "live") as "live" | "pending";

  const rowElements = document.querySelectorAll("#manual-items-container > div");
  if (rowElements.length === 0) {
    Toast.show("Please add at least one line item.", "error");
    return;
  }

  const items: PurchaseBillItem[] = [];
  let grandTotal = 0;

  rowElements.forEach((row, idx) => {
    const cat = (row.querySelector(".row-category") as HTMLSelectElement).value as any;
    const name = (row.querySelector(".row-name") as HTMLInputElement).value.trim() || `Optical Item #${idx + 1}`;
    let modelNumber = (row.querySelector(".row-sku") as HTMLInputElement).value.trim();
    if (!modelNumber) modelNumber = `${cat.slice(0, 3).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const brand = (row.querySelector(".row-brand") as HTMLInputElement).value.trim() || "OptiWay";
    const model = (row.querySelector(".row-model") as HTMLInputElement).value.trim() || "";
    const qty = parseInt((row.querySelector(".row-qty") as HTMLInputElement).value || "1", 10) || 1;
    const cost = parseFloat((row.querySelector(".row-cost") as HTMLInputElement).value || "0") || 0;
    const selling = parseFloat((row.querySelector(".row-selling") as HTMLInputElement).value || "0") || (cost * 1.8);

    grandTotal += cost * qty;

    items.push({
      name: name,
      modelNumber: modelNumber,
      sku: modelNumber,
      category: cat,
      brand: brand,
      model: model,
      quantity: qty,
      purchasePrice: cost,
      sellingPrice: selling,
      minStockLevel: 3
    });
  });

  const saveBtn = document.getElementById("btn-save-manual-bill") as HTMLButtonElement;
  saveBtn.disabled = true;
  saveBtn.innerText = "Saving Bill & Products...";

  try {
    // 1. Commit each item to Live Catalog or Pending Queue
    for (const item of items) {
      if (destination === "live") {
        const liveProducts = await dbService.getList<Product>("products");
        const existing = liveProducts.find(p => 
          (p.modelNumber && p.modelNumber.trim().toLowerCase() === (item.modelNumber || item.sku)?.trim().toLowerCase()) ||
          (p.sku && p.sku.trim().toLowerCase() === (item.modelNumber || item.sku)?.trim().toLowerCase())
        );

        if (existing) {
          const prevStock = existing.stockQuantity || 0;
          await dbService.saveItem("products", {
            ...existing,
            modelNumber: item.modelNumber || existing.modelNumber || item.sku,
            sku: item.modelNumber || existing.sku || item.sku,
            stockQuantity: prevStock + item.quantity,
            purchasePrice: item.purchasePrice || existing.purchasePrice,
            sellingPrice: item.sellingPrice || existing.sellingPrice,
            supplierName: supName,
            supplierLedgerId: supLedger,
            billNumber: billNumber
          });
        } else {
          await dbService.saveItem("products", {
            name: item.name,
            modelNumber: item.modelNumber || item.sku,
            sku: item.modelNumber || item.sku,
            category: item.category || "Frame",
            brand: item.brand || "OptiWay",
            model: item.model || "",
            sellingPrice: item.sellingPrice || 0,
            purchasePrice: item.purchasePrice || 0,
            stockQuantity: item.quantity || 1,
            minStockLevel: 3,
            supplierName: supName,
            supplierLedgerId: supLedger,
            billNumber: billNumber,
            status: "Active",
            createdAt: new Date().toISOString()
          } as Partial<Product>);
        }
      } else {
        await dbService.saveItem("pendingProducts", {
          name: item.name,
          modelNumber: item.modelNumber || item.sku,
          sku: item.modelNumber || item.sku,
          category: item.category || "Frame",
          brand: item.brand || "OptiWay",
          model: item.model || "",
          sellingPrice: item.sellingPrice || 0,
          purchasePrice: item.purchasePrice || 0,
          stockQuantity: item.quantity || 1,
          minStockLevel: 3,
          supplierName: supName,
          supplierLedgerId: supLedger,
          billNumber: billNumber,
          status: "Pending",
          createdAt: new Date().toISOString(),
          notes: `Manual Purchase Bill #${billNumber}`
        } as Partial<PendingProduct>);
      }
    }

    // 2. Save Purchase Bill
    const purchaseBillPayload: Partial<PurchaseBill> = {
      billNumber: billNumber,
      supplierName: supName,
      supplierLedgerId: supLedger,
      billDate: billDate,
      paymentStatus: paymentStatus,
      paymentMethod: paymentMethod,
      subtotal: grandTotal,
      taxTotal: 0,
      discountTotal: 0,
      grandTotal: grandTotal,
      items: items,
      destination: destination,
      notes: notes,
      fileName: "manual_entry",
      createdAt: new Date().toISOString()
    };

    await dbService.saveItem("purchaseBills", purchaseBillPayload);

    // 3. Auto-Register or update supplier account
    if (supName) {
      const existingSup = registeredSuppliers.find(
        s => s.name.toLowerCase() === supName.toLowerCase() ||
             (s.ledgerId && s.ledgerId.toUpperCase() === supLedger.toUpperCase())
      );

      if (existingSup) {
        const addBal = paymentStatus === "Unpaid" ? grandTotal : (paymentStatus === "Partial" ? grandTotal / 2 : 0);
        await dbService.saveItem("suppliers", {
          ...existingSup,
          outstandingBalance: (existingSup.outstandingBalance || 0) + addBal
        });
      } else {
        let finalLedger = supLedger.toUpperCase();
        const conflict = registeredSuppliers.find(s => (s.ledgerId || "").toUpperCase() === finalLedger);
        if (!finalLedger || conflict) {
          finalLedger = generateUniqueSupplierLedgerId(supName, registeredSuppliers);
        }
        await dbService.saveItem("suppliers", {
          name: supName,
          ledgerId: finalLedger,
          mobile: "+1 800-000-0000",
          outstandingBalance: paymentStatus === "Unpaid" ? grandTotal : 0,
          productsSupplied: items.map(i => i.brand || i.category).filter(Boolean).join(", "),
          createdAt: new Date().toISOString()
        } as Partial<Supplier>);
      }
    }

    Toast.show(`Success! Purchase Bill #${billNumber} saved (${items.length} items).`, "success");
    closeManualBillModal();
    await loadAllData();
  } catch (err: any) {
    console.error("Save manual bill error:", err);
    Toast.show("Failed to save purchase bill: " + err.message, "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerText = "Confirm & Save Purchase Bill";
  }
}
