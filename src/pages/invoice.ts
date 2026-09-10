import { initAuthGuard } from "../lib/auth";
import { renderAppLayout, Toast } from "../components/layout";
import { dbService, Sale, SaleItem, Order, Customer, Prescription, StoreSettings, Receipt, ensureArray } from "../lib/db";
import { downloadInvoicePDF, printInvoiceDirect, printThermalReceiptDirect } from "../lib/exportUtils";
import { sendSaleWhatsAppPrompt } from "../lib/whatsapp";

let salesList: Sale[] = [];
let currentSale: Sale | null = null;
let currentPrescription: Prescription | null = null;
let storeSettings: StoreSettings | null = null;

initAuthGuard({
  onUserReady: async (user) => {
    renderAppLayout("invoice", "Invoice & Billing Terminal", user);
    await loadInvoiceData();
  }
});

async function loadInvoiceData() {
  try {
    storeSettings = await dbService.getSettings();
    salesList = await dbService.getList<Sale>("sales");

    // Sort sales newest first
    salesList.sort((a, b) => new Date(b.saleDate || b.createdAt).getTime() - new Date(a.saleDate || a.createdAt).getTime());

    populateSaleSelect();

    // Check query params e.g. invoice.html?saleId=123
    const urlParams = new URLSearchParams(window.location.search);
    const saleIdParam = urlParams.get("saleId");

    if (saleIdParam) {
      currentSale = salesList.find(s => s.id === saleIdParam || s.saleNumber === saleIdParam) || salesList[0] || null;
    } else if (salesList.length > 0) {
      currentSale = salesList[0];
    }

    if (currentSale) {
      (document.getElementById("select-sale-lookup") as HTMLSelectElement).value = currentSale.id;
      await renderInvoice(currentSale);
    }

    setupEvents();
  } catch (err) {
    console.error("Failed to load invoice details:", err);
    Toast.show("Failed to load invoice details.", "error");
  }
}

function populateSaleSelect() {
  const select = document.getElementById("select-sale-lookup") as HTMLSelectElement;
  if (salesList.length === 0) {
    select.innerHTML = `<option value="">No sales / invoices recorded</option>`;
    return;
  }

  select.innerHTML = salesList.map(s => {
    const isPending = (s.pendingAmount || 0) > 0 || s.status === "Pending Fulfillment";
    const statusLabel = isPending ? `[Due: RS ${(s.pendingAmount || 0).toFixed(2)}]` : `[Paid Full]`;
    return `
      <option value="${s.id}">${s.saleNumber} — ${s.customerName} ${statusLabel}</option>
    `;
  }).join("");
}

