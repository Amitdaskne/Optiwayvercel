import { initAuthGuard } from "../lib/auth";
import { renderAppLayout, Toast } from "../components/layout";
import { dbService, Order, Customer, Prescription, Sale, StoreSettings, Receipt, ensureArray, formatDateStr, ensureDateString } from "../lib/db";
import { printLabJobSlip, downloadAdvanceReceiptPDF, downloadInvoicePDF, printInvoiceDirect } from "../lib/exportUtils";
import { sendOrderWhatsAppPrompt, sendSaleWhatsAppPrompt } from "../lib/whatsapp";

let allOrders: Order[] = [];
let selectedOrder: Order | null = null;
let quickConfirmOrderTarget: Order | null = null;
let confirmedSaleForDownload: Sale | null = null;
let confirmedRxForDownload: Prescription | null = null;
let storeSettings: StoreSettings | null = null;
let activeTabFilter: "active" | "in-lab" | "ready" | "balance" | "completed" | "all" = "active";

initAuthGuard({
  onUserReady: async (user) => {
    renderAppLayout("orders", "Pending Orders & Optical Lab", user);
    await loadOrdersData();
  }
});

async function loadOrdersData() {
  try {
    const [orders, settings] = await Promise.all([
      dbService.getList<Order>("orders"),
      dbService.getSettings()
    ]);
    allOrders = orders;
    storeSettings = settings;

    // Sort newest first
    allOrders.sort((a, b) => new Date(ensureDateString(b.createdAt, b.orderDate)).getTime() - new Date(ensureDateString(a.createdAt, a.orderDate)).getTime());

    updateOrderStats();
    renderOrders();
    setupEvents();

    // Check deep link
    const urlParams = new URLSearchParams(window.location.search);
    const orderIdParam = urlParams.get("orderId");
    if (orderIdParam) {
      const match = allOrders.find(o => o.id === orderIdParam || o.orderNumber === orderIdParam);
      if (match) openOrderDetailModal(match);
    }
  } catch (err) {
    console.error("Failed to load orders:", err);
    Toast.show("Failed to load pending orders.", "error");
  }
}

function updateOrderStats() {
  const pendingOrders = allOrders.filter(o => o.status === "Pending");
  const inLabOrders = allOrders.filter(o => o.status === "In Progress");
  const readyOrders = allOrders.filter(o => o.status === "Ready for Pickup");
  
  // Total pending balance across active orders
  const activeOrders = allOrders.filter(o => o.status !== "Completed" && o.status !== "Cancelled");
  const totalPendingBalance = activeOrders.reduce((sum, o) => sum + (o.pendingBalance || 0), 0);

  const pendingCountEl = document.getElementById("stat-pending-count");
  if (pendingCountEl) pendingCountEl.innerText = String(pendingOrders.length);

  const inLabCountEl = document.getElementById("stat-in-lab-count");
  if (inLabCountEl) inLabCountEl.innerText = String(inLabOrders.length);

  const readyCountEl = document.getElementById("stat-ready-count");
  if (readyCountEl) readyCountEl.innerText = String(readyOrders.length);

  const balanceEl = document.getElementById("stat-pending-balance");
  if (balanceEl) balanceEl.innerText = `RS ${totalPendingBalance.toFixed(2)}`;
}

function getFilteredOrders(): Order[] {
  const searchQuery = (document.getElementById("filter-search") as HTMLInputElement)?.value.trim().toLowerCase() || "";
  const paymentFilter = (document.getElementById("filter-payment") as HTMLSelectElement)?.value || "All";
  const dateFilter = (document.getElementById("filter-date") as HTMLInputElement)?.value || "";

  return allOrders.filter(o => {
    // Tab filter
    let matchTab = true;
    if (activeTabFilter === "active") {
      matchTab = o.status !== "Completed" && o.status !== "Cancelled";
    } else if (activeTabFilter === "in-lab") {
      matchTab = o.status === "In Progress";
    } else if (activeTabFilter === "ready") {
      matchTab = o.status === "Ready for Pickup";
    } else if (activeTabFilter === "balance") {
      matchTab = (o.pendingBalance || 0) > 0;
    } else if (activeTabFilter === "completed") {
      matchTab = o.status === "Completed";
    } else if (activeTabFilter === "all") {
      matchTab = true;
    }

    const itemsMatch = ensureArray(o.items).some(i => (i.productName || "").toLowerCase().includes(searchQuery));
    const matchSearch = !searchQuery ||
      (o.orderNumber || "").toLowerCase().includes(searchQuery) ||
      (o.customerName || "").toLowerCase().includes(searchQuery) ||
      (o.customerMobile || "").includes(searchQuery) ||
      itemsMatch;

    const matchPayment = paymentFilter === "All" || o.paymentStatus === paymentFilter;
    const matchDate = !dateFilter || (o.orderDate || formatDateStr(o.createdAt, "")).startsWith(dateFilter);

    return matchTab && matchSearch && matchPayment && matchDate;
  });
}

function renderOrders() {
  const filtered = getFilteredOrders();
  const countIndicator = document.getElementById("orders-count-indicator");
  if (countIndicator) {
    countIndicator.innerText = `Showing ${filtered.length} order${filtered.length === 1 ? "" : "s"}`;
  }

  renderDesktopTable(filtered);
  renderMobileCards(filtered);
}

