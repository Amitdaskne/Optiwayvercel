/**
 * WhatsApp Integration Utility for OPTIWAY Vision Care
 * Formats clean, professional optical store messages and opens WhatsApp
 * to send Pending Orders, Sales History / Invoices, and Optical Prescriptions (Rx)
 * directly to customer mobile numbers.
 */

import { Order, Sale, Prescription, StoreSettings, ensureArray, formatDateStr } from "./db";

/**
 * Clean phone number to WhatsApp international standard (e.g. 919876543210)
 */
export function formatWhatsAppPhone(phone: string | undefined | null): string {
  if (!phone) return "";
  // Strip non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) {
    cleaned = cleaned.substring(1);
  }
  // If Indian 10-digit mobile number, prepend 91
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    cleaned = "91" + cleaned;
  }
  // If 11-digit starting with 0 (e.g. 09876543210)
  if (/^0[6-9]\d{9}$/.test(cleaned)) {
    cleaned = "91" + cleaned.substring(1);
  }
  return cleaned;
}

/**
 * Opens WhatsApp Web or WhatsApp App with encoded message
 */
export function launchWhatsApp(phone: string, message: string): void {
  const cleanNumber = formatWhatsAppPhone(phone);
  const encodedText = encodeURIComponent(message);
  let url = "";
  if (cleanNumber) {
    url = `https://wa.me/${cleanNumber}?text=${encodedText}`;
  } else {
    // If no phone number, open WhatsApp with text ready to choose contact
    url = `https://wa.me/?text=${encodedText}`;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Builds optical prescription summary string
 */
function buildRxText(rx: Prescription | any): string {
  if (!rx) return "";
  const re = rx.rightEye || { sph: "0.00", cyl: "0.00", axis: "", add: "" };
  const le = rx.leftEye || { sph: "0.00", cyl: "0.00", axis: "", add: "" };
  const pd = rx.pd ? `${rx.pd} mm` : "Standard";

  return [
    `👁️ *OPTICAL PRESCRIPTION (Rx)*`,
    `*Right Eye (OD/RE):* SPH: ${re.sph || "0.00"} | CYL: ${re.cyl || "0.00"} | AXIS: ${re.axis || "—"}° | ADD: +${re.add || "0.00"}`,
    `*Left Eye (OS/LE):* SPH: ${le.sph || "0.00"} | CYL: ${le.cyl || "0.00"} | AXIS: ${le.axis || "—"}° | ADD: +${le.add || "0.00"}`,
    `*Pupillary Distance (PD):* ${pd}`,
    rx.notes ? `*Notes:* ${rx.notes}` : ""
  ].filter(Boolean).join("\n");
}

/**
 * Generate Pending Order WhatsApp message
 */
export function generateOrderWhatsAppMessage(order: Order, storeSettings?: StoreSettings | null): string {
  const storeName = storeSettings?.storeName || localStorage.getItem("optiway_store_name") || "OPTIWAY VISION CARE";
  const storePhone = storeSettings?.phone || "+1 800-555-0199";
  const storeAddress = storeSettings?.address || "";

  const itemsList = ensureArray(order.items)
    .map(i => `• ${i.productName} (x${i.quantity}) - ₹${(i.total || (i.price * i.quantity) || 0).toFixed(2)}`)
    .join("\n");

  const rxText = order.prescriptionDetails ? `\n${buildRxText(order.prescriptionDetails)}\n` : "";

  let statusNote = "";
  if (order.status === "Ready for Pickup") {
    statusNote = `🎉 *GOOD NEWS:* Your spectacles are ready for pickup! Please visit our store at your earliest convenience.`;
  } else if (order.status === "In Progress") {
    statusNote = `🔬 *LAB STATUS:* Your optical lenses are currently being fitted in our lab with high precision. We will update you once ready.`;
  } else if (order.status === "Pending") {
    statusNote = `⏳ *ORDER STATUS:* Your order has been placed and scheduled for lab preparation.`;
  } else {
    statusNote = `✅ *ORDER STATUS:* ${order.status}`;
  }

  const lines = [
    `👓 *${storeName.toUpperCase()} - ORDER UPDATE*`,
    `----------------------------------------`,
    `Dear *${order.customerName || "Customer"}*,`,
    `Here are the details of your eyewear order:`,
    ``,
    `📋 *Order Ref:* ${order.orderNumber}`,
    `📅 *Order Date:* ${order.orderDate || formatDateStr(order.createdAt, "Today")}`,
    `📌 *Status:* ${order.status}`,
    ``,
    `🛍️ *SPECTACLE ITEMS:*`,
    itemsList || "• Eyewear Order Item",
    rxText,
    `💰 *PAYMENT SUMMARY:*`,
    `• Grand Total: ₹${(order.grandTotal || 0).toFixed(2)}`,
    `• Advance Paid: ₹${(order.advancePaid || 0).toFixed(2)}`,
    `• *Balance Due:* ₹${(order.pendingBalance || 0).toFixed(2)}`,
    ``,
    statusNote,
    ``,
    `📍 *Store Address:* ${storeAddress || "Visit our optical clinic"}`,
    `📞 *Helpline / WhatsApp:* ${storePhone}`,
    `----------------------------------------`,
    `Thank you for trusting ${storeName} with your vision care! 🙏`
  ];

  return lines.filter(l => l !== undefined).join("\n");
}

/**
 * Generate Sales History / Invoice WhatsApp message
 */
export function generateSaleWhatsAppMessage(
  sale: Sale,
  prescription?: Prescription | null,
  storeSettings?: StoreSettings | null
): string {
  const storeName = storeSettings?.storeName || localStorage.getItem("optiway_store_name") || "OPTIWAY VISION CARE";
  const storePhone = storeSettings?.phone || "+1 800-555-0199";
  const storeAddress = storeSettings?.address || "";

  const itemsList = ensureArray(sale.items)
    .map(i => `• ${i.productName} (x${i.quantity}) - ₹${(i.total || (i.price * i.quantity) || 0).toFixed(2)}`)
    .join("\n");

  const rxText = prescription ? `\n${buildRxText(prescription)}\n` : "";

  const isPending = sale.status !== "Completed" || (sale.pendingAmount || 0) > 0;
  const paymentStatusText = isPending ? `Pending (Due: ₹${(sale.pendingAmount || 0).toFixed(2)})` : "Paid in Full";

  const lines = [
    `🧾 *${storeName.toUpperCase()} - TAX INVOICE*`,
    `----------------------------------------`,
    `Dear *${sale.customerName || "Customer"}*,`,
    `Thank you for your purchase. Here is your bill summary:`,
    ``,
    `📄 *Invoice / Bill No:* ${sale.saleNumber || sale.id}`,
    `📅 *Date:* ${sale.saleDate || formatDateStr(sale.createdAt, "Today")}`,
    `💳 *Payment Mode:* ${sale.paymentMethod || "Cash"}`,
    `📌 *Payment Status:* ${paymentStatusText}`,
    ``,
    `🛍️ *PURCHASED ITEMS:*`,
    itemsList || "• Optical Goods",
    rxText,
    `💰 *BILL AMOUNT:*`,
    `• Subtotal: ₹${(sale.subtotal || 0).toFixed(2)}`,
    sale.discountTotal ? `• Discount: -₹${sale.discountTotal.toFixed(2)}` : "",
    sale.taxTotal ? `• GST / Tax: ₹${sale.taxTotal.toFixed(2)}` : "",
    `• *Net Total:* ₹${(sale.grandTotal || 0).toFixed(2)}`,
    sale.advanceAmount ? `• Amount Paid: ₹${sale.advanceAmount.toFixed(2)}` : "",
    isPending && (sale.pendingAmount || 0) > 0 ? `• *Remaining Balance Due:* ₹${(sale.pendingAmount || 0).toFixed(2)}` : "",
    ``,
    `📍 *Store Address:* ${storeAddress || "Visit our optical clinic"}`,
    `📞 *Customer Care:* ${storePhone}`,
    `----------------------------------------`,
    `Wishing you clear and comfortable vision! ✨`
  ];

  return lines.filter(Boolean).join("\n");
}

/**
 * Generate Optical Prescription WhatsApp message
 */
export function generatePrescriptionWhatsAppMessage(
  rx: Prescription,
  customerMobile?: string,
  storeSettings?: StoreSettings | null
): string {
  const storeName = storeSettings?.storeName || localStorage.getItem("optiway_store_name") || "OPTIWAY VISION CARE";
  const storePhone = storeSettings?.phone || "+1 800-555-0199";
  const storeAddress = storeSettings?.address || "";

  const re = rx.rightEye || { sph: "0.00", cyl: "0.00", axis: "", add: "" };
  const le = rx.leftEye || { sph: "0.00", cyl: "0.00", axis: "", add: "" };

  const lines = [
    `👁️ *${storeName.toUpperCase()} - OPTICAL PRESCRIPTION*`,
    `----------------------------------------`,
    `*Patient Name:* ${rx.customerName || "Valued Patient"}`,
    `*Rx Date:* ${rx.prescriptionDate || formatDateStr(rx.createdAt, "Today")}`,
    `*Pupillary Distance (PD):* ${rx.pd ? rx.pd + " mm" : "Standard"}`,
    ``,
    `*RIGHT EYE (OD / RE):*`,
    `• SPH: ${re.sph || "0.00"}`,
    `• CYL: ${re.cyl || "0.00"}`,
    `• AXIS: ${re.axis ? re.axis + "°" : "—"}`,
    `• ADD: +${re.add || "0.00"}`,
    ``,
    `*LEFT EYE (OS / LE):*`,
    `• SPH: ${le.sph || "0.00"}`,
    `• CYL: ${le.cyl || "0.00"}`,
    `• AXIS: ${le.axis ? le.axis + "°" : "—"}`,
    `• ADD: +${le.add || "0.00"}`,
    ``,
    rx.notes ? `*Clinical Notes:* ${rx.notes}\n` : "",
    `📍 *Clinic / Store:* ${storeName}`,
    storeAddress ? `📍 *Address:* ${storeAddress}` : "",
    `📞 *Consultation & Inquiries:* ${storePhone}`,
    `----------------------------------------`,
    `Please retain this prescription record for your future eyewear consultations.`
  ];

  return lines.filter(Boolean).join("\n");
}

/**
 * Universal Dialog for Confirming & Sending WhatsApp
 * Allows the user to inspect/edit the mobile number, preview the message text,
 * and open WhatsApp directly or copy message.
 */
export function showWhatsAppShareModal(options: {
  title: string;
  recipientName: string;
  recipientMobile: string;
  message: string;
  onSent?: () => void;
}): void {
  // Remove existing modal if any
  const existing = document.getElementById("optiway-whatsapp-modal");
  if (existing) existing.remove();

  const cleanInitialPhone = formatWhatsAppPhone(options.recipientMobile);

  const modalHtml = `
    <div id="optiway-whatsapp-modal" class="fixed inset-0 bg-slate-900/80 z-[9999] flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs antialiased">
      <div class="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full p-5 sm:p-6 space-y-4 border border-slate-200 shadow-2xl animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] flex flex-col">
        
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
          <div class="flex items-center gap-2.5">
            <div class="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-md shadow-emerald-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            </div>
            <div>
              <h3 class="font-extrabold text-slate-900 text-sm sm:text-base">${options.title}</h3>
              <p class="text-xs text-slate-500">Send directly to customer via WhatsApp</p>
            </div>
          </div>
          <button id="btn-wa-modal-close" class="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <!-- Scrollable Content -->
        <div class="space-y-3.5 overflow-y-auto pr-1 flex-1 text-xs">
          <!-- Recipient info input -->
          <div class="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100 space-y-2">
            <div class="flex justify-between items-center">
              <span class="text-[11px] font-bold text-emerald-900 uppercase tracking-wider">Customer Contact</span>
              <span class="text-[11px] font-semibold text-slate-600">${options.recipientName || "Walk-in Patient"}</span>
            </div>
            <div>
              <label class="block text-[11px] font-bold text-slate-700 mb-1">WhatsApp Mobile Number</label>
              <div class="relative">
                <input
                  type="text"
                  id="wa-modal-phone"
                  value="${options.recipientMobile || ""}"
                  placeholder="e.g. 9876543210 or +91 9876543210"
                  class="w-full px-3 py-2 pl-8 border border-slate-300 rounded-xl bg-white font-mono font-bold text-xs text-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                />
                <span class="absolute left-2.5 top-2.5 text-slate-400">📱</span>
              </div>
              <p class="text-[10px] text-slate-500 mt-1">Enter 10-digit mobile or international format with country code.</p>
            </div>
          </div>

          <!-- Message Preview -->
          <div class="space-y-1.5">
            <div class="flex justify-between items-center">
              <label class="font-bold text-slate-700 text-xs">Message Preview</label>
              <button id="btn-wa-copy-text" class="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 hover:underline inline-flex items-center gap-1 cursor-pointer">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                <span>Copy Text</span>
              </button>
            </div>
            <textarea
              id="wa-modal-message"
              rows="9"
              class="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 font-mono text-[11px] leading-relaxed text-slate-800 outline-none focus:bg-white focus:border-emerald-500 transition-colors"
            >${options.message}</textarea>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="border-t border-slate-100 pt-3 flex items-center gap-2 shrink-0">
          <button id="btn-wa-modal-cancel" class="py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer">
            Cancel
          </button>
          <button id="btn-wa-modal-send" class="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-extrabold text-xs rounded-xl shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span>Open & Send in WhatsApp</span>
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);

  const modalEl = document.getElementById("optiway-whatsapp-modal")!;
  const closeBtn = document.getElementById("btn-wa-modal-close")!;
  const cancelBtn = document.getElementById("btn-wa-modal-cancel")!;
  const sendBtn = document.getElementById("btn-wa-modal-send")!;
  const copyBtn = document.getElementById("btn-wa-copy-text")!;
  const phoneInput = document.getElementById("wa-modal-phone") as HTMLInputElement;
  const messageInput = document.getElementById("wa-modal-message") as HTMLTextAreaElement;

  const closeModal = () => modalEl.remove();

  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(messageInput.value);
      copyBtn.innerHTML = `<span>✓ Copied!</span>`;
      setTimeout(() => {
        copyBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          <span>Copy Text</span>
        `;
      }, 2000);
    } catch {
      messageInput.select();
      document.execCommand("copy");
    }
  });

  sendBtn.addEventListener("click", () => {
    const enteredPhone = phoneInput.value.trim();
    const finalMessage = messageInput.value.trim();
    launchWhatsApp(enteredPhone, finalMessage);
    if (options.onSent) options.onSent();
    closeModal();
  });
}

