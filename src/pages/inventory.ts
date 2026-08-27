import { initAuthGuard } from "../lib/auth";
import { renderAppLayout, Toast } from "../components/layout";
import { dbService, Product, InventoryLog, Sale, ensureArray, formatDateStr, ensureDateString, StoreSettings } from "../lib/db";
import { BarcodePrinter } from "../lib/barcodePrinter";
import { ExcelProductImporter } from "../lib/excelProductImporter";
import { PurchaseBillScanner } from "../lib/purchaseBillScanner";
import * as XLSX from "xlsx";

export interface SoldInventoryItem {
  id: string;
  saleId: string;
  billNumber: string;
  invoiceNumber: string;
  orderId?: string;
  saleDate: string;
  createdAt: string;
  customerId: string;
  customerName: string;
  customerMobile: string;
  productId: string;
  productName: string;
  rawCategory: string;
  normalizedCategory: "frame" | "sunglass" | "lens" | "contact" | "accessories" | "other";
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  paymentMethod: string;
  status: string;
  lensDetails?: string;
  eyeSide?: string;
}

let productsList: Product[] = [];
let pendingList: Product[] = [];
let logsList: InventoryLog[] = [];
let salesList: Sale[] = [];
let allSoldItems: SoldInventoryItem[] = [];
let selectedPendingIds: Set<string> = new Set();
let storeSettings: StoreSettings | null = null;
let storeName = "OPTIWAY OPTICAL";

// Active Tab
let activeTab: "instock" | "sold" | "pending" | "audit" = "instock";

// Pending Filter States
let pendingSearchKeyword: string = "";
let pendingBillFilter: string = "All";

// Sold Filter States
let soldCategoryFilter: "all" | "frame" | "sunglass" | "lens" | "contact" | "accessories" = "all";
let soldSearchKeyword: string = "";
let soldPriceMin: number | null = null;
let soldPriceMax: number | null = null;
let soldDateFrom: string = "";
let soldDateTo: string = "";
let soldSortMode: "date-desc" | "date-asc" | "price-desc" | "price-asc" | "qty-desc" = "date-desc";

// In-Stock Search State
let inStockSearchKeyword: string = "";

initAuthGuard({
  onUserReady: async (user) => {
    renderAppLayout("inventory", "Inventory Management", user);
    await loadInventoryData();
  }
});

async function loadInventoryData() {
  try {
    const [products, pending, logs, sales, settings] = await Promise.all([
      dbService.getList<Product>("products"),
      dbService.getList<Product>("pendingProducts"),
      dbService.getList<InventoryLog>("inventoryLogs"),
      dbService.getList<Sale>("sales"),
      dbService.getSettings()
    ]);

    productsList = products;
    pendingList = pending;
    logsList = logs;
    salesList = sales;
    storeSettings = settings;
    if (settings && settings.storeName) {
      storeName = settings.storeName;
    }

    const pendingBadge = document.getElementById("badge-pending-count");
    if (pendingBadge) pendingBadge.innerText = String(pendingList.length);

    buildSoldItemsIndex();
    renderStats();
    renderInventoryTable();
    renderSoldSection();
    renderPendingSection();
    renderLogsTable();
    populateProductSelect();
    setupEvents();

    // Check URL query parameters for default tab (e.g. ?tab=sold or ?tab=pending)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("tab") === "sold" || window.location.hash === "#sold") {
      switchTab("sold");
    } else if (urlParams.get("tab") === "pending" || window.location.hash === "#pending") {
      switchTab("pending");
    }
  } catch (err) {
    console.error("Failed to load inventory:", err);
    Toast.show("Failed to load inventory data.", "error");
  }
}

function normalizeItemCategory(catStr: string = "", prodName: string = ""): "frame" | "sunglass" | "lens" | "contact" | "accessories" | "other" {
  const combined = `${catStr} ${prodName}`.toLowerCase();
  if (combined.includes("sunglass") || combined.includes("sun glass") || combined.includes("shades") || combined.includes("goggles")) {
    return "sunglass";
  }
  if (combined.includes("frame") || combined.includes("optical frame") || combined.includes("spectacle") || combined.includes("eyeglass")) {
    return "frame";
  }
  if (combined.includes("contact") || combined.includes("cl lens") || combined.includes("toric lens") || combined.includes("disposable")) {
    return "contact";
  }
  if (combined.includes("lens") || combined.includes("cr-39") || combined.includes("anti-glare") || combined.includes("blue cut") || combined.includes("progressive") || combined.includes("bifocal") || combined.includes("single vision") || combined.includes("polycarbonate")) {
    return "lens";
  }
  if (combined.includes("solution") || combined.includes("case") || combined.includes("spray") || combined.includes("cleaner") || combined.includes("cloth") || combined.includes("chain") || combined.includes("accessory") || combined.includes("accessories")) {
    return "accessories";
  }
  return "other";
}

function buildSoldItemsIndex() {
  const items: SoldInventoryItem[] = [];

  // Sort sales by newest date
  const sortedSales = [...salesList].sort((a, b) => {
    const dateA = new Date(ensureDateString(a.saleDate, a.createdAt)).getTime();
    const dateB = new Date(ensureDateString(b.saleDate, b.createdAt)).getTime();
    return dateB - dateA;
  });

  sortedSales.forEach(sale => {
    const saleItems = ensureArray(sale.items);
    const saleDateStr = ensureDateString(sale.saleDate, sale.createdAt);
    const billNum = sale.saleNumber || "OPT-SL-0000";
    const invNum = billNum.replace("OPT-SL-", "OPT-INV-");

    saleItems.forEach((item, idx) => {
      // Cross reference with products catalog to get enriched category if needed
      const matchedProd = productsList.find(p => p.id === item.productId || (p.name && p.name.toLowerCase() === item.productName.toLowerCase()));
      const rawCat = item.category || matchedProd?.category || "General Item";
      const normCat = normalizeItemCategory(rawCat, item.productName);

      items.push({
        id: `${sale.id}_${idx}`,
        saleId: sale.id,
        billNumber: billNum,
        invoiceNumber: invNum,
        orderId: sale.orderId,
        saleDate: saleDateStr,
        createdAt: sale.createdAt || saleDateStr,
        customerId: sale.customerId || "c_walkin",
        customerName: sale.customerName || "Walk-in Customer",
        customerMobile: sale.customerMobile || "",
        productId: item.productId || `prod_${idx}`,
        productName: item.productName || "Optical Item",
        rawCategory: rawCat,
        normalizedCategory: normCat,
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.price) || 0,
        discount: Number(item.discount) || 0,
        total: Number(item.total) || ((Number(item.price) || 0) * (Number(item.quantity) || 1)),
        paymentMethod: sale.paymentMethod || "Cash",
        status: sale.status || "Completed",
        lensDetails: item.lensDetails,
        eyeSide: item.eyeSide
      });
    });
  });

  allSoldItems = items;

  // Update badge count
  const badgeEl = document.getElementById("badge-sold-count");
  if (badgeEl) {
    badgeEl.innerText = String(allSoldItems.length);
  }
}