function renderDesktopTable(orders: Order[]) {
  const tbody = document.getElementById("tbl-orders-body");
  if (!tbody) return;

  if (orders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="p-8 text-center text-slate-400">
          <div class="flex flex-col items-center justify-center space-y-2">
            <svg class="w-8 h-8 text-slate-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <p class="font-medium text-xs">No pending orders match the selected criteria.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = orders.map(o => {
    const itemsSummary = ensureArray(o.items).map(i => `${i.productName} (x${i.quantity})`).join(", ") || "General Item";
    const truncItems = itemsSummary.length > 28 ? itemsSummary.slice(0, 26) + ".." : itemsSummary;

    return `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="p-3.5">
          <span class="font-extrabold text-blue-600 font-mono">${o.orderNumber}</span>
        </td>
        <td class="p-3.5">
          <span class="font-bold text-slate-900 block">${o.customerName || "Walk-in Patient"}</span>
          <span class="text-[11px] text-slate-500 font-mono">${o.customerMobile || "No mobile"}</span>
        </td>
        <td class="p-3.5 text-slate-600 whitespace-nowrap">${o.orderDate || formatDateStr(o.createdAt, "—")}</td>
        <td class="p-3.5">
          <span class="text-slate-800 font-medium" title="${itemsSummary}">${truncItems}</span>
        </td>
        <td class="p-3.5 text-right font-bold text-slate-900 whitespace-nowrap">RS ${(o.grandTotal || 0).toFixed(2)}</td>
        <td class="p-3.5 text-right text-emerald-700 font-semibold whitespace-nowrap">RS ${(o.advancePaid || 0).toFixed(2)}</td>
        <td class="p-3.5 text-right whitespace-nowrap ${o.pendingBalance > 0 ? "text-amber-700 font-extrabold" : "text-slate-400 font-medium"}">
          RS ${(o.pendingBalance || 0).toFixed(2)}
        </td>
        <td class="p-3.5 text-center">
          <span class="px-2.5 py-1 rounded-full text-[10px] font-bold inline-block ${getStatusBadgeClass(o.status)}">
            ${o.status}
          </span>
        </td>
        <td class="p-3.5 text-center">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
            o.paymentStatus === "Fully-paid" ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-800 border border-amber-200"
          }">${o.paymentStatus}</span>
        </td>
        <td class="p-3.5 text-right space-x-1.5 whitespace-nowrap">
          ${o.status !== "Completed" && o.status !== "Cancelled" ? `
            <button class="btn-confirm-sale px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-[11px] transition-colors inline-flex items-center gap-1 shadow-2xs cursor-pointer active:scale-95" data-id="${o.id}" title="Confirm & Finalize Sale">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Confirm Sale</span>
            </button>
          ` : ""}
          <button class="btn-whatsapp-order px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold rounded-lg text-[11px] transition-colors inline-flex items-center gap-1 cursor-pointer active:scale-95 shadow-2xs" data-id="${o.id}" title="Send Order Details via WhatsApp">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span>WhatsApp</span>
          </button>
          <button class="btn-download-advance-pdf px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold rounded-lg text-[11px] transition-colors inline-flex items-center gap-1 cursor-pointer active:scale-95" data-id="${o.id}" title="Download Advance Receipt PDF">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>
            <span>Receipt PDF</span>
          </button>
          <button class="btn-manage-order px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-lg text-[11px] transition-colors cursor-pointer active:scale-95" data-id="${o.id}">
            Manage
          </button>
        </td>
      </tr>
    `;
  }).join("");

  attachTableEventListeners(tbody);
}

