import * as XLSX from "xlsx";
import { dbService, Product, PendingProduct, Supplier, PurchaseBill, PurchaseBillItem, InventoryMovement, Expense, generateUniqueSupplierLedgerId, validateSupplierLedgerId } from "./db";
import { Toast } from "../components/layout";
import { BarcodePrinter, Sticker79x10Item } from "./barcodePrinter";
import { getGeminiApiKey, validateGeminiApiKey } from "../../api/_apiKey";

export interface ScanBillResult {
  supplierName?: string;
  supplierLedgerId?: string;
  supplierPhone?: string;
  supplierEmail?: string;
  supplierTaxId?: string;
  supplierAddress?: string;
  billNumber?: string;
  billDate?: string;
  dueDate?: string;
  paymentStatus?: "Paid" | "Unpaid" | "Partial";
  paymentMethod?: string;
  subtotal?: number;
  taxRate?: number;
  taxTotal?: number;
  discountTotal?: number;
  grandTotal?: number;
  items?: PurchaseBillItem[];
  notes?: string;
}

export interface PurchaseBillScannerOptions {
  onSuccess?: (bill: PurchaseBill) => void;
  defaultDestination?: "live" | "pending";
  initialTab?: "file" | "camera" | "paste" | "excel" | "sample";
}

export class PurchaseBillScanner {
  private static modalId = "modal-purchase-bill-scanner";
  private static activeStream: MediaStream | null = null;
  private static currentFileData: { base64: string; mimeType: string; fileName: string; previewUrl: string; isExcel?: boolean; excelSheetName?: string } | null = null;
  private static extractedData: ScanBillResult | null = null;
  private static currentItems: PurchaseBillItem[] = [];
  private static onCompleteCallback: ((bill: PurchaseBill) => void) | null = null;
  private static defaultDest: "live" | "pending" = "live";
  private static currentFacingMode: "environment" | "user" = "environment";
  private static registeredSuppliers: Supplier[] = [];
  private static storeName = "OPTIWAY OPTICAL";
  private static modalCatFilter = "all";
  private static modalSearchQuery = "";
  private static requestedInitialTab: "file" | "camera" | "paste" | "excel" | "sample" = "file";

  /**
   * Generates a standard unique 12-13 digit optical barcode (EAN-13 style)
   */
  public static generateAutoBarcode(): string {
    return `890${Math.floor(100000000 + Math.random() * 900000000)}`;
  }

  /**
   * Opens the Purchase Bill Scanner & Direct Verification Modal
   */
  public static async openModal(options?: PurchaseBillScannerOptions) {
    this.onCompleteCallback = options?.onSuccess || null;
    this.defaultDest = options?.defaultDestination || "live";
    this.requestedInitialTab = options?.initialTab || "file";
    this.currentFileData = null;
    this.extractedData = null;
    this.currentItems = [];
    this.modalCatFilter = "all";
    this.modalSearchQuery = "";

    try {
      this.registeredSuppliers = await dbService.getList<Supplier>("suppliers");
      const settings = await dbService.getSettings();
      if (settings?.storeName) this.storeName = settings.storeName;
    } catch (e) {
      console.warn("Failed to fetch initial suppliers:", e);
    }

    this.renderModalContainer();
    this.showIntakeStep();
    
    const modal = document.getElementById(this.modalId);
    if (modal) {
      modal.classList.remove("hidden");
    }
  }

  /**
   * Closes the scanner modal and stops any active camera stream
   */
  public static closeModal() {
    this.stopCameraStream();
    const modal = document.getElementById(this.modalId);
    if (modal) {
      modal.classList.add("hidden");
    }
    this.currentFileData = null;
    this.extractedData = null;
    this.currentItems = [];
  }

  private static stopCameraStream() {
    if (this.activeStream) {
      this.activeStream.getTracks().forEach(track => track.stop());
      this.activeStream = null;
    }
  }