function renderStats() {
  const totalItems = productsList.length;
  const lowItems = productsList.filter(p => p.stockQuantity > 0 && p.stockQuantity <= p.minStockLevel).length;
  const outItems = productsList.filter(p => p.stockQuantity === 0).length;

  document.getElementById("inv-stat-total")!.innerText = String(totalItems);
  document.getElementById("inv-stat-low")!.innerText = String(lowItems);
  document.getElementById("inv-stat-out")!.innerText = String(outItems);
}

function renderInventoryTable() {
  const tbody = document.getElementById("tbl-inventory-body")!;
  
  let list = productsList;
  if (inStockSearchKeyword.trim()) {
    const q = inStockSearchKeyword.toLowerCase().trim();
    list = list.filter(p => 
      p.name.toLowerCase().includes(q) ||
      (p.modelNumber && p.modelNumber.toLowerCase().includes(q)) ||
      (p.sku && p.sku.toLowerCase().includes(q)) ||
      (p.brand && p.brand.toLowerCase().includes(q)) ||
      (p.category && p.category.toLowerCase().includes(q))
    );
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400">No products match your search.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(p => `
    <tr class="hover:bg-slate-50 transition-colors">
      <td class="p-3 font-bold text-slate-900">${p.name}</td>
      <td class="p-3 font-mono text-slate-500 text-[11px]">${p.modelNumber || p.sku || "—"}</td>
      <td class="p-3 text-slate-600">${p.category}</td>
      <td class="p-3 font-bold ${p.stockQuantity <= p.minStockLevel ? "text-rose-600" : "text-slate-900"}">${p.stockQuantity}</td>
      <td class="p-3 text-slate-500">${p.minStockLevel}</td>
      <td class="p-3">
        ${p.stockQuantity === 0 
          ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">Out of Stock</span>`
          : p.stockQuantity <= p.minStockLevel
          ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">Low Stock Alert</span>`
          : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">In Stock</span>`
        }
      </td>
      <td class="p-3 text-right space-x-1.5">
        <button class="btn-inv-download-barcode font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-1 rounded text-xs transition-colors cursor-pointer" data-id="${p.id}" title="Direct download PNG barcode tag">
          Download Barcode
        </button>
        <button class="btn-inv-print-barcode font-bold text-slate-700 hover:text-blue-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 px-2 py-1 rounded text-xs transition-colors cursor-pointer" data-id="${p.id}">
          Print
        </button>
        <button class="btn-quick-adj text-blue-600 hover:underline font-bold text-xs cursor-pointer" data-id="${p.id}">Adjust</button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btn-inv-download-barcode").forEach(btn => {
    btn.addEventListener("click", async () => {
      const pId = btn.getAttribute("data-id")!;
      const prod = productsList.find(p => p.id === pId);
      if (prod) {
        Toast.show(`Downloading 79x10mm sticker for ${prod.name}...`, "info");
        await BarcodePrinter.downloadExact79x10mmPdf([{
          brand: prod.brand || prod.category || "OptiWay",
          price: `RS ${prod.sellingPrice || 0}`,
          model: prod.model || prod.modelNumber || prod.sku || "",
          barcodeCode: prod.barcode || prod.modelNumber || prod.sku || prod.id || "000000",
          type: "CODE128",
          storeName: storeName
        }], `sticker_${prod.modelNumber || prod.sku || "tag"}.pdf`);
        Toast.show(`Sticker tag downloaded directly!`, "success");
      }
    });
  });

  tbody.querySelectorAll(".btn-inv-print-barcode").forEach(btn => {
    btn.addEventListener("click", () => {
      const pId = btn.getAttribute("data-id")!;
      const prod = productsList.find(p => p.id === pId);
      if (prod) {
        BarcodePrinter.openPrintModal(prod, storeName);
      }
    });
  });

  tbody.querySelectorAll(".btn-quick-adj").forEach(btn => {
    btn.addEventListener("click", () => {
      const pId = btn.getAttribute("data-id")!;
      openAdjustmentModal(pId);
    });
  });
}

// ----------------------------------------------------
// SOLD INVENTORY SECTION IMPLEMENTATION
// ----------------------------------------------------

function getFilteredSoldItems(): SoldInventoryItem[] {
  return allSoldItems.filter(item => {
    // 1. Category Filter (frame, sunglass, lens, contact, accessories, all)
    if (soldCategoryFilter !== "all") {
      if (item.normalizedCategory !== soldCategoryFilter) {
        return false;
      }
    }

    // 2. Bill No. / Product Name / Customer Keyword Filter
    if (soldSearchKeyword.trim()) {
      const q = soldSearchKeyword.toLowerCase().trim();
      const matchBill = item.billNumber.toLowerCase().includes(q);
      const matchInv = item.invoiceNumber.toLowerCase().includes(q);
      const matchProd = item.productName.toLowerCase().includes(q);
      const matchCust = item.customerName.toLowerCase().includes(q);
      const matchPhone = item.customerMobile.includes(q);
      const matchOrder = item.orderId ? item.orderId.toLowerCase().includes(q) : false;
      if (!matchBill && !matchInv && !matchProd && !matchCust && !matchPhone && !matchOrder) {
        return false;
      }
    }

    // 3. Price Filter (Price range)
    if (soldPriceMin !== null && item.unitPrice < soldPriceMin) {
      return false;
    }
    if (soldPriceMax !== null && item.unitPrice > soldPriceMax) {
      return false;
    }

    // 4. Custom Date Range Filter
    const itemDate = item.saleDate.slice(0, 10);
    if (soldDateFrom && itemDate < soldDateFrom) {
      return false;
    }
    if (soldDateTo && itemDate > soldDateTo) {
      return false;
    }

    return true;
  }).sort((a, b) => {
    switch (soldSortMode) {
      case "date-desc":
        return new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime();
      case "date-asc":
        return new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime();
      case "price-desc":
        return b.unitPrice - a.unitPrice;
      case "price-asc":
        return a.unitPrice - b.unitPrice;
      case "qty-desc":
        return b.quantity - a.quantity;
      default:
        return new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime();
    }
  });
}