function renderMobileCards(orders: Order[]) {
  const container = document.getElementById("orders-mobile-container");
  if (!container) return;

  if (orders.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
        <p class="font-medium text-xs">No pending orders found.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = orders.map(o => {
    const itemsSummary = ensureArray(o.items).map(i => `${i.productName} (x${i.quantity})`).join(", ") || "General Item";

    return `
      <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-mono font-bold text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">${o.orderNumber}</span>
            <span class="text-[11px] text-slate-500">${o.orderDate || formatDateStr(o.createdAt, "—")}</span>
          </div>
          <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${getStatusBadgeClass(o.status)}">
            ${o.status}
          </span>
        </div>

        <div class="border-y border-slate-100 py-2.5 space-y-1">
          <div class="flex justify-between items-start">
            <span class="font-bold text-sm text-slate-900">${o.customerName || "Walk-in Patient"}</span>
            <span class="font-mono text-xs text-slate-500">${o.customerMobile || ""}</span>
          </div>
          <p class="text-xs text-slate-600">${itemsSummary}</p>
        </div>

        <div class="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl text-center">
          <div>
            <span class="text-[10px] text-slate-500 font-semibold block">Total</span>
            <span class="text-xs font-bold text-slate-900">RS ${(o.grandTotal || 0).toFixed(2)}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-500 font-semibold block">Paid</span>
            <span class="text-xs font-bold text-emerald-700">RS ${(o.advancePaid || 0).toFixed(2)}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-500 font-semibold block">Balance Due</span>
            <span class="text-xs font-extrabold ${o.pendingBalance > 0 ? "text-amber-700" : "text-slate-400"}">RS ${(o.pendingBalance || 0).toFixed(2)}</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between pt-1 gap-2">
          ${o.status !== "Completed" && o.status !== "Cancelled" ? `
            <button class="btn-confirm-sale flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer active:scale-95" data-id="${o.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Confirm Sale</span>
            </button>
          ` : ""}
          <button class="btn-whatsapp-order flex-1 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 shadow-2xs" data-id="${o.id}">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span>WhatsApp</span>
          </button>
          <button class="btn-download-advance-pdf flex-1 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer active:scale-95" data-id="${o.id}">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>
            <span>Receipt PDF</span>
          </button>
          <button class="btn-manage-order px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs transition-colors cursor-pointer active:scale-95" data-id="${o.id}">
            Manage
          </button>
        </div>
      </div>
    `;
  }).join("");

  attachTableEventListeners(container);
}

function attachTableEventListeners(parentEl: HTMLElement) {
  parentEl.querySelectorAll(".btn-whatsapp-order").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      const match = allOrders.find(o => o.id === id);
      if (match) sendOrderWhatsAppPrompt(match, storeSettings);
    });
  });

  parentEl.querySelectorAll(".btn-manage-order").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const match = allOrders.find(o => o.id === id);
      if (match) openOrderDetailModal(match);
    });
  });

  parentEl.querySelectorAll(".btn-download-advance-pdf").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      const match = allOrders.find(o => o.id === id);
      if (match) triggerDownloadAdvanceReceipt(match);
    });
  });

  parentEl.querySelectorAll(".btn-confirm-sale").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      const match = allOrders.find(o => o.id === id);
      if (match) openQuickConfirmSaleModal(match);
    });
  });

  parentEl.querySelectorAll(".btn-advance-status").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const match = allOrders.find(o => o.id === id);
      if (!match) return;

      let nextStatus: Order["status"] = "Completed";
      if (match.status === "Pending") nextStatus = "In Progress";
      else if (match.status === "In Progress") nextStatus = "Ready for Pickup";
      else if (match.status === "Ready for Pickup") nextStatus = "Completed";

      match.status = nextStatus;
      await dbService.saveItem("orders", match);

      let targetSale: Sale | null = null;
      let rx: Prescription | null = null;

      // If marked completed, sync or create corresponding sale
      if (nextStatus === "Completed") {
        const saleResult = await getOrCreateSaleForOrder(match, "Cash");
        targetSale = saleResult.sale;
        rx = saleResult.rx;
        if (targetSale) {
          targetSale.status = "Completed";
          await dbService.saveItem("sales", targetSale);
        }
      }

      Toast.show(`Order ${match.orderNumber} advanced to "${nextStatus}".`, "success");
      updateOrderStats();
      renderOrders();

      if (nextStatus === "Completed" && targetSale) {
        showInvoiceDownloadConfirmationModal(targetSale, rx, match);
      }
    });
  });
}

function triggerDownloadAdvanceReceipt(order: Order) {
  try {
    const rawNumber = (order.orderNumber || order.id || "").replace(/[^0-9]/g, "");
    const safeOrderNum = order.orderNumber || `OPT-ORD-${order.id || Math.floor(1000 + Math.random() * 9000)}`;
    const safeSaleNum = (order.orderNumber || "").replace("OPT-ORD-", "OPT-SL-") || `OPT-SL-${order.saleId || order.id || "0000"}`;
    const receiptData = {
      receiptNumber: "OPT-REC-" + (rawNumber || Math.floor(1000 + Math.random() * 9000)),
      orderNumber: safeOrderNum,
      saleNumber: safeSaleNum,
      customerName: order.customerName || "Walk-in Patient",
      customerMobile: order.customerMobile || "",
      customerAddress: "",
      items: ensureArray(order.items),
      grandTotal: order.grandTotal || 0,
      advanceAmount: order.advancePaid || 0,
      pendingAmount: order.pendingBalance || 0,
      paymentMethod: (order.advancePaid || 0) >= (order.grandTotal || 0) ? "Full Payment" : "Advance / Partial",
      date: order.orderDate || formatDateStr(order.createdAt, new Date().toISOString().slice(0, 10)),
      notes: order.notes || ""
    };

    downloadAdvanceReceiptPDF(receiptData, order.prescriptionDetails || null, storeSettings);
    Toast.show(`Advance Receipt PDF downloaded for ${safeOrderNum}!`, "success");
  } catch (err) {
    console.error("Failed to generate advance receipt PDF:", err);
    Toast.show("Failed to download advance receipt PDF.", "error");
  }
}

function openQuickConfirmSaleModal(order: Order) {
  quickConfirmOrderTarget = order;

  const modal = document.getElementById("modal-quick-confirm-sale");
  const orderRefEl = document.getElementById("quick-confirm-order-ref");
  const custEl = document.getElementById("quick-confirm-cust");
  const totalEl = document.getElementById("quick-confirm-total");
  const advanceEl = document.getElementById("quick-confirm-advance");
  const balanceEl = document.getElementById("quick-confirm-balance");
  const paySection = document.getElementById("quick-confirm-payment-section");
  const fullyPaidMsg = document.getElementById("quick-confirm-fully-paid-msg");
  const submitBtnText = document.getElementById("btn-submit-quick-confirm-text");

  if (orderRefEl) orderRefEl.innerText = order.orderNumber;
  if (custEl) custEl.innerText = `${order.customerName} (${order.customerMobile || "No mobile"})`;
  if (totalEl) totalEl.innerText = `RS ${(order.grandTotal || 0).toFixed(2)}`;
  if (advanceEl) advanceEl.innerText = `RS ${(order.advancePaid || 0).toFixed(2)}`;
  if (balanceEl) balanceEl.innerText = `RS ${(order.pendingBalance || 0).toFixed(2)}`;

  if (order.pendingBalance > 0) {
    paySection?.classList.remove("hidden");
    fullyPaidMsg?.classList.add("hidden");
    if (submitBtnText) submitBtnText.innerText = `Collect RS ${(order.pendingBalance || 0).toFixed(2)} & Confirm Sale`;
  } else {
    paySection?.classList.add("hidden");
    fullyPaidMsg?.classList.remove("hidden");
    if (submitBtnText) submitBtnText.innerText = "Confirm Sale (Fulfilled)";
  }

  modal?.classList.remove("hidden");
}