async function renderInvoice(sale: Sale) {
  // Store info
  if (storeSettings) {
    document.getElementById("inv-store-name")!.innerText = storeSettings.storeName || "OPTIWAY VISION CARE";
    document.getElementById("inv-store-address")!.innerText = storeSettings.address || "742 Vision Avenue, Suite 100, NY";
    document.getElementById("inv-store-contact")!.innerText = `Phone: ${storeSettings.phone || "+1 800-555-0199"} | Email: ${storeSettings.email || "contact@optiway.com"}`;
  }

  // Invoice headers
  document.getElementById("inv-number")!.innerText = (sale.saleNumber || "OPT-SL-0000").replace("OPT-SL-", "OPT-INV-");
  document.getElementById("inv-date")!.innerText = sale.saleDate || sale.createdAt?.slice(0, 10) || "—";

  // Customer Details
  document.getElementById("inv-cust-name")!.innerText = sale.customerName || "Walk-in Customer";
  document.getElementById("inv-cust-phone")!.innerText = sale.customerMobile || "No mobile";
  document.getElementById("inv-cust-address")!.innerText = sale.customerAddress || "Walk-in";

  // Transaction details
  document.getElementById("inv-sale-ref")!.innerText = sale.saleNumber || "—";
  document.getElementById("inv-pay-method")!.innerText = sale.paymentMethod || "Cash";
  
  const statusEl = document.getElementById("inv-status")!;
  const isPending = (sale.pendingAmount || 0) > 0 || sale.status === "Pending Fulfillment";

  if (isPending) {
    statusEl.innerText = `Pending (Due: RS ${(sale.pendingAmount || 0).toFixed(2)})`;
    statusEl.className = "text-amber-700 font-extrabold";
  } else {
    statusEl.innerText = "Completed (Fully Paid)";
    statusEl.className = "text-emerald-700 font-extrabold";
  }

  // Prescription Box
  const rxBox = document.getElementById("inv-rx-box")!;
  currentPrescription = null;
  if (sale.prescriptionId) {
    const rx = await dbService.getItem<Prescription>("prescriptions", sale.prescriptionId);
    if (rx) {
      currentPrescription = rx;
      document.getElementById("inv-rx-od")!.innerText = `SPH: ${rx.rightEye?.sph || "0.00"}, CYL: ${rx.rightEye?.cyl || "0.00"}, AXIS: ${rx.rightEye?.axis || "—"}°, ADD: +${rx.rightEye?.add || "0.00"}`;
      document.getElementById("inv-rx-os")!.innerText = `SPH: ${rx.leftEye?.sph || "0.00"}, CYL: ${rx.leftEye?.cyl || "0.00"}, AXIS: ${rx.leftEye?.axis || "—"}°, ADD: +${rx.leftEye?.add || "0.00"}`;
      document.getElementById("inv-rx-pd")!.innerText = `${rx.pd ? rx.pd + " mm" : "N/A"}`;
      rxBox.classList.remove("hidden");
    } else {
      rxBox.classList.add("hidden");
    }
  } else {
    rxBox.classList.add("hidden");
  }

  // Items table
  const tbody = document.getElementById("tbl-inv-items")!;
  tbody.innerHTML = ensureArray(sale.items).map(i => `
    <tr class="hover:bg-slate-50 transition-colors">
      <td class="p-3">
        <span class="font-bold text-slate-900 block">${i.productName || "Item"}</span>
        ${i.lensDetails || i.prescriptionText ? `
          <span class="text-[11px] font-mono text-blue-800 bg-blue-50/90 px-2 py-0.5 rounded border border-blue-200 inline-block mt-1 font-semibold">
            Rx: ${i.lensDetails || i.prescriptionText}
          </span>
        ` : ""}
      </td>
      <td class="p-3 text-center font-bold text-slate-800">${i.quantity}</td>
      <td class="p-3 text-right text-slate-700">RS ${(i.price || 0).toFixed(2)}</td>
      <td class="p-3 text-right text-rose-600">${i.discount ? `-RS ${i.discount.toFixed(2)}` : "—"}</td>
      <td class="p-3 text-right font-bold text-slate-900">RS ${(i.total || 0).toFixed(2)}</td>
    </tr>
  `).join("");

  // Totals
  const hasTax = (sale.taxTotal || 0) > 0 || sale.taxType === "with_tax";
  const taxRate = sale.taxRate ?? storeSettings?.taxRate ?? 18;

  const taxBadge = document.getElementById("inv-tax-badge");
  const taxLabel = document.getElementById("inv-tax-label");

  if (taxBadge) {
    if (hasTax) {
      taxBadge.innerText = `TAX INVOICE (${taxRate}% GST)`;
      taxBadge.className = "text-xs font-black uppercase text-blue-600 bg-blue-50 px-3 py-1 rounded border border-blue-200 block mb-2";
    } else {
      taxBadge.innerText = "RETAIL INVOICE / BILL OF SUPPLY";
      taxBadge.className = "text-xs font-black uppercase text-slate-700 bg-slate-100 px-3 py-1 rounded border border-slate-300 block mb-2";
    }
  }

  if (taxLabel) {
    taxLabel.innerText = hasTax ? `Sales Tax (GST ${taxRate}%):` : "Tax (Non-GST / Exempt):";
  }

  document.getElementById("inv-subtotal")!.innerText = `RS ${(sale.subtotal || 0).toFixed(2)}`;
  document.getElementById("inv-discount")!.innerText = `-RS ${(sale.discountTotal || 0).toFixed(2)}`;
  document.getElementById("inv-tax")!.innerText = hasTax ? `RS ${(sale.taxTotal || 0).toFixed(2)}` : "RS 0.00 (Exempt)";
  document.getElementById("inv-grand-total")!.innerText = `RS ${(sale.grandTotal || 0).toFixed(2)}`;
  document.getElementById("inv-advance")!.innerText = `RS ${(sale.advanceAmount || 0).toFixed(2)}`;
  document.getElementById("inv-pending")!.innerText = `RS ${(sale.pendingAmount || 0).toFixed(2)}`;

  // Configure Balance Collection Terminal
  const panel = document.getElementById("panel-collect-balance")!;
  const fullyPaidBanner = document.getElementById("banner-fully-paid")!;

  if (isPending) {
    panel.classList.remove("hidden");
    fullyPaidBanner.classList.add("hidden");

    document.getElementById("terminal-grand-total")!.innerText = `RS ${(sale.grandTotal || 0).toFixed(2)}`;
    document.getElementById("terminal-advance-paid")!.innerText = `RS ${(sale.advanceAmount || 0).toFixed(2)}`;
    document.getElementById("terminal-pending-due")!.innerText = `RS ${(sale.pendingAmount || 0).toFixed(2)}`;

    const collectInput = document.getElementById("input-terminal-collect-amount") as HTMLInputElement;
    if (collectInput) {
      collectInput.value = (sale.pendingAmount || 0).toFixed(2);
      collectInput.max = String(sale.pendingAmount || 0);
    }
  } else {
    panel.classList.add("hidden");
    fullyPaidBanner.classList.remove("hidden");
  }
}