  private static renderModalContainer() {
    let modal = document.getElementById(this.modalId);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = this.modalId;
      modal.className = "fixed inset-0 bg-slate-900/80 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4 overflow-y-auto hidden";
      document.body.appendChild(modal);
    }
  }

  /**
   * Step 1: Intake Screen (File Upload / Camera / Sample Bills)
   */
  private static showIntakeStep() {
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    modal.innerHTML = `
      <div class="bg-white rounded-2xl max-w-2xl w-full p-4 sm:p-6 space-y-5 border border-slate-200 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-2xs">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
            </div>
            <div>
              <h3 class="font-bold text-slate-900 text-base">Direct Purchase Bill Scanner</h3>
              <p class="text-xs text-slate-500">Scan or upload supplier invoices (PDF, JPG, PNG) with instant verification</p>
            </div>
          </div>
          <button id="btn-scanner-close" class="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer text-lg leading-none">✕</button>
        </div>

        <!-- Mode Selector Tabs -->
        <div class="flex border-b border-slate-200 gap-1 bg-slate-50 p-1 rounded-xl overflow-x-auto">
          <button id="tab-intake-file" class="flex-1 min-w-[100px] py-2 px-2.5 text-xs font-bold rounded-lg transition-colors bg-white text-blue-600 shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
            </svg>
            <span>Upload Bill</span>
          </button>
          <button id="tab-intake-excel" class="flex-1 min-w-[110px] py-2 px-2.5 text-xs font-bold rounded-lg transition-colors text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1.5 cursor-pointer">
            <svg class="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            <span>Excel / CSV</span>
          </button>
          <button id="tab-intake-camera" class="flex-1 min-w-[90px] py-2 px-2.5 text-xs font-bold rounded-lg transition-colors text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1.5 cursor-pointer">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
            </svg>
            <span>Camera</span>
          </button>
          <button id="tab-intake-paste" class="flex-1 min-w-[120px] py-2 px-2.5 text-xs font-bold rounded-lg transition-colors text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1.5 cursor-pointer">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
            </svg>
            <span>Paste Text</span>
          </button>
          <button id="tab-intake-sample" class="flex-1 min-w-[100px] py-2 px-2.5 text-xs font-bold rounded-lg transition-colors text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1.5 cursor-pointer">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
            </svg>
            <span>Sample Bills</span>
          </button>
        </div>

        <!-- Content Area: Upload Tab -->
        <div id="content-intake-file" class="space-y-4">
          <div id="drop-zone-bill" class="border-2 border-dashed border-slate-300 hover:border-blue-500 bg-slate-50/70 hover:bg-blue-50/40 rounded-2xl p-8 text-center transition-colors cursor-pointer space-y-3">
            <input type="file" id="file-input-bill" accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv,application/pdf,image/*" class="hidden" />
            <div class="w-14 h-14 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto shadow-2xs">
              <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
              </svg>
            </div>
            <div>
              <p class="font-bold text-slate-800 text-sm">Click to choose or drag & drop purchase bill</p>
              <p class="text-xs text-slate-500 mt-1">Supports PDF documents, Excel (.xlsx/.csv), and JPG / PNG images</p>
            </div>
            <div class="flex items-center justify-center gap-2 pt-1 flex-wrap">
              <span class="px-2.5 py-0.5 text-[10px] font-bold rounded-md bg-rose-100 text-rose-800 font-mono">PDF</span>
              <span class="px-2.5 py-0.5 text-[10px] font-bold rounded-md bg-emerald-100 text-emerald-800 font-mono">XLSX / CSV</span>
              <span class="px-2.5 py-0.5 text-[10px] font-bold rounded-md bg-blue-100 text-blue-800 font-mono">JPG / JPEG</span>
              <span class="px-2.5 py-0.5 text-[10px] font-bold rounded-md bg-purple-100 text-purple-800 font-mono">PNG / WEBP</span>
            </div>
          </div>

          <div id="file-selected-badge" class="hidden p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0" id="file-ext-icon">
                PDF
              </div>
              <div class="min-w-0">
                <p id="file-name-text" class="text-xs font-bold text-blue-950 truncate">supplier_invoice.pdf</p>
                <p id="file-size-text" class="text-[11px] text-blue-700">1.2 MB</p>
              </div>
            </div>
            <button id="btn-start-scan-file" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer">
              <span>Scan & Extract</span>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path>
              </svg>
            </button>
          </div>
        </div>

        <!-- Content Area: Excel Tab -->
        <div id="content-intake-excel" class="hidden space-y-4">
          <div id="drop-zone-excel" class="border-2 border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/40 hover:bg-emerald-50/70 rounded-2xl p-8 text-center transition-colors cursor-pointer space-y-3">
            <input type="file" id="file-input-excel" accept=".xlsx,.xls,.csv" class="hidden" />
            <div class="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto shadow-2xs">
              <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
            </div>
            <div>
              <p class="font-bold text-slate-800 text-sm">Upload Supplier Excel (.xlsx) or CSV Sheet</p>
              <p class="text-xs text-slate-500 mt-1">Automatically extracts products, quantities, tax amount, and pricing</p>
            </div>
            <div class="flex items-center justify-center gap-2 pt-1">
              <span class="px-2.5 py-0.5 text-[10px] font-bold rounded-md bg-emerald-100 text-emerald-800 font-mono">.XLSX</span>
              <span class="px-2.5 py-0.5 text-[10px] font-bold rounded-md bg-teal-100 text-teal-800 font-mono">.XLS</span>
              <span class="px-2.5 py-0.5 text-[10px] font-bold rounded-md bg-slate-100 text-slate-800 font-mono">.CSV</span>
            </div>
          </div>

          <div class="flex items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div class="text-xs text-slate-600">
              <span class="font-bold text-slate-800 block">Need a standard template?</span>
              <span>Download our pre-formatted Optical Excel sheet with tax columns</span>
            </div>
            <button type="button" id="btn-download-excel-template" class="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs shrink-0">
              <svg class="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
              </svg>
              <span>Download Excel Template</span>
            </button>
          </div>
        </div>

        <!-- Content Area: Camera Tab -->
        <div id="content-intake-camera" class="hidden space-y-4">
          <div class="relative bg-black rounded-2xl overflow-hidden aspect-4/3 max-h-[360px] flex items-center justify-center">
            <video id="camera-feed" autoplay playsinline muted class="w-full h-full object-cover"></video>
            <canvas id="camera-canvas" class="hidden"></canvas>
            
            <!-- Viewfinder Guide Overlay -->
            <div class="absolute inset-4 border-2 border-white/60 rounded-xl pointer-events-none flex flex-col justify-between p-3">
              <div class="flex justify-between items-center text-white/90 text-[11px] font-semibold bg-black/40 px-2.5 py-1 rounded-md w-fit backdrop-blur-xs">
                Align purchase bill inside frame
              </div>
              <div class="text-center text-white/80 text-[10px] bg-black/40 px-2 py-0.5 rounded-md self-center backdrop-blur-xs">
                Ensure good lighting & sharp text
              </div>
            </div>

            <!-- Loading overlay when camera is booting -->
            <div id="camera-loading" class="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center gap-2 text-white text-xs">
              <div class="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Connecting device camera...</span>
            </div>
          </div>

          <div class="flex items-center justify-between gap-3">
            <button id="btn-flip-camera" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
              </svg>
              <span>Flip Camera</span>
            </button>
            <button id="btn-snap-photo" class="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-2xs transition-colors flex items-center justify-center gap-2 cursor-pointer">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
              </svg>
              <span>Capture Photo & Scan</span>
            </button>
          </div>
        </div>

        <!-- Content Area: Paste Text Tab -->
        <div id="content-intake-paste" class="hidden space-y-3">
          <div class="space-y-1.5">
            <label class="block text-xs font-bold text-slate-800">Paste Invoice Text, WhatsApp Order or Table Lines</label>
            <p class="text-[11px] text-slate-500">Copy & paste invoice body from email, WhatsApp, or supplier portal. AI will parse items and prices:</p>
            <textarea id="raw-bill-text-input" rows="6" placeholder="Example:
Supplier: EssilorLuxottica India
Invoice: INV-98442
Date: 2026-08-25
1. Ray-Ban Aviator RB3025 Gold - 10 pcs @ Rs 90.00
2. Zeiss Single Vision ClearView 1.60 - 20 pcs @ Rs 35.00
3. Acuvue Oasys Contact Lenses 30PK - 15 pcs @ Rs 21.00" class="w-full p-3 text-xs font-mono text-slate-800 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-blue-600 outline-none resize-none"></textarea>
          </div>

          <div class="flex items-center justify-between gap-2">
            <button id="btn-paste-example-text" type="button" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold rounded-lg cursor-pointer">Insert Sample Text</button>
            <button id="btn-extract-paste-text" type="button" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer">
              <span>Extract from Text</span>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path>
              </svg>
            </button>
          </div>
        </div>

        <!-- Content Area: Sample Bills Tab -->
        <div id="content-intake-sample" class="hidden space-y-3">
          <p class="text-xs text-slate-600 font-semibold">Select a pre-built optical supplier bill to test AI scanning instantly:</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button class="btn-load-sample p-3 text-left border border-slate-200 hover:border-blue-500 rounded-xl bg-slate-50 hover:bg-blue-50/50 transition-colors cursor-pointer space-y-1.5" data-sample="essilor">
              <div class="flex items-center justify-between">
                <span class="font-bold text-xs text-slate-900">EssilorLuxottica Invoice</span>
                <span class="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px] font-bold">Frames & Lenses</span>
              </div>
              <p class="text-[11px] text-slate-500">Ray-Ban Wayfarer, Aviator & Crizal Progressive Lenses (BIL-2026-081)</p>
              <div class="text-[11px] font-mono text-slate-700 font-semibold">Total: RS 1,280.00 • 3 Items</div>
            </button>

            <button class="btn-load-sample p-3 text-left border border-slate-200 hover:border-blue-500 rounded-xl bg-slate-50 hover:bg-blue-50/50 transition-colors cursor-pointer space-y-1.5" data-sample="zeiss">
              <div class="flex items-center justify-between">
                <span class="font-bold text-xs text-slate-900">Zeiss Vision Care Bill</span>
                <span class="px-2 py-0.5 bg-purple-100 text-purple-800 rounded text-[10px] font-bold">Precision Optics</span>
              </div>
              <p class="text-[11px] text-slate-500">ClearView 1.60 Index, DuraVision Platinum & BlueGuard (BIL-2026-094)</p>
              <div class="text-[11px] font-mono text-slate-700 font-semibold">Total: RS 890.00 • 2 Items</div>
            </button>

            <button class="btn-load-sample p-3 text-left border border-slate-200 hover:border-blue-500 rounded-xl bg-slate-50 hover:bg-blue-50/50 transition-colors cursor-pointer space-y-1.5" data-sample="contactlens">
              <div class="flex items-center justify-between">
                <span class="font-bold text-xs text-slate-900">J&J Vision Contact Lens Bill</span>
                <span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-bold">Contact Lenses</span>
              </div>
              <p class="text-[11px] text-slate-500">Acuvue Oasys 30PK & 1-Day Moist Multipacks (BIL-2026-105)</p>
              <div class="text-[11px] font-mono text-slate-700 font-semibold">Total: RS 640.00 • 2 Items</div>
            </button>

            <button class="btn-load-sample p-3 text-left border border-slate-200 hover:border-blue-500 rounded-xl bg-slate-50 hover:bg-blue-50/50 transition-colors cursor-pointer space-y-1.5" data-sample="accessories">
              <div class="flex items-center justify-between">
                <span class="font-bold text-xs text-slate-900">OptiWay Lab & Accessories</span>
                <span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-bold">Cases & Sprays</span>
              </div>
              <p class="text-[11px] text-slate-500">Hard Eyeglass Cases, Anti-Fog Sprays & Screwdriver Kits (BIL-2026-118)</p>
              <div class="text-[11px] font-mono text-slate-700 font-semibold">Total: RS 420.00 • 3 Items</div>
            </button>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" id="btn-cancel-intake" class="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">Cancel</button>
        </div>
      </div>
    `;

    this.setupIntakeEvents();
  }

  private static setupIntakeEvents() {
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    // Close buttons
    modal.querySelector("#btn-scanner-close")?.addEventListener("click", () => this.closeModal());
    modal.querySelector("#btn-cancel-intake")?.addEventListener("click", () => this.closeModal());

    // Tabs
    const tabFile = modal.querySelector("#tab-intake-file") as HTMLButtonElement;
    const tabExcel = modal.querySelector("#tab-intake-excel") as HTMLButtonElement;
    const tabCamera = modal.querySelector("#tab-intake-camera") as HTMLButtonElement;
    const tabPaste = modal.querySelector("#tab-intake-paste") as HTMLButtonElement;
    const tabSample = modal.querySelector("#tab-intake-sample") as HTMLButtonElement;

    const contentFile = modal.querySelector("#content-intake-file")!;
    const contentExcel = modal.querySelector("#content-intake-excel")!;
    const contentCamera = modal.querySelector("#content-intake-camera")!;
    const contentPaste = modal.querySelector("#content-intake-paste")!;
    const contentSample = modal.querySelector("#content-intake-sample")!;

    const activateTab = (activeTab: "file" | "excel" | "camera" | "paste" | "sample") => {
      [tabFile, tabExcel, tabCamera, tabPaste, tabSample].forEach(t => {
        if (!t) return;
        t.classList.remove("bg-white", "text-blue-600", "shadow-2xs");
        t.classList.add("text-slate-600");
      });
      [contentFile, contentExcel, contentCamera, contentPaste, contentSample].forEach(c => {
        if (c) c.classList.add("hidden");
      });

      if (activeTab === "file") {
        tabFile?.classList.add("bg-white", "text-blue-600", "shadow-2xs");
        tabFile?.classList.remove("text-slate-600");
        contentFile?.classList.remove("hidden");
        this.stopCameraStream();
      } else if (activeTab === "excel") {
        tabExcel?.classList.add("bg-white", "text-blue-600", "shadow-2xs");
        tabExcel?.classList.remove("text-slate-600");
        contentExcel?.classList.remove("hidden");
        this.stopCameraStream();
      } else if (activeTab === "camera") {
        tabCamera?.classList.add("bg-white", "text-blue-600", "shadow-2xs");
        tabCamera?.classList.remove("text-slate-600");
        contentCamera?.classList.remove("hidden");
        this.startCameraStream();
      } else if (activeTab === "paste") {
        tabPaste?.classList.add("bg-white", "text-blue-600", "shadow-2xs");
        tabPaste?.classList.remove("text-slate-600");
        contentPaste?.classList.remove("hidden");
        this.stopCameraStream();
      } else {
        tabSample?.classList.add("bg-white", "text-blue-600", "shadow-2xs");
        tabSample?.classList.remove("text-slate-600");
        contentSample?.classList.remove("hidden");
        this.stopCameraStream();
      }
    };

    tabFile?.addEventListener("click", () => activateTab("file"));
    tabExcel?.addEventListener("click", () => activateTab("excel"));
    tabCamera?.addEventListener("click", () => activateTab("camera"));
    tabPaste?.addEventListener("click", () => activateTab("paste"));
    tabSample?.addEventListener("click", () => activateTab("sample"));

    if (this.requestedInitialTab) {
      activateTab(this.requestedInitialTab);
    }

    // Excel Drag & Drop + Click
    const dropZoneExcel = modal.querySelector("#drop-zone-excel") as HTMLDivElement;
    const fileInputExcel = modal.querySelector("#file-input-excel") as HTMLInputElement;

    dropZoneExcel?.addEventListener("click", () => fileInputExcel.click());
    dropZoneExcel?.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZoneExcel.classList.add("border-emerald-600", "bg-emerald-50/80");
    });
    dropZoneExcel?.addEventListener("dragleave", () => {
      dropZoneExcel.classList.remove("border-emerald-600", "bg-emerald-50/80");
    });
    dropZoneExcel?.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZoneExcel.classList.remove("border-emerald-600", "bg-emerald-50/80");
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        this.handleFileSelected(e.dataTransfer.files[0]);
      }
    });
    fileInputExcel?.addEventListener("change", () => {
      if (fileInputExcel.files && fileInputExcel.files.length > 0) {
        this.handleFileSelected(fileInputExcel.files[0]);
      }
    });

    modal.querySelector("#btn-download-excel-template")?.addEventListener("click", () => {
      this.downloadExcelTemplate();
    });

    // File Drag & Drop + Click
    const dropZone = modal.querySelector("#drop-zone-bill") as HTMLDivElement;
    const fileInput = modal.querySelector("#file-input-bill") as HTMLInputElement;

    dropZone?.addEventListener("click", () => fileInput.click());

    dropZone?.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("border-blue-600", "bg-blue-50/60");
    });

    dropZone?.addEventListener("dragleave", () => {
      dropZone.classList.remove("border-blue-600", "bg-blue-50/60");
    });

    dropZone?.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("border-blue-600", "bg-blue-50/60");
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        this.handleFileSelected(e.dataTransfer.files[0]);
      }
    });

    fileInput?.addEventListener("change", () => {
      if (fileInput.files && fileInput.files.length > 0) {
        this.handleFileSelected(fileInput.files[0]);
      }
    });

    // Start Scan File Button
    modal.querySelector("#btn-start-scan-file")?.addEventListener("click", () => {
      if (this.currentFileData) {
        this.processBillWithAI(this.currentFileData.base64, this.currentFileData.mimeType, this.currentFileData.fileName);
      }
    });

    // Camera Flip & Snap
    modal.querySelector("#btn-flip-camera")?.addEventListener("click", () => {
      this.currentFacingMode = this.currentFacingMode === "environment" ? "user" : "environment";
      this.startCameraStream();
    });

    modal.querySelector("#btn-snap-photo")?.addEventListener("click", () => {
      this.captureCameraSnapshot();
    });

    // Paste Text Events
    modal.querySelector("#btn-paste-example-text")?.addEventListener("click", () => {
      const ta = modal.querySelector("#raw-bill-text-input") as HTMLTextAreaElement;
      if (ta) {
        ta.value = `Supplier: EssilorLuxottica India Pvt Ltd
Bill Number: BIL-ESS-9821
Date: ${new Date().toISOString().slice(0, 10)}
Payment Method: Bank Transfer
Status: Paid

ITEMS:
1. Ray-Ban Aviator RB3025 Gold Classic - 10 pcs @ Rs 90.00 each (MRP: 175.00)
2. Ray-Ban Wayfarer RB2140 Black - 8 pcs @ Rs 85.00 each (MRP: 165.00)
3. Essilor Crizal Sapphire Single Vision 1.60 - 20 pcs @ Rs 35.00 each (MRP: 95.00)
4. Zeiss Anti-Fog Cleaning Spray 60ml - 30 pcs @ Rs 4.00 each (MRP: 12.00)`;
      }
    });

    modal.querySelector("#btn-extract-paste-text")?.addEventListener("click", () => {
      const ta = modal.querySelector("#raw-bill-text-input") as HTMLTextAreaElement;
      const text = ta?.value.trim();
      if (!text) {
        Toast.show("Please paste invoice or bill text first.", "error");
        return;
      }
      this.processBillTextWithAI(text);
    });

    // Sample Bill Clicks
    modal.querySelectorAll(".btn-load-sample").forEach(btn => {
      btn.addEventListener("click", () => {
        const sampleKey = btn.getAttribute("data-sample") || "essilor";
        this.loadSampleBill(sampleKey);
      });
    });
  }

  private static async startCameraStream() {
    this.stopCameraStream();
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    const video = modal.querySelector("#camera-feed") as HTMLVideoElement;
    const loading = modal.querySelector("#camera-loading") as HTMLDivElement;
    if (loading) loading.classList.remove("hidden");

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: this.currentFacingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.activeStream = stream;
      if (video) {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          video.play();
          if (loading) loading.classList.add("hidden");
        };
      }
    } catch (err: any) {
      console.error("Camera access failed:", err);
      if (loading) {
        loading.innerHTML = `
          <div class="text-center p-4 space-y-2">
            <p class="text-rose-400 font-bold">Camera access unavailable</p>
            <p class="text-[11px] text-slate-300">Please allow camera permissions in your browser or use File Upload.</p>
          </div>
        `;
      }
      Toast.show("Camera access unavailable. Please use file upload.", "info");
    }
  }

  private static captureCameraSnapshot() {
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    const video = modal.querySelector("#camera-feed") as HTMLVideoElement;
    const canvas = modal.querySelector("#camera-canvas") as HTMLCanvasElement;
    if (!video || !canvas || !video.videoWidth) {
      Toast.show("Waiting for camera feed...", "info");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const base64 = dataUrl.split(",")[1];

    this.stopCameraStream();
    this.currentFileData = {
      base64,
      mimeType: "image/jpeg",
      fileName: `camera_bill_scan_${Date.now()}.jpg`,
      previewUrl: dataUrl
    };

    this.processBillWithAI(base64, "image/jpeg", this.currentFileData.fileName);
  }

  private static handleFileSelected(file: File) {
    const isExcel = file.name.match(/\.(xlsx|xls|csv)$/i);
    const validTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/jpg"];
    const isPdfOrImage = validTypes.some(t => file.type.includes(t.replace("application/", "").replace("image/", ""))) || file.name.match(/\.(pdf|jpg|jpeg|png|webp)$/i);

    if (!isExcel && !isPdfOrImage) {
      Toast.show("Unsupported file format. Please upload a PDF, Excel (.xlsx/.csv), or JPG/PNG image.", "error");
      return;
    }

    if (isExcel) {
      this.processExcelBillFile(file);
      return;
    }

    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const mimeType = isPdf ? "application/pdf" : (file.type || "image/jpeg");

      this.currentFileData = {
        base64,
        mimeType,
        fileName: file.name,
        previewUrl: dataUrl
      };

      // Show selected file badge
      const badge = modal.querySelector("#file-selected-badge") as HTMLDivElement;
      const nameEl = modal.querySelector("#file-name-text") as HTMLParagraphElement;
      const sizeEl = modal.querySelector("#file-size-text") as HTMLParagraphElement;
      const iconEl = modal.querySelector("#file-ext-icon") as HTMLDivElement;

      if (badge && nameEl && sizeEl && iconEl) {
        badge.classList.remove("hidden");
        nameEl.innerText = file.name;
        sizeEl.innerText = `${(file.size / (1024 * 1024)).toFixed(2)} MB • ${isPdf ? "PDF Document" : "Image"}`;
        iconEl.innerText = isPdf ? "PDF" : "IMG";
        iconEl.className = `w-8 h-8 rounded-lg ${isPdf ? 'bg-rose-600' : 'bg-blue-600'} text-white flex items-center justify-center font-bold text-xs shrink-0`;
      }
    };
    reader.readAsDataURL(file);
  }

  /**
   * Parse Excel (.xlsx, .xls, .csv) purchase bill directly with XLSX engine
   */
  private static async processExcelBillFile(file: File) {
    this.showScanningAnimation(file.name);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });

      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error("Excel file has no readable sheets.");
      }

      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });

      if (!rawRows || rawRows.length === 0) {
        throw new Error("The selected Excel sheet is empty.");
      }

      let supName = "";
      let supPhone = "";
      let billNumber = `BIL-EXC-${Math.floor(1000 + Math.random() * 9000)}`;
      let billDate = new Date().toISOString().slice(0, 10);
      let paymentStatus: "Paid" | "Unpaid" | "Partial" = "Paid";
      let paymentMethod = "Bank Transfer";
      let overallTaxRate = 18;

      let headerRowIndex = -1;
      let colMap: Record<string, number> = {};

      for (let r = 0; r < Math.min(rawRows.length, 15); r++) {
        const row = rawRows[r];
        if (!Array.isArray(row)) continue;

        const rowStr = row.map(c => String(c || "").trim()).join(" ");

        if (!supName) {
          const supMatch = rowStr.match(/supplier\s*(?:name)?\s*[:\-]\s*([^\,\|;\n\r]+)/i);
          if (supMatch && supMatch[1].trim()) {
            supName = supMatch[1].trim();
          }
        }

        if (!supPhone) {
          const phoneMatch = rowStr.match(/(?:phone|mobile|tel|contact)\s*[:\-]\s*([0-9\+\-\s]{8,15})/i);
          if (phoneMatch && phoneMatch[1].trim()) {
            supPhone = phoneMatch[1].trim();
          }
        }

        const billNumMatch = rowStr.match(/(?:invoice|bill)\s*(?:no|number|#)?\s*[:\-]\s*([A-Za-z0-9\-_]+)/i);
        if (billNumMatch && billNumMatch[1].trim()) {
          billNumber = billNumMatch[1].trim();
        }

        const dateMatch = rowStr.match(/date\s*[:\-]\s*([0-9]{2,4}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})/i);
        if (dateMatch && dateMatch[1].trim()) {
          const parsed = new Date(dateMatch[1].trim());
          if (!isNaN(parsed.getTime())) {
            billDate = parsed.toISOString().slice(0, 10);
          }
        }

        const normCells = row.map(c => String(c || "").trim().toLowerCase());
        const hasItem = normCells.some(c => c.includes("item") || c.includes("product") || c.includes("description") || c.includes("name") || c.includes("model"));
        const hasPrice = normCells.some(c => c.includes("price") || c.includes("rate") || c.includes("cost") || c.includes("amount"));
        const hasQty = normCells.some(c => c.includes("qty") || c.includes("quantity") || c.includes("pcs") || c.includes("count"));

        if ((hasItem && (hasPrice || hasQty)) || (hasQty && hasPrice)) {
          headerRowIndex = r;
          normCells.forEach((cell, idx) => {
            if (cell.includes("name") || cell.includes("product") || cell.includes("description") || cell.includes("item")) {
              if (colMap.name === undefined) colMap.name = idx;
            }
            if (cell.includes("barcode") || cell.includes("ean") || cell.includes("upc")) {
              if (colMap.barcode === undefined) colMap.barcode = idx;
            }
            if (cell.includes("hsn") || cell.includes("sac")) {
              if (colMap.hsn === undefined) colMap.hsn = idx;
            }
            if (cell.includes("size") || cell.includes("dimension")) {
              if (colMap.size === undefined) colMap.size = idx;
            }
            if (cell.includes("color") || cell.includes("colour") || cell.includes("shade")) {
              if (colMap.color === undefined) colMap.color = idx;
            }
            if (cell.includes("sku") || cell.includes("code") || cell.includes("article")) {
              if (colMap.sku === undefined) colMap.sku = idx;
            }
            if (cell.includes("cat") || cell.includes("type")) {
              if (colMap.category === undefined) colMap.category = idx;
            }
            if (cell.includes("brand") || cell.includes("make")) {
              if (colMap.brand === undefined) colMap.brand = idx;
            }
            if (cell.includes("model")) {
              if (colMap.model === undefined) colMap.model = idx;
            }
            if (cell.includes("qty") || cell.includes("quantity") || cell.includes("pcs") || cell.includes("count")) {
              if (colMap.qty === undefined) colMap.qty = idx;
            }
            if (cell.includes("purchase") || cell.includes("cost") || cell.includes("buy price") || cell.includes("unit rate") || cell.includes("rate") || cell.includes("unit price")) {
              if (colMap.purchasePrice === undefined) colMap.purchasePrice = idx;
            }
            if (cell.includes("sell") || cell.includes("mrp") || cell.includes("retail") || cell.includes("sales price")) {
              if (colMap.sellingPrice === undefined) colMap.sellingPrice = idx;
            }
            if (cell.includes("tax %") || cell.includes("gst %") || cell.includes("tax rate") || cell.includes("vat %")) {
              if (colMap.taxRate === undefined) colMap.taxRate = idx;
            }
            if (cell.includes("tax amt") || cell.includes("tax amount") || cell.includes("gst amt") || cell.includes("gst amount") || cell.includes("tax")) {
              if (colMap.taxAmt === undefined) colMap.taxAmt = idx;
            }
            if (cell.includes("discount amt") || cell.includes("discount amount") || (cell.includes("discount") && !cell.includes("%") && !cell.includes("rate"))) {
              if (colMap.discount === undefined) colMap.discount = idx;
            }
            if (cell.includes("min") || cell.includes("alert")) {
              if (colMap.minStock === undefined) colMap.minStock = idx;
            }
          });
          break;
        }
      }

      if (headerRowIndex === -1) {
        headerRowIndex = 0;
        colMap = { name: 0, category: 1, brand: 2, model: 3, qty: 4, purchasePrice: 5, sellingPrice: 6, taxRate: 7 };
      }

      const extractedItems: PurchaseBillItem[] = [];
      let calculatedSubtotal = 0;
      let calculatedTaxTotal = 0;
      let calculatedDiscountTotal = 0;

      for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (!Array.isArray(row) || row.length === 0) continue;

        const nameVal = colMap.name !== undefined ? String(row[colMap.name] || "").trim() : "";
        if (!nameVal || nameVal.toLowerCase().startsWith("total") || nameVal.toLowerCase().startsWith("subtotal")) {
          continue;
        }

        const skuVal = colMap.sku !== undefined ? String(row[colMap.sku] || "").trim() : "";
        const barcodeVal = colMap.barcode !== undefined ? String(row[colMap.barcode] || "").trim() : "";
        const hsnVal = colMap.hsn !== undefined ? String(row[colMap.hsn] || "").trim() : "";
        const sizeVal = colMap.size !== undefined ? String(row[colMap.size] || "").trim() : "";
        const colorVal = colMap.color !== undefined ? String(row[colMap.color] || "").trim() : "";

        const catRaw = colMap.category !== undefined ? String(row[colMap.category] || "").trim() : "";
        let categoryVal = "Frame";
        if (catRaw.toLowerCase().includes("lens") && !catRaw.toLowerCase().includes("contact")) categoryVal = "Lens";
        else if (catRaw.toLowerCase().includes("contact")) categoryVal = "Contact Lens";
        else if (catRaw.toLowerCase().includes("sun")) categoryVal = "Sunglasses";
        else if (catRaw.toLowerCase().includes("access") || catRaw.toLowerCase().includes("case") || catRaw.toLowerCase().includes("spray")) categoryVal = "Accessories";

        const brandVal = colMap.brand !== undefined ? String(row[colMap.brand] || "").trim() : "";
        const modelVal = colMap.model !== undefined ? String(row[colMap.model] || "").trim() : "";
        
        let qty = 1;
        if (colMap.qty !== undefined && row[colMap.qty] !== undefined) {
          const parsedQty = parseFloat(String(row[colMap.qty]).replace(/[^0-9.]/g, ""));
          if (!isNaN(parsedQty) && parsedQty > 0) qty = parsedQty;
        }

        let purchasePrice = 0;
        if (colMap.purchasePrice !== undefined && row[colMap.purchasePrice] !== undefined) {
          const parsedPP = parseFloat(String(row[colMap.purchasePrice]).replace(/[^0-9.]/g, ""));
          if (!isNaN(parsedPP)) purchasePrice = parsedPP;
        }

        let sellingPrice = purchasePrice * 1.8;
        if (colMap.sellingPrice !== undefined && row[colMap.sellingPrice] !== undefined) {
          const parsedSP = parseFloat(String(row[colMap.sellingPrice]).replace(/[^0-9.]/g, ""));
          if (!isNaN(parsedSP) && parsedSP > 0) sellingPrice = parsedSP;
        }

        let itemTaxRate = overallTaxRate;
        if (colMap.taxRate !== undefined && row[colMap.taxRate] !== undefined) {
          const parsedTR = parseFloat(String(row[colMap.taxRate]).replace(/[^0-9.]/g, ""));
          if (!isNaN(parsedTR)) itemTaxRate = parsedTR;
        }

        let itemTaxAmount = 0;
        if (colMap.taxAmt !== undefined && row[colMap.taxAmt] !== undefined) {
          const parsedTA = parseFloat(String(row[colMap.taxAmt]).replace(/[^0-9.]/g, ""));
          if (!isNaN(parsedTA)) itemTaxAmount = parsedTA;
        } else {
          itemTaxAmount = (purchasePrice * qty * (itemTaxRate / 100));
        }

        if (colMap.discount !== undefined && row[colMap.discount] !== undefined) {
          const parsedDisc = parseFloat(String(row[colMap.discount]).replace(/[^0-9.]/g, ""));
          if (!isNaN(parsedDisc) && parsedDisc > 0) calculatedDiscountTotal += parsedDisc;
        }

        let minStock = 3;
        if (colMap.minStock !== undefined && row[colMap.minStock] !== undefined) {
          const parsedMS = parseFloat(String(row[colMap.minStock]).replace(/[^0-9.]/g, ""));
          if (!isNaN(parsedMS)) minStock = parsedMS;
        }

        const lineSubtotal = purchasePrice * qty;
        calculatedSubtotal += lineSubtotal;
        calculatedTaxTotal += itemTaxAmount;

        extractedItems.push({
          name: nameVal,
          sku: skuVal || (barcodeVal ? `SKU-${barcodeVal.slice(-6)}` : `SKU-${Math.floor(10000 + Math.random() * 90000)}`),
          barcode: barcodeVal || PurchaseBillScanner.generateAutoBarcode(),
          hsnCode: hsnVal || undefined,
          size: sizeVal || undefined,
          color: colorVal || undefined,
          category: categoryVal as any,
          brand: brandVal,
          model: modelVal,
          quantity: qty,
          purchasePrice: Math.round(purchasePrice * 100) / 100,
          sellingPrice: Math.round(sellingPrice * 100) / 100,
          minStockLevel: minStock
        });
      }

      if (extractedItems.length === 0) {
        throw new Error("Could not find valid product line rows in the Excel sheet.");
      }

      if (!supName) {
        supName = file.name.replace(/\.[^/.]+$/, "").replace(/[_\-]+/g, " ");
        supName = supName.charAt(0).toUpperCase() + supName.slice(1);
      }

      const uniqueLedgerId = generateUniqueSupplierLedgerId(supName, this.registeredSuppliers);
      const grandTotal = Math.round(Math.max(0, calculatedSubtotal + calculatedTaxTotal - calculatedDiscountTotal) * 100) / 100;

      this.extractedData = {
        supplierName: supName,
        supplierLedgerId: uniqueLedgerId,
        supplierPhone: supPhone || "+1 800-555-0199",
        billNumber: billNumber,
        billDate: billDate,
        paymentStatus: paymentStatus,
        paymentMethod: paymentMethod,
        subtotal: Math.round(calculatedSubtotal * 100) / 100,
        taxRate: overallTaxRate,
        taxTotal: Math.round(calculatedTaxTotal * 100) / 100,
        discountTotal: Math.round(calculatedDiscountTotal * 100) / 100,
        grandTotal: grandTotal,
        items: extractedItems
      };

      this.currentItems = extractedItems;
      this.currentFileData = {
        base64: "",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileName: file.name,
        previewUrl: ""
      };

      Toast.show(`Excel import successful! Loaded ${extractedItems.length} items with tax calculation.`, "success");
      this.showVerificationAndEditStep();
    } catch (err: any) {
      console.error("Excel import error:", err);
      Toast.show("Excel import failed: " + (err.message || "Invalid file format"), "error");
      this.showIntakeStep();
    }
  }

  /**
   * Generates and downloads a clean sample Optical Purchase Bill Excel sheet with tax columns
   */
  private static downloadExcelTemplate() {
    const headers = [
      ["OPTICAL SUPPLIER PURCHASE BILL / INVOICE IMPORT TEMPLATE"],
      ["Supplier Name:", "EssilorLuxottica Optical", "Invoice No:", "BIL-2026-9811", "Date:", new Date().toISOString().slice(0, 10)],
      ["Supplier Phone:", "+1 800-422-2020", "Payment Status:", "Paid", "Payment Method:", "Bank Transfer"],
      [],
      ["Product Name / Description", "SKU / Code", "Category", "Brand", "Model", "Quantity", "Purchase Price", "Selling Price", "Tax %", "Tax Amount", "Discount (RS)", "Min Stock Alert"]
    ];

    const sampleRows = [
      ["Ray-Ban Aviator Classic Gold RB3025", "FRM-RB3025", "Frame", "Ray-Ban", "Arista Gold 58mm", 10, 90.00, 175.00, 18, 162.00, 0, 3],
      ["Ray-Ban Wayfarer Classic RB2140", "FRM-RB2140", "Frame", "Ray-Ban", "Black 50mm", 8, 85.00, 165.00, 18, 122.40, 0, 3],
      ["Essilor Crizal Sapphire Single Vision 1.6", "LNS-ESS-CRZ16", "Lens", "Essilor", "1.60 Crizal AR", 20, 35.00, 95.00, 18, 126.00, 0, 5],
      ["Zeiss PhotoFusion X Extra Grey 1.56", "LNS-ZS-PFX156", "Lens", "Zeiss", "Photochromic 1.56", 12, 55.00, 140.00, 18, 118.80, 0, 4],
      ["Acuvue Oasys with HydraLuxe 30PK", "CL-ACV-OAS30", "Contact Lens", "Johnson & Johnson", "Daily 8.5 BC", 15, 21.00, 38.50, 12, 37.80, 0, 8],
      ["Anti-Fog Lens Cleaning Spray 60ml", "ACC-CLN-SP60", "Accessories", "OptiWay", "Microfiber included", 30, 4.00, 12.00, 18, 21.60, 0, 10]
    ];

    const wsData = [...headers, ...sampleRows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws["!cols"] = [
      { wch: 38 },
      { wch: 16 },
      { wch: 14 },
      { wch: 18 },
      { wch: 22 },
      { wch: 10 },
      { wch: 14 },
      { wch: 14 },
      { wch: 10 },
      { wch: 12 },
      { wch: 14 },
      { wch: 14 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Purchase Bill");
    XLSX.writeFile(wb, "Optical_Purchase_Bill_Template.xlsx");
    Toast.show("Excel template downloaded! Fill and upload to auto-populate bill.", "success");
  }

  /**
   * Direct client-side Gemini AI caller (used on static hosting like Vercel when /api is unavailable)
   */
  private static async callGeminiDirectly(params: { fileData?: string; mimeType?: string; rawText?: string; fileName?: string }): Promise<ScanBillResult> {
    const apiKey = getGeminiApiKey();
    const validation = validateGeminiApiKey(apiKey);
    if (!validation.valid) {
      throw new Error(validation.error || "Gemini API Key missing or invalid.");
    }

    const promptInstructions = `You are an expert optical retail procurement & billing auditor.
Analyze this optical invoice/purchase bill (covers optical frames, ophthalmic prescription lenses, contact lenses, sunglasses, accessories, lab charges).
Extract all supplier details, invoice metadata, payment status, and every line item.

Return a valid JSON object matching EXACTLY this schema:
{
  "supplierName": "Company or distributor name (e.g. 'EssilorLuxottica', 'Zeiss Vision Care', 'Safilo', or local distributor)",
  "supplierLedgerId": "Supplier vendor code / ledger ID ONLY if explicitly printed on the bill/invoice, otherwise return ''",
  "supplierPhone": "Supplier contact number if visible, else ''",
  "supplierEmail": "Supplier contact email if visible, else ''",
  "supplierTaxId": "GSTIN / VAT / Tax ID if visible, else ''",
  "supplierAddress": "Supplier address if visible, else ''",
  "billNumber": "Invoice or Bill reference number (e.g. 'BIL-2026-081')",
  "billDate": "Invoice date in 'YYYY-MM-DD' format (default to today if missing)",
  "dueDate": "Payment due date in 'YYYY-MM-DD' format if present, else ''",
  "paymentStatus": "Paid" | "Unpaid" | "Partial",
  "paymentMethod": "Bank Transfer" | "Cash" | "UPI" | "Cheque" | "Card" | "Credit",
  "subtotal": number,
  "taxRate": number,
  "taxTotal": number,
  "discountTotal": number,
  "grandTotal": number,
  "items": [
    {
      "name": "Full optical product name",
      "modelNumber": "Article Model Number / Code or SKU from invoice (e.g. 'MOD-RB3025', 'RB3025-001', 'LNS-ZS160')",
      "sku": "Article Model Number / Code or SKU from invoice",
      "barcode": "Barcode or EAN-13/UPC 12-13 digit number if printed on invoice, else ''",
      "hsnCode": "HSN/SAC 4-8 digit tax classification code, else ''",
      "size": "Optical frame eye size or lens dimensions, else ''",
      "color": "Frame colour or lens color code, else ''",
      "category": "Frame" | "Lens" | "Contact Lens" | "Accessories" | "Services",
      "brand": "Brand name (e.g. 'Ray-Ban', 'Zeiss', 'Essilor')",
      "model": "Model or specification",
      "quantity": number,
      "purchasePrice": number,
      "sellingPrice": number,
      "taxRate": number,
      "discount": number,
      "minStockLevel": number
    }
  ],
  "notes": "Any payment terms, remarks or optical lab notes"
}

Important rules:
1. Ensure all numeric amounts are pure numbers (no currency symbols or commas).
2. HSN code and Barcode MUST NOT be confused.
3. If size or colour is present, extract them.
4. If sellingPrice is not specified, calculate standard optical retail price with 1.8x - 2.0x markup over purchasePrice.
5. Output MUST be ONLY valid JSON without markdown fences.`;

    const contentsParts: any[] = [];

    if (params.fileData) {
      let cleanBase64 = params.fileData;
      let detectedMime = params.mimeType || "application/pdf";

      if (params.fileData.includes(";base64,")) {
        const parts = params.fileData.split(";base64,");
        const match = parts[0].match(/data:(.*?)$/);
        if (match && match[1]) {
          detectedMime = match[1];
        }
        cleanBase64 = parts[1];
      }

      if (detectedMime.includes("pdf")) {
        detectedMime = "application/pdf";
      } else if (detectedMime.includes("jpeg") || detectedMime.includes("jpg")) {
        detectedMime = "image/jpeg";
      } else if (detectedMime.includes("png")) {
        detectedMime = "image/png";
      } else if (detectedMime.includes("webp")) {
        detectedMime = "image/webp";
      }

      contentsParts.push({
        inlineData: {
          mimeType: detectedMime,
          data: cleanBase64
        }
      });
    }

    if (params.rawText) {
      contentsParts.push({
        text: `Raw Invoice / Purchase Bill Text to parse:\n${params.rawText}`
      });
    }

    contentsParts.push({
      text: promptInstructions
    });

    const candidateModels = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
    let rawResponseText = "";
    let lastError: any = null;

    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                parts: contentsParts
              }
            ],
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          const errMsg = errBody?.error?.message || `HTTP ${res.status}`;
          throw new Error(errMsg);
        }

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 0) {
          rawResponseText = text;
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`Direct model call to ${model} failed:`, err);
      }
    }

    if (!rawResponseText) {
      throw new Error(lastError?.message || "Could not extract invoice data from Gemini AI.");
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawResponseText);
    } catch {
      const cleaned = rawResponseText.replace(/```json/gi, "").replace(/```/g, "").trim();
      parsed = JSON.parse(cleaned);
    }

    if (!parsed.items || !Array.isArray(parsed.items)) {
      parsed.items = [];
    } else {
      parsed.items = parsed.items.map((item: any, idx: number) => {
        const purchasePrice = typeof item.purchasePrice === "number" ? item.purchasePrice : (parseFloat(String(item.purchasePrice || 0).replace(/[^0-9.]/g, "")) || 0);
        const sellingPrice = typeof item.sellingPrice === "number" ? item.sellingPrice : (parseFloat(String(item.sellingPrice || 0).replace(/[^0-9.]/g, "")) || (purchasePrice > 0 ? Math.round(purchasePrice * 1.8) : 0));
        const quantity = parseInt(String(item.quantity || 1).replace(/[^0-9]/g, "")) || 1;
        const taxRate = typeof item.taxRate === "number" ? item.taxRate : (parseFloat(String(item.taxRate || 18).replace(/[^0-9.]/g, "")) || 18);
        const discount = typeof item.discount === "number" ? item.discount : (parseFloat(String(item.discount || 0).replace(/[^0-9.]/g, "")) || 0);
        const modelNumberVal = String(item.modelNumber || item.sku || `MOD-${Math.floor(1000 + Math.random() * 9000)}`).trim();
        const rawBarcode = item.barcode ? String(item.barcode).trim() : "";
        const generatedBarcode = rawBarcode || PurchaseBillScanner.generateAutoBarcode();

        return {
          name: String(item.name || `Optical Item #${idx + 1}`).trim(),
          modelNumber: modelNumberVal,
          sku: modelNumberVal,
          barcode: generatedBarcode,
          hsnCode: item.hsnCode ? String(item.hsnCode).trim() : "",
          size: item.size ? String(item.size).trim() : "",
          color: item.color ? String(item.color).trim() : (item.colour ? String(item.colour).trim() : ""),
          category: item.category || "Frame",
          brand: String(item.brand || "OptiWay").trim(),
          model: String(item.model || "").trim(),
          quantity: Math.max(1, quantity),
          purchasePrice: Math.max(0, purchasePrice),
          sellingPrice: Math.max(0, sellingPrice),
          taxRate: Math.max(0, taxRate),
          discount: Math.max(0, discount),
          minStockLevel: item.minStockLevel || 3
        };
      });
    }

    if (!parsed.supplierName) parsed.supplierName = "Optical Supplier";
    if (!parsed.billNumber) parsed.billNumber = `BIL-${Date.now().toString().slice(-6)}`;
    if (!parsed.billDate) parsed.billDate = new Date().toISOString().slice(0, 10);

    const parseNum = (val: any, def: number) => {
      if (val !== undefined && val !== null) {
        const p = parseFloat(String(val).replace(/[^0-9.]/g, ""));
        return !isNaN(p) && p >= 0 ? p : def;
      }
      return def;
    };

    parsed.discountTotal = parseNum(parsed.discountTotal, 0);
    parsed.subtotal = parseNum(parsed.subtotal, 0);
    parsed.taxTotal = parseNum(parsed.taxTotal, 0);
    parsed.taxRate = parseNum(parsed.taxRate, 18);
    parsed.grandTotal = parseNum(parsed.grandTotal, 0);

    return parsed as ScanBillResult;
  }

  /**
   * Process the uploaded document with server-side Gemini API with fallback
   */
  private static async processBillWithAI(base64: string, mimeType: string, fileName: string) {
    this.showScanningAnimation(fileName);

    try {
      let extracted: ScanBillResult | null = null;

      // 1. Try server endpoint first
      try {
        const response = await fetch("/api/scan-purchase-bill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileData: base64, mimeType, fileName })
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            extracted = result.data;
          }
        } else {
          console.warn(`Server endpoint returned status ${response.status}, seamlessly switching to direct AI scan...`);
        }
      } catch (netErr) {
        console.warn("Server endpoint unreachable, seamlessly switching to direct AI scan...", netErr);
      }

      // 2. If server endpoint was 404, not configured, or failed, use direct client-side Gemini scan
      if (!extracted) {
        extracted = await PurchaseBillScanner.callGeminiDirectly({ fileData: base64, mimeType, fileName });
      }

      if (!extracted) {
        throw new Error("Failed to extract structured data from document.");
      }

      // Refresh registered suppliers from DB for fresh matching
      try {
        this.registeredSuppliers = await dbService.getList<Supplier>("suppliers");
      } catch (e) {
        console.warn("Failed to refresh suppliers list:", e);
      }

      const supName = (extracted.supplierName || "").trim();
      const matched = this.registeredSuppliers.find(
        s => s.name && s.name.trim().toLowerCase() === supName.toLowerCase()
      );

      let ledgerId = (extracted.supplierLedgerId || "").trim().toUpperCase();
      const isGeneric = !ledgerId ||
        ledgerId === "LED-SUP-01" ||
        ledgerId === "LED-SUP-1" ||
        ledgerId === "LED-SUP-001" ||
        ledgerId === "LED-SUP" ||
        ledgerId === "SUP-01" ||
        ledgerId === "SUP-1" ||
        ledgerId === "LED-SUP-02" ||
        ledgerId === "LED-SUP-2" ||
        ledgerId === "LED-01" ||
        ledgerId === "LED-1";

      if (matched && matched.ledgerId) {
        ledgerId = matched.ledgerId;
      } else if (isGeneric || this.registeredSuppliers.some(s => s.ledgerId && s.ledgerId.trim().toUpperCase() === ledgerId)) {
        ledgerId = generateUniqueSupplierLedgerId(supName || "Supplier", this.registeredSuppliers);
      }
      extracted.supplierLedgerId = ledgerId;

      this.extractedData = extracted;
      this.currentItems = Array.isArray(extracted.items) ? extracted.items.map((item: any) => ({
        ...item,
        barcode: item.barcode?.trim() || PurchaseBillScanner.generateAutoBarcode()
      })) : [];
      
      Toast.show("Bill successfully scanned! Review and edit data below.", "success");
      this.showVerificationAndEditStep();
    } catch (err: any) {
      console.error("Scanning error:", err);
      // Instead of failing completely, offer the interactive Recovery / Direct Split Studio
      this.showScanningErrorRecovery(err.message || "Could not read data automatically", fileName);
    }
  }

  /**
   * Process raw pasted invoice text with Gemini or local heuristic parser
   */
  private static async processBillTextWithAI(rawText: string) {
    this.showScanningAnimation("pasted_bill_text.txt");

    try {
      let extracted: ScanBillResult | null = null;

      try {
        const response = await fetch("/api/scan-purchase-bill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rawText, fileName: "pasted_bill.txt" })
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            extracted = result.data;
          }
        }
      } catch (apiErr) {
        console.warn("Server text scan endpoint unreachable:", apiErr);
      }

      // If server scan was unavailable, try direct Gemini call
      if (!extracted) {
        try {
          extracted = await PurchaseBillScanner.callGeminiDirectly({ rawText, fileName: "pasted_bill.txt" });
        } catch (directErr) {
          console.warn("Direct Gemini text scan failed, falling back to local heuristic parser:", directErr);
        }
      }

      if (extracted) {
        try {
          this.registeredSuppliers = await dbService.getList<Supplier>("suppliers");
        } catch (e) {
          console.warn("Failed to refresh suppliers list:", e);
        }

        const supName = (extracted.supplierName || "").trim();
        const matched = this.registeredSuppliers.find(
          s => s.name && s.name.trim().toLowerCase() === supName.toLowerCase()
        );

        let ledgerId = (extracted.supplierLedgerId || "").trim().toUpperCase();
        const isGeneric = !ledgerId ||
          ledgerId === "LED-SUP-01" ||
          ledgerId === "LED-SUP-1" ||
          ledgerId === "LED-SUP-001" ||
          ledgerId === "LED-SUP" ||
          ledgerId === "SUP-01" ||
          ledgerId === "SUP-1" ||
          ledgerId === "LED-SUP-02" ||
          ledgerId === "LED-SUP-2" ||
          ledgerId === "LED-01" ||
          ledgerId === "LED-1";

        if (matched && matched.ledgerId) {
          ledgerId = matched.ledgerId;
        } else if (isGeneric || this.registeredSuppliers.some(s => s.ledgerId && s.ledgerId.trim().toUpperCase() === ledgerId)) {
          ledgerId = generateUniqueSupplierLedgerId(supName || "Supplier", this.registeredSuppliers);
        }
        extracted.supplierLedgerId = ledgerId;

        this.extractedData = extracted;
        this.currentItems = Array.isArray(extracted.items) ? extracted.items.map((item: any) => ({
          ...item,
          barcode: item.barcode?.trim() || PurchaseBillScanner.generateAutoBarcode()
        })) : [];
        this.currentFileData = {
          base64: "",
          mimeType: "text/plain",
          fileName: "pasted_invoice.txt",
          previewUrl: ""
        };
        Toast.show("Invoice text successfully parsed!", "success");
        this.showVerificationAndEditStep();
        return;
      }
    } catch (apiErr) {
      console.warn("Server text scan failed, using local heuristic parser:", apiErr);
    }

    // Fallback: Local optical text parser
    const localParsed = this.parseOpticalBillText(rawText);
    this.extractedData = localParsed;
    this.currentItems = localParsed.items;
    this.currentFileData = {
      base64: "",
      mimeType: "text/plain",
      fileName: "pasted_invoice.txt",
      previewUrl: ""
    };
    Toast.show("Parsed invoice text via Smart Optical Parser!", "info");
    this.showVerificationAndEditStep();
  }

  /**
   * Heuristic parser for optical text lines when offline or API is unavailable
   */
  private static parseOpticalBillText(rawText: string): ScanBillResult {
    const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
    let supplierName = "Optical Supplier";
    let billNumber = `BIL-${Date.now().toString().slice(-6)}`;
    let billDate = new Date().toISOString().slice(0, 10);
    const items: PurchaseBillItem[] = [];

    let discountTotal = 0;

    // Extract supplier if present and invoice-level metadata
    for (const line of lines) {
      const supMatch = line.match(/(?:supplier|vendor|from|m\/s|distributor)\s*[:\-]\s*(.+)/i);
      if (supMatch && supMatch[1]) {
        supplierName = supMatch[1].trim();
      }
      const invMatch = line.match(/(?:inv(?:oice)?|bill|ref)\s*(?:no\.?|#)?\s*[:\-]?\s*([A-Za-z0-9\-_]+)/i);
      if (invMatch && invMatch[1] && !invMatch[1].toLowerCase().includes("date")) {
        billNumber = invMatch[1].trim();
      }
      const dateMatch = line.match(/(?:date)\s*[:\-]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/i);
      if (dateMatch && dateMatch[1]) {
        billDate = dateMatch[1].replace(/\//g, "-").replace(/\./g, "-");
      }
      const discMatch = line.match(/(?:discount|disc\.?|rebate|less)\s*(?:amt|amount)?\s*[:\-]?\s*(?:rs\.?|@|\$|inr)?\s*([\d,]+(?:\.\d+)?)/i);
      if (discMatch && discMatch[1] && !line.includes("%")) {
        const parsedDisc = parseFloat(discMatch[1].replace(/,/g, ""));
        if (!isNaN(parsedDisc) && parsedDisc >= 0) discountTotal = parsedDisc;
      }
    }

    // Parse items line by line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^(supplier|vendor|invoice|bill|date|total|subtotal|gst|tax|items|m\/s)/i.test(line)) {
        continue;
      }

      // Try matching: "1. Ray-Ban RB3025 - 10 pcs @ Rs 90.00" or "Zeiss 1.60, qty: 5, rate: 45"
      const cleanLine = line.replace(/^\d+[\.\)\-]\s*/, ""); // remove bullet/number
      if (cleanLine.length < 3) continue;

      const qtyMatch = cleanLine.match(/(\d+)\s*(?:pcs|pairs|units|qty|pk|nos|x)/i) || cleanLine.match(/x\s*(\d+)/i);
      const priceMatch = cleanLine.match(/(?:rs\.?|@|\$|inr)\s*([\d,]+(?:\.\d{2})?)/i) || cleanLine.match(/(?:rate|cost|price)\s*[:\-]?\s*([\d,]+(?:\.\d{2})?)/i);

      const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
      let purchasePrice = 0;
      if (priceMatch) {
        purchasePrice = parseFloat(priceMatch[1].replace(/,/g, "")) || 0;
      }

      // Detect brand & category
      let category: "Frame" | "Lens" | "Contact Lens" | "Accessories" | "Services" = "Frame";
      let brand = "OptiWay";

      if (/lens|crizal|single vision|bifocal|progressive|photochromic|clearview|index/i.test(cleanLine)) {
        category = "Lens";
      } else if (/contact|acuvue|bausch|moist|oasys|biotrue|toric/i.test(cleanLine)) {
        category = "Contact Lens";
      } else if (/spray|case|cloth|screw|cord|chain|cleaner/i.test(cleanLine)) {
        category = "Accessories";
      }

      if (/ray[\s-]?ban/i.test(cleanLine)) brand = "Ray-Ban";
      else if (/zeiss/i.test(cleanLine)) brand = "Zeiss";
      else if (/essilor/i.test(cleanLine)) brand = "Essilor";
      else if (/oakley/i.test(cleanLine)) brand = "Oakley";
      else if (/titan/i.test(cleanLine)) brand = "Titan";
      else if (/acuvue/i.test(cleanLine)) brand = "Johnson & Johnson";
      else if (/gucci/i.test(cleanLine)) brand = "Gucci";

      const sellingPrice = purchasePrice > 0 ? Math.round(purchasePrice * 1.85) : 0;
      const skuPrefix = category === "Frame" ? "FRM" : (category === "Lens" ? "LNS" : (category === "Contact Lens" ? "CL" : "ACC"));

      // Extract size & color heuristically if available in description
      const sizeMatch = cleanLine.match(/\b(?:size|sz)?\s*(5[0-8](?:\/[12][0-9]|-1[4-9]-\d{3})?|[0-9]{2}\s*mm)\b/i);
      const colorMatch = cleanLine.match(/\b(?:c[0-9]{1,2}|black|gold|silver|blue|red|gunmetal|brown|matte\s*black|rose\s*gold|havana|tortoise)\b/i);

      items.push({
        name: cleanLine.split(/[@\-–—]/)[0].trim() || `Optical Item ${items.length + 1}`,
        sku: `${skuPrefix}-${Math.floor(1000 + Math.random() * 9000)}`,
        barcode: PurchaseBillScanner.generateAutoBarcode(),
        hsnCode: category === "Frame" ? "9003" : (category === "Lens" ? "9001" : "9004"),
        size: sizeMatch ? sizeMatch[1].trim() : undefined,
        color: colorMatch ? colorMatch[0].toUpperCase() : undefined,
        category,
        brand,
        model: "",
        quantity: quantity || 1,
        purchasePrice: purchasePrice,
        sellingPrice: sellingPrice,
        taxRate: 18,
        minStockLevel: 3
      });
    }

    if (items.length === 0) {
      items.push({
        name: "Optical Frame / Lens Item",
        sku: `OPT-${Math.floor(1000 + Math.random() * 9000)}`,
        barcode: PurchaseBillScanner.generateAutoBarcode(),
        hsnCode: "9003",
        size: "54/24",
        color: "Black",
        category: "Frame",
        brand: "OptiWay",
        model: "",
        quantity: 1,
        purchasePrice: 100,
        sellingPrice: 190,
        taxRate: 18,
        minStockLevel: 3
      });
    }

    const subtotal = items.reduce((sum, item) => sum + (item.purchasePrice * item.quantity), 0);
    const taxTotal = Math.round(subtotal * 0.18);
    const grandTotal = Math.max(0, subtotal + taxTotal - discountTotal);

    const matchedSup = this.registeredSuppliers.find(
      s => s.name && s.name.trim().toLowerCase() === supplierName.toLowerCase()
    );
    const supplierLedgerId = matchedSup?.ledgerId || generateUniqueSupplierLedgerId(supplierName || "Supplier", this.registeredSuppliers);

    return {
      supplierName,
      supplierLedgerId,
      billNumber,
      billDate,
      paymentStatus: "Paid",
      paymentMethod: "Bank Transfer",
      subtotal,
      taxRate: 18,
      taxTotal,
      discountTotal,
      grandTotal,
      items
    };
  }

  /**
   * Dedicated Error Recovery Screen: Lets the user continue without getting stuck!
   */
  private static showScanningErrorRecovery(errorMessage: string, fileName: string) {
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    modal.innerHTML = `
      <div class="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 border border-slate-200 shadow-2xl animate-in fade-in zoom-in-95 duration-200 text-center">
        <div class="w-14 h-14 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto shadow-2xs">
          <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
          </svg>
        </div>

        <div class="space-y-1.5">
          <h3 class="font-bold text-slate-900 text-base">Automatic Extraction Notice</h3>
          <p class="text-xs text-slate-600">The AI model could not automatically extract all table fields from this specific document layout.</p>
          <div class="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-left">
            <p class="text-[11px] font-mono text-rose-800 break-words">${errorMessage}</p>
          </div>
        </div>

        <div class="space-y-2 pt-1 text-left">
          <p class="text-[11px] font-bold text-slate-700 uppercase tracking-wide">Choose how you would like to proceed:</p>
          
          <button id="btn-recovery-manual-studio" class="w-full p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs flex items-center justify-between cursor-pointer transition-colors shadow-2xs">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
              </svg>
              <span>Open Dual Verification Studio (Document Preview Preserved)</span>
            </div>
            <span class="text-xs">→</span>
          </button>

          <button id="btn-recovery-paste-text" class="w-full p-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-semibold text-xs flex items-center justify-between cursor-pointer transition-colors">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
              </svg>
              <span>Paste Bill / WhatsApp Text to Parse</span>
            </div>
            <span class="text-xs text-slate-500">Fast</span>
          </button>

          <button id="btn-recovery-retry" class="w-full p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl font-semibold text-xs flex items-center justify-between cursor-pointer transition-colors">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
              </svg>
              <span>Retry Scanning Document</span>
            </div>
            <span class="text-xs text-slate-500">AI</span>
          </button>
        </div>

        <div class="flex justify-center pt-2">
          <button id="btn-recovery-cancel" class="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">Back to Upload</button>
        </div>
      </div>
    `;

    modal.querySelector("#btn-recovery-manual-studio")?.addEventListener("click", () => {
      // Build default editable draft without losing the uploaded file preview
      const fallbackLedgerId = generateUniqueSupplierLedgerId("Optical Supplier", this.registeredSuppliers);
      this.extractedData = {
        supplierName: "Optical Supplier",
        supplierLedgerId: fallbackLedgerId,
        supplierPhone: "",
        billNumber: `BIL-${Date.now().toString().slice(-6)}`,
        billDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "Paid",
        paymentMethod: "Bank Transfer",
        subtotal: 0,
        taxTotal: 0,
        grandTotal: 0,
        items: [
          {
            name: "Optical Frame / Lens",
            sku: `OPT-${Math.floor(1000 + Math.random() * 9000)}`,
            category: "Frame",
            brand: "OptiWay",
            model: "",
            quantity: 1,
            purchasePrice: 0,
            sellingPrice: 0,
            taxRate: 18,
            minStockLevel: 3
          }
        ]
      };
      this.currentItems = [...this.extractedData.items];
      Toast.show("Opened Verification Studio with Document Preview side-by-side.", "info");
      this.showVerificationAndEditStep();
    });

    modal.querySelector("#btn-recovery-paste-text")?.addEventListener("click", () => {
      this.showIntakeStep();
      const tabPaste = modal.querySelector("#tab-intake-paste") as HTMLButtonElement;
      tabPaste?.click();
    });

    modal.querySelector("#btn-recovery-retry")?.addEventListener("click", () => {
      if (this.currentFileData && this.currentFileData.base64) {
        this.processBillWithAI(this.currentFileData.base64, this.currentFileData.mimeType, this.currentFileData.fileName);
      } else {
        this.showIntakeStep();
      }
    });

    modal.querySelector("#btn-recovery-cancel")?.addEventListener("click", () => {
      this.showIntakeStep();
    });
  }

  /**
   * Step 2: Visual scanning progress
   */
  private static showScanningAnimation(fileName: string) {
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    modal.innerHTML = `
      <div class="bg-white rounded-2xl max-w-md w-full p-8 text-center space-y-6 border border-slate-200 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div class="relative w-20 h-20 mx-auto">
          <div class="absolute inset-0 rounded-full bg-blue-100 animate-ping opacity-75"></div>
          <div class="relative w-20 h-20 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-lg">
            <svg class="w-10 h-10 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
          </div>
        </div>

        <div class="space-y-2">
          <h3 class="font-bold text-slate-900 text-base">Analyzing Purchase Bill with AI</h3>
          <p class="text-xs text-slate-500 font-medium">Extracting vendor, line items, SKU codes, pricing, and GST amounts...</p>
          <p class="text-[11px] font-mono text-blue-700 bg-blue-50 py-1 px-2 rounded-md truncate max-w-xs mx-auto">${fileName}</p>
        </div>

        <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
          <div class="bg-blue-600 h-full w-2/3 animate-pulse"></div>
        </div>
      </div>
    `;
  }

  /**
   * Step 3: Verification & Interactive Data Edit Studio (Dual Split View)
   */
  private static showVerificationAndEditStep() {
    const modal = document.getElementById(this.modalId);
    if (!modal || !this.extractedData) return;

    const data = this.extractedData;
    const isPdf = this.currentFileData?.mimeType?.includes("pdf");
    const previewUrl = this.currentFileData?.previewUrl || "";

    modal.innerHTML = `
      <div class="bg-white rounded-2xl max-w-6xl w-full p-4 sm:p-6 space-y-4 border border-slate-200 shadow-2xl max-h-[94vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <!-- Studio Header -->
        <div class="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-2xs">
              ✓
            </div>
            <div>
              <h3 class="font-bold text-slate-900 text-sm sm:text-base">Verify & Edit Scanned Purchase Bill</h3>
              <p class="text-xs text-slate-500">Review optical items, prices, supplier details, and confirm stock intake</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button id="btn-rescan-bill" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
              </svg>
              <span>Rescan</span>
            </button>
            <button id="btn-close-edit-modal" class="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer text-lg leading-none">✕</button>
          </div>
        </div>

        <!-- Body: Split Preview & Edit Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0 overflow-y-auto">
          <!-- Left Column: Document Preview (4 cols on lg) -->
          <div class="lg:col-span-4 bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col space-y-2 h-[260px] lg:h-auto overflow-hidden">
            <div class="flex items-center justify-between border-b border-slate-200 pb-1.5">
              <span class="text-[11px] font-bold text-slate-700 uppercase">Original Document Preview</span>
              <span class="text-[10px] font-mono text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">${isPdf ? 'PDF' : 'IMAGE'}</span>
            </div>
            <div class="flex-1 overflow-auto bg-white rounded-lg border border-slate-200 p-1 flex items-center justify-center min-h-0">
              ${isPdf 
                ? `<iframe src="${previewUrl}" class="w-full h-full min-h-[220px] rounded border-0"></iframe>` 
                : `<img src="${previewUrl}" alt="Scanned Bill" class="max-w-full max-h-full object-contain rounded" />`
              }
            </div>
            <div class="text-[11px] text-slate-500 flex items-center justify-between pt-1">
              <span class="truncate">${this.currentFileData?.fileName || 'document'}</span>
              <button id="btn-view-full-doc" class="text-blue-600 hover:underline font-bold text-[11px] cursor-pointer">Open full</button>
            </div>
          </div>

          <!-- Right Column: Verification & Editable Form (8 cols on lg) -->
          <div class="lg:col-span-8 space-y-4 overflow-y-auto pr-1">
            <!-- Header Block: Supplier & Bill Metadata -->
            <div class="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-blue-900 uppercase tracking-wide">Supplier & Invoice Details</span>
                <span class="text-[11px] text-blue-700 font-semibold" id="supplier-match-indicator"></span>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label class="block text-[11px] font-semibold text-slate-700 mb-1">Supplier Company Name *</label>
                  <input type="text" id="edit-sup-name" list="existing-suppliers-list" value="${data.supplierName || ''}" required placeholder="e.g. EssilorLuxottica" class="w-full px-3 py-1.5 text-xs font-bold text-slate-900 border border-slate-300 rounded-lg outline-none bg-white focus:border-blue-500" />
                  <datalist id="existing-suppliers-list">
                    ${this.registeredSuppliers.map(s => `<option value="${s.name}">${s.ledgerId || ''} - ${s.name}</option>`).join("")}
                  </datalist>
                </div>
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <label class="block text-[11px] font-semibold text-slate-700">Supplier Ledger ID *</label>
                    <span id="ledger-uniqueness-badge" class="text-[10px] text-purple-700 font-bold bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">Unique Code</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <input type="text" id="edit-sup-ledger" value="${data.supplierLedgerId || generateUniqueSupplierLedgerId(data.supplierName || 'Supplier', this.registeredSuppliers)}" placeholder="e.g. LED-ESS-01" class="w-full px-3 py-1.5 text-xs font-mono font-bold uppercase text-purple-800 border border-slate-300 rounded-lg outline-none bg-white focus:border-purple-500" />
                    <button type="button" id="btn-regen-ledger-id" title="Generate New Unique Ledger ID" class="p-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg transition-colors cursor-pointer shrink-0">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                      </svg>
                    </button>
                  </div>
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-slate-700 mb-1">Bill / Invoice Number *</label>
                  <input type="text" id="edit-bill-number" value="${data.billNumber || 'BIL-' + Date.now().toString().slice(-6)}" required placeholder="e.g. BIL-2026-081" class="w-full px-3 py-1.5 text-xs font-mono font-bold uppercase text-blue-800 border border-slate-300 rounded-lg outline-none bg-white" />
                </div>
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label class="block text-[11px] font-semibold text-slate-700 mb-1">Bill Date *</label>
                  <input type="date" id="edit-bill-date" value="${data.billDate || new Date().toISOString().slice(0, 10)}" required class="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white" />
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-slate-700 mb-1">Supplier Contact / Mobile</label>
                  <input type="text" id="edit-sup-phone" value="${data.supplierPhone || ''}" placeholder="+1 800-555-0199" class="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white" />
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-slate-700 mb-1">Payment Status</label>
                  <select id="edit-payment-status" class="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white font-medium">
                    <option value="Paid" ${data.paymentStatus === 'Paid' ? 'selected' : ''}>Paid in Full</option>
                    <option value="Partial" ${data.paymentStatus === 'Partial' ? 'selected' : ''}>Partial Advance</option>
                    <option value="Unpaid" ${data.paymentStatus === 'Unpaid' ? 'selected' : ''}>Credit / Unpaid</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-slate-700 mb-1">Payment Method</label>
                  <select id="edit-payment-method" class="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white font-medium">
                    <option value="Bank Transfer" ${data.paymentMethod === 'Bank Transfer' ? 'selected' : ''}>Bank Transfer</option>
                    <option value="UPI" ${data.paymentMethod === 'UPI' ? 'selected' : ''}>UPI</option>
                    <option value="Cash" ${data.paymentMethod === 'Cash' ? 'selected' : ''}>Cash</option>
                    <option value="Card" ${data.paymentMethod === 'Card' ? 'selected' : ''}>Card</option>
                    <option value="Cheque" ${data.paymentMethod === 'Cheque' ? 'selected' : ''}>Cheque</option>
                  </select>
                </div>
              </div>

              <!-- Financial & Tax Amount Breakdown Strip -->
              <div class="p-2.5 bg-white border border-blue-100 rounded-lg grid grid-cols-2 sm:grid-cols-5 gap-2.5 items-center">
                <div>
                  <label class="block text-[10px] font-bold text-slate-500 uppercase">Items Subtotal (RS)</label>
                  <input type="number" step="0.01" id="edit-bill-subtotal" value="${data.subtotal || 0}" class="w-full px-2 py-1 text-xs font-bold text-slate-800 border border-slate-200 rounded outline-none bg-slate-50" />
                </div>
                <div>
                  <label class="block text-[10px] font-bold text-slate-500 uppercase">GST / Tax Rate %</label>
                  <div class="flex items-center gap-1">
                    <input type="number" step="0.5" min="0" max="100" id="edit-bill-tax-rate" value="${data.taxRate !== undefined ? data.taxRate : 18}" class="w-full px-2 py-1 text-xs font-bold text-slate-800 border border-slate-200 rounded outline-none bg-white" />
                    <span class="text-xs font-bold text-slate-500">%</span>
                  </div>
                </div>
                <div>
                  <label class="block text-[10px] font-bold text-emerald-700 uppercase">GST / Tax Amount (RS)</label>
                  <input type="number" step="0.01" min="0" id="edit-bill-tax-total" value="${data.taxTotal || 0}" class="w-full px-2 py-1 text-xs font-bold text-emerald-700 border border-emerald-300 rounded outline-none bg-emerald-50/50" />
                </div>
                <div>
                  <label class="block text-[10px] font-bold text-amber-700 uppercase">Discount Amount (RS)</label>
                  <input type="number" step="0.01" min="0" id="edit-bill-discount-total" value="${data.discountTotal || 0}" placeholder="0.00" class="w-full px-2 py-1 text-xs font-bold text-amber-700 border border-amber-300 rounded outline-none bg-amber-50/50" />
                </div>
                <div>
                  <label class="block text-[10px] font-bold text-blue-900 uppercase">Grand Invoice Total (RS)</label>
                  <input type="number" step="0.01" id="edit-bill-grand-total" value="${data.grandTotal || 0}" class="w-full px-2 py-1 text-xs font-bold text-blue-900 border border-blue-300 rounded outline-none bg-blue-50/50" />
                </div>
              </div>
            </div>

            <!-- Optical Line Items Section -->
            <div class="space-y-2.5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <h4 class="font-bold text-slate-900 text-xs sm:text-sm">Optical Product Line Items (<span id="items-count-badge">${this.currentItems.length}</span>)</h4>
                  <span class="text-[11px] text-slate-500 font-medium">Frames, Lenses & Contact Lenses</span>
                </div>
                <div class="flex items-center flex-wrap gap-1.5">
                  <div class="text-[11px] font-semibold text-slate-600">Quick Markup:</div>
                  <button type="button" class="btn-quick-markup px-2 py-0.5 text-[10px] bg-slate-100 hover:bg-slate-200 rounded font-bold text-slate-700 transition-colors cursor-pointer" data-markup="1.6">+60%</button>
                  <button type="button" class="btn-quick-markup px-2 py-0.5 text-[10px] bg-slate-100 hover:bg-slate-200 rounded font-bold text-slate-700 transition-colors cursor-pointer" data-markup="1.8">+80%</button>
                  <button type="button" class="btn-quick-markup px-2 py-0.5 text-[10px] bg-blue-100 hover:bg-blue-200 rounded font-bold text-blue-800 transition-colors cursor-pointer" data-markup="2.0">+100%</button>
                  <div class="h-4 w-px bg-slate-300 mx-0.5"></div>
                  <button type="button" id="btn-add-frame-item" class="px-2 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1">
                    + Frame
                  </button>
                  <button type="button" id="btn-add-lens-item" class="px-2 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1">
                    + Lens
                  </button>
                  <button type="button" id="btn-add-cl-item" class="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1">
                    + Contact Lens
                  </button>
                  <button type="button" id="btn-add-item-row" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow-2xs transition-colors flex items-center gap-1 cursor-pointer">
                    + Other
                  </button>
                </div>
              </div>

              <!-- Scanner Items Search & Category Filter Toolbar -->
              <div class="flex flex-wrap items-center justify-between gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                <div class="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
                  <button type="button" class="btn-modal-cat-filter px-2.5 py-1 text-xs font-bold rounded-lg bg-slate-900 text-white cursor-pointer" data-cat="all">All</button>
                  <button type="button" class="btn-modal-cat-filter px-2.5 py-1 text-xs font-semibold rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 cursor-pointer" data-cat="Frame">Frames</button>
                  <button type="button" class="btn-modal-cat-filter px-2.5 py-1 text-xs font-semibold rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 cursor-pointer" data-cat="Lens">Lenses</button>
                  <button type="button" class="btn-modal-cat-filter px-2.5 py-1 text-xs font-semibold rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 cursor-pointer" data-cat="Contact Lens">Contact Lenses</button>
                  <button type="button" class="btn-modal-cat-filter px-2.5 py-1 text-xs font-semibold rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 cursor-pointer" data-cat="Accessories">Accessories</button>
                </div>
                <div class="relative flex-1 sm:max-w-xs min-w-[160px]">
                  <input type="text" id="input-modal-filter-search" placeholder="Search item name, brand, SKU..." class="w-full pl-7 pr-2.5 py-1 text-xs border border-slate-300 rounded-lg outline-none bg-white focus:border-blue-500" />
                  <svg class="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                </div>
              </div>

              <!-- Line Items Table -->
              <div class="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div class="overflow-x-auto">
                  <table class="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr class="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] border-b border-slate-200 whitespace-nowrap">
                        <th class="p-2 w-8 text-center">#</th>
                        <th class="p-2 min-w-[150px]">Product Name *</th>
                        <th class="p-2 min-w-[95px]">SKU / Code *</th>
                        <th class="p-2 min-w-[95px]">Barcode (EAN)</th>
                        <th class="p-2 min-w-[80px]">HSN Code</th>
                        <th class="p-2 min-w-[70px]">Size</th>
                        <th class="p-2 min-w-[80px]">Colour</th>
                        <th class="p-2 min-w-[95px]">Category *</th>
                        <th class="p-2 min-w-[85px]">Brand</th>
                        <th class="p-2 w-12 text-right">Qty *</th>
                        <th class="p-2 w-16 text-right">Cost (RS) *</th>
                        <th class="p-2 w-16 text-right">Selling (RS) *</th>
                        <th class="p-2 w-12 text-right">Tax %</th>
                        <th class="p-2 w-16 text-right">Tax Amt</th>
                        <th class="p-2 w-20 text-right">Total</th>
                        <th class="p-2 w-8 text-center"></th>
                      </tr>
                    </thead>
                    <tbody id="tbl-edit-items-body" class="divide-y divide-slate-100 text-slate-700">
                      <!-- Rendered dynamically -->
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Balance & Reconciliation Summary Bar -->
              <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center flex-wrap gap-3">
                  <div class="text-xs">
                    <span class="text-slate-500">Items Subtotal:</span>
                    <span id="summary-items-cost" class="font-bold text-slate-900 ml-1">RS 0.00</span>
                  </div>
                  <div class="h-4 w-px bg-slate-300"></div>
                  <div class="text-xs">
                    <span class="text-slate-500">Tax Amount:</span>
                    <span id="summary-tax-amount" class="font-bold text-emerald-700 ml-1">RS 0.00</span>
                  </div>
                  <div class="h-4 w-px bg-slate-300"></div>
                  <div class="text-xs">
                    <span class="text-slate-500">Discount:</span>
                    <span id="summary-discount-amount" class="font-bold text-amber-700 ml-1">- RS 0.00</span>
                  </div>
                  <div class="h-4 w-px bg-slate-300"></div>
                  <div class="text-xs">
                    <span class="text-slate-500">Net Total:</span>
                    <span id="summary-net-total" class="font-bold text-blue-900 ml-1">RS 0.00</span>
                  </div>
                  <div class="h-4 w-px bg-slate-300"></div>
                  <div class="text-xs">
                    <span class="text-slate-500">Estimated Retail Value:</span>
                    <span id="summary-retail-value" class="font-bold text-slate-700 ml-1">RS 0.00</span>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <span id="reconciliation-badge" class="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-100 text-emerald-800">Balanced</span>
                </div>
              </div>
            </div>

            <!-- Workflow Destination & Recording Options -->
            <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
              <label class="block text-xs font-bold text-slate-800">Inventory Intake Destination & Integration Options:</label>
              
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="p-2.5 bg-white border border-slate-200 rounded-lg flex items-center gap-2 cursor-pointer hover:border-blue-500 transition-colors">
                  <input type="radio" name="bill-dest-choice" value="live" ${this.defaultDest === 'live' ? 'checked' : ''} class="text-blue-600 cursor-pointer" />
                  <div>
                    <span class="font-bold text-xs text-slate-900 block">Direct to Live Catalog Stock</span>
                    <span class="text-[11px] text-slate-500">Available immediately for POS & sales</span>
                  </div>
                </label>

                <label class="p-2.5 bg-white border border-slate-200 rounded-lg flex items-center gap-2 cursor-pointer hover:border-amber-500 transition-colors">
                  <input type="radio" name="bill-dest-choice" value="pending" ${this.defaultDest === 'pending' ? 'checked' : ''} class="text-amber-600 cursor-pointer" />
                  <div>
                    <span class="font-bold text-xs text-amber-900 block">Stage in Pending Barcode Queue</span>
                    <span class="text-[11px] text-slate-500">Print optical stickers (79x10mm) before shelving</span>
                  </div>
                </label>
              </div>

              <div class="flex flex-wrap items-center gap-4 pt-1">
                <label class="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                  <input type="checkbox" id="chk-auto-supplier" checked class="rounded border-slate-300 text-blue-600 cursor-pointer" />
                  <span>Update / Register Supplier Account</span>
                </label>
                <label class="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                  <input type="checkbox" id="chk-auto-expense" checked class="rounded border-slate-300 text-blue-600 cursor-pointer" />
                  <span>Record Store Purchase Expense</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- Action Footer -->
        <div class="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100 shrink-0">
          <div class="flex items-center gap-2 w-full sm:w-auto">
            <button type="button" id="btn-print-stickers-now" class="w-full sm:w-auto px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-2xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer">
              <svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path>
              </svg>
              <span>Download 79x10mm Stickers</span>
            </button>
          </div>

          <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button type="button" id="btn-cancel-verify" class="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer">Discard</button>
            <button type="button" id="btn-save-confirm-bill" class="flex-1 sm:flex-none px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
              </svg>
              <span id="btn-save-confirm-label">Confirm & Save Purchase Bill</span>
            </button>
          </div>
        </div>
      </div>
    `;

    this.renderLineItemsTable();
    this.setupVerificationEvents();
    this.updateReconciliationSummary();
  }

  private static renderLineItemsTable() {
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    const tbody = modal.querySelector("#tbl-edit-items-body") as HTMLTableSectionElement;
    if (!tbody) return;

    if (this.currentItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" class="p-6 text-center text-slate-400">
            No items parsed yet. Click "+ Add Frame" or "+ Add Lens" above to add products manually.
          </td>
        </tr>
      `;
      return;
    }

    const catFilter = this.modalCatFilter;
    const search = this.modalSearchQuery.trim().toLowerCase();

    const filteredItems = this.currentItems.map((item, originalIndex) => ({ item, originalIndex })).filter(({ item }) => {
      if (catFilter !== "all") {
        const cat = (item.category || "").toLowerCase();
        if (catFilter === "Frame" && !(cat.includes("frame") || cat.includes("sunglass"))) return false;
        if (catFilter === "Lens" && !(cat.includes("lens") && !cat.includes("contact"))) return false;
        if (catFilter === "Contact Lens" && !cat.includes("contact")) return false;
        if (catFilter === "Accessories" && !(cat.includes("access") || cat.includes("clean") || cat.includes("case") || cat.includes("solution"))) return false;
      }

      if (search) {
        const nameMatch = (item.name || "").toLowerCase().includes(search);
        const skuMatch = (item.sku || "").toLowerCase().includes(search);
        const brandMatch = (item.brand || "").toLowerCase().includes(search);
        const modelMatch = (item.model || "").toLowerCase().includes(search);
        if (!nameMatch && !skuMatch && !brandMatch && !modelMatch) return false;
      }

      return true;
    });

    if (filteredItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" class="p-6 text-center text-slate-400">
            No items match category "${catFilter}" or search term "${search}".
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filteredItems.map(({ item, originalIndex }) => {
      const lineCost = (item.purchasePrice || 0) * (item.quantity || 1);
      const taxRate = item.taxRate !== undefined ? item.taxRate : (this.extractedData?.taxRate !== undefined ? this.extractedData.taxRate : 18);
      const taxAmt = lineCost * (taxRate / 100);
      const lineTotalWithTax = lineCost + taxAmt;

      return `
        <tr class="hover:bg-slate-50/60 transition-colors" data-index="${originalIndex}">
          <td class="p-2 text-center text-slate-400 font-mono text-[11px]">${originalIndex + 1}</td>
          <td class="p-2">
            <input type="text" class="item-field-name w-full px-2 py-1 text-xs font-semibold text-slate-900 border border-slate-300 rounded outline-none bg-white focus:border-blue-500" value="${item.name || ''}" placeholder="Product Name" />
          </td>
          <td class="p-2">
            <div class="flex items-center gap-1">
              <input type="text" class="item-field-sku w-full px-2 py-1 text-xs font-mono font-bold uppercase text-blue-700 border border-slate-300 rounded outline-none bg-white focus:border-blue-500" value="${item.sku || ''}" placeholder="SKU-101" />
              <button type="button" class="btn-gen-sku p-1 text-slate-400 hover:text-blue-600 rounded cursor-pointer" title="Auto-generate SKU">⚡</button>
            </div>
          </td>
          <td class="p-2">
            <div class="flex items-center gap-1">
              <input type="text" class="item-field-barcode w-full px-2 py-1 text-xs font-mono font-bold text-emerald-800 border border-slate-300 rounded outline-none bg-white focus:border-emerald-500" value="${item.barcode || PurchaseBillScanner.generateAutoBarcode()}" placeholder="Barcode / EAN" />
              <button type="button" class="btn-gen-barcode p-1 text-slate-400 hover:text-emerald-600 rounded cursor-pointer" title="Auto-generate / Refresh Barcode">⚡</button>
            </div>
          </td>
          <td class="p-2">
            <input type="text" class="item-field-hsn w-full px-2 py-1 text-xs font-mono text-amber-800 border border-slate-300 rounded outline-none bg-white focus:border-amber-500" value="${item.hsnCode || ''}" placeholder="HSN (e.g. 9003)" />
          </td>
          <td class="p-2">
            <input type="text" class="item-field-size w-full px-2 py-1 text-xs text-sky-800 border border-slate-300 rounded outline-none bg-white focus:border-sky-500" value="${item.size || ''}" placeholder="e.g. 54/24" />
          </td>
          <td class="p-2">
            <input type="text" class="item-field-color w-full px-2 py-1 text-xs text-purple-800 border border-slate-300 rounded outline-none bg-white focus:border-purple-500" value="${item.color || ''}" placeholder="e.g. C2, Red" />
          </td>
          <td class="p-2">
            <select class="item-field-cat w-full px-2 py-1 text-xs border border-slate-300 rounded outline-none bg-white font-medium">
              <option value="Frame" ${item.category === 'Frame' ? 'selected' : ''}>Frame</option>
              <option value="Lens" ${item.category === 'Lens' ? 'selected' : ''}>Lens</option>
              <option value="Contact Lens" ${item.category === 'Contact Lens' ? 'selected' : ''}>Contact Lens</option>
              <option value="Accessories" ${item.category === 'Accessories' ? 'selected' : ''}>Accessories</option>
              <option value="Services" ${item.category === 'Services' ? 'selected' : ''}>Services</option>
            </select>
          </td>
          <td class="p-2">
            <input type="text" class="item-field-brand w-full px-2 py-1 text-xs border border-slate-300 rounded outline-none bg-white" value="${item.brand || ''}" placeholder="Brand" />
          </td>
          <td class="p-2 text-right">
            <input type="number" min="1" class="item-field-qty w-12 px-1 py-1 text-xs font-bold text-center border border-slate-300 rounded outline-none bg-white" value="${item.quantity || 1}" />
          </td>
          <td class="p-2 text-right">
            <input type="number" step="0.01" min="0" class="item-field-cost w-16 px-1 py-1 text-xs font-bold text-right text-slate-700 border border-slate-300 rounded outline-none bg-white" value="${item.purchasePrice || 0}" />
          </td>
          <td class="p-2 text-right">
            <input type="number" step="0.01" min="0" class="item-field-selling w-16 px-1 py-1 text-xs font-bold text-right text-emerald-700 border border-slate-300 rounded outline-none bg-white" value="${item.sellingPrice || 0}" />
          </td>
          <td class="p-2 text-right">
            <input type="number" step="0.5" min="0" max="100" class="item-field-taxrate w-12 px-1 py-1 text-xs font-bold text-center text-slate-700 border border-slate-300 rounded outline-none bg-white" value="${taxRate}" />
          </td>
          <td class="p-2 text-right font-mono font-bold text-emerald-700 whitespace-nowrap text-[11px]">
            RS <span class="line-tax-val">${taxAmt.toFixed(2)}</span>
          </td>
          <td class="p-2 text-right font-mono font-bold text-slate-900 whitespace-nowrap text-[11px]">
            RS <span class="line-total-val">${lineTotalWithTax.toFixed(2)}</span>
          </td>
          <td class="p-2 text-center whitespace-nowrap">
            <button type="button" class="btn-delete-row text-rose-500 hover:text-rose-700 font-bold text-xs p-1 cursor-pointer" title="Delete Row">✕</button>
          </td>
        </tr>
      `;
    }).join("");

    const countBadge = modal.querySelector("#items-count-badge") as HTMLElement | null;
    if (countBadge) countBadge.innerText = String(this.currentItems.length);

    this.bindRowInputEvents();
  }

  private static bindRowInputEvents() {
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    modal.querySelectorAll("#tbl-edit-items-body tr").forEach(tr => {
      const idx = parseInt(tr.getAttribute("data-index") || "0", 10);
      const nameInput = tr.querySelector(".item-field-name") as HTMLInputElement;
      const skuInput = tr.querySelector(".item-field-sku") as HTMLInputElement;
      const barcodeInput = tr.querySelector(".item-field-barcode") as HTMLInputElement;
      const hsnInput = tr.querySelector(".item-field-hsn") as HTMLInputElement;
      const sizeInput = tr.querySelector(".item-field-size") as HTMLInputElement;
      const colorInput = tr.querySelector(".item-field-color") as HTMLInputElement;
      const catSelect = tr.querySelector(".item-field-cat") as HTMLSelectElement;
      const brandInput = tr.querySelector(".item-field-brand") as HTMLInputElement;
      const qtyInput = tr.querySelector(".item-field-qty") as HTMLInputElement;
      const costInput = tr.querySelector(".item-field-cost") as HTMLInputElement;
      const sellingInput = tr.querySelector(".item-field-selling") as HTMLInputElement;
      const taxRateInput = tr.querySelector(".item-field-taxrate") as HTMLInputElement;
      const genSkuBtn = tr.querySelector(".btn-gen-sku") as HTMLButtonElement;
      const genBarcodeBtn = tr.querySelector(".btn-gen-barcode") as HTMLButtonElement;
      const deleteBtn = tr.querySelector(".btn-delete-row") as HTMLButtonElement;
      const lineTaxSpan = tr.querySelector(".line-tax-val") as HTMLSpanElement;
      const lineTotalSpan = tr.querySelector(".line-total-val") as HTMLSpanElement;

      const updateRowData = () => {
        if (!this.currentItems[idx]) return;
        const qty = parseInt(qtyInput?.value || "1", 10) || 1;
        const cost = parseFloat(costInput?.value || "0") || 0;
        const selling = parseFloat(sellingInput?.value || "0") || 0;
        const taxRate = parseFloat(taxRateInput?.value || "18") || 0;

        this.currentItems[idx].name = nameInput?.value || "";
        this.currentItems[idx].sku = skuInput?.value || "";
        this.currentItems[idx].barcode = barcodeInput?.value?.trim() || undefined;
        this.currentItems[idx].hsnCode = hsnInput?.value?.trim() || undefined;
        this.currentItems[idx].size = sizeInput?.value?.trim() || undefined;
        this.currentItems[idx].color = colorInput?.value?.trim() || undefined;
        this.currentItems[idx].category = (catSelect?.value as any) || "Frame";
        this.currentItems[idx].brand = brandInput?.value || "";
        this.currentItems[idx].quantity = qty;
        this.currentItems[idx].purchasePrice = cost;
        this.currentItems[idx].sellingPrice = selling;
        this.currentItems[idx].taxRate = taxRate;

        const lineCost = qty * cost;
        const taxAmt = lineCost * (taxRate / 100);
        const lineTotal = lineCost + taxAmt;

        if (lineTaxSpan) lineTaxSpan.innerText = taxAmt.toFixed(2);
        if (lineTotalSpan) lineTotalSpan.innerText = lineTotal.toFixed(2);

        this.updateReconciliationSummary();
      };

      [nameInput, skuInput, barcodeInput, hsnInput, sizeInput, colorInput, catSelect, brandInput, qtyInput, costInput, sellingInput, taxRateInput].forEach(el => {
        el?.addEventListener("input", updateRowData);
      });

      genSkuBtn?.addEventListener("click", () => {
        const cat = catSelect?.value || "FRM";
        const prefix = cat === "Frame" ? "FRM" : cat === "Lens" ? "LNS" : cat === "Contact Lens" ? "CL" : "ACC";
        const newSku = `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
        if (skuInput) {
          skuInput.value = newSku;
          updateRowData();
        }
      });

      genBarcodeBtn?.addEventListener("click", () => {
        const newBarcode = PurchaseBillScanner.generateAutoBarcode();
        if (barcodeInput) {
          barcodeInput.value = newBarcode;
          updateRowData();
        }
      });

      deleteBtn?.addEventListener("click", () => {
        this.currentItems.splice(idx, 1);
        this.renderLineItemsTable();
        this.updateReconciliationSummary();
      });
    });
  }

  private static updateReconciliationSummary() {
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    let totalSubtotal = 0;
    let totalTax = 0;
    let totalRetailValue = 0;

    const globalTaxRateInput = modal.querySelector("#edit-bill-tax-rate") as HTMLInputElement | null;
    const globalTaxRate = parseFloat(globalTaxRateInput?.value || "18") || 0;

    this.currentItems.forEach(item => {
      const q = item.quantity || 1;
      const cost = item.purchasePrice || 0;
      const lineCost = cost * q;
      const rate = item.taxRate !== undefined ? item.taxRate : globalTaxRate;
      const taxAmt = lineCost * (rate / 100);

      totalSubtotal += lineCost;
      totalTax += taxAmt;
      totalRetailValue += (item.sellingPrice || 0) * q;
    });

    const subtotalInput = modal.querySelector("#edit-bill-subtotal") as HTMLInputElement | null;
    const taxTotalInput = modal.querySelector("#edit-bill-tax-total") as HTMLInputElement | null;
    const discountTotalInput = modal.querySelector("#edit-bill-discount-total") as HTMLInputElement | null;
    const grandTotalInput = modal.querySelector("#edit-bill-grand-total") as HTMLInputElement | null;
    const badge = modal.querySelector("#reconciliation-badge") as HTMLSpanElement | null;

    const discountAmount = parseFloat(discountTotalInput?.value || "0") || 0;
    const calculatedGrandTotal = Math.max(0, totalSubtotal + totalTax - discountAmount);

    const itemsCostEl = modal.querySelector("#summary-items-cost") as HTMLElement | null;
    const taxAmountEl = modal.querySelector("#summary-tax-amount") as HTMLElement | null;
    const discountAmountEl = modal.querySelector("#summary-discount-amount") as HTMLElement | null;
    const netTotalEl = modal.querySelector("#summary-net-total") as HTMLElement | null;
    const retailValEl = modal.querySelector("#summary-retail-value") as HTMLElement | null;

    if (itemsCostEl) itemsCostEl.innerText = `RS ${totalSubtotal.toFixed(2)}`;
    if (taxAmountEl) taxAmountEl.innerText = `RS ${totalTax.toFixed(2)}`;
    if (discountAmountEl) discountAmountEl.innerText = `- RS ${discountAmount.toFixed(2)}`;
    if (netTotalEl) netTotalEl.innerText = `RS ${calculatedGrandTotal.toFixed(2)}`;
    if (retailValEl) retailValEl.innerText = `RS ${totalRetailValue.toFixed(2)}`;

    if (subtotalInput && !document.activeElement?.isSameNode(subtotalInput)) {
      subtotalInput.value = totalSubtotal.toFixed(2);
    }
    if (taxTotalInput && !document.activeElement?.isSameNode(taxTotalInput)) {
      taxTotalInput.value = totalTax.toFixed(2);
    }
    if (grandTotalInput && !document.activeElement?.isSameNode(grandTotalInput)) {
      grandTotalInput.value = calculatedGrandTotal.toFixed(2);
    }

    const enteredGrandTotal = parseFloat(grandTotalInput?.value || "0") || calculatedGrandTotal;
    if (badge) {
      const diff = Math.abs(enteredGrandTotal - calculatedGrandTotal);
      if (enteredGrandTotal === 0 || diff < 1.0) {
        badge.className = "px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-100 text-emerald-800";
        badge.innerText = "Balanced";
      } else {
        badge.className = "px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-100 text-amber-900";
        badge.innerText = `Diff: RS ${diff.toFixed(2)}`;
      }
    }
  }

  private static setupVerificationEvents() {
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    modal.querySelector("#btn-close-edit-modal")?.addEventListener("click", () => this.closeModal());
    modal.querySelector("#btn-cancel-verify")?.addEventListener("click", () => this.closeModal());
    modal.querySelector("#btn-rescan-bill")?.addEventListener("click", () => this.showIntakeStep());

    // Supplier Name change listener to auto-populate or suggest unique Ledger ID
    const supNameInput = modal.querySelector("#edit-sup-name") as HTMLInputElement | null;
    const supLedgerInput = modal.querySelector("#edit-sup-ledger") as HTMLInputElement | null;
    const supPhoneInput = modal.querySelector("#edit-sup-phone") as HTMLInputElement | null;
    const matchIndicator = modal.querySelector("#supplier-match-indicator") as HTMLElement | null;
    const ledgerBadge = modal.querySelector("#ledger-uniqueness-badge") as HTMLElement | null;

    const updateSupplierMatchState = (forceRegen = false) => {
      const val = supNameInput?.value.trim() || "";
      const matched = this.registeredSuppliers.find(s => s.name && s.name.trim().toLowerCase() === val.toLowerCase());

      if (matched) {
        if (supLedgerInput) supLedgerInput.value = matched.ledgerId;
        if (supPhoneInput && !supPhoneInput.value) supPhoneInput.value = matched.mobile || (matched as any).phone || "";
        if (matchIndicator) {
          matchIndicator.innerHTML = `<span class="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md font-bold text-[10px]">✓ Registered Supplier: ${matched.ledgerId}</span>`;
        }
        if (ledgerBadge) {
          ledgerBadge.className = "text-[10px] text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200";
          ledgerBadge.innerText = "Registered Supplier";
        }
      } else if (val) {
        const currentVal = supLedgerInput?.value.trim().toUpperCase() || "";
        const isGeneric = !currentVal || currentVal === "LED-SUP-01" || currentVal === "LED-SUP-1" || currentVal === "LED-SUP";
        const conflict = this.registeredSuppliers.some(s => s.ledgerId && s.ledgerId.trim().toUpperCase() === currentVal);

        if (forceRegen || isGeneric || conflict) {
          const uniqueId = generateUniqueSupplierLedgerId(val, this.registeredSuppliers);
          if (supLedgerInput) supLedgerInput.value = uniqueId;
        }

        const activeLedger = supLedgerInput?.value || "";
        if (matchIndicator) {
          matchIndicator.innerHTML = `<span class="text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md font-bold text-[10px]">★ New Supplier (Unique ID: ${activeLedger})</span>`;
        }
        if (ledgerBadge) {
          ledgerBadge.className = "text-[10px] text-purple-700 font-bold bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200";
          ledgerBadge.innerText = "Unique ID Assigned";
        }
      } else {
        if (matchIndicator) matchIndicator.innerHTML = "";
      }
    };

    supNameInput?.addEventListener("input", () => updateSupplierMatchState(true));

    supLedgerInput?.addEventListener("input", () => {
      const entered = supLedgerInput.value.trim().toUpperCase();
      const conflict = this.registeredSuppliers.find(s => (s.ledgerId || "").trim().toUpperCase() === entered);
      const currentSupName = supNameInput?.value.trim().toLowerCase() || "";

      if (conflict && conflict.name.toLowerCase() !== currentSupName) {
        if (ledgerBadge) {
          ledgerBadge.className = "text-[10px] text-rose-700 font-bold bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200";
          ledgerBadge.innerText = `⚠️ Conflict with ${conflict.name}`;
        }
      } else if (entered) {
        if (ledgerBadge) {
          ledgerBadge.className = "text-[10px] text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200";
          ledgerBadge.innerText = "✓ Valid Unique ID";
        }
      }
    });

    modal.querySelector("#btn-regen-ledger-id")?.addEventListener("click", () => {
      const supName = supNameInput?.value.trim() || "Supplier";
      const newLedgerId = generateUniqueSupplierLedgerId(supName, this.registeredSuppliers);
      if (supLedgerInput) {
        supLedgerInput.value = newLedgerId;
        if (ledgerBadge) {
          ledgerBadge.className = "text-[10px] text-purple-700 font-bold bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200";
          ledgerBadge.innerText = "Unique ID Assigned";
        }
        if (matchIndicator && !this.registeredSuppliers.some(s => s.name.toLowerCase() === supName.toLowerCase())) {
          matchIndicator.innerHTML = `<span class="text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md font-bold text-[10px]">★ New Supplier (Unique ID: ${newLedgerId})</span>`;
        }
        Toast.show(`Generated Unique Supplier Ledger ID: ${newLedgerId}`, "info");
      }
    });

    // Run initial match state verification
    updateSupplierMatchState(false);

    // Category filter pills in verification modal
    modal.querySelectorAll(".btn-modal-cat-filter").forEach(btn => {
      btn.addEventListener("click", () => {
        const cat = btn.getAttribute("data-cat") || "all";
        this.modalCatFilter = cat;

        modal.querySelectorAll(".btn-modal-cat-filter").forEach(b => {
          b.className = "btn-modal-cat-filter px-2.5 py-1 text-xs font-semibold rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 cursor-pointer";
        });
        btn.className = "btn-modal-cat-filter px-2.5 py-1 text-xs font-bold rounded-lg bg-slate-900 text-white cursor-pointer";

        this.renderLineItemsTable();
      });
    });

    // Search filter input in verification modal
    const searchInput = modal.querySelector("#input-modal-filter-search") as HTMLInputElement | null;
    searchInput?.addEventListener("input", () => {
      this.modalSearchQuery = searchInput.value;
      this.renderLineItemsTable();
    });

    // Tax Rate & Financial inputs change listener
    const taxRateInput = modal.querySelector("#edit-bill-tax-rate") as HTMLInputElement | null;
    const taxTotalInput = modal.querySelector("#edit-bill-tax-total") as HTMLInputElement | null;
    const discountTotalInput = modal.querySelector("#edit-bill-discount-total") as HTMLInputElement | null;
    const subtotalInput = modal.querySelector("#edit-bill-subtotal") as HTMLInputElement | null;
    const grandTotalInput = modal.querySelector("#edit-bill-grand-total") as HTMLInputElement | null;

    taxRateInput?.addEventListener("input", () => {
      const rate = parseFloat(taxRateInput.value) || 0;
      this.currentItems.forEach(item => {
        item.taxRate = rate;
      });
      this.renderLineItemsTable();
      this.updateReconciliationSummary();
    });

    discountTotalInput?.addEventListener("input", () => {
      const sub = parseFloat(subtotalInput?.value || "0") || 0;
      const tax = parseFloat(taxTotalInput?.value || "0") || 0;
      const disc = parseFloat(discountTotalInput.value) || 0;
      if (grandTotalInput && !document.activeElement?.isSameNode(grandTotalInput)) {
        grandTotalInput.value = Math.max(0, sub + tax - disc).toFixed(2);
      }
      this.updateReconciliationSummary();
    });

    taxTotalInput?.addEventListener("input", () => {
      const sub = parseFloat(subtotalInput?.value || "0") || 0;
      const tax = parseFloat(taxTotalInput.value) || 0;
      const disc = parseFloat(discountTotalInput?.value || "0") || 0;
      if (grandTotalInput && !document.activeElement?.isSameNode(grandTotalInput)) {
        grandTotalInput.value = Math.max(0, sub + tax - disc).toFixed(2);
      }
      this.updateReconciliationSummary();
    });

    subtotalInput?.addEventListener("input", () => {
      const sub = parseFloat(subtotalInput.value) || 0;
      const rate = parseFloat(taxRateInput?.value || "18") || 0;
      const tax = sub * (rate / 100);
      const disc = parseFloat(discountTotalInput?.value || "0") || 0;
      if (taxTotalInput) taxTotalInput.value = tax.toFixed(2);
      if (grandTotalInput && !document.activeElement?.isSameNode(grandTotalInput)) {
        grandTotalInput.value = Math.max(0, sub + tax - disc).toFixed(2);
      }
      this.updateReconciliationSummary();
    });

    grandTotalInput?.addEventListener("input", () => {
      this.updateReconciliationSummary();
    });

    // Quick Add Optical Categories
    modal.querySelector("#btn-add-frame-item")?.addEventListener("click", () => {
      this.currentItems.push({
        name: "Ray-Ban Aviator / Wayfarer Frame",
        sku: `FRM-${Math.floor(1000 + Math.random() * 9000)}`,
        barcode: PurchaseBillScanner.generateAutoBarcode(),
        hsnCode: "9003",
        size: "54/24",
        color: "C2 / Gold",
        category: "Frame",
        brand: "Ray-Ban",
        model: "52-18-140",
        quantity: 1,
        purchasePrice: 60.00,
        sellingPrice: 120.00,
        minStockLevel: 3
      });
      this.renderLineItemsTable();
      this.updateReconciliationSummary();
    });

    modal.querySelector("#btn-add-lens-item")?.addEventListener("click", () => {
      this.currentItems.push({
        name: "Essilor Crizal Single Vision Lens",
        sku: `LNS-${Math.floor(1000 + Math.random() * 9000)}`,
        barcode: PurchaseBillScanner.generateAutoBarcode(),
        hsnCode: "9001",
        size: "1.60 Index",
        color: "Clear / Blue-Cut",
        category: "Lens",
        brand: "Essilor",
        model: "1.60 Index AR",
        quantity: 2,
        purchasePrice: 40.00,
        sellingPrice: 85.00,
        minStockLevel: 4
      });
      this.renderLineItemsTable();
      this.updateReconciliationSummary();
    });

    modal.querySelector("#btn-add-cl-item")?.addEventListener("click", () => {
      this.currentItems.push({
        name: "Acuvue Oasys Daily Contact Lenses (30PK)",
        sku: `CL-${Math.floor(1000 + Math.random() * 9000)}`,
        barcode: PurchaseBillScanner.generateAutoBarcode(),
        hsnCode: "9001",
        size: "8.5 BC",
        color: "Clear",
        category: "Contact Lens",
        brand: "Johnson & Johnson",
        model: "8.5 BC / -2.50 D",
        quantity: 5,
        purchasePrice: 25.00,
        sellingPrice: 45.00,
        minStockLevel: 5
      });
      this.renderLineItemsTable();
      this.updateReconciliationSummary();
    });

    // View full original document
    modal.querySelector("#btn-view-full-doc")?.addEventListener("click", () => {
      if (this.currentFileData?.previewUrl) {
        const w = window.open("");
        if (w) {
          if (this.currentFileData.mimeType.includes("pdf")) {
            w.document.write(`<iframe src="${this.currentFileData.previewUrl}" style="border:0; top:0; left:0; bottom:0; right:0; width:100%; height:100%;"></iframe>`);
          } else {
            w.document.write(`<img src="${this.currentFileData.previewUrl}" style="max-width:100%; height:auto; display:block; margin:20px auto;" />`);
          }
        }
      }
    });

    // Add New Line Item Button (Other)
    modal.querySelector("#btn-add-item-row")?.addEventListener("click", () => {
      this.currentItems.push({
        name: "Lens Cleaning Solution / Optical Case",
        sku: `ACC-${Math.floor(1000 + Math.random() * 9000)}`,
        barcode: PurchaseBillScanner.generateAutoBarcode(),
        hsnCode: "9004",
        size: "60ml",
        color: "Blue",
        category: "Accessories",
        brand: "OptiWay",
        model: "60ml Spray",
        quantity: 10,
        purchasePrice: 4.00,
        sellingPrice: 10.00,
        minStockLevel: 5
      });
      this.renderLineItemsTable();
      this.updateReconciliationSummary();
    });

    // Quick Markup Buttons
    modal.querySelectorAll(".btn-quick-markup").forEach(btn => {
      btn.addEventListener("click", () => {
        const factor = parseFloat(btn.getAttribute("data-markup") || "2.0");
        this.currentItems.forEach(item => {
          if (item.purchasePrice > 0) {
            item.sellingPrice = Math.round(item.purchasePrice * factor);
          }
        });
        this.renderLineItemsTable();
        this.updateReconciliationSummary();
        Toast.show(`Applied ${Math.round((factor - 1) * 100)}% markup across all items!`, "info");
      });
    });

    // Download 79x10mm stickers now
    modal.querySelector("#btn-print-stickers-now")?.addEventListener("click", async () => {
      await this.downloadStickersForCurrentItems();
    });

    // Save & Confirm Purchase Bill Button
    modal.querySelector("#btn-save-confirm-bill")?.addEventListener("click", () => {
      this.saveAndConfirmPurchaseBill();
    });
  }

  private static async downloadStickersForCurrentItems() {
    if (this.currentItems.length === 0) {
      Toast.show("No items to print stickers for.", "error");
      return;
    }

    const stickers: Sticker79x10Item[] = [];
    this.currentItems.forEach(item => {
      const count = item.quantity || 1;
      const detailParts = [];
      if (item.model) detailParts.push(item.model);
      if (item.size) detailParts.push(`Sz:${item.size}`);
      if (item.color) detailParts.push(`Col:${item.color}`);
      const modelDetail = detailParts.join(" ") || item.modelNumber || item.sku || "";

      for (let i = 0; i < count; i++) {
        stickers.push({
          brand: item.brand || item.category || "OptiWay",
          price: `RS ${(item.sellingPrice || 0).toFixed(2)}`,
          model: modelDetail,
          barcodeCode: item.barcode || item.modelNumber || item.sku || "000000",
          type: "CODE128",
          storeName: this.storeName
        });
      }
    });

    Toast.show(`Generating ${stickers.length} optical barcode stickers (79x10mm)...`, "info");
    await BarcodePrinter.downloadExact79x10mmPdf(stickers, `stickers_bill_${this.extractedData?.billNumber || 'scan'}.pdf`);
    Toast.show(`Stickers PDF successfully generated and downloaded!`, "success");
  }

  /**
   * Final Step: Commit items to Live Catalog or Pending Queue + Supplier & Expense updates
   */
  private static async saveAndConfirmPurchaseBill() {
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    const supName = (modal.querySelector("#edit-sup-name") as HTMLInputElement)?.value.trim();
    const supLedger = (modal.querySelector("#edit-sup-ledger") as HTMLInputElement)?.value.trim() || "LED-SUP-01";
    const billNumber = (modal.querySelector("#edit-bill-number") as HTMLInputElement)?.value.trim() || `BIL-${Date.now().toString().slice(-6)}`;
    const billDate = (modal.querySelector("#edit-bill-date") as HTMLInputElement)?.value || new Date().toISOString().slice(0, 10);
    const paymentStatus = ((modal.querySelector("#edit-payment-status") as HTMLSelectElement)?.value || "Paid") as "Paid" | "Unpaid" | "Partial";
    const paymentMethod = (modal.querySelector("#edit-payment-method") as HTMLSelectElement)?.value || "Bank Transfer";
    const grandTotal = parseFloat((modal.querySelector("#edit-bill-grand-total") as HTMLInputElement)?.value || "0") || 0;
    const destRadio = modal.querySelector('input[name="bill-dest-choice"]:checked') as HTMLInputElement;
    const destination = (destRadio?.value || "live") as "live" | "pending";
    const autoSupplier = (modal.querySelector("#chk-auto-supplier") as HTMLInputElement)?.checked;
    const autoExpense = (modal.querySelector("#chk-auto-expense") as HTMLInputElement)?.checked;

    if (!supName) {
      Toast.show("Please enter the Supplier Company Name.", "error");
      return;
    }

    if (this.currentItems.length === 0) {
      Toast.show("Please add at least one line item.", "error");
      return;
    }

    const saveBtn = modal.querySelector("#btn-save-confirm-bill") as HTMLButtonElement;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> <span>Saving Bill & Stock...</span>`;
    }

    try {
      // 1. Process & Save Each Item into Live Catalog or Pending Queue
      const batchId = `BATCH-${billNumber.replace(/[^a-zA-Z0-9]/g, "")}-${Date.now().toString().slice(-4)}`;
      let confirmedCount = 0;

      for (const item of this.currentItems) {
        if (!item.name) continue;
        const itemModelNumber = item.modelNumber || item.sku || `MOD-${Math.floor(1000 + Math.random() * 9000)}`;

        if (destination === "live") {
          // Direct Live Stock: check if product exists by Model Number or barcode
          const liveProducts = await dbService.getList<Product>("products");
          const existing = liveProducts.find(p => 
            (p.modelNumber && p.modelNumber.trim().toLowerCase() === itemModelNumber.trim().toLowerCase()) ||
            (p.sku && p.sku.trim().toLowerCase() === itemModelNumber.trim().toLowerCase()) ||
            (item.barcode && p.barcode && p.barcode.trim() === item.barcode.trim())
          );

          if (existing) {
            const prevStock = existing.stockQuantity || 0;
            const newStock = prevStock + (item.quantity || 1);
            await dbService.saveItem("products", {
              ...existing,
              name: item.name || existing.name,
              modelNumber: item.modelNumber || existing.modelNumber || itemModelNumber,
              sku: item.modelNumber || existing.sku || itemModelNumber,
              category: item.category || existing.category,
              brand: item.brand || existing.brand,
              barcode: item.barcode || existing.barcode,
              hsnCode: item.hsnCode || existing.hsnCode,
              size: item.size || existing.size,
              color: item.color || existing.color,
              purchasePrice: item.purchasePrice || existing.purchasePrice,
              sellingPrice: item.sellingPrice || existing.sellingPrice,
              stockQuantity: newStock,
              supplierName: supName,
              supplierLedgerId: supLedger,
              billNumber: billNumber
            });

            await dbService.saveItem("inventoryLogs", {
              productId: existing.id,
              productName: existing.name,
              type: "Stock-In",
              quantityChange: item.quantity || 1,
              previousQuantity: prevStock,
              newQuantity: newStock,
              reason: `Direct Bill Purchase Scan (Bill #${billNumber}, Supplier: ${supName})`,
              createdAt: new Date().toISOString(),
              user: "Bill Scanner"
            } as Partial<InventoryMovement>);
          } else {
            const newProductPayload: Partial<Product> = {
              name: item.name,
              modelNumber: itemModelNumber,
              sku: itemModelNumber,
              barcode: item.barcode || undefined,
              hsnCode: item.hsnCode || undefined,
              size: item.size || undefined,
              color: item.color || undefined,
              category: item.category || "Frame",
              brand: item.brand || "OptiWay",
              model: item.model || "",
              sellingPrice: item.sellingPrice || 0,
              purchasePrice: item.purchasePrice || 0,
              stockQuantity: item.quantity || 1,
              minStockLevel: item.minStockLevel || 3,
              supplierName: supName,
              supplierLedgerId: supLedger,
              billNumber: billNumber,
              status: "Active",
              createdAt: new Date().toISOString()
            };
            const newId = await dbService.saveItem("products", newProductPayload);

            await dbService.saveItem("inventoryLogs", {
              productId: newId,
              productName: item.name,
              type: "Stock-In",
              quantityChange: item.quantity || 1,
              previousQuantity: 0,
              newQuantity: item.quantity || 1,
              reason: `Direct Bill Purchase Scan - New Product (Bill #${billNumber}, Supplier: ${supName})`,
              createdAt: new Date().toISOString(),
              user: "Bill Scanner"
            } as Partial<InventoryMovement>);
          }
        } else {
          // Staged in Pending Queue (for optical sticker printing / barcode verification)
          const pendingPayload: Partial<PendingProduct> = {
            name: item.name,
            modelNumber: itemModelNumber,
            sku: itemModelNumber,
            barcode: item.barcode || undefined,
            hsnCode: item.hsnCode || undefined,
            size: item.size || undefined,
            color: item.color || undefined,
            category: item.category || "Frame",
            brand: item.brand || "OptiWay",
            model: item.model || "",
            sellingPrice: item.sellingPrice || 0,
            purchasePrice: item.purchasePrice || 0,
            stockQuantity: item.quantity || 1,
            minStockLevel: item.minStockLevel || 3,
            supplierName: supName,
            supplierLedgerId: supLedger,
            billNumber: billNumber,
            status: "Pending",
            batchId: batchId,
            createdAt: new Date().toISOString(),
            notes: `Scanned from Purchase Bill #${billNumber}`
          };
          await dbService.saveItem("pendingProducts", pendingPayload);
        }
        confirmedCount++;
      }

      // 2. Save Purchase Bill Record
      const billSubtotal = parseFloat((modal.querySelector("#edit-bill-subtotal") as HTMLInputElement)?.value || "0") || (grandTotal - (this.extractedData?.taxTotal || 0) + (this.extractedData?.discountTotal || 0));
      const billTaxRate = parseFloat((modal.querySelector("#edit-bill-tax-rate") as HTMLInputElement)?.value || "18") || 18;
      const billTaxTotal = parseFloat((modal.querySelector("#edit-bill-tax-total") as HTMLInputElement)?.value || "0") || (this.extractedData?.taxTotal || 0);
      const billDiscountTotal = parseFloat((modal.querySelector("#edit-bill-discount-total") as HTMLInputElement)?.value || "0") || (this.extractedData?.discountTotal || 0);

      const purchaseBillRecord: Partial<PurchaseBill> = {
        billNumber: billNumber,
        supplierName: supName,
        supplierLedgerId: supLedger,
        supplierPhone: (modal.querySelector("#edit-sup-phone") as HTMLInputElement)?.value || "",
        billDate: billDate,
        paymentStatus: paymentStatus,
        paymentMethod: paymentMethod,
        subtotal: billSubtotal,
        taxRate: billTaxRate,
        taxTotal: billTaxTotal,
        discountTotal: billDiscountTotal,
        grandTotal: grandTotal,
        items: this.currentItems,
        destination: destination,
        fileName: this.currentFileData?.fileName || "scanned_bill.pdf",
        createdAt: new Date().toISOString()
      };
      const savedBillId = await dbService.saveItem("purchaseBills", purchaseBillRecord);

      // 3. Update or Register Supplier
      if (autoSupplier) {
        const existingSup = this.registeredSuppliers.find(
          s => (s.name && s.name.trim().toLowerCase() === supName.toLowerCase()) ||
               (s.ledgerId && s.ledgerId.trim().toUpperCase() === supLedger.toUpperCase())
        );

        if (existingSup) {
          const addBalance = paymentStatus === "Unpaid" ? grandTotal : (paymentStatus === "Partial" ? grandTotal / 2 : 0);
          await dbService.saveItem("suppliers", {
            ...existingSup,
            ledgerId: existingSup.ledgerId || supLedger,
            outstandingBalance: (existingSup.outstandingBalance || 0) + addBalance
          });
        } else {
          // Verify that supLedger is strictly unique; otherwise generate a guaranteed unique ID
          let finalLedger = supLedger.trim().toUpperCase();
          const ledgerConflict = this.registeredSuppliers.find(s => (s.ledgerId || "").trim().toUpperCase() === finalLedger);
          if (!finalLedger || ledgerConflict) {
            finalLedger = generateUniqueSupplierLedgerId(supName, this.registeredSuppliers);
          }

          await dbService.saveItem("suppliers", {
            name: supName,
            ledgerId: finalLedger,
            mobile: (modal.querySelector("#edit-sup-phone") as HTMLInputElement)?.value || "+1 800-000-0000",
            outstandingBalance: paymentStatus === "Unpaid" ? grandTotal : 0,
            productsSupplied: this.currentItems.map(i => i.brand || i.category).filter(Boolean).join(", "),
            createdAt: new Date().toISOString()
          } as Partial<Supplier>);
        }
      }

      // 4. Record Expense Entry if checked
      if (autoExpense && grandTotal > 0) {
        const expensePayload: Partial<Expense> = {
          category: "Stock & Inventory",
          amount: grandTotal,
          date: billDate,
          expenseDate: billDate,
          description: `Direct Purchase Bill #${billNumber} (${supName} - ${confirmedCount} items)`,
          paymentMethod: (paymentMethod as any) || "Bank Transfer",
          createdAt: new Date().toISOString()
        };
        await dbService.saveItem("expenses", expensePayload);
      }

      Toast.show(
        destination === "live"
          ? `Success! Bill #${billNumber} confirmed. ${confirmedCount} items added to Live Stock!`
          : `Success! Bill #${billNumber} staged. ${confirmedCount} items added to Pending Queue for stickers!`,
        "success"
      );

      this.closeModal();

      if (this.onCompleteCallback) {
        this.onCompleteCallback({ ...purchaseBillRecord, id: savedBillId } as PurchaseBill);
      }
    } catch (err: any) {
      console.error("Save purchase bill error:", err);
      Toast.show("Failed to save purchase bill: " + err.message, "error");
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerText = "Confirm & Save Purchase Bill";
      }
    }
  }

  /**
   * Pre-loaded sample optical invoices for rapid demonstration and verification
   */
  private static loadSampleBill(sampleKey: string) {
    if (sampleKey === "essilor") {
      this.extractedData = {
        supplierName: "EssilorLuxottica Optical",
        supplierLedgerId: "LED-ESS-01",
        supplierPhone: "+1 800-422-2020",
        supplierTaxId: "GST-ESS-992144",
        billNumber: `BIL-ESS-${Math.floor(1000 + Math.random() * 9000)}`,
        billDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "Paid",
        paymentMethod: "Bank Transfer",
        subtotal: 1280.00,
        taxTotal: 195.00,
        grandTotal: 1475.00,
        items: [
          {
            name: "Ray-Ban Wayfarer Classic RB2140",
            sku: "FRM-RB2140",
            barcode: PurchaseBillScanner.generateAutoBarcode(),
            hsnCode: "9003",
            size: "50/22",
            color: "C1 / Black",
            category: "Frame",
            brand: "Ray-Ban",
            model: "RB2140 Black 50mm",
            quantity: 8,
            purchasePrice: 85.00,
            sellingPrice: 165.00,
            minStockLevel: 3
          },
          {
            name: "Ray-Ban Aviator Classic Gold RB3025",
            sku: "FRM-RB3025",
            barcode: PurchaseBillScanner.generateAutoBarcode(),
            hsnCode: "9003",
            size: "58/14",
            color: "C2 / Gold",
            category: "Frame",
            brand: "Ray-Ban",
            model: "RB3025 Arista Gold 58mm",
            quantity: 5,
            purchasePrice: 90.00,
            sellingPrice: 175.00,
            minStockLevel: 2
          },
          {
            name: "Essilor Crizal Sapphire Single Vision 1.6",
            sku: "LNS-ESS-CRZ16",
            barcode: PurchaseBillScanner.generateAutoBarcode(),
            hsnCode: "9001",
            size: "1.60 Index",
            color: "Clear / Anti-Glare",
            category: "Lens",
            brand: "Essilor",
            model: "1.60 Index Anti-Reflective Crizal",
            quantity: 10,
            purchasePrice: 35.00,
            sellingPrice: 95.00,
            minStockLevel: 5
          }
        ]
      };
    } else if (sampleKey === "zeiss") {
      this.extractedData = {
        supplierName: "Zeiss Vision Care",
        supplierLedgerId: "LED-ZSS-02",
        supplierPhone: "+1 800-338-2984",
        supplierTaxId: "GST-ZSS-883100",
        billNumber: `BIL-ZSS-${Math.floor(1000 + Math.random() * 9000)}`,
        billDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "Partial",
        paymentMethod: "Bank Transfer",
        subtotal: 890.00,
        taxTotal: 135.00,
        grandTotal: 1025.00,
        items: [
          {
            name: "Zeiss Single Vision ClearView 1.60",
            sku: "LNS-ZS160-CR",
            barcode: PurchaseBillScanner.generateAutoBarcode(),
            hsnCode: "9001",
            size: "1.60 Index",
            color: "Clear / Platinum AR",
            category: "Lens",
            brand: "Zeiss",
            model: "DuraVision Platinum 1.60",
            quantity: 12,
            purchasePrice: 45.00,
            sellingPrice: 120.00,
            minStockLevel: 4
          },
          {
            name: "Zeiss PhotoFusion X Extra Grey 1.56",
            sku: "LNS-ZS-PFX156",
            barcode: PurchaseBillScanner.generateAutoBarcode(),
            hsnCode: "9001",
            size: "1.56 Index",
            color: "Extra Grey Photochromic",
            category: "Lens",
            brand: "Zeiss",
            model: "Photochromic 1.56 Index",
            quantity: 8,
            purchasePrice: 55.00,
            sellingPrice: 140.00,
            minStockLevel: 3
          }
        ]
      };
    } else if (sampleKey === "contactlens") {
      this.extractedData = {
        supplierName: "Johnson & Johnson Vision",
        supplierLedgerId: "LED-JNJ-03",
        supplierPhone: "+1 800-874-5278",
        supplierTaxId: "GST-JNJ-771120",
        billNumber: `BIL-JNJ-${Math.floor(1000 + Math.random() * 9000)}`,
        billDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "Paid",
        paymentMethod: "UPI",
        subtotal: 640.00,
        taxTotal: 76.80,
        grandTotal: 716.80,
        items: [
          {
            name: "Acuvue Oasys with HydraLuxe 30PK",
            sku: "CL-ACV-OAS30",
            barcode: PurchaseBillScanner.generateAutoBarcode(),
            hsnCode: "9001",
            size: "8.5 BC",
            color: "Clear",
            category: "Contact Lens",
            brand: "Johnson & Johnson",
            model: "Daily Disposable 8.5 BC",
            quantity: 20,
            purchasePrice: 21.00,
            sellingPrice: 38.50,
            minStockLevel: 10
          },
          {
            name: "1-Day Acuvue Moist 90PK",
            sku: "CL-ACV-MST90",
            barcode: PurchaseBillScanner.generateAutoBarcode(),
            hsnCode: "9001",
            size: "8.5 BC",
            color: "Clear",
            category: "Contact Lens",
            brand: "Johnson & Johnson",
            model: "Daily Moisture Lock 8.5 BC",
            quantity: 10,
            purchasePrice: 42.00,
            sellingPrice: 75.00,
            minStockLevel: 5
          }
        ]
      };
    } else {
      this.extractedData = {
        supplierName: "OptiWay Optical Distribution",
        supplierLedgerId: "LED-DIR-04",
        supplierPhone: "+1 800-555-6784",
        billNumber: `BIL-ACC-${Math.floor(1000 + Math.random() * 9000)}`,
        billDate: new Date().toISOString().slice(0, 10),
        paymentStatus: "Paid",
        paymentMethod: "Cash",
        subtotal: 420.00,
        taxTotal: 50.40,
        grandTotal: 470.40,
        items: [
          {
            name: "Anti-Fog Lens Cleaning Spray 60ml",
            sku: "ACC-CLN-SP60",
            barcode: PurchaseBillScanner.generateAutoBarcode(),
            hsnCode: "9004",
            size: "60ml",
            color: "Blue",
            category: "Accessories",
            brand: "OptiWay",
            model: "Microfiber cloth included",
            quantity: 30,
            purchasePrice: 4.00,
            sellingPrice: 12.00,
            minStockLevel: 10
          },
          {
            name: "Deluxe Hard Shell Eyeglass Case",
            sku: "ACC-CSE-DLX",
            barcode: PurchaseBillScanner.generateAutoBarcode(),
            hsnCode: "9004",
            size: "Standard",
            color: "Black Velvet",
            category: "Accessories",
            brand: "OptiWay",
            model: "Velvet interior lining",
            quantity: 25,
            purchasePrice: 5.50,
            sellingPrice: 15.00,
            minStockLevel: 8
          },
          {
            name: "Precision Optical Screwdriver Keychain",
            sku: "ACC-TLS-SCR",
            barcode: PurchaseBillScanner.generateAutoBarcode(),
            hsnCode: "9004",
            size: "4-in-1",
            color: "Silver",
            category: "Accessories",
            brand: "OptiWay",
            model: "4-in-1 tool",
            quantity: 40,
            purchasePrice: 1.50,
            sellingPrice: 5.00,
            minStockLevel: 15
          }
        ]
      };
    }

    this.currentItems = (this.extractedData.items || []).map((i: any) => ({
      ...i,
      barcode: i.barcode || PurchaseBillScanner.generateAutoBarcode()
    }));
    this.currentFileData = {
      base64: "",
      mimeType: "application/pdf",
      fileName: `${sampleKey}_optical_invoice.pdf`,
      previewUrl: ""
    };

    Toast.show(`Sample bill loaded for ${this.extractedData.supplierName}!`, "success");
    this.showVerificationAndEditStep();
  }
}