function renderSoldSection() {
  renderSoldCards();
  renderSoldTable();
}

function renderSoldCards() {
  // Aggregate stats across all sold items
  let totalUnits = 0;
  let totalRev = 0;

  let framesUnits = 0;
  let framesRev = 0;

  let sunglassUnits = 0;
  let sunglassRev = 0;

  let lensUnits = 0;
  let lensRev = 0;

  let otherUnits = 0;
  let otherRev = 0;

  allSoldItems.forEach(item => {
    totalUnits += item.quantity;
    totalRev += item.total;

    if (item.normalizedCategory === "frame") {
      framesUnits += item.quantity;
      framesRev += item.total;
    } else if (item.normalizedCategory === "sunglass") {
      sunglassUnits += item.quantity;
      sunglassRev += item.total;
    } else if (item.normalizedCategory === "lens") {
      lensUnits += item.quantity;
      lensRev += item.total;
    } else {
      otherUnits += item.quantity;
      otherRev += item.total;
    }
  });

  const totalUnitsEl = document.getElementById("sold-stat-total-units");
  const totalRevEl = document.getElementById("sold-stat-total-rev");
  const framesUnitsEl = document.getElementById("sold-stat-frames-units");
  const framesRevEl = document.getElementById("sold-stat-frames-rev");
  const sunglassUnitsEl = document.getElementById("sold-stat-sunglasses-units");
  const sunglassRevEl = document.getElementById("sold-stat-sunglasses-rev");
  const lensUnitsEl = document.getElementById("sold-stat-lenses-units");
  const lensRevEl = document.getElementById("sold-stat-lenses-rev");
  const otherUnitsEl = document.getElementById("sold-stat-other-units");
  const otherRevEl = document.getElementById("sold-stat-other-rev");

  if (totalUnitsEl) totalUnitsEl.innerText = `${totalUnits} Units`;
  if (totalRevEl) totalRevEl.innerText = `RS ${totalRev.toFixed(2)}`;

  if (framesUnitsEl) framesUnitsEl.innerText = `${framesUnits} Units`;
  if (framesRevEl) framesRevEl.innerText = `RS ${framesRev.toFixed(2)}`;

  if (sunglassUnitsEl) sunglassUnitsEl.innerText = `${sunglassUnits} Units`;
  if (sunglassRevEl) sunglassRevEl.innerText = `RS ${sunglassRev.toFixed(2)}`;

  if (lensUnitsEl) lensUnitsEl.innerText = `${lensUnits} Units`;
  if (lensRevEl) lensRevEl.innerText = `RS ${lensRev.toFixed(2)}`;

  if (otherUnitsEl) otherUnitsEl.innerText = `${otherUnits} Units`;
  if (otherRevEl) otherRevEl.innerText = `RS ${otherRev.toFixed(2)}`;
}

function getCategoryBadge(cat: SoldInventoryItem["normalizedCategory"], rawCat: string): string {
  switch (cat) {
    case "frame":
      return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800 border border-blue-200">👓 ${rawCat || "Frame"}</span>`;
    case "sunglass":
      return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-100 text-purple-800 border border-purple-200">🕶️ ${rawCat || "Sunglass"}</span>`;
    case "lens":
      return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200">🔍 ${rawCat || "Lens"}</span>`;
    case "contact":
      return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-cyan-100 text-cyan-800 border border-cyan-200">👁️ ${rawCat || "Contact Lens"}</span>`;
    case "accessories":
      return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-200">🧴 ${rawCat || "Accessory"}</span>`;
    default:
      return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-100 text-slate-700 border border-slate-200">${rawCat || "General"}</span>`;
  }
}