function closeQuickConfirmSaleModal() {
  document.getElementById("modal-quick-confirm-sale")?.classList.add("hidden");
  quickConfirmOrderTarget = null;
}

async function submitQuickConfirmSale() {
  if (!quickConfirmOrderTarget) return;

  const order = quickConfirmOrderTarget;
  const method = (document.getElementById("quick-confirm-method") as HTMLSelectElement)?.value || "Cash";
  const balanceToCollect = order.pendingBalance || 0;

  try {
    // 1. Update Order
    order.advancePaid = order.grandTotal;
    order.pendingBalance = 0;
    order.status = "Completed";
    order.paymentStatus = "Fully-paid";
    await dbService.saveItem("orders", order);

    // 2. Update or create linked Sale record
    const { sale: targetSale, rx } = await getOrCreateSaleForOrder(order, method);

    // 3. Update customer outstanding balance if applicable
    if (order.customerId && order.customerId !== "c_walkin") {
      const customer = await dbService.getItem<Customer>("customers", order.customerId);
      if (customer && customer.outstandingBalance) {
        customer.outstandingBalance = Math.max(0, customer.outstandingBalance - balanceToCollect);
        await dbService.saveItem("customers", customer);
      }
    }

    // 4. Create Settlement Receipt if remaining payment was collected
    if (balanceToCollect > 0) {
      const rawNumber = (order.orderNumber || order.id || "").replace(/[^0-9]/g, "");
      const receipt: Partial<Receipt> = {
        receiptNumber: "OPT-REC-" + (rawNumber || Math.floor(1000 + Math.random() * 9000)),
        saleId: targetSale.id || order.saleId,
        orderId: order.id,
        customerId: order.customerId,
        customerName: order.customerName,
        customerMobile: order.customerMobile,
        date: new Date().toISOString().slice(0, 10),
        totalAmount: order.grandTotal,
        advanceAmount: order.grandTotal,
        pendingAmount: 0,
        paymentMethod: method as "Cash" | "UPI" | "Card",
        itemsSummary: `Final balance settlement for Order ${order.orderNumber || order.id}`,
        createdAt: new Date().toISOString()
      };
      await dbService.saveItem("receipts", receipt);
    }

    Toast.show(`Sale Confirmed! Order ${order.orderNumber || order.id} settled in full and completed.`, "success");
    closeQuickConfirmSaleModal();
    closeOrderDetailModal();
    updateOrderStats();
    renderOrders();

    // Show popup to download PDF of invoice
    showInvoiceDownloadConfirmationModal(targetSale, rx, order);
  } catch (err) {
    console.error("Failed to confirm sale:", err);
    Toast.show("Failed to finalize and confirm sale.", "error");
  }
}

async function getOrCreateSaleForOrder(order: Order, paymentMethod: string = "Cash"): Promise<{ sale: Sale; rx: Prescription | null }> {
  let targetSale: Sale | null = null;
  if (order.saleId) {
    try {
      targetSale = await dbService.getItem<Sale>("sales", order.saleId);
    } catch {
      targetSale = null;
    }
  }

  if (targetSale) {
    targetSale.advanceAmount = order.grandTotal || targetSale.grandTotal;
    targetSale.pendingAmount = 0;
    targetSale.status = "Completed";
    if (paymentMethod) targetSale.paymentMethod = (paymentMethod as any) || targetSale.paymentMethod || "Cash";
    await dbService.saveItem("sales", targetSale);
  } else {
    const saleNum = (order.orderNumber || "OPT-ORD-0000").replace("OPT-ORD-", "OPT-SL-");
    const newSale: Partial<Sale> = {
      saleNumber: saleNum,
      orderId: order.id,
      customerId: order.customerId || "c_walkin",
      customerName: order.customerName || "Walk-in Patient",
      customerMobile: order.customerMobile || "",
      customerAddress: "",
      items: ensureArray(order.items),
      subtotal: order.subtotal || order.grandTotal,
      discountTotal: order.discountTotal || 0,
      billDiscountAmount: order.billDiscountAmount || 0,
      billDiscountType: order.billDiscountType,
      billDiscountValue: order.billDiscountValue,
      discountReason: order.discountReason,
      taxTotal: order.taxTotal || 0,
      grandTotal: order.grandTotal,
      advanceAmount: order.grandTotal,
      pendingAmount: 0,
      paymentMethod: (paymentMethod as "Cash" | "UPI" | "Card") || "Cash",
      status: "Completed",
      saleDate: new Date().toISOString().slice(0, 10),
      prescriptionId: order.prescriptionDetails?.id,
      notes: order.notes || "",
      createdAt: new Date().toISOString()
    };
    const newSaleId = await dbService.saveItem("sales", newSale);
    order.saleId = newSaleId;
    await dbService.saveItem("orders", order);
    targetSale = { ...newSale, id: newSaleId } as Sale;
  }

  let rx: Prescription | null = null;
  if (order.prescriptionDetails) {
    rx = order.prescriptionDetails as Prescription;
  } else if (targetSale.prescriptionId) {
    rx = await dbService.getItem<Prescription>("prescriptions", targetSale.prescriptionId);
  } else if (order.customerId && order.customerId !== "c_walkin") {
    const rxList = await dbService.getList<Prescription>("prescriptions");
    rx = rxList.find(r => r.customerId === order.customerId) || null;
  }

  return { sale: targetSale, rx };
}