function setupEvents() {
  const select = document.getElementById("select-sale-lookup") as HTMLSelectElement;
  select?.addEventListener("change", () => {
    const id = select.value;
    const match = salesList.find(s => s.id === id);
    if (match) {
      currentSale = match;
      renderInvoice(currentSale);
    }
  });

  // WhatsApp Share Invoice
  document.getElementById("btn-whatsapp-invoice")?.addEventListener("click", () => {
    if (!currentSale) {
      Toast.show("No invoice loaded to share on WhatsApp", "error");
      return;
    }
    sendSaleWhatsAppPrompt(currentSale, currentPrescription, storeSettings);
  });

  // Direct A4 Print Invoice
  document.getElementById("btn-print-invoice")?.addEventListener("click", () => {
    if (!currentSale) {
      Toast.show("No invoice loaded to print", "error");
      return;
    }
    const printed = printInvoiceDirect(currentSale, currentPrescription, storeSettings);
    if (!printed) {
      window.print();
    }
  });

  // Download PDF Invoice
  document.getElementById("btn-download-pdf-invoice")?.addEventListener("click", async () => {
    if (!currentSale) {
      Toast.show("No invoice loaded to download", "error");
      return;
    }
    try {
      await downloadInvoicePDF(currentSale, currentPrescription, storeSettings);
      Toast.show("Tax Invoice PDF downloaded successfully!", "success");
    } catch (e: any) {
      console.error("PDF generation failed:", e);
      Toast.show("Failed to generate PDF: " + (e?.message || "Unknown error"), "error");
    }
  });

  // 80mm Thermal Receipt Print
  document.getElementById("btn-print-thermal-receipt")?.addEventListener("click", () => {
    if (!currentSale) {
      Toast.show("No invoice loaded to print receipt", "error");
      return;
    }
    printThermalReceiptDirect(currentSale, storeSettings);
  });

  // Setup Add Lens to Invoice Modal
  setupAddLensModalEvents();

  // Terminal Set Full Due Shortcut
  document.getElementById("btn-terminal-set-full")?.addEventListener("click", () => {
    if (!currentSale) return;
    const collectInput = document.getElementById("input-terminal-collect-amount") as HTMLInputElement;
    if (collectInput) collectInput.value = (currentSale.pendingAmount || 0).toFixed(2);
  });

  // 1. SAVE TO PENDING (Partial amount collected or keeping as pending)
  document.getElementById("btn-terminal-save-pending")?.addEventListener("click", async () => {
    if (!currentSale) return;

    const collectInput = document.getElementById("input-terminal-collect-amount") as HTMLInputElement;
    const amountToCollect = parseFloat(collectInput.value) || 0;
    const method = (document.getElementById("select-terminal-method") as HTMLSelectElement).value as "Cash" | "UPI" | "Card";
    const notes = (document.getElementById("input-terminal-notes") as HTMLInputElement).value.trim();

    if (amountToCollect <= 0) {
      Toast.show("Please enter a valid collection amount greater than 0.", "error");
      return;
    }

    if (amountToCollect > (currentSale.pendingAmount || 0)) {
      Toast.show("Amount to collect cannot exceed remaining balance due.", "error");
      return;
    }

    const newAdvance = (currentSale.advanceAmount || 0) + amountToCollect;
    const newPending = Math.max(0, (currentSale.grandTotal || 0) - newAdvance);

    currentSale.advanceAmount = newAdvance;
    currentSale.pendingAmount = newPending;
    currentSale.status = newPending === 0 ? "Completed" : "Pending Fulfillment";

    await dbService.saveItem("sales", currentSale);

    // Synchronize linked Order
    await syncLinkedOrder(currentSale, amountToCollect, false);

    // Update Customer outstanding balance
    if (currentSale.customerId && currentSale.customerId !== "c_walkin") {
      const customer = await dbService.getItem<Customer>("customers", currentSale.customerId);
      if (customer) {
        customer.outstandingBalance = Math.max(0, (customer.outstandingBalance || 0) - amountToCollect);
        await dbService.saveItem("customers", customer);
      }
    }

    // Save payment receipt
    const receipt: Partial<Receipt> = {
      receiptNumber: "OPT-REC-" + Math.floor(1000 + Math.random() * 9000),
      saleId: currentSale.id,
      customerId: currentSale.customerId,
      customerName: currentSale.customerName,
      customerMobile: currentSale.customerMobile,
      date: new Date().toISOString().slice(0, 10),
      totalAmount: currentSale.grandTotal,
      advanceAmount: newAdvance,
      pendingAmount: newPending,
      paymentMethod: method,
      itemsSummary: `Payment collected for ${currentSale.saleNumber} (${notes || "Partial Balance"})`,
      createdAt: new Date().toISOString()
    };
    await dbService.saveItem("receipts", receipt);

    Toast.show(`Collected RS ${amountToCollect.toFixed(2)} (${method}). Saved to Pending Orders! (Remaining Due: RS ${newPending.toFixed(2)})`, "success");
    populateSaleSelect();
    select.value = currentSale.id;
    await renderInvoice(currentSale);
  });

  // 2. SETTLE & SAVE AS SALE (Full payment settled)
  document.getElementById("btn-terminal-save-sale")?.addEventListener("click", async () => {
    if (!currentSale) return;

    const remainingDue = currentSale.pendingAmount || 0;
    const method = (document.getElementById("select-terminal-method") as HTMLSelectElement).value as "Cash" | "UPI" | "Card";
    const notes = (document.getElementById("input-terminal-notes") as HTMLInputElement).value.trim();

    currentSale.advanceAmount = currentSale.grandTotal;
    currentSale.pendingAmount = 0;
    currentSale.status = "Completed";

    await dbService.saveItem("sales", currentSale);

    // Synchronize linked Order to completed
    await syncLinkedOrder(currentSale, remainingDue, true);

    // Update Customer outstanding balance
    if (currentSale.customerId && currentSale.customerId !== "c_walkin") {
      const customer = await dbService.getItem<Customer>("customers", currentSale.customerId);
      if (customer) {
        customer.outstandingBalance = Math.max(0, (customer.outstandingBalance || 0) - remainingDue);
        await dbService.saveItem("customers", customer);
      }
    }

    // Save payment receipt
    const receipt: Partial<Receipt> = {
      receiptNumber: "OPT-REC-" + Math.floor(1000 + Math.random() * 9000),
      saleId: currentSale.id,
      customerId: currentSale.customerId,
      customerName: currentSale.customerName,
      customerMobile: currentSale.customerMobile,
      date: new Date().toISOString().slice(0, 10),
      totalAmount: currentSale.grandTotal,
      advanceAmount: currentSale.grandTotal,
      pendingAmount: 0,
      paymentMethod: method,
      itemsSummary: `Full settlement for ${currentSale.saleNumber} (${notes || "Completed Sale"})`,
      createdAt: new Date().toISOString()
    };
    await dbService.saveItem("receipts", receipt);

    Toast.show(`Full balance settled! Bill ${currentSale.saleNumber} finalized and saved as Sale!`, "success");
    populateSaleSelect();
    select.value = currentSale.id;
    await renderInvoice(currentSale);
  });
}