function renderSoldTable() {
  const tbody = document.getElementById("tbl-sold-inventory-body");
  const countBadge = document.getElementById("sold-records-count-badge");
  const footQty = document.getElementById("sold-foot-total-qty");
  const footDisc = document.getElementById("sold-foot-total-disc");
  const footGrand = document.getElementById("sold-foot-grand-total");
  const footAvg = document.getElementById("sold-foot-unit-avg");

  if (!tbody) return;

  const filtered = getFilteredSoldItems();

  if (countBadge) {
    countBadge.innerText = `${filtered.length} Items Found`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="p-8 text-center text-slate-400 space-y-2">
          <svg class="w-10 h-10 mx-auto text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <p class="font-bold text-slate-600 text-xs">No sold inventory items match the current filters.</p>
          <p class="text-[11px] text-slate-400">Try adjusting your category, price range, bill number, or date filters.</p>
        </td>
      </tr>
    `;

    if (footQty) footQty.innerText = "0";
    if (footDisc) footDisc.innerText = "RS 0.00";
    if (footGrand) footGrand.innerText = "RS 0.00";
    if (footAvg) footAvg.innerText = "-";
    return;
  }

  let totalQty = 0;
  let totalDiscount = 0;
  let grandTotal = 0;

  tbody.innerHTML = filtered.map(item => {
    totalQty += item.quantity;
    totalDiscount += item.discount;
    grandTotal += item.total;

    const formattedDate = formatDateStr(item.saleDate);

    return `
      <tr class="hover:bg-slate-50 transition-colors">
        <!-- Date -->
        <td class="p-3 text-slate-500 font-mono text-[11px] whitespace-nowrap">
          ${formattedDate}
        </td>

        <!-- Associated Bill No -->
        <td class="p-3 whitespace-nowrap">
          <a href="invoice.html?saleId=${item.saleId}" class="inline-flex items-center gap-1 font-mono font-extrabold text-blue-600 hover:text-blue-800 hover:underline bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-xs" title="Open and view invoice">
            <span>${item.billNumber}</span>
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
          </a>
        </td>

        <!-- Product Name & Details -->
        <td class="p-3">
          <div class="font-bold text-slate-900">${item.productName}</div>
          ${item.lensDetails ? `<div class="text-[11px] text-slate-500 italic mt-0.5">Lens: ${item.lensDetails} ${item.eyeSide ? `(${item.eyeSide})` : ""}</div>` : ""}
        </td>

        <!-- Category -->
        <td class="p-3 whitespace-nowrap">
          ${getCategoryBadge(item.normalizedCategory, item.rawCategory)}
        </td>

        <!-- Customer -->
        <td class="p-3">
          <div class="font-bold text-slate-900 text-xs">${item.customerName}</div>
          ${item.customerMobile ? `<div class="text-[11px] text-slate-500 font-mono">${item.customerMobile}</div>` : `<span class="text-slate-400 text-[10px] italic">Walk-in</span>`}
        </td>

        <!-- Unit Price -->
        <td class="p-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
          RS ${item.unitPrice.toFixed(2)}
        </td>

        <!-- Quantity -->
        <td class="p-3 text-center font-mono font-extrabold text-slate-900 whitespace-nowrap">
          <span class="inline-block px-2 py-0.5 bg-slate-100 rounded text-xs">${item.quantity}</span>
        </td>

        <!-- Discount -->
        <td class="p-3 text-right font-mono text-xs whitespace-nowrap ${item.discount > 0 ? "text-rose-600 font-bold" : "text-slate-400"}">
          ${item.discount > 0 ? `-RS ${item.discount.toFixed(2)}` : "—"}
        </td>

        <!-- Total Price -->
        <td class="p-3 text-right font-mono font-black text-emerald-700 text-xs whitespace-nowrap">
          RS ${item.total.toFixed(2)}
        </td>

        <!-- Status -->
        <td class="p-3 text-center whitespace-nowrap">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
            item.status === "Completed" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
          }">${item.status}</span>
          <span class="block text-[10px] text-slate-400 font-mono mt-0.5">${item.paymentMethod}</span>
        </td>

        <!-- Action -->
        <td class="p-3 text-right whitespace-nowrap">
          <a href="invoice.html?saleId=${item.saleId}" class="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded transition-colors border border-slate-200" title="Open full invoice terminal">
            <svg class="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            <span>Invoice</span>
          </a>
        </td>
      </tr>
    `;
  }).join("");

  // Update table footer summary values
  if (footQty) footQty.innerText = `${totalQty} Units`;
  if (footDisc) footDisc.innerText = `RS ${totalDiscount.toFixed(2)}`;
  if (footGrand) footGrand.innerText = `RS ${grandTotal.toFixed(2)}`;
  if (footAvg) footAvg.innerText = totalQty > 0 ? `Avg: RS ${(grandTotal / totalQty).toFixed(2)}` : "-";
}

function exportSoldItemsToExcel() {
  const filtered = getFilteredSoldItems();
  if (filtered.length === 0) {
    Toast.show("No sold items to export.", "error");
    return;
  }

  try {
    const exportRows = filtered.map(item => ({
      "Sale Date": item.saleDate,
      "Bill Number": item.billNumber,
      "Invoice Number": item.invoiceNumber,
      "Product Name": item.productName,
      "Category": item.rawCategory,
      "Normalized Category": item.normalizedCategory.toUpperCase(),
      "Customer Name": item.customerName,
      "Customer Mobile": item.customerMobile || "N/A",
      "Unit Price (RS)": item.unitPrice,
      "Quantity Sold": item.quantity,
      "Discount (RS)": item.discount,
      "Total Price (RS)": item.total,
      "Payment Mode": item.paymentMethod,
      "Status": item.status,
      "Lens / Item Specs": item.lensDetails || ""
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sold_Inventory");

    const dateStr = new Date().toISOString().slice(0, 10);
    const catLabel = soldCategoryFilter !== "all" ? `_${soldCategoryFilter}` : "";
    const fileName = `OptiWay_Sold_Inventory${catLabel}_${dateStr}.xlsx`;

    XLSX.writeFile(workbook, fileName);
    Toast.show(`Successfully exported ${filtered.length} sold records to Excel!`, "success");
  } catch (err) {
    console.error("Excel export error:", err);
    Toast.show("Failed to generate Excel export.", "error");
  }
}

function printSoldItemsReport() {
  const filtered = getFilteredSoldItems();
  if (filtered.length === 0) {
    Toast.show("No sold items to print.", "error");
    return;
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    Toast.show("Please allow popups to print report.", "error");
    return;
  }

  let totalUnits = 0;
  let grandTotal = 0;
  filtered.forEach(f => {
    totalUnits += f.quantity;
    grandTotal += f.total;
  });

  const categoryTitle = soldCategoryFilter === "all" ? "All Categories" : soldCategoryFilter.toUpperCase();
  const dateRangeText = (soldDateFrom || soldDateTo) ? `Date: ${soldDateFrom || "Start"} to ${soldDateTo || "Present"}` : `Date: All Time (${new Date().toLocaleDateString()})`;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Sold Inventory Report - ${storeName}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 20px; color: #1e293b; font-size: 12px; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #0f172a; padding-bottom: 12px; }
          .header h1 { margin: 0 0 4px 0; font-size: 18px; color: #0f172a; text-transform: uppercase; }
          .header p { margin: 2px 0; color: #64748b; font-size: 11px; }
          .meta { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 11px; font-weight: bold; background: #f8fafc; padding: 8px 12px; border-radius: 6px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
          th { background: #f1f5f9; color: #334155; font-weight: bold; text-align: left; padding: 6px 8px; border: 1px solid #cbd5e1; }
          td { padding: 6px 8px; border: 1px solid #e2e8f0; }
          tr:nth-child(even) { background: #f8fafc; }
          .text-right { text-align: right; }
          .text-center { text-align: center; }
          .font-bold { font-weight: bold; }
          .font-mono { font-family: monospace; }
          .summary { margin-top: 15px; text-align: right; font-size: 12px; font-weight: bold; }
          @media print {
            body { padding: 0; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${storeName}</h1>
          <p>SOLD INVENTORY AUDIT & SALES LEDGER REPORT</p>
        </div>
        <div class="meta">
          <div>Category: ${categoryTitle} | ${dateRangeText}</div>
          <div>Total Records: ${filtered.length} | Total Units Sold: ${totalUnits}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Bill No.</th>
              <th>Product Name</th>
              <th>Category</th>
              <th>Customer</th>
              <th class="text-right">Price</th>
              <th class="text-center">Qty</th>
              <th class="text-right">Discount</th>
              <th class="text-right">Total (RS)</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(i => `
              <tr>
                <td class="font-mono">${formatDateStr(i.saleDate)}</td>
                <td class="font-mono font-bold">${i.billNumber}</td>
                <td>${i.productName}</td>
                <td>${i.rawCategory}</td>
                <td>${i.customerName}</td>
                <td class="text-right font-mono">RS ${i.unitPrice.toFixed(2)}</td>
                <td class="text-center font-bold">${i.quantity}</td>
                <td class="text-right font-mono">${i.discount > 0 ? `RS ${i.discount.toFixed(2)}` : "-"}</td>
                <td class="text-right font-mono font-bold">RS ${i.total.toFixed(2)}</td>
              </tr>
            `).join("")}
          </tbody>
          <tfoot>
            <tr style="background: #e2e8f0; font-weight: bold;">
              <td colspan="6" class="text-right">TOTAL SUMMARY:</td>
              <td class="text-center">${totalUnits}</td>
              <td></td>
              <td class="text-right font-mono">RS ${grandTotal.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
        <div class="summary">
          Total Net Sales Revenue: RS ${grandTotal.toFixed(2)}
        </div>
        <script>
          window.onload = function() {
            window.print();
          }
        </script>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}

function renderLogsTable() {
  const tbody = document.getElementById("tbl-inv-logs-body")!;
  if (logsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400">No adjustment logs recorded yet.</td></tr>`;
    return;
  }

  const sortedLogs = [...logsList].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  tbody.innerHTML = sortedLogs.map(l => `
    <tr class="hover:bg-slate-50 transition-colors">
      <td class="p-3 text-slate-500 text-[11px]">${new Date(l.createdAt).toLocaleString()}</td>
      <td class="p-3 font-bold text-slate-900">${l.productName}</td>
      <td class="p-3">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
          l.type === "Stock-In" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
        }">${l.type}</span>
      </td>
      <td class="p-3 font-bold ${l.quantityChange > 0 ? "text-emerald-700" : "text-rose-700"}">
        ${l.quantityChange > 0 ? `+${l.quantityChange}` : l.quantityChange}
      </td>
      <td class="p-3 text-slate-600">${l.previousQuantity} → <strong class="text-slate-900">${l.newQuantity}</strong></td>
      <td class="p-3 text-slate-500 italic">${l.reason || "Manual adjustment"}</td>
    </tr>
  `).join("");
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