function showInvoiceDownloadConfirmationModal(sale: Sale, rx: Prescription | null, order?: Order | null) {
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
  if (ordNumEl) ordNumEl.innerText = order?.orderNumber || (sale.orderId ? `Order #${sale.orderId}` : sale.saleNumber);
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
    if (rx || order?.prescriptionDetails) {
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

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case "Completed":
      return "bg-emerald-100 text-emerald-800";
    case "In Progress":
      return "bg-blue-100 text-blue-800";
    case "Ready for Pickup":
      return "bg-indigo-100 text-indigo-800 border border-indigo-200 animate-pulse";
    case "Cancelled":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function getNextStatusActionText(status: string): string {
  switch (status) {
    case "Pending":
      return "Send to Lab &rarr;";
    case "In Progress":
      return "Mark Ready &rarr;";
    case "Ready for Pickup":
      return "Deliver Order &rarr;";
    default:
      return "Advance";
  }
}

function setupEvents() {
  // Tab Switching
  const tabs = [
    { id: "tab-status-active", key: "active" as const },
    { id: "tab-status-in-lab", key: "in-lab" as const },
    { id: "tab-status-ready", key: "ready" as const },
    { id: "tab-status-balance", key: "balance" as const },
    { id: "tab-status-completed", key: "completed" as const },
    { id: "tab-status-all", key: "all" as const },
  ];

  tabs.forEach(t => {
    document.getElementById(t.id)?.addEventListener("click", () => {
      activeTabFilter = t.key;
      tabs.forEach(item => {
        const btn = document.getElementById(item.id);
        if (item.key === activeTabFilter) {
          btn?.classList.remove("bg-slate-100", "text-slate-700");
          btn?.classList.add("bg-blue-600", "text-white");
        } else {
          btn?.classList.remove("bg-blue-600", "text-white");
          btn?.classList.add("bg-slate-100", "text-slate-700");
        }
      });
      renderOrders();
    });
  });

  // Inputs
  document.getElementById("filter-search")?.addEventListener("input", renderOrders);
  document.getElementById("filter-payment")?.addEventListener("change", renderOrders);
  document.getElementById("filter-date")?.addEventListener("change", renderOrders);

  // Clear filters
  document.getElementById("btn-reset-filters")?.addEventListener("click", () => {
    (document.getElementById("filter-search") as HTMLInputElement).value = "";
    (document.getElementById("filter-payment") as HTMLSelectElement).value = "All";
    (document.getElementById("filter-date") as HTMLInputElement).value = "";
    activeTabFilter = "active";
    tabs.forEach(item => {
      const btn = document.getElementById(item.id);
      if (item.key === "active") {
        btn?.classList.remove("bg-slate-100", "text-slate-700");
        btn?.classList.add("bg-blue-600", "text-white");
      } else {
        btn?.classList.remove("bg-blue-600", "text-white");
        btn?.classList.add("bg-slate-100", "text-slate-700");
      }
    });
    renderOrders();
  });

  // Modal controls
  document.getElementById("btn-modal-order-whatsapp")?.addEventListener("click", () => {
    if (selectedOrder) sendOrderWhatsAppPrompt(selectedOrder, storeSettings);
  });
  document.getElementById("btn-inv-confirm-whatsapp")?.addEventListener("click", () => {
    if (confirmedSaleForDownload) {
      sendSaleWhatsAppPrompt(confirmedSaleForDownload, confirmedRxForDownload, storeSettings);
    } else if (selectedOrder) {
      sendOrderWhatsAppPrompt(selectedOrder, storeSettings);
    }
  });
  document.getElementById("btn-close-ord-modal")?.addEventListener("click", closeOrderDetailModal);
  document.getElementById("btn-save-order-status")?.addEventListener("click", saveOrderStatus);
  document.getElementById("btn-modal-confirm-sale")?.addEventListener("click", () => {
    if (selectedOrder) openQuickConfirmSaleModal(selectedOrder);
  });
  document.getElementById("btn-modal-download-receipt-pdf")?.addEventListener("click", () => {
    if (selectedOrder) triggerDownloadAdvanceReceipt(selectedOrder);
  });
  document.getElementById("btn-collect-save-pending")?.addEventListener("click", () => handleOrderPaymentCollection("pending"));
  document.getElementById("btn-collect-save-sale")?.addEventListener("click", () => handleOrderPaymentCollection("sale"));
  document.getElementById("btn-print-job-card")?.addEventListener("click", printLabJobCard);

  // Quick Confirm Sale Modal controls
  document.getElementById("btn-close-quick-confirm")?.addEventListener("click", closeQuickConfirmSaleModal);
  document.getElementById("btn-cancel-quick-confirm")?.addEventListener("click", closeQuickConfirmSaleModal);
  document.getElementById("btn-submit-quick-confirm")?.addEventListener("click", submitQuickConfirmSale);

  // Invoice Download Popup controls
  document.getElementById("btn-inv-confirm-download-pdf")?.addEventListener("click", handleConfirmModalDownloadPDF);
  document.getElementById("btn-inv-confirm-print")?.addEventListener("click", handleConfirmModalPrint);
  document.getElementById("btn-inv-confirm-close")?.addEventListener("click", closeInvoiceDownloadConfirmationModal);
}

async function openOrderDetailModal(order: Order) {
  selectedOrder = order;
  const modal = document.getElementById("modal-order-detail")!;
  document.getElementById("modal-ord-title")!.innerText = `Order: ${order.orderNumber}`;
  document.getElementById("modal-ord-sub")!.innerText = `Customer: ${order.customerName} (${order.customerMobile || "No Mobile"})`;

  const modalBody = document.getElementById("modal-ord-body")!;

  let rxHtml = "";
  if (order.prescriptionDetails) {
    const rx = order.prescriptionDetails;
    const eyeSideTag = rx.eyeSide === "RE" ? "Right Eye (RE / OD) Only" : rx.eyeSide === "LE" ? "Left Eye (LE / OS) Only" : "Pair (RE + LE)";
    const eyeSideClass = rx.eyeSide === "RE" ? "bg-emerald-100 text-emerald-800 border-emerald-300" : rx.eyeSide === "LE" ? "bg-purple-100 text-purple-800 border-purple-300" : "bg-blue-100 text-blue-800 border-blue-300";

    rxHtml = `
      <div class="border border-blue-200 bg-blue-50/50 rounded-xl p-3 space-y-2">
        <div class="flex justify-between items-center text-blue-900 font-bold text-xs border-b border-blue-100 pb-1.5">
          <div class="flex items-center gap-2">
            <span>Attached Optical Prescription (Rx)</span>
            <span class="text-[9.5px] px-2 py-0.5 rounded font-extrabold border ${eyeSideClass}">${eyeSideTag}</span>
          </div>
          <span>PD: ${rx.pd ? rx.pd + "mm" : "N/A"}</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
          <div class="bg-white p-2.5 rounded-lg border ${rx.eyeSide === "RE" ? "border-emerald-300 bg-emerald-50/20" : rx.eyeSide === "LE" ? "border-slate-200 opacity-60" : "border-blue-100"}">
            <div class="flex justify-between items-center">
              <span class="font-bold ${rx.eyeSide === "RE" ? "text-emerald-800" : "text-blue-800"} block">Right Eye (RE / OD)</span>
              ${rx.eyeSide === "LE" ? `<span class="text-[9px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">N/A</span>` : ""}
            </div>
            ${rx.eyeSide !== "LE" ? `
              <div class="text-slate-700 mt-1">SPH: <strong>${rx.rightEye?.sph || "0.00"}</strong> | CYL: <strong>${rx.rightEye?.cyl || "0.00"}</strong></div>
              <div class="text-slate-700">AXIS: <strong>${rx.rightEye?.axis || "—"}°</strong> | ADD: <strong>+${rx.rightEye?.add || "0.00"}</strong></div>
            ` : `<div class="text-slate-400 italic text-[10px] mt-1">Not applicable for single Left Eye order</div>`}
          </div>
          <div class="bg-white p-2.5 rounded-lg border ${rx.eyeSide === "LE" ? "border-purple-300 bg-purple-50/20" : rx.eyeSide === "RE" ? "border-slate-200 opacity-60" : "border-blue-100"}">
            <div class="flex justify-between items-center">
              <span class="font-bold ${rx.eyeSide === "LE" ? "text-purple-800" : "text-indigo-800"} block">Left Eye (LE / OS)</span>
              ${rx.eyeSide === "RE" ? `<span class="text-[9px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">N/A</span>` : ""}
            </div>
            ${rx.eyeSide !== "RE" ? `
              <div class="text-slate-700 mt-1">SPH: <strong>${rx.leftEye?.sph || "0.00"}</strong> | CYL: <strong>${rx.leftEye?.cyl || "0.00"}</strong></div>
              <div class="text-slate-700">AXIS: <strong>${rx.leftEye?.axis || "—"}°</strong> | ADD: <strong>+${rx.leftEye?.add || "0.00"}</strong></div>
            ` : `<div class="text-slate-400 italic text-[10px] mt-1">Not applicable for single Right Eye order</div>`}
          </div>
        </div>
      </div>
    `;
  }

  modalBody.innerHTML = `
    <!-- Patient Info Banner with Edit Option -->
    <div class="p-3 bg-blue-50/70 rounded-xl border border-blue-200">
      <div id="patient-view-mode" class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div>
          <span class="text-[10px] text-blue-800 font-bold uppercase tracking-wider block">Patient / Customer Info</span>
          <div class="flex items-center gap-2 mt-0.5">
            <span class="text-xs font-bold text-slate-900" id="patient-display-name">${order.customerName || "Walk-in Patient"}</span>
            <span class="text-[11px] text-slate-500 font-mono" id="patient-display-mobile">${order.customerMobile ? `• ${order.customerMobile}` : "(No phone)"}</span>
          </div>
        </div>
        <button type="button" id="btn-toggle-edit-patient" class="text-[11px] font-bold text-blue-700 bg-white hover:bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg transition-colors shadow-2xs">
          Edit Patient Info
        </button>
      </div>

      <div id="patient-edit-mode" class="hidden pt-2 border-t border-blue-200/60 mt-2 space-y-2">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Patient Name *</label>
            <input type="text" id="modal-edit-patient-name" value="${order.customerName || ""}" placeholder="Customer name" class="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg outline-none bg-white font-bold text-slate-900" />
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-600 mb-0.5">Mobile Number</label>
            <input type="text" id="modal-edit-patient-mobile" value="${order.customerMobile || ""}" placeholder="Mobile number" class="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg outline-none bg-white font-bold text-slate-900" />
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-1">
          <button type="button" id="btn-cancel-edit-patient" class="px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 rounded-lg">Cancel</button>
          <button type="button" id="btn-save-edit-patient" class="px-3 py-1 text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 rounded-lg shadow-2xs">Save Patient Info</button>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
      <div>
        <p class="text-[10px] text-slate-500 font-bold uppercase">Grand Total</p>
        <p class="text-sm font-extrabold text-slate-900 mt-0.5">RS ${(order.grandTotal || 0).toFixed(2)}</p>
      </div>
      <div>
        <p class="text-[10px] text-slate-500 font-bold uppercase">Advance Paid</p>
        <p class="text-sm font-extrabold text-emerald-700 mt-0.5">RS ${(order.advancePaid || 0).toFixed(2)}</p>
      </div>
      <div>
        <p class="text-[10px] text-slate-500 font-bold uppercase">Balance Due</p>
        <p class="text-sm font-extrabold ${order.pendingBalance > 0 ? "text-amber-700" : "text-slate-400"} mt-0.5">RS ${(order.pendingBalance || 0).toFixed(2)}</p>
      </div>
      <div>
        <p class="text-[10px] text-slate-500 font-bold uppercase">Order Date</p>
        <p class="text-sm font-bold text-slate-900 mt-0.5">${order.orderDate || "—"}</p>
      </div>
    </div>

    ${rxHtml}

    <div class="border border-slate-200 rounded-xl overflow-hidden">
      <div class="bg-slate-100 px-3 py-2 font-bold text-slate-700 uppercase text-[10px] flex justify-between items-center">
        <span>Order Items & Spectacle Specifications</span>
        <a href="invoice.html?saleId=${order.saleId || ""}" class="text-blue-600 hover:underline lowercase font-medium">View Full Invoice &rarr;</a>
      </div>
      <div class="p-3 space-y-2 divide-y divide-slate-100">
        ${ensureArray(order.items).map(i => `
          <div class="flex justify-between items-start text-xs pt-1.5 first:pt-0">
            <div>
              <span class="font-bold text-slate-900 block">${i.productName}</span>
              ${i.lensDetails || i.prescriptionText ? `
                <span class="text-[10px] font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 inline-block mt-0.5">
                  Rx: ${i.lensDetails || i.prescriptionText}
                </span>
              ` : ""}
              <span class="text-slate-500 text-[11px] block mt-0.5">Qty: ${i.quantity} &times; RS ${(i.price || 0).toFixed(2)}</span>
            </div>
            <span class="font-bold text-slate-900">RS ${(i.total || 0).toFixed(2)}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  // Attach patient edit handlers
  const toggleEditBtn = document.getElementById("btn-toggle-edit-patient");
  const cancelEditBtn = document.getElementById("btn-cancel-edit-patient");
  const savePatientBtn = document.getElementById("btn-save-edit-patient");
  const editModeDiv = document.getElementById("patient-edit-mode");

  toggleEditBtn?.addEventListener("click", () => {
    editModeDiv?.classList.remove("hidden");
  });

  cancelEditBtn?.addEventListener("click", () => {
    editModeDiv?.classList.add("hidden");
  });

  savePatientBtn?.addEventListener("click", async () => {
    const newName = (document.getElementById("modal-edit-patient-name") as HTMLInputElement).value.trim();
    const newMobile = (document.getElementById("modal-edit-patient-mobile") as HTMLInputElement).value.trim();

    if (!newName) {
      Toast.show("Please enter a valid patient name.", "error");
      return;
    }

    selectedOrder!.customerName = newName;
    selectedOrder!.customerMobile = newMobile;
    await dbService.saveItem("orders", selectedOrder!);

    // Also update linked sale if any
    if (selectedOrder!.saleId) {
      const sale = await dbService.getItem<Sale>("sales", selectedOrder!.saleId);
      if (sale) {
        sale.customerName = newName;
        sale.customerMobile = newMobile;
        await dbService.saveItem("sales", sale);
      }
    }

    document.getElementById("patient-display-name")!.innerText = newName;
    document.getElementById("patient-display-mobile")!.innerText = newMobile ? `• ${newMobile}` : "(No phone)";
    document.getElementById("modal-ord-sub")!.innerText = `Customer: ${newName} (${newMobile || "No Mobile"})`;
    editModeDiv?.classList.add("hidden");

    Toast.show(`Patient details updated for Order ${selectedOrder!.orderNumber}.`, "success");
    renderOrders();
  });

  const statusSelect = document.getElementById("modal-select-status") as HTMLSelectElement;
  statusSelect.value = order.status;

  const collectBox = document.getElementById("box-collect-payment")!;
  const balanceLabel = document.getElementById("label-balance-due")!;
  const collectAmountInput = document.getElementById("modal-collect-amount") as HTMLInputElement;

  if (order.pendingBalance > 0) {
    collectBox.classList.remove("hidden");
    balanceLabel.innerText = `Due: RS ${order.pendingBalance.toFixed(2)}`;
    if (collectAmountInput) collectAmountInput.value = order.pendingBalance.toFixed(2);
  } else {
    collectBox.classList.add("hidden");
  }

  modal.classList.remove("hidden");
}

function closeOrderDetailModal() {
  document.getElementById("modal-order-detail")?.classList.add("hidden");
  selectedOrder = null;
}

async function saveOrderStatus() {
  if (!selectedOrder) return;
  const newStatus = (document.getElementById("modal-select-status") as HTMLSelectElement).value as Order["status"];

  selectedOrder.status = newStatus;
  await dbService.saveItem("orders", selectedOrder);

  let targetSale: Sale | null = null;
  let rx: Prescription | null = null;

  if (newStatus === "Completed") {
    const saleResult = await getOrCreateSaleForOrder(selectedOrder, "Cash");
    targetSale = saleResult.sale;
    rx = saleResult.rx;
    if (targetSale) {
      targetSale.status = "Completed";
      await dbService.saveItem("sales", targetSale);
    }
  }

  const completedOrder = selectedOrder;
  Toast.show(`Order ${selectedOrder.orderNumber} status updated to "${newStatus}".`, "success");
  closeOrderDetailModal();
  updateOrderStats();
  renderOrders();

  if (newStatus === "Completed" && targetSale) {
    showInvoiceDownloadConfirmationModal(targetSale, rx, completedOrder);
  }
}

async function handleOrderPaymentCollection(mode: "pending" | "sale") {
  if (!selectedOrder || selectedOrder.pendingBalance <= 0) return;

  const method = (document.getElementById("modal-collect-method") as HTMLSelectElement).value || "Cash";
  const amountInput = document.getElementById("modal-collect-amount") as HTMLInputElement;
  let collectedAmount = parseFloat(amountInput.value) || 0;

  if (mode === "sale") {
    collectedAmount = selectedOrder.pendingBalance;
  }

  if (collectedAmount <= 0) {
    Toast.show("Please enter a collection amount greater than 0.", "error");
    return;
  }

  if (collectedAmount > selectedOrder.pendingBalance) {
    Toast.show("Collected amount cannot exceed remaining balance due.", "error");
    return;
  }

  const newAdvance = (selectedOrder.advancePaid || 0) + collectedAmount;
  const newPending = Math.max(0, (selectedOrder.grandTotal || 0) - newAdvance);

  selectedOrder.advancePaid = newAdvance;
  selectedOrder.pendingBalance = newPending;

  if (mode === "sale" || newPending === 0) {
    selectedOrder.status = "Completed";
    selectedOrder.paymentStatus = "Fully-paid";
  } else {
    selectedOrder.paymentStatus = newAdvance > 0 ? "Advance-paid" : "Unpaid";
  }

  await dbService.saveItem("orders", selectedOrder);

  // Update linked sale
  if (selectedOrder.saleId) {
    const sale = await dbService.getItem<Sale>("sales", selectedOrder.saleId);
    if (sale) {
      sale.advanceAmount = newAdvance;
      sale.pendingAmount = newPending;
      sale.status = (mode === "sale" || newPending === 0) ? "Completed" : "Pending Fulfillment";
      await dbService.saveItem("sales", sale);
    }
  }

  // Update customer balance if applicable
  if (selectedOrder.customerId && selectedOrder.customerId !== "c_walkin") {
    const customer = await dbService.getItem<Customer>("customers", selectedOrder.customerId);
    if (customer) {
      customer.outstandingBalance = Math.max(0, (customer.outstandingBalance || 0) - collectedAmount);
      await dbService.saveItem("customers", customer);
    }
  }

  // Create payment receipt
  const receipt: Partial<Receipt> = {
    receiptNumber: "OPT-REC-" + Math.floor(1000 + Math.random() * 9000),
    saleId: selectedOrder.saleId,
    orderId: selectedOrder.id,
    customerId: selectedOrder.customerId,
    customerName: selectedOrder.customerName,
    customerMobile: selectedOrder.customerMobile,
    date: new Date().toISOString().slice(0, 10),
    totalAmount: selectedOrder.grandTotal,
    advanceAmount: newAdvance,
    pendingAmount: newPending,
    paymentMethod: method as "Cash" | "UPI" | "Card",
    itemsSummary: `Payment collected for Order ${selectedOrder.orderNumber}`,
    createdAt: new Date().toISOString()
  };
  await dbService.saveItem("receipts", receipt);

  if (mode === "sale" || newPending === 0) {
    const { sale: targetSale, rx } = await getOrCreateSaleForOrder(selectedOrder, method);
    Toast.show(`Full payment of RS ${collectedAmount.toFixed(2)} received via ${method}! Order marked Completed and saved as Sale.`, "success");
    closeOrderDetailModal();
    updateOrderStats();
    renderOrders();
    showInvoiceDownloadConfirmationModal(targetSale, rx, selectedOrder);
  } else {
    Toast.show(`Collected RS ${collectedAmount.toFixed(2)} via ${method}. Order updated in Pending (Due: RS ${newPending.toFixed(2)}).`, "success");
    closeOrderDetailModal();
    updateOrderStats();
    renderOrders();
  }
}

function printLabJobCard() {
  if (!selectedOrder) return;
  printLabJobSlip(selectedOrder);
}