async function syncLinkedOrder(sale: Sale, amountCollected: number, markCompleted: boolean) {
  try {
    const orders = await dbService.getList<Order>("orders");
    const linkedOrder = orders.find(o => o.saleId === sale.id || o.orderNumber === sale.saleNumber);

    if (linkedOrder) {
      linkedOrder.advancePaid = (linkedOrder.advancePaid || 0) + amountCollected;
      linkedOrder.pendingBalance = Math.max(0, (linkedOrder.grandTotal || 0) - linkedOrder.advancePaid);
      
      if (markCompleted || linkedOrder.pendingBalance === 0) {
        linkedOrder.status = "Completed";
        linkedOrder.paymentStatus = "Fully-paid";
      } else {
        linkedOrder.paymentStatus = linkedOrder.advancePaid > 0 ? "Advance-paid" : "Unpaid";
      }

      await dbService.saveItem("orders", linkedOrder);
    }
  } catch (err) {
    console.error("Failed to sync linked order:", err);
  }
}

function setupAddLensModalEvents() {
  const modal = document.getElementById("modal-add-lens-invoice") as HTMLElement;
  const openBtn = document.getElementById("btn-open-add-lens-modal");
  const closeBtn = document.getElementById("btn-close-lens-modal");
  const cancelBtn = document.getElementById("btn-cancel-lens-modal");
  const saveBtn = document.getElementById("btn-save-lens-invoice");

  const lensNameInput = document.getElementById("inv-modal-lens-name") as HTMLInputElement;
  const lensPriceInput = document.getElementById("inv-modal-lens-price") as HTMLInputElement;

  const odSph = document.getElementById("inv-modal-od-sph") as HTMLInputElement;
  const odCyl = document.getElementById("inv-modal-od-cyl") as HTMLInputElement;
  const odAxis = document.getElementById("inv-modal-od-axis") as HTMLInputElement;
  const odAdd = document.getElementById("inv-modal-od-add") as HTMLInputElement;
  const odVa = document.getElementById("inv-modal-od-va") as HTMLInputElement;

  const osSph = document.getElementById("inv-modal-os-sph") as HTMLInputElement;
  const osCyl = document.getElementById("inv-modal-os-cyl") as HTMLInputElement;
  const osAxis = document.getElementById("inv-modal-os-axis") as HTMLInputElement;
  const osAdd = document.getElementById("inv-modal-os-add") as HTMLInputElement;
  const osVa = document.getElementById("inv-modal-os-va") as HTMLInputElement;

  const pdInput = document.getElementById("inv-modal-pd") as HTMLInputElement;
  const notesInput = document.getElementById("inv-modal-notes") as HTMLInputElement;

  const formatRxSummary = () => {
    const odS = odSph?.value || "0.00";
    const odC = odCyl?.value || "0.00";
    const odAx = odAxis?.value ? ` Ax:${odAxis.value}°` : "";
    const odAd = odAdd?.value ? ` Add:+${odAdd.value}` : "";

    const osS = osSph?.value || "0.00";
    const osC = osCyl?.value || "0.00";
    const osAx = osAxis?.value ? ` Ax:${osAxis.value}°` : "";
    const osAd = osAdd?.value ? ` Add:+${osAdd.value}` : "";

    const pd = pdInput?.value ? ` | PD: ${pdInput.value}mm` : "";
    return `OD: SPH ${odS} CYL ${odC}${odAx}${odAd} | OS: SPH ${osS} CYL ${osC}${osAx}${osAd}${pd}`;
  };

  // Modal Copy OD -> OS
  document.getElementById("inv-modal-btn-copy-od")?.addEventListener("click", () => {
    if (osSph && odSph) osSph.value = odSph.value;
    if (osCyl && odCyl) osCyl.value = odCyl.value;
    if (osAxis && odAxis) osAxis.value = odAxis.value;
    if (osAdd && odAdd) osAdd.value = odAdd.value;
    if (osVa && odVa) osVa.value = odVa.value;
    Toast.show("Copied Right Eye (OD) parameters to Left Eye (OS).", "info");
  });

  // Modal Quick Presets
  document.querySelectorAll(".inv-btn-rx-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      const addVal = btn.getAttribute("data-add") || "+2.00";
      if (odAdd) odAdd.value = addVal.replace("+", "");
      if (osAdd) osAdd.value = addVal.replace("+", "");
      Toast.show(`Set Near Addition to ${addVal}`, "info");
    });
  });

  // Modal Clear
  document.getElementById("inv-btn-clear-rx")?.addEventListener("click", () => {
    [odSph, odCyl, odAxis, odAdd, odVa, osSph, osCyl, osAxis, osAdd, osVa, pdInput, notesInput].forEach(el => {
      if (el) el.value = "";
    });
    Toast.show("Prescription modal form cleared.", "info");
  });

  openBtn?.addEventListener("click", async () => {
    if (!currentSale) {
      Toast.show("Please select an invoice first.", "error");
      return;
    }

    // Reset inputs
    if (lensNameInput) lensNameInput.value = "";
    if (lensPriceInput) lensPriceInput.value = "";
    if (notesInput) notesInput.value = "";

    // If invoice already has a prescription, prefill
    if (currentSale.prescriptionId) {
      try {
        const rx = await dbService.getItem<Prescription>("prescriptions", currentSale.prescriptionId);
        if (rx) {
          if (odSph) odSph.value = rx.rightEye?.sph || "";
          if (odCyl) odCyl.value = rx.rightEye?.cyl || "";
          if (odAxis) odAxis.value = rx.rightEye?.axis || "";
          if (odAdd) odAdd.value = rx.rightEye?.add || "";

          if (osSph) osSph.value = rx.leftEye?.sph || "";
          if (osCyl) osCyl.value = rx.leftEye?.cyl || "";
          if (osAxis) osAxis.value = rx.leftEye?.axis || "";
          if (osAdd) osAdd.value = rx.leftEye?.add || "";

          if (pdInput) pdInput.value = rx.pd || "";
          if (notesInput) notesInput.value = rx.notes || "";
        }
      } catch (err) {
        console.error("Error pre-filling rx in modal:", err);
      }
    } else {
      if (odSph) odSph.value = "";
      if (odCyl) odCyl.value = "";
      if (odAxis) odAxis.value = "";
      if (odAdd) odAdd.value = "";
      if (odVa) odVa.value = "";
      if (osSph) osSph.value = "";
      if (osCyl) osCyl.value = "";
      if (osAxis) osAxis.value = "";
      if (osAdd) osAdd.value = "";
      if (osVa) osVa.value = "";
      if (pdInput) pdInput.value = "";
    }

    modal.classList.remove("hidden");
  });

  const closeModal = () => {
    modal.classList.add("hidden");
  };

  closeBtn?.addEventListener("click", closeModal);
  cancelBtn?.addEventListener("click", closeModal);

  saveBtn?.addEventListener("click", async () => {
    if (!currentSale) return;

    const lensName = lensNameInput?.value.trim() || "Single Vision Optical Lens";
    const priceVal = parseFloat(lensPriceInput?.value) || 0;

    if (priceVal <= 0) {
      Toast.show("Please enter a valid price for the lens.", "error");
      lensPriceInput?.focus();
      return;
    }

    const rxSummary = formatRxSummary();

    // 1. Create or Update Prescription
    let rxId = currentSale.prescriptionId;
    const hasRxDetails = odSph?.value || odCyl?.value || osSph?.value || osCyl?.value || pdInput?.value;

    if (hasRxDetails) {
      const rxObj: Prescription = {
        id: rxId || "rx_" + Math.random().toString(36).substring(2, 9),
        customerId: currentSale.customerId || "c_walkin",
        customerName: currentSale.customerName,
        saleId: currentSale.id,
        prescriptionDate: new Date().toISOString().slice(0, 10),
        rightEye: {
          sph: odSph?.value || "0.00",
          cyl: odCyl?.value || "0.00",
          axis: odAxis?.value || "0",
          add: odAdd?.value || "0.00"
        },
        leftEye: {
          sph: osSph?.value || "0.00",
          cyl: osCyl?.value || "0.00",
          axis: osAxis?.value || "0",
          add: osAdd?.value || "0.00"
        },
        pd: pdInput?.value || "",
        notes: notesInput?.value || rxSummary,
        createdAt: new Date().toISOString()
      };

      await dbService.saveItem("prescriptions", rxObj);
      rxId = rxObj.id;
      currentSale.prescriptionId = rxId;
    }

    // 2. Append Custom Lens Item to Sale
    const newLensItem: SaleItem = {
      productId: "lens_" + Math.random().toString(36).substring(2, 9),
      productName: `Lens: ${lensName}`,
      category: "Lens",
      quantity: 1,
      price: priceVal,
      discount: 0,
      total: priceVal,
      lensDetails: rxSummary,
      prescriptionText: rxSummary,
      isCustomLens: true
    };

    currentSale.items = ensureArray(currentSale.items);
    currentSale.items.push(newLensItem);

    // 3. Recalculate Sale Financials
    const subtotal = currentSale.items.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0);
    const discountTotal = currentSale.items.reduce((sum, item) => sum + (item.discount || 0) * (item.quantity || 1), 0);
    const taxRate = storeSettings?.taxRate || 0;
    const taxableAmount = Math.max(0, subtotal - discountTotal);
    const taxTotal = (taxableAmount * taxRate) / 100;
    const grandTotal = taxableAmount + taxTotal;

    const oldGrandTotal = currentSale.grandTotal || 0;
    const addedAmount = grandTotal - oldGrandTotal;

    currentSale.subtotal = subtotal;
    currentSale.discountTotal = discountTotal;
    currentSale.taxTotal = taxTotal;
    currentSale.grandTotal = grandTotal;
    currentSale.pendingAmount = Math.max(0, grandTotal - (currentSale.advanceAmount || 0));

    if (currentSale.pendingAmount > 0) {
      currentSale.status = "Pending Fulfillment";
    }

    await dbService.saveItem("sales", currentSale);

    // 4. Update linked Order if exists
    try {
      const orders = await dbService.getList<Order>("orders");
      const linkedOrder = orders.find(o => o.saleId === currentSale!.id || o.orderNumber === currentSale!.saleNumber);
      if (linkedOrder) {
        linkedOrder.items = currentSale.items;
        linkedOrder.grandTotal = currentSale.grandTotal;
        linkedOrder.pendingBalance = currentSale.pendingAmount;
        if (currentSale.pendingAmount > 0) {
          linkedOrder.status = "Pending";
          linkedOrder.paymentStatus = (linkedOrder.advancePaid || 0) > 0 ? "Advance-paid" : "Unpaid";
        }
        await dbService.saveItem("orders", linkedOrder);
      }
    } catch (err) {
      console.error("Failed to update linked order:", err);
    }

    // 5. Update Customer outstanding balance if applicable
    if (currentSale.customerId && currentSale.customerId !== "c_walkin") {
      try {
        const customer = await dbService.getItem<Customer>("customers", currentSale.customerId);
        if (customer) {
          customer.outstandingBalance = (customer.outstandingBalance || 0) + addedAmount;
          await dbService.saveItem("customers", customer);
        }
      } catch (err) {
        console.error("Failed to update customer balance:", err);
      }
    }

    closeModal();
    Toast.show(`Added ${newLensItem.productName} (RS ${priceVal.toFixed(2)}) with Prescription to Invoice!`, "success");

    // Refresh UI
    populateSaleSelect();
    const select = document.getElementById("select-sale-lookup") as HTMLSelectElement;
    if (select) select.value = currentSale.id;
    await renderInvoice(currentSale);
  });
}