// ----------------------------------------------------
// PENDING SECTION RENDERING & ACTIONS
// ----------------------------------------------------
function getFilteredPendingList(): Product[] {
  let list = [...pendingList];

  if (pendingSearchKeyword) {
    const q = pendingSearchKeyword.toLowerCase();
    list = list.filter(p =>
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.modelNumber && p.modelNumber.toLowerCase().includes(q)) ||
      (p.sku && p.sku.toLowerCase().includes(q)) ||
      (p.brand && p.brand.toLowerCase().includes(q)) ||
      (p.model && p.model.toLowerCase().includes(q)) ||
      (p.billNumber && p.billNumber.toLowerCase().includes(q)) ||
      (p.supplierLedgerId && p.supplierLedgerId.toLowerCase().includes(q)) ||
      (p.supplierName && p.supplierName.toLowerCase().includes(q))
    );
  }

  if (pendingBillFilter && pendingBillFilter !== "All") {
    list = list.filter(p => (p.billNumber || "Unassigned") === pendingBillFilter);
  }

  return list;
}

function populatePendingBillDropdown() {
  const billFilter = document.getElementById("inv-pending-bill-filter") as HTMLSelectElement;
  if (!billFilter) return;

  const billSet = new Set<string>();
  pendingList.forEach(p => {
    if (p.billNumber) billSet.add(p.billNumber);
  });

  const sortedBills = Array.from(billSet).sort();
  const currentVal = billFilter.value || "All";

  billFilter.innerHTML = `
    <option value="All">All Bill Numbers (${pendingList.length} items)</option>
    ${sortedBills.map(b => `<option value="${b}">${b}</option>`).join("")}
  `;

  if (sortedBills.includes(currentVal)) {
    billFilter.value = currentVal;
  }
}

function updatePendingSelectionState() {
  const filtered = getFilteredPendingList();
  const masterChk = document.getElementById("inv-pending-chk-master") as HTMLInputElement;
  const confirmBtnLabel = document.getElementById("btn-inv-confirm-label");

  if (masterChk) {
    if (filtered.length === 0) {
      masterChk.checked = false;
      masterChk.indeterminate = false;
    } else {
      const selectedCountInFiltered = filtered.filter(p => selectedPendingIds.has(p.id)).length;
      masterChk.checked = selectedCountInFiltered === filtered.length;
      masterChk.indeterminate = selectedCountInFiltered > 0 && selectedCountInFiltered < filtered.length;
    }
  }

  const selectedCount = selectedPendingIds.size;
  if (confirmBtnLabel) {
    if (selectedCount > 0) {
      confirmBtnLabel.innerText = `Confirm Selected (${selectedCount}) to Stock`;
    } else {
      confirmBtnLabel.innerText = `Confirm All (${filtered.length}) to Stock`;
    }
  }
}