/**
 * Convenient quick triggers for Orders, Sales, and Prescriptions
 */
export function sendOrderWhatsAppPrompt(
  order: Order,
  prescriptionOrSettings?: Prescription | StoreSettings | null,
  storeSettingsParam?: StoreSettings | null
): void {
  let rx: Prescription | null = null;
  let settings: StoreSettings | null = null;

  if (prescriptionOrSettings && "storeName" in prescriptionOrSettings) {
    settings = prescriptionOrSettings as StoreSettings;
  } else if (prescriptionOrSettings) {
    rx = prescriptionOrSettings as Prescription;
    settings = storeSettingsParam || null;
  } else {
    settings = storeSettingsParam || null;
  }

  const orderWithRx: Order = {
    ...order,
    prescriptionDetails: rx || order.prescriptionDetails
  };
  const message = generateOrderWhatsAppMessage(orderWithRx, settings);
  showWhatsAppShareModal({
    title: `WhatsApp: Order ${order.orderNumber}`,
    recipientName: order.customerName || "Customer",
    recipientMobile: order.customerMobile || "",
    message
  });
}

export function sendSaleWhatsAppPrompt(
  sale: Sale,
  prescription?: Prescription | null,
  storeSettings?: StoreSettings | null
): void {
  const message = generateSaleWhatsAppMessage(sale, prescription, storeSettings);
  showWhatsAppShareModal({
    title: `WhatsApp: Invoice ${sale.saleNumber || sale.id}`,
    recipientName: sale.customerName || "Customer",
    recipientMobile: sale.customerMobile || "",
    message
  });
}

export function sendPrescriptionWhatsAppPrompt(
  rx: Prescription,
  customerMobile?: string,
  storeSettings?: StoreSettings | null
): void {
  const message = generatePrescriptionWhatsAppMessage(rx, customerMobile, storeSettings);
  showWhatsAppShareModal({
    title: `WhatsApp: Rx for ${rx.customerName || "Patient"}`,
    recipientName: rx.customerName || "Patient",
    recipientMobile: customerMobile || "",
    message
  });
}