function renderPendingSection() {
  populatePendingBillDropdown();
  const filtered = getFilteredPendingList();
  const tbody = document.getElementById("tbl-inv-pending-body");
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="p-8 text-center text-slate-400">
          <div class="flex flex-col items-center justify-center space-y-2">
            <svg class="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
            <p class="font-bold text-slate-600 text-xs">No pending stock items in staging queue.</p>
            <p class="text-[11px] text-slate-400">All purchased inventory items have been verified and confirmed into active stock.</p>
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
        <input type="checkbox" class="inv-pending-chk rounded border-amber-300 cursor-pointer" data-id="${p.id}" ${selectedPendingIds.has(p.id) ? "checked" : ""} />
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
        <span class="text-[11px] text-slate-500 font-mono">Model: ${p.modelNumber || p.sku || "—"}</span>
      </td>
      <td class="p-3.5 font-medium text-slate-700">${p.category || "General"}</td>
      <td class="p-3.5 text-slate-600">${p.brand || "—"} ${p.model ? `(${p.model})` : ""}</td>
      <td class="p-3.5 text-right font-bold text-slate-900">RS ${(p.sellingPrice || 0).toFixed(2)}</td>
      <td class="p-3.5 text-right text-slate-500">RS ${(p.purchasePrice || 0).toFixed(2)}</td>
      <td class="p-3.5 text-right font-bold text-amber-900">
        <span class="px-2 py-0.5 bg-amber-100 rounded text-xs">${p.stockQuantity || 0}</span>
      </td>
      <td class="p-3.5 text-right space-x-1.5 whitespace-nowrap">
        <button class="btn-inv-print-pending-single px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded font-bold text-xs transition-colors cursor-pointer inline-flex items-center gap-1 shadow-2xs" data-id="${p.id}" title="Download single 79x10mm optical sticker tag">
          <svg class="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          Sticker
        </button>
        <button class="btn-inv-confirm-single-pending px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold text-xs shadow-2xs transition-colors cursor-pointer" data-id="${p.id}" title="Confirm item into active live stock">
          ✓ Confirm
        </button>
        <button class="btn-inv-del-pending text-rose-600 hover:underline font-bold text-xs cursor-pointer ml-1" data-id="${p.id}">
          ✕ Reject
        </button>
      </td>
    </tr>
  `).join("");

  // Checkbox handlers
  tbody.querySelectorAll<HTMLInputElement>(".inv-pending-chk").forEach(chk => {
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

  // Single sticker download
  tbody.querySelectorAll(".btn-inv-print-pending-single").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id")!;
      const pendingItem = pendingList.find(p => p.id === id);
      if (pendingItem) {
        Toast.show(`Generating 79x10mm optical sticker for ${pendingItem.name}...`, "info");
        await BarcodePrinter.downloadExact79x10mmPdf([{
          brand: pendingItem.brand || pendingItem.category || "OptiWay",
          price: `RS ${pendingItem.sellingPrice || 0}`,
          model: pendingItem.model || pendingItem.modelNumber || pendingItem.sku || "",
          barcodeCode: pendingItem.barcode || pendingItem.modelNumber || pendingItem.sku || pendingItem.id || "000000",
          type: "CODE128",
          storeName: storeName
        }], `sticker_pending_${pendingItem.modelNumber || pendingItem.sku || "tag"}.pdf`);
        Toast.show(`Sticker tag downloaded!`, "success");
      }
    });
  });

  // Single item confirm
  tbody.querySelectorAll(".btn-inv-confirm-single-pending").forEach(btn => {
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
        await loadInventoryData();
      } catch (err: any) {
        console.error("Confirm pending error:", err);
        Toast.show("Confirmation failed: " + err.message, "error");
        targetBtn.disabled = false;
        targetBtn.innerHTML = originalHtml;
      }
    });
  });

  // Single item reject
  tbody.querySelectorAll(".btn-inv-del-pending").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id")!;
      const pendingItem = pendingList.find(p => p.id === id);
      if (!pendingItem) return;

      showConfirmDialog({
        title: `Remove Pending Product?`,
        message: `Are you sure you want to reject and remove "${pendingItem.name}" (Model: ${pendingItem.modelNumber || pendingItem.sku || 'N/A'}) from the staging queue?`,
        confirmText: "Reject & Delete",
        isDestructive: true,
        onConfirm: async () => {
          await dbService.deleteItem("pendingProducts", id);
          selectedPendingIds.delete(id);
          Toast.show(`Removed "${pendingItem.name}" from pending queue.`, "info");
          await loadInventoryData();
        }
      });
    });
  });

  updatePendingSelectionState();
}

async function handleInvConfirmPendingSelection() {
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
      
      await loadInventoryData();
      switchTab("instock");
    }
  });
}

async function handleInvPrintPendingStickers() {
  const filtered = getFilteredPendingList();
  const selectedItems = filtered.filter(p => selectedPendingIds.has(p.id));
  const targetItems = selectedItems.length > 0 ? selectedItems : filtered;

  if (targetItems.length === 0) {
    Toast.show("No pending products available to generate stickers for.", "error");
    return;
  }

  const stickerItems = targetItems.map(p => ({
    brand: p.brand || p.category || "OptiWay",
    price: `RS ${p.sellingPrice || 0}`,
    model: p.model || p.modelNumber || p.sku || "",
    barcodeCode: p.barcode || p.modelNumber || p.sku || p.id || "000000",
    type: "CODE128" as const,
    storeName: storeName
  }));

  Toast.show(`Generating ${stickerItems.length} 79x10mm optical stickers...`, "info");
  const filename = `pending_stickers_${stickerItems.length}_tags.pdf`;
  await BarcodePrinter.downloadExact79x10mmPdf(stickerItems, filename);
  Toast.show(`Downloaded ${stickerItems.length} sticker(s) in PDF!`, "success");
}

function populateProductSelect() {
  const select = document.getElementById("adj-product-id") as HTMLSelectElement;
  if (!select) return;
  select.innerHTML = productsList.map(p => `
    <option value="${p.id}">${p.name} (${p.modelNumber || p.sku || "N/A"}) — Stock: ${p.stockQuantity}</option>
  `).join("");
}

function switchTab(tab: "instock" | "sold" | "pending" | "audit") {
  activeTab = tab;

  const btnInStock = document.getElementById("tab-btn-instock");
  const btnSold = document.getElementById("tab-btn-sold");
  const btnPending = document.getElementById("tab-btn-pending");
  const btnAudit = document.getElementById("tab-btn-audit");

  const secInStock = document.getElementById("section-instock");
  const secSold = document.getElementById("section-sold");
  const secPending = document.getElementById("section-pending");
  const secAudit = document.getElementById("section-audit");

  const activeBtnClass = ["bg-slate-900", "text-white", "shadow-xs"];
  const inactiveBtnClass = ["bg-white", "text-slate-600", "hover:bg-slate-100", "border", "border-slate-200"];

  [btnInStock, btnSold, btnPending, btnAudit].forEach(btn => {
    btn?.classList.remove(...activeBtnClass);
    btn?.classList.add(...inactiveBtnClass);
  });

  secInStock?.classList.add("hidden");
  secSold?.classList.add("hidden");
  secPending?.classList.add("hidden");
  secAudit?.classList.add("hidden");

  if (tab === "instock") {
    btnInStock?.classList.remove(...inactiveBtnClass);
    btnInStock?.classList.add(...activeBtnClass);
    secInStock?.classList.remove("hidden");
  } else if (tab === "sold") {
    btnSold?.classList.remove(...inactiveBtnClass);
    btnSold?.classList.add(...activeBtnClass);
    secSold?.classList.remove("hidden");
    renderSoldSection();
  } else if (tab === "pending") {
    btnPending?.classList.remove(...inactiveBtnClass);
    btnPending?.classList.add(...activeBtnClass);
    secPending?.classList.remove("hidden");
    renderPendingSection();
  } else if (tab === "audit") {
    btnAudit?.classList.remove(...inactiveBtnClass);
    btnAudit?.classList.add(...activeBtnClass);
    secAudit?.classList.remove("hidden");
  }
}

function setupEvents() {
  // Navigation Tabs
  document.getElementById("tab-btn-instock")?.addEventListener("click", () => switchTab("instock"));
  document.getElementById("tab-btn-sold")?.addEventListener("click", () => switchTab("sold"));
  document.getElementById("tab-btn-pending")?.addEventListener("click", () => switchTab("pending"));
  document.getElementById("tab-btn-audit")?.addEventListener("click", () => switchTab("audit"));

  // Pending Search & Bill Filter
  document.getElementById("inv-pending-search")?.addEventListener("input", (e) => {
    pendingSearchKeyword = (e.target as HTMLInputElement).value;
    renderPendingSection();
  });

  document.getElementById("inv-pending-bill-filter")?.addEventListener("change", (e) => {
    pendingBillFilter = (e.target as HTMLSelectElement).value;
    renderPendingSection();
  });

  // Pending Master Checkbox
  document.getElementById("inv-pending-chk-master")?.addEventListener("change", (e) => {
    const isChecked = (e.target as HTMLInputElement).checked;
    const filtered = getFilteredPendingList();
    if (isChecked) {
      filtered.forEach(p => selectedPendingIds.add(p.id));
    } else {
      filtered.forEach(p => selectedPendingIds.delete(p.id));
    }
    renderPendingSection();
  });

  // Pending Batch Action Buttons
  document.getElementById("btn-inv-confirm-all-pending")?.addEventListener("click", handleInvConfirmPendingSelection);
  document.getElementById("btn-inv-print-all-pending-stickers")?.addEventListener("click", handleInvPrintPendingStickers);

  // In-Stock Search
  document.getElementById("inv-search-instock")?.addEventListener("input", (e) => {
    inStockSearchKeyword = (e.target as HTMLInputElement).value;
    renderInventoryTable();
  });

  // Sold Category Filter Buttons (Frame, Sunglass, Lens, Contact, Accessories, All)
  document.querySelectorAll(".btn-sold-cat-filter").forEach(btn => {
    btn.addEventListener("click", () => {
      const cat = btn.getAttribute("data-category") as typeof soldCategoryFilter;
      soldCategoryFilter = cat;

      document.querySelectorAll(".btn-sold-cat-filter").forEach(b => {
        b.classList.remove("bg-slate-900", "text-white");
        b.classList.add("bg-slate-100", "text-slate-700", "hover:bg-slate-200");
      });

      btn.classList.remove("bg-slate-100", "text-slate-700", "hover:bg-slate-200");
      btn.classList.add("bg-slate-900", "text-white");

      renderSoldTable();
    });
  });

  // Sold Bill No. & Keyword Search
  const searchInput = document.getElementById("inv-sold-search-bill") as HTMLInputElement;
  const searchClear = document.getElementById("btn-sold-search-clear");
  searchInput?.addEventListener("input", () => {
    soldSearchKeyword = searchInput.value;
    if (soldSearchKeyword) {
      searchClear?.classList.remove("hidden");
    } else {
      searchClear?.classList.add("hidden");
    }
    renderSoldTable();
  });

  searchClear?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    soldSearchKeyword = "";
    searchClear.classList.add("hidden");
    renderSoldTable();
  });

  // Sold Price Filters
  const priceMinInput = document.getElementById("inv-sold-price-min") as HTMLInputElement;
  const priceMaxInput = document.getElementById("inv-sold-price-max") as HTMLInputElement;

  priceMinInput?.addEventListener("input", () => {
    const val = priceMinInput.value ? parseFloat(priceMinInput.value) : null;
    soldPriceMin = isNaN(val as number) ? null : val;
    renderSoldTable();
  });

  priceMaxInput?.addEventListener("input", () => {
    const val = priceMaxInput.value ? parseFloat(priceMaxInput.value) : null;
    soldPriceMax = isNaN(val as number) ? null : val;
    renderSoldTable();
  });

  // Sold Custom Date Filters
  const dateFromInput = document.getElementById("inv-sold-date-from") as HTMLInputElement;
  const dateToInput = document.getElementById("inv-sold-date-to") as HTMLInputElement;

  dateFromInput?.addEventListener("change", () => {
    soldDateFrom = dateFromInput.value;
    renderSoldTable();
  });

  dateToInput?.addEventListener("change", () => {
    soldDateTo = dateToInput.value;
    renderSoldTable();
  });

  // Sold Quick Date Presets
  document.querySelectorAll(".btn-sold-date-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      const preset = btn.getAttribute("data-preset");
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);

      if (preset === "all") {
        soldDateFrom = "";
        soldDateTo = "";
      } else if (preset === "today") {
        soldDateFrom = todayStr;
        soldDateTo = todayStr;
      } else if (preset === "week") {
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        soldDateFrom = weekAgo.toISOString().slice(0, 10);
        soldDateTo = todayStr;
      } else if (preset === "month") {
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        soldDateFrom = firstDay.toISOString().slice(0, 10);
        soldDateTo = todayStr;
      }

      if (dateFromInput) dateFromInput.value = soldDateFrom;
      if (dateToInput) dateToInput.value = soldDateTo;

      renderSoldTable();
    });
  });

  // Sold Sorting Select
  const sortSelect = document.getElementById("inv-sold-sort") as HTMLSelectElement;
  sortSelect?.addEventListener("change", () => {
    soldSortMode = sortSelect.value as typeof soldSortMode;
    renderSoldTable();
  });

  // Reset All Filters
  document.getElementById("btn-sold-reset-all")?.addEventListener("click", () => {
    soldCategoryFilter = "all";
    soldSearchKeyword = "";
    soldPriceMin = null;
    soldPriceMax = null;
    soldDateFrom = "";
    soldDateTo = "";
    soldSortMode = "date-desc";

    // Reset UI
    if (searchInput) searchInput.value = "";
    searchClear?.classList.add("hidden");
    if (priceMinInput) priceMinInput.value = "";
    if (priceMaxInput) priceMaxInput.value = "";
    if (dateFromInput) dateFromInput.value = "";
    if (dateToInput) dateToInput.value = "";
    if (sortSelect) sortSelect.value = "date-desc";

    document.querySelectorAll(".btn-sold-cat-filter").forEach(b => {
      const isAll = b.getAttribute("data-category") === "all";
      if (isAll) {
        b.classList.remove("bg-slate-100", "text-slate-700", "hover:bg-slate-200");
        b.classList.add("bg-slate-900", "text-white");
      } else {
        b.classList.remove("bg-slate-900", "text-white");
        b.classList.add("bg-slate-100", "text-slate-700", "hover:bg-slate-200");
      }
    });

    renderSoldTable();
    Toast.show("All search and date filters have been reset.", "info");
  });

  // Export Sold Items
  document.getElementById("btn-sold-export-excel")?.addEventListener("click", exportSoldItemsToExcel);
  document.getElementById("btn-sold-print-report")?.addEventListener("click", printSoldItemsReport);

  // AI Direct Purchase Bill Scanner
  document.getElementById("btn-scan-purchase-bill")?.addEventListener("click", () => {
    PurchaseBillScanner.openModal({
      defaultDestination: "live",
      onSuccess: async () => {
        await loadInventoryData();
      }
    });
  });

  document.getElementById("btn-open-excel-import")?.addEventListener("click", () => {
    ExcelProductImporter.openImportModal(productsList, async () => {
      await loadInventoryData();
    });
  });

  document.getElementById("btn-export-excel")?.addEventListener("click", () => {
    ExcelProductImporter.exportProductsToExcel(productsList, `optiway_inventory_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  document.getElementById("btn-open-stk-gen-modal")?.addEventListener("click", () => {
    BarcodePrinter.open79x10mmStickerGeneratorModal(productsList, storeName);
  });
  document.getElementById("btn-open-bulk-barcodes")?.addEventListener("click", () => {
    BarcodePrinter.openBulkPrintModal(productsList, storeName);
  });
  document.getElementById("btn-open-adj-modal")?.addEventListener("click", () => openAdjustmentModal());
  document.getElementById("btn-close-adj-modal")?.addEventListener("click", closeAdjustmentModal);
  document.getElementById("btn-cancel-adj-modal")?.addEventListener("click", closeAdjustmentModal);

  document.getElementById("form-adj")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const productId = (document.getElementById("adj-product-id") as HTMLSelectElement).value;
    const type = (document.getElementById("adj-type") as HTMLSelectElement).value as InventoryLog["type"];
    const qtyAmount = parseInt((document.getElementById("adj-quantity") as HTMLInputElement).value) || 0;
    const reason = (document.getElementById("adj-reason") as HTMLInputElement).value.trim();

    const product = productsList.find(p => p.id === productId);
    if (!product) return;

    const prevQty = product.stockQuantity;
    let qtyChange = 0;

    if (type === "Stock-In") {
      qtyChange = qtyAmount;
    } else if (type === "Stock-Out" || type === "Damage") {
      qtyChange = -qtyAmount;
    } else if (type === "Correction") {
      qtyChange = qtyAmount - prevQty;
    }

    const newQty = Math.max(0, prevQty + qtyChange);
    product.stockQuantity = newQty;

    // Save updated product
    await dbService.saveItem("products", product);

    // Record Inventory Log
    const logItem: Partial<InventoryLog> = {
      productId,
      productName: product.name,
      type,
      quantityChange: qtyChange,
      previousQuantity: prevQty,
      newQuantity: newQty,
      reason,
      createdAt: new Date().toISOString()
    };
    await dbService.saveItem("inventoryLogs", logItem);

    Toast.show(`Updated stock for "${product.name}" to ${newQty}.`, "success");
    closeAdjustmentModal();
    await loadInventoryData();
  });
}

function openAdjustmentModal(productId?: string) {
  if (productId) {
    (document.getElementById("adj-product-id") as HTMLSelectElement).value = productId;
  }
  document.getElementById("modal-adj")?.classList.remove("hidden");
}

function closeAdjustmentModal() {
  document.getElementById("modal-adj")?.classList.add("hidden");
}

