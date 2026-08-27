import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";
import { Product } from "./db";

export interface LabelPrintOptions {
  codeType: "barcode" | "qrcode" | "both";
  labelSize: "standard" | "small" | "optical_tag";
  copies: number;
  showStoreName: boolean;
  showBrand: boolean;
  showModel: boolean;
  showPrice: boolean;
  showCodeNumber: boolean;
  customStoreName?: string;
}

export class BarcodePrinter {
  /**
   * Normalize and sanitize barcode formats to ensure JsBarcode supported format strings
   */
  public static sanitizeBarcodeFormat(format?: string): string {
    if (!format) return "CODE128";
    const clean = String(format).trim().toUpperCase();
    if (clean === "CODE39") return "CODE39";
    if (clean === "ITF" || clean === "ITF14") return "ITF";
    if (clean === "EAN13") return "EAN13";
    if (clean === "EAN8") return "EAN8";
    if (clean === "UPC" || clean === "UPCE") return "UPC";
    if (clean === "MSI") return "MSI";
    if (clean === "PHARMACODE") return "pharmacode";
    if (clean === "CODABAR") return "codabar";
    // Default safe fallback for all other strings (including "barcode", "qrcode", "both", etc.)
    return "CODE128";
  }

  /**
   * Render Barcode SVG element string using CODE128 format with responsive containment
   */
  public static generateBarcodeSvg(code: string, height: number = 30, width: number = 1.2, format: string = "CODE128"): string {
    try {
      const safeFormat = BarcodePrinter.sanitizeBarcodeFormat(format);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      JsBarcode(svg, code || "000000", {
        format: safeFormat,
        width: width,
        height: height,
        displayValue: false,
        margin: 0,
        background: "#ffffff",
        lineColor: "#000000"
      });
      svg.setAttribute("style", "max-width:100%; max-height:100%; height:auto; width:auto; display:block; margin:0 auto;");
      return svg.outerHTML;
    } catch (err) {
      console.error("Failed to generate barcode SVG:", err);
      return `<div class="text-[10px] text-red-500 font-mono">Invalid Barcode</div>`;
    }
  }

  /**
   * Render QR Code SVG element string asynchronously with responsive containment
   */
  public static async generateQrCodeSvg(data: string): Promise<string> {
    try {
      const raw = await QRCode.toString(data || "000000", {
        type: "svg",
        margin: 0,
        width: 80,
        color: {
          dark: "#000000",
          light: "#ffffff"
        }
      });
      return raw.replace("<svg ", '<svg style="max-width:100%; max-height:100%; width:100%; height:100%; display:block; margin:0 auto;" ');
    } catch (err) {
      console.error("Failed to generate QR code SVG:", err);
      return `<div class="text-[10px] text-red-500 font-mono">Invalid QR</div>`;
    }
  }

  /**
   * Render single HTML element string for a given product label without overflow/overlap
   */
  public static async buildLabelHtml(
    product: Product,
    options: {
      codeType: "barcode" | "qrcode" | "both";
      showStoreName: boolean;
      showBrand: boolean;
      showModel: boolean;
      showPrice: boolean;
      showSku: boolean;
      storeName: string;
      size: "standard" | "small" | "optical_tag" | "81x11mm";
    }
  ): Promise<string> {
    const barcodeNumber = product.barcode || product.id || "000000";
    const brandStr = product.brand || "Generic";
    const detailParts = [];
    if (product.model) detailParts.push(product.model);
    if (product.size) detailParts.push(`Sz: ${product.size}`);
    if (product.color) detailParts.push(`Col: ${product.color}`);
    const modelStr = detailParts.join(" ") || product.model || product.name || "Model N/A";
    const priceVal = product.sellingPrice || 0;
    const priceStr = `RS ${priceVal % 1 === 0 ? priceVal : priceVal.toFixed(2)}`;

    let barcodeSvgHtml = "";
    let qrcodeSvgHtml = "";

    if (options.codeType === "barcode" || options.codeType === "both") {
      barcodeSvgHtml = BarcodePrinter.generateBarcodeSvg(barcodeNumber, 28, 1.2);
    }
    if (options.codeType === "qrcode" || options.codeType === "both") {
      qrcodeSvgHtml = await BarcodePrinter.generateQrCodeSvg(barcodeNumber);
    }

    if (options.size === "81x11mm" || options.size === "optical_tag") {
      const barcodeSmallSvg = BarcodePrinter.generateBarcodeSvg(barcodeNumber, 26, 1.1);

      return `
        <div style="background:#ffffff; color:#000000; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; box-sizing:border-box; width:1000px; height:110px; display:flex; align-items:center; justify-content:space-between; margin:0; padding:0; overflow:hidden;">
          <!-- Section 1: Left 35 MM Printable Rectangle (350px width) -->
          <div style="width:350px; height:110px; box-sizing:border-box; padding:6px 14px; display:flex; flex-direction:column; justify-content:center; gap:2px; overflow:hidden;">
            ${options.showBrand ? `<div style="font-weight:800; font-size:16px; color:#000000; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.2;">${brandStr}</div>` : ""}
            ${options.showPrice ? `<div style="font-weight:900; font-size:16px; color:#000000; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.2;">${priceStr}</div>` : ""}
            ${options.showModel ? `<div style="font-weight:700; font-size:14px; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.2;">${modelStr}</div>` : ""}
          </div>

          <!-- Section 2: Middle 35 MM Printable Rectangle (350px width) -->
          <div style="width:350px; height:110px; box-sizing:border-box; padding:4px 8px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; gap:1px; overflow:hidden;">
            ${options.showStoreName ? `<div style="font-weight:800; font-size:12px; color:#000000; text-transform:uppercase; letter-spacing:0.3px; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; margin-bottom:1px;">${options.storeName}</div>` : ""}
            
            <div style="display:flex; align-items:center; justify-content:center; height:34px; max-height:34px; overflow:hidden; width:100%;">
              ${options.codeType === "qrcode" ? `
                <div style="width:34px; height:34px; display:flex; align-items:center; justify-content:center;">${qrcodeSvgHtml}</div>
              ` : options.codeType === "both" ? `
                <div style="display:flex; align-items:center; justify-content:center; gap:6px; max-width:100%;">
                  <div style="width:32px; height:32px; flex-shrink:0; display:flex; align-items:center; justify-content:center;">${qrcodeSvgHtml}</div>
                  <div style="height:32px; display:flex; align-items:center; justify-content:center; max-width:180px; overflow:hidden;">${barcodeSmallSvg}</div>
                </div>
              ` : `
                <div style="height:34px; display:flex; align-items:center; justify-content:center; max-width:300px; overflow:hidden; width:100%;">${barcodeSmallSvg}</div>
              `}
            </div>

            ${options.showSku ? `<div style="font-weight:700; font-size:10px; color:#000000; font-family:monospace, Arial, sans-serif; line-height:1.1; letter-spacing:0.2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; margin-top:1px;">${barcodeNumber}</div>` : ""}
          </div>

          <!-- Section 3: Right 30 MM Wrap-Around Tail (300px width) -->
          <div style="width:300px; height:110px; box-sizing:border-box; background:#ffffff;">
          </div>
        </div>
      `;
    }

    let cardWidthStyle = "width: 100%; min-height: 100px;";
    if (options.size === "small") cardWidthStyle = "width: 100%; min-height: 85px;";

    return `
      <div style="background:#ffffff; color:#0f172a; padding:6px 8px; border-radius:6px; border:1px solid #cbd5e1; font-family:sans-serif; box-sizing:border-box; ${cardWidthStyle} text-align:center; display:flex; flex-direction:column; justify-content:space-between; overflow:hidden;">
        <div>
          ${options.showStoreName ? `<div style="font-weight:800; text-transform:uppercase; font-size:9px; letter-spacing:0.3px; border-bottom:1px solid #e2e8f0; padding-bottom:2px; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${options.storeName}</div>` : ""}
          
          <div style="font-weight:700; font-size:11px; line-height:1.2; color:#0f172a; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">${product.name || "Optical Item"}</div>
          
          ${(options.showBrand || options.showModel) ? `
            <div style="font-size:10px; color:#334155; font-weight:600; margin-top:1px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">
              ${options.showBrand ? `<span>${brandStr}</span>` : ""}
              ${options.showBrand && options.showModel && modelStr ? " • " : ""}
              ${options.showModel && modelStr ? `<span>${modelStr}</span>` : ""}
            </div>
          ` : ""}

          ${options.showPrice ? `
            <div style="font-size:11px; font-weight:800; color:#000000; margin:2px 0;">
              Price: <span style="text-decoration:underline;">${priceStr}</span>
            </div>
          ` : ""}
        </div>

        <div style="margin-top:3px; padding-top:3px; border-top:1px solid #e2e8f0; display:flex; align-items:center; justify-content:center; gap:4px; width:100%; overflow:hidden;">
          ${options.codeType === "both" ? `
            <div style="width:36px; height:36px; flex-shrink:0; display:flex; align-items:center; justify-content:center; overflow:hidden;">${qrcodeSvgHtml}</div>
            <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; overflow:hidden; min-width:0;">
              <div style="width:100%; height:26px; display:flex; align-items:center; justify-content:center; overflow:hidden;">${barcodeSvgHtml}</div>
              ${options.showSku ? `<div style="font-family:monospace; font-size:9px; font-weight:700; color:#000; letter-spacing:0.3px; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${barcodeNumber}</div>` : ""}
            </div>
          ` : options.codeType === "barcode" ? `
            <div style="width:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; overflow:hidden;">
              <div style="width:100%; height:32px; display:flex; align-items:center; justify-content:center; overflow:hidden;">${barcodeSvgHtml}</div>
              ${options.showSku ? `<div style="font-family:monospace; font-size:9px; font-weight:700; color:#000; letter-spacing:0.3px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${barcodeNumber}</div>` : ""}
            </div>
          ` : `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; overflow:hidden;">
              <div style="width:42px; height:42px; display:flex; align-items:center; justify-content:center; overflow:hidden;">${qrcodeSvgHtml}</div>
              ${options.showSku ? `<div style="font-family:monospace; font-size:9px; font-weight:700; color:#000; letter-spacing:0.3px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${barcodeNumber}</div>` : ""}
            </div>
          `}
        </div>
      </div>
    `;
  }

  /**
   * Open Single Product Print & PDF Download Modal
   */
  public static async openPrintModal(product: Product, storeName: string = "OPTIWAY OPTICAL") {
    let modal = document.getElementById("modal-barcode-printer");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "modal-barcode-printer";
      modal.className = "fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center p-4";
      document.body.appendChild(modal);
    }

    const barcodeNumber = product.barcode || product.id || "000000";
    const brandStr = product.brand || "Generic";
    const detailParts = [];
    if (product.model) detailParts.push(product.model);
    if (product.size) detailParts.push(`Sz: ${product.size}`);
    if (product.color) detailParts.push(`Col: ${product.color}`);
    const modelStr = detailParts.join(" ") || product.model || product.name || "Model N/A";
    const priceStr = `RS ${(product.sellingPrice || 0).toFixed(2)}`;

    modal.innerHTML = `
      <div class="bg-white rounded-2xl max-w-3xl w-full p-6 space-y-5 border border-slate-200 shadow-2xl max-h-[92vh] overflow-y-auto">
        <!-- Modal Header -->
        <div class="flex justify-between items-center border-b border-slate-100 pb-3">
          <div>
            <h3 class="font-bold text-slate-900 text-base flex items-center gap-2">
              <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"></path>
              </svg>
              Print & Download Barcode/QR Labels
            </h3>
            <p class="text-xs text-slate-500">Generate 8.5" x 11" Letter sheet PDF stickers or barcode tags</p>
          </div>
          <button id="btn-close-barcode-modal" class="text-slate-400 hover:text-slate-700 p-1.5 text-lg font-bold">✕</button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-5">
          <!-- Options Column -->
          <div class="md:col-span-5 space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h4 class="text-xs font-bold text-slate-800 uppercase tracking-wider">Label Options</h4>
            
            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">Code Type</label>
              <select id="lbl-code-type" class="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white font-semibold">
                <option value="barcode" selected>Barcode Only (Code 128)</option>
                <option value="qrcode">QR Code Only</option>
                <option value="both">Both Barcode & QR Code</option>
              </select>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">Sticker Size / Paper Layout</label>
              <select id="lbl-layout-grid" class="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white font-semibold">
                <option value="81x11mm_single" selected>100mm Optical Tag Sticker (35mm Details | 35mm Barcode | 30mm Tail)</option>
                <option value="81x11mm_sheet">100mm Optical Tags on 8.5" x 11" Letter Sheet (40/Sheet)</option>
                <option value="3x10">30 Standard Labels/Sheet (3 cols x 10 rows - 8.5" x 11")</option>
                <option value="3x8">24 Standard Labels/Sheet (3 cols x 8 rows - 8.5" x 11")</option>
                <option value="2x7">14 Large Labels/Sheet (2 cols x 7 rows - 8.5" x 11")</option>
              </select>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">Total Sticker Quantity</label>
              <div class="flex items-center gap-2">
                <input type="number" id="lbl-copies" min="1" max="500" value="${Math.max(1, product.stockQuantity || 1)}" class="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white font-bold" />
                <button type="button" id="btn-set-copies-stock" class="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-[11px] font-bold rounded-lg whitespace-nowrap">
                  Use Stock (${product.stockQuantity || 0})
                </button>
              </div>
            </div>

            <div class="space-y-2 pt-2 border-t border-slate-200">
              <label class="block text-xs font-bold text-slate-800">Fields to Include:</label>
              
              <label class="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input type="checkbox" id="chk-show-store" checked class="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                Store Name (${storeName})
              </label>

              <label class="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input type="checkbox" id="chk-show-brand" checked class="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                Brand (${brandStr})
              </label>

              <label class="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input type="checkbox" id="chk-show-model" checked class="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                Model Number ${modelStr ? `(${modelStr})` : ""}
              </label>

              <label class="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input type="checkbox" id="chk-show-price" checked class="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                Selling Price (${priceStr})
              </label>

              <label class="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input type="checkbox" id="chk-show-sku" checked class="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                Barcode Number (${barcodeNumber})
              </label>
            </div>
          </div>

          <!-- Live Preview Column -->
          <div class="md:col-span-7 space-y-4 flex flex-col justify-between">
            <div>
              <div class="flex justify-between items-center mb-2">
                <h4 class="text-xs font-bold text-slate-800 uppercase tracking-wider">Live Sticker Tag Preview</h4>
                <span class="text-[10px] font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-bold">8.5" x 11" Ready</span>
              </div>

              <!-- Preview Frame Container -->
              <div class="bg-slate-200/60 p-6 rounded-xl flex items-center justify-center min-h-[220px] border border-dashed border-slate-300">
                <div id="label-preview-container" class="bg-white text-black p-3 rounded-md shadow-md border border-slate-400 font-sans transition-all w-[260px]">
                  <!-- Dynamic content injected by updatePreview -->
                </div>
              </div>
            </div>

            <!-- Modal Action Buttons -->
            <div class="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button type="button" id="btn-close-barcode-modal-2" class="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">
                Cancel
              </button>

              <button type="button" id="btn-do-download-png" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-colors flex items-center gap-1.5 cursor-pointer">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
                </svg>
                Direct Download PNG Barcode
              </button>

              <button type="button" id="btn-do-download-pdf" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition-colors flex items-center gap-1.5 cursor-pointer">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
                Direct Download PDF (8.5x11)
              </button>

              <button type="button" id="btn-do-print-label" class="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path>
                </svg>
                Print Sheet
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    modal.classList.remove("hidden");

    const getOptions = () => {
      const gridVal = (document.getElementById("lbl-layout-grid") as HTMLSelectElement)?.value || "81x11mm_single";
      const sizeVal = (gridVal.startsWith("81x11mm")) ? ("81x11mm" as const) : ("standard" as const);
      return {
        codeType: (document.getElementById("lbl-code-type") as HTMLSelectElement).value as any,
        showStoreName: (document.getElementById("chk-show-store") as HTMLInputElement).checked,
        showBrand: (document.getElementById("chk-show-brand") as HTMLInputElement).checked,
        showModel: (document.getElementById("chk-show-model") as HTMLInputElement).checked,
        showPrice: (document.getElementById("chk-show-price") as HTMLInputElement).checked,
        showSku: (document.getElementById("chk-show-sku") as HTMLInputElement).checked,
        storeName,
        size: sizeVal
      };
    };

    const updatePreview = async () => {
      const opts = getOptions();
      const container = document.getElementById("label-preview-container")!;
      const html = await BarcodePrinter.buildLabelHtml(product, opts);

      if (opts.size === "81x11mm" || (opts.size as string) === "optical_tag") {
        container.style.width = "100%";
        container.style.maxWidth = "500px";
        container.style.padding = "0";
        container.style.overflow = "hidden";
        container.style.border = "1px solid #cbd5e1";
        container.style.borderRadius = "8px";

        container.innerHTML = `
          <div style="width: 100%; overflow-x: auto; background: #ffffff;">
            <div style="transform: scale(0.48); transform-origin: top left; width: 1000px; height: 110px;">
              ${html}
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; background: #f8fafc; font-size: 10px; font-weight: 700; color: #475569; border-top: 1px solid #e2e8f0;">
            <span style="width: 35%; text-align: left; color: #0284c7;">35 MM (Details)</span>
            <span style="width: 35%; text-align: center; color: #16a34a;">35 MM (Barcode/QR)</span>
            <span style="width: 30%; text-align: right; color: #94a3b8;">30 MM (Tail)</span>
          </div>
        `;
      } else {
        container.style.width = "260px";
        container.style.padding = "12px";
        container.style.overflow = "hidden";
        container.style.border = "1px solid #cbd5e1";
        container.style.borderRadius = "8px";
        container.innerHTML = html;
      }

      const btnPng = document.getElementById("btn-do-download-png");
      if (btnPng) {
        const labelText = opts.codeType === "qrcode" ? "Direct Download PNG QR Code" : opts.codeType === "both" ? "Direct Download PNG (Barcode + QR)" : "Direct Download PNG Barcode";
        btnPng.innerHTML = `
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
          </svg>
          ${labelText}
        `;
      }
    };

    document.getElementById("lbl-layout-grid")?.addEventListener("change", updatePreview);
    document.getElementById("lbl-code-type")?.addEventListener("change", updatePreview);
    document.getElementById("chk-show-store")?.addEventListener("change", updatePreview);
    document.getElementById("chk-show-brand")?.addEventListener("change", updatePreview);
    document.getElementById("chk-show-model")?.addEventListener("change", updatePreview);
    document.getElementById("chk-show-price")?.addEventListener("change", updatePreview);
    document.getElementById("chk-show-sku")?.addEventListener("change", updatePreview);

    document.getElementById("btn-set-copies-stock")?.addEventListener("click", () => {
      (document.getElementById("lbl-copies") as HTMLInputElement).value = String(product.stockQuantity || 1);
    });

    const closeModal = () => modal.classList.add("hidden");
    document.getElementById("btn-close-barcode-modal")?.addEventListener("click", closeModal);
    document.getElementById("btn-close-barcode-modal-2")?.addEventListener("click", closeModal);

    // Print Sheet Action
    document.getElementById("btn-do-print-label")?.addEventListener("click", async () => {
      const copies = parseInt((document.getElementById("lbl-copies") as HTMLInputElement).value || "1", 10);
      const grid = (document.getElementById("lbl-layout-grid") as HTMLSelectElement).value;
      const opts = getOptions();
      const singleLabel = await BarcodePrinter.buildLabelHtml(product, opts);
      await BarcodePrinter.executePrintJob(singleLabel, copies, grid);
    });

    // Direct PNG Image Download Action
    document.getElementById("btn-do-download-png")?.addEventListener("click", async () => {
      const btn = document.getElementById("btn-do-download-png") as HTMLButtonElement;
      btn.disabled = true;
      btn.innerText = "Downloading PNG...";

      try {
        const opts = getOptions();
        await BarcodePrinter.downloadBarcodeImagePng(product, opts);
      } catch (err) {
        console.error("Failed to download PNG barcode:", err);
        alert("An error occurred while downloading the barcode PNG image.");
      } finally {
        btn.disabled = false;
        btn.innerHTML = `
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
          </svg>
          Direct Download PNG Barcode
        `;
      }
    });

    // Direct PDF Download Action (8.5" x 11")
    document.getElementById("btn-do-download-pdf")?.addEventListener("click", async () => {
      const btn = document.getElementById("btn-do-download-pdf") as HTMLButtonElement;
      btn.disabled = true;
      btn.innerText = "Generating PDF...";

      try {
        const copies = parseInt((document.getElementById("lbl-copies") as HTMLInputElement).value || "1", 10);
        const grid = (document.getElementById("lbl-layout-grid") as HTMLSelectElement).value;
        const opts = getOptions();

        const items: { product: Product; quantity: number }[] = [
          { product, quantity: copies }
        ];

        await BarcodePrinter.downloadBulkPdf81x11(items, opts, grid);
      } catch (err) {
        console.error("Failed to generate PDF:", err);
        alert("An error occurred while generating the PDF. Please try again.");
      } finally {
        btn.disabled = false;
        btn.innerHTML = `
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          Direct Download PDF (8.5x11)
        `;
      }
    });

    await updatePreview();
  }

  /**
   * Open Bulk Barcode & QR Sticker Download Modal for all or selected products
   */
  public static async openBulkPrintModal(allProducts: Product[], storeName: string = "OPTIWAY OPTICAL") {
    let modal = document.getElementById("modal-bulk-barcode-printer");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "modal-bulk-barcode-printer";
      modal.className = "fixed inset-0 bg-slate-900/80 z-50 flex items-center justify-center p-4";
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="bg-white rounded-2xl max-w-4xl w-full p-6 space-y-5 border border-slate-200 shadow-2xl max-h-[92vh] overflow-y-auto">
        <!-- Modal Header -->
        <div class="flex justify-between items-center border-b border-slate-100 pb-3">
          <div>
            <h3 class="font-bold text-slate-900 text-base flex items-center gap-2">
              <svg class="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
              Bulk Barcode / QR Code Sticker Sheets (8.5" x 11")
            </h3>
            <p class="text-xs text-slate-500">Select multiple items and export bulk printable sticker PDF sheets</p>
          </div>
          <button id="btn-close-bulk-modal" class="text-slate-400 hover:text-slate-700 p-1.5 text-lg font-bold">✕</button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-5">
          <!-- Options Column -->
          <div class="md:col-span-5 space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h4 class="text-xs font-bold text-slate-800 uppercase tracking-wider">Sheet & Code Options</h4>

            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">Code Format</label>
              <select id="bulk-code-type" class="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white font-semibold">
                <option value="barcode" selected>Barcode Only (Code 128)</option>
                <option value="qrcode">QR Code Only</option>
                <option value="both">Both Barcode & QR Code</option>
              </select>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">Sticker Size / Paper Layout</label>
              <select id="bulk-layout-grid" class="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white font-semibold">
                <option value="81x11mm_single" selected>81mm x 11mm Direct Sticker Tag (Single Roll / Thermal PDF)</option>
                <option value="81x11mm_sheet">81mm x 11mm Stickers on 8.5" x 11" Letter Sheet (40/Sheet)</option>
                <option value="3x10">30 Standard Labels/Sheet (3 cols x 10 rows - 8.5" x 11")</option>
                <option value="3x8">24 Standard Labels/Sheet (3 cols x 8 rows - 8.5" x 11")</option>
                <option value="2x7">14 Large Labels/Sheet (2 cols x 7 rows - 8.5" x 11")</option>
              </select>
            </div>

            <div class="space-y-2 pt-2 border-t border-slate-200">
              <label class="block text-xs font-bold text-slate-800">Fields to Include on Stickers:</label>
              
              <label class="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input type="checkbox" id="bulk-chk-store" checked class="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                Store Name (${storeName})
              </label>

              <label class="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input type="checkbox" id="bulk-chk-brand" checked class="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                Brand
              </label>

              <label class="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input type="checkbox" id="bulk-chk-model" checked class="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                Model Number
              </label>

              <label class="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input type="checkbox" id="bulk-chk-price" checked class="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                Selling Price
              </label>

              <label class="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input type="checkbox" id="bulk-chk-sku" checked class="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                Barcode Number
              </label>
            </div>
          </div>

          <!-- Product Selection List Column -->
          <div class="md:col-span-7 space-y-3 flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-xs font-bold text-slate-800 uppercase tracking-wider">Select Products & Quantities</h4>
                <div class="flex items-center gap-2">
                  <button type="button" id="btn-bulk-select-all" class="text-[11px] font-bold text-blue-600 hover:underline">Select All</button>
                  <span class="text-slate-300">|</span>
                  <button type="button" id="btn-bulk-deselect-all" class="text-[11px] font-bold text-slate-500 hover:underline">Deselect All</button>
                  <span class="text-slate-300">|</span>
                  <button type="button" id="btn-bulk-use-stock" class="text-[11px] font-bold text-emerald-600 hover:underline">Set Stock Qty</button>
                </div>
              </div>

              <!-- Product Search in Bulk -->
              <input type="text" id="bulk-prod-search" placeholder="Filter by product name, brand, model, barcode..." class="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none mb-2" />

              <div id="bulk-prod-list" class="max-h-[280px] overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 p-1 bg-slate-50">
                <!-- Injected products list -->
              </div>
            </div>

            <!-- Action buttons -->
            <div class="flex items-center justify-between pt-3 border-t border-slate-100">
              <span id="bulk-selected-count" class="text-xs font-bold text-slate-700">0 Total Stickers Selected</span>

              <div class="flex gap-2">
                <button type="button" id="btn-close-bulk-modal-2" class="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">
                  Cancel
                </button>

                <button type="button" id="btn-do-bulk-pdf-download" class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition-colors flex items-center gap-2">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                  </svg>
                  Download Bulk PDF (8.5" x 11")
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    modal.classList.remove("hidden");

    const renderProdList = (searchStr: string = "") => {
      const container = document.getElementById("bulk-prod-list")!;
      const filtered = allProducts.filter(p => 
        (p.name || "").toLowerCase().includes(searchStr.toLowerCase()) ||
        (p.brand || "").toLowerCase().includes(searchStr.toLowerCase()) ||
        (p.model || "").toLowerCase().includes(searchStr.toLowerCase()) ||
        (p.barcode || "").toLowerCase().includes(searchStr.toLowerCase()) ||
        (p.sku || "").toLowerCase().includes(searchStr.toLowerCase())
      );

      container.innerHTML = filtered.map(p => `
        <div class="flex items-center justify-between p-2 bg-white rounded-lg hover:bg-slate-100 transition-colors">
          <label class="flex items-center gap-2 text-xs cursor-pointer flex-1 mr-2 overflow-hidden">
            <input type="checkbox" class="chk-bulk-item rounded border-slate-300 text-blue-600 focus:ring-blue-500" data-id="${p.id}" checked />
            <div class="truncate">
              <span class="font-bold text-slate-900 block truncate">${p.name || "Item"}</span>
              <span class="text-[10px] text-slate-500 font-mono">Barcode: ${p.barcode || p.id || "N/A"} | Model: ${p.model || "—"} | Price: RS ${(p.sellingPrice || 0).toFixed(2)} | Stock: ${p.stockQuantity || 0}</span>
            </div>
          </label>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            <span class="text-[10px] text-slate-400 font-bold">Qty:</span>
            <input type="number" class="inp-bulk-qty w-16 px-2 py-1 text-xs border border-slate-300 rounded font-bold text-center" data-id="${p.id}" value="${Math.max(1, p.stockQuantity || 1)}" min="1" max="500" />
          </div>
        </div>
      `).join("");

      updateCount();

      container.querySelectorAll(".chk-bulk-item, .inp-bulk-qty").forEach(el => {
        el.addEventListener("change", updateCount);
      });
    };

    const updateCount = () => {
      let total = 0;
      document.querySelectorAll(".chk-bulk-item").forEach(chk => {
        if ((chk as HTMLInputElement).checked) {
          const id = chk.getAttribute("data-id");
          const qtyInp = document.querySelector(`.inp-bulk-qty[data-id="${id}"]`) as HTMLInputElement;
          total += parseInt(qtyInp?.value || "1", 10);
        }
      });
      const cntEl = document.getElementById("bulk-selected-count");
      if (cntEl) cntEl.innerText = `${total} Total Sticker(s) Selected`;
    };

    document.getElementById("bulk-prod-search")?.addEventListener("input", (e) => {
      renderProdList((e.target as HTMLInputElement).value);
    });

    document.getElementById("btn-bulk-select-all")?.addEventListener("click", () => {
      document.querySelectorAll(".chk-bulk-item").forEach(c => (c as HTMLInputElement).checked = true);
      updateCount();
    });

    document.getElementById("btn-bulk-deselect-all")?.addEventListener("click", () => {
      document.querySelectorAll(".chk-bulk-item").forEach(c => (c as HTMLInputElement).checked = false);
      updateCount();
    });

    document.getElementById("btn-bulk-use-stock")?.addEventListener("click", () => {
      allProducts.forEach(p => {
        const inp = document.querySelector(`.inp-bulk-qty[data-id="${p.id}"]`) as HTMLInputElement;
        if (inp) inp.value = String(p.stockQuantity || 1);
      });
      updateCount();
    });

    const closeModal = () => modal.classList.add("hidden");
    document.getElementById("btn-close-bulk-modal")?.addEventListener("click", closeModal);
    document.getElementById("btn-close-bulk-modal-2")?.addEventListener("click", closeModal);

    // Download Bulk PDF
    document.getElementById("btn-do-bulk-pdf-download")?.addEventListener("click", async () => {
      const btn = document.getElementById("btn-do-bulk-pdf-download") as HTMLButtonElement;
      btn.disabled = true;
      btn.innerText = "Generating Bulk PDF...";

      try {
        const codeType = (document.getElementById("bulk-code-type") as HTMLSelectElement).value as any;
        const grid = (document.getElementById("bulk-layout-grid") as HTMLSelectElement).value;
        const showStoreName = (document.getElementById("bulk-chk-store") as HTMLInputElement).checked;
        const showBrand = (document.getElementById("bulk-chk-brand") as HTMLInputElement).checked;
        const showModel = (document.getElementById("bulk-chk-model") as HTMLInputElement).checked;
        const showPrice = (document.getElementById("bulk-chk-price") as HTMLInputElement).checked;
        const showSku = (document.getElementById("bulk-chk-sku") as HTMLInputElement).checked;

        const selectedItems: { product: Product; quantity: number }[] = [];

        document.querySelectorAll(".chk-bulk-item").forEach(chk => {
          if ((chk as HTMLInputElement).checked) {
            const id = chk.getAttribute("data-id");
            const prod = allProducts.find(p => p.id === id);
            const qtyInp = document.querySelector(`.inp-bulk-qty[data-id="${id}"]`) as HTMLInputElement;
            if (prod) {
              selectedItems.push({
                product: prod,
                quantity: parseInt(qtyInp?.value || "1", 10)
              });
            }
          }
        });

        if (selectedItems.length === 0) {
          alert("Please select at least one product to generate stickers.");
          return;
        }

        const opts = {
          codeType,
          showStoreName,
          showBrand,
          showModel,
          showPrice,
          showSku,
          storeName,
          size: grid.startsWith("81x11mm") ? ("81x11mm" as const) : ("standard" as const)
        };

        await BarcodePrinter.downloadBulkPdf81x11(selectedItems, opts, grid);
      } catch (err) {
        console.error("Failed to generate bulk PDF:", err);
        alert("An error occurred while generating the bulk PDF sheet.");
      } finally {
        btn.disabled = false;
        btn.innerHTML = `
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          Download Bulk PDF (8.5" x 11")
        `;
      }
    });

    renderProdList();
  }

  /**
   * Generates direct 81mm x 11mm or 8.5" x 11" Letter format PDF and triggers browser download
   */
  public static async downloadBulkPdf81x11(
    items: { product: Product; quantity: number }[],
    options: {
      codeType: "barcode" | "qrcode" | "both";
      showStoreName: boolean;
      showBrand: boolean;
      showModel: boolean;
      showPrice: boolean;
      showSku: boolean;
      storeName: string;
      size: "standard" | "small" | "optical_tag" | "81x11mm";
    },
    grid: string = "81x11mm_single"
  ) {
    // If exact 81mm x 11mm or 79mm x 10mm single label output is requested
    if (grid === "81x11mm_single" || grid === "81x11mm" || options.size === "81x11mm") {
      options.size = "81x11mm";

      const stickerItems: Sticker79x10Item[] = [];
      for (const item of items) {
        const detailParts = [];
        if (item.product.model) detailParts.push(item.product.model);
        if (item.product.size) detailParts.push(`Sz: ${item.product.size}`);
        if (item.product.color) detailParts.push(`Col: ${item.product.color}`);
        const modelStr = detailParts.join(" ") || item.product.model || item.product.name || "";
        const barcodeCode = item.product.barcode || item.product.id || "000000";

        for (let i = 0; i < item.quantity; i++) {
          stickerItems.push({
            brand: options.showBrand ? (item.product.brand || "Generic") : "",
            price: options.showPrice ? (item.product.sellingPrice || 0) : "",
            model: options.showModel ? modelStr : "",
            barcodeCode: options.showSku !== false ? barcodeCode : "",
            type: options.codeType || "CODE128",
            codeType: options.codeType || "barcode",
            storeName: options.showStoreName ? options.storeName : "DRISHYA"
          });
        }
      }

      if (stickerItems.length === 0) return;

      await BarcodePrinter.downloadExact79x10mmPdf(stickerItems, `sticker_${stickerItems[0].barcodeCode}.pdf`);
      return;
    }

    // Grid sheet layout calculation
    let cols = 3;
    let rows = 10;
    if (grid === "81x11mm_sheet") {
      cols = 2;
      rows = 20;
      options.size = "81x11mm";
    } else if (grid === "3x8") {
      cols = 3;
      rows = 8;
    } else if (grid === "2x7") {
      cols = 2;
      rows = 7;
    }

    const labelsPerPage = cols * rows;

    // Collect list of all html elements
    const labelCards: string[] = [];
    for (const item of items) {
      const cardHtml = await BarcodePrinter.buildLabelHtml(item.product, options);
      for (let i = 0; i < item.quantity; i++) {
        labelCards.push(cardHtml);
      }
    }

    if (labelCards.length === 0) return;

    // Off-screen iframe container formatted for exact 8.5 x 11 in (Letter)
    // 8.5 in @ 96 DPI = 816 px width, 11 in @ 96 DPI = 1056 px height
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.left = "-9999px";
    iframe.style.top = "0";
    iframe.style.width = "816px";
    iframe.style.height = "1056px";
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      document.body.removeChild(iframe);
      throw new Error("Could not access iframe content document");
    }

    iframeDoc.open();
    iframeDoc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { background-color: #ffffff; color: #000000; font-family: sans-serif; padding: 16px; width: 816px; box-sizing: border-box; }
            svg { display: block; }
          </style>
        </head>
        <body>
          <div id="labels-container" style="width: 100%;"></div>
        </body>
      </html>
    `);
    iframeDoc.close();

    const container = iframeDoc.getElementById("labels-container");
    if (!container) {
      document.body.removeChild(iframe);
      throw new Error("Labels container element missing");
    }

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "in",
      format: [8.5, 11]
    });

    const pageCount = Math.ceil(labelCards.length / labelsPerPage);

    for (let p = 0; p < pageCount; p++) {
      const pageCards = labelCards.slice(p * labelsPerPage, (p + 1) * labelsPerPage);

      container.innerHTML = `
        <div style="display:grid; grid-template-columns: repeat(${cols}, 1fr); gap: 6px; width: 100%;">
          ${pageCards.map(c => `<div>${c}</div>`).join("")}
        </div>
      `;

      // Render off-screen page to high-res canvas
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        onclone: (clonedDoc) => {
          // Remove any style or link tags containing oklch
          clonedDoc.querySelectorAll('style, link[rel="stylesheet"]').forEach(el => {
            if (el.textContent && el.textContent.includes('oklch')) {
              el.remove();
            }
          });
        }
      });

      const imgData = canvas.toDataURL("image/png");

      if (p > 0) {
        doc.addPage([8.5, 11], "portrait");
      }

      // 8.5in width, 11in height
      doc.addImage(imgData, "PNG", 0, 0, 8.5, 11);
    }

    document.body.removeChild(iframe);

    doc.save(`optiway_barcode_labels_${grid}_${Date.now()}.pdf`);
  }

  /**
   * Browser print fallback helper
   */
  public static async executePrintJob(labelHtml: string, copies: number, grid: string) {
    let cols = 3;
    if (grid === "2x7") cols = 2;

    const printWindow = window.open("", "_blank", "width=850,height=700");
    if (!printWindow) {
      alert("Please allow popups in your browser to enable printing.");
      return;
    }

    let labelsSheet = "";
    for (let i = 0; i < copies; i++) {
      labelsSheet += `
        <div class="label-card" style="box-sizing:border-box;">
          ${labelHtml}
        </div>
      `;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print Product Barcode Labels (8.5" x 11") - OPTIWAY</title>
          <style>
            @page {
              size: 8.5in 11in;
              margin: 0.3in;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              background-color: #ffffff;
              color: #000000;
              margin: 0;
              padding: 0;
            }
            .labels-container {
              display: grid;
              grid-template-columns: repeat(${cols}, 1fr);
              gap: 10px;
            }
            .label-card svg {
              max-width: 100%;
              height: auto;
            }
            @media print {
              .label-card {
                page-break-inside: avoid;
                break-inside: avoid;
              }
            }
          </style>
        </head>
        <body>
          <div class="labels-container">
            ${labelsSheet}
          </div>
          <script>
            setTimeout(() => {
              window.print();
              window.close();
            }, 300);
          </script>
        </body>
      </html>
    `);

    printWindow.document.close();
  }

  /**
   * Directly download PNG image of barcode / optical label without opening print dialogs
   */
  public static async downloadBarcodeImagePng(
    product: Product,
    options: {
      codeType: "barcode" | "qrcode" | "both";
      showStoreName: boolean;
      showBrand: boolean;
      showModel: boolean;
      showPrice: boolean;
      showSku: boolean;
      storeName: string;
      size: "standard" | "small" | "optical_tag" | "81x11mm";
    }
  ) {
    const html = await BarcodePrinter.buildLabelHtml(product, options);

    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-9999px";
    container.style.top = "0";
    if (options.size === "81x11mm" || options.size === "optical_tag") {
      container.style.width = "1000px";
      container.style.height = "110px";
    } else {
      container.style.width = "280px";
      container.style.height = "140px";
    }
    container.style.background = "#ffffff";
    container.innerHTML = html;
    document.body.appendChild(container);

    try {
      const canvas = await html2canvas(container, {
        scale: 3,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        onclone: (clonedDoc) => {
          clonedDoc.querySelectorAll('style, link[rel="stylesheet"]').forEach(el => {
            if (el.textContent && el.textContent.includes('oklch')) {
              el.remove();
            }
          });
        }
      });

      const imgData = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = imgData;
      a.download = `barcode_${product.sku || product.id || "item"}.png`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (document.body.contains(a)) {
          document.body.removeChild(a);
        }
      }, 100);
    } finally {
      if (document.body.contains(container)) {
        document.body.removeChild(container);
      }
    }
  }

  /**
   * Generate barcode PNG Data URL for jsPDF embedding
   */
  public static generateBarcodeDataUrl(
    code: string,
    format: string = "CODE128"
  ): Promise<string> {
    return new Promise((resolve) => {
      try {
        const safeFormat = BarcodePrinter.sanitizeBarcodeFormat(format);
        const canvas = document.createElement("canvas");
        JsBarcode(canvas, code || "000000", {
          format: safeFormat,
          width: 2,
          height: 36,
          displayValue: false,
          margin: 0,
          background: "#ffffff",
          lineColor: "#000000"
        });
        resolve(canvas.toDataURL("image/png"));
      } catch (err) {
        console.error("Failed to generate canvas barcode:", err);
        resolve("");
      }
    });
  }

  /**
   * Generate QR code PNG Data URL for jsPDF embedding
   */
  public static async generateQrCodeDataUrl(data: string): Promise<string> {
    try {
      return await QRCode.toDataURL(data || "000000", {
        margin: 0,
        width: 150,
        color: {
          dark: "#000000",
          light: "#ffffff"
        }
      });
    } catch (err) {
      console.error("Failed to generate canvas QR code:", err);
      return "";
    }
  }

  /**
   * Direct 79mm x 10mm vector PDF generator with exact positioning:
   * Dimensions: [79, 10] mm landscape
   * Left side (x=2mm):
   *   brand at (2, 3)
   *   price at (2, 6)
   *   model at (2, 9)
   * Right side (x=28mm):
   *   storeName at (28, 3)
   *   barcode / qrcode / both image at (28, 3.4, ...)
   *   barcodeCode text at (28, 9.3)
   */
  public static async downloadExact79x10mmPdf(
    items: Sticker79x10Item[],
    filename?: string
  ): Promise<void> {
    if (!items || items.length === 0) return;

    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: [79, 10]
    });

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (idx > 0) {
        pdf.addPage([79, 10], "landscape");
      }

      const brandStr = String(item.brand || "").substring(0, 22);
      const priceVal = typeof item.price === "number" ? `RS ${item.price}` : String(item.price || "");
      const modelStr = String(item.model || "").substring(0, 22);
      const storeStr = String(item.storeName || "DRISHYA").substring(0, 22);
      const barcodeCode = String(item.barcodeCode || "000000");
      const barcodeType = String(item.type || "CODE128");
      const codeType = String(item.codeType || item.type || "CODE128").toLowerCase();

      try {
        pdf.setFont(undefined as any, "bold");
      } catch {
        // fallback
      }

      // --- Left side (x=2mm) ---
      pdf.setFontSize(6);
      pdf.text(brandStr, 2, 3, { maxWidth: 24 });

      pdf.setFontSize(6.5);
      pdf.text(priceVal, 2, 6, { maxWidth: 24 });

      pdf.setFontSize(5.5);
      pdf.text(modelStr, 2, 9, { maxWidth: 24 });

      // --- Right side (x=28mm) ---
      pdf.setFontSize(5.5);
      pdf.text(storeStr, 28, 3, { maxWidth: 25 });

      if (codeType === "qrcode" || codeType === "qr") {
        try {
          const qrImg = await BarcodePrinter.generateQrCodeDataUrl(barcodeCode);
          if (qrImg) {
            pdf.addImage(qrImg, "PNG", 28, 3.4, 4.8, 4.8);
          }
        } catch (err) {
          console.error("QR Code PDF image add error:", err);
        }
      } else if (codeType === "both") {
        try {
          const qrImg = await BarcodePrinter.generateQrCodeDataUrl(barcodeCode);
          if (qrImg) {
            pdf.addImage(qrImg, "PNG", 28, 3.4, 4.6, 4.6);
          }
        } catch (err) {
          console.error("QR Code PDF image add error:", err);
        }
        try {
          const barcodeImg = await BarcodePrinter.generateBarcodeDataUrl(barcodeCode, "CODE128");
          if (barcodeImg) {
            pdf.addImage(barcodeImg, "PNG", 34, 3.5, 16, 4.0);
          }
        } catch (err) {
          console.error("Barcode PDF image add error:", err);
        }
      } else {
        // Barcode default
        try {
          const barcodeImg = await BarcodePrinter.generateBarcodeDataUrl(barcodeCode, barcodeType);
          if (barcodeImg) {
            pdf.addImage(barcodeImg, "PNG", 28, 3.5, 22, 4.0);
          }
        } catch (err) {
          console.error("Barcode PDF image add error:", err);
        }
      }

      // Barcode / SKU text below image (x=28mm, y=9.2mm) with smaller font size
      pdf.setFontSize(3.8);
      pdf.text(barcodeCode, 28, 9.2, { maxWidth: 25 });
    }

    const outName = filename || (items.length === 1 ? `sticker_${items[0].barcodeCode}.pdf` : `stickers_${Date.now()}.pdf`);
    pdf.save(outName);
  }

  /**
   * Excel export for sticker items
   */
  public static downloadStickersExcel(items: Sticker79x10Item[], filename: string = "stickers.xlsx") {
    const formatted = [["Brand", "Price", "Model", "Barcode", "Type"]];
    items.forEach(item => {
      formatted.push([
        String(item.brand || ""),
        String(item.price || ""),
        String(item.model || ""),
        String(item.barcodeCode || ""),
        String(item.type || "CODE128")
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(formatted);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stickers");
    XLSX.writeFile(wb, filename);
  }

  /**
   * Excel import parser for sticker items
   */
  public static async parseStickersExcel(file: File): Promise<Sticker79x10Item[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const wb = XLSX.read(data, { type: "binary" });
          const firstSheet = wb.SheetNames[0];
          const sheet = wb.Sheets[firstSheet];
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
          if (rows.length > 0) {
            rows.shift();
          }
          const items: Sticker79x10Item[] = [];
          rows.forEach(row => {
            const [brand, price, model, barcodeCode, type] = row;
            if (brand || price || model || barcodeCode) {
              items.push({
                brand: String(brand || ""),
                price: String(price || ""),
                model: String(model || ""),
                barcodeCode: String(barcodeCode || ""),
                type: String(type || "CODE128")
              });
            }
          });
          resolve(items);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsBinaryString(file);
    });
  }

  /**
   * Interactive modal matching the exact 79 x 10 mm Sticker Generator layout requested by user
   */
  public static open79x10mmStickerGeneratorModal(initialProducts: Product[] = [], storeName: string = "DRISHYA") {
    let modal = document.getElementById("modal-sticker-generator-79x10");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "modal-sticker-generator-79x10";
      modal.className = "fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto";
      document.body.appendChild(modal);
    }

    let stickerList: Sticker79x10Item[] = initialProducts.map((p, i) => {
      const detailParts = [];
      if (p.model) detailParts.push(p.model);
      if (p.size) detailParts.push(`Sz: ${p.size}`);
      if (p.color) detailParts.push(`Col: ${p.color}`);
      const modelStr = detailParts.join(" ") || p.model || p.name || "";
      const barcodeNumber = p.barcode || p.id || "000000";

      return {
        id: p.id || `stk-${i}`,
        brand: p.brand || p.category || "OptiWay",
        price: `RS ${p.sellingPrice || 0}`,
        model: modelStr,
        barcodeCode: barcodeNumber,
        billNumber: (p as any).billNumber || "",
        supplierLedgerId: (p as any).supplierLedgerId || "",
        type: "CODE128",
        storeName: storeName
      };
    });

    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl p-3.5 sm:p-6 my-2 sm:my-8 space-y-4 max-h-[94vh] overflow-y-auto">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 class="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
              <svg class="w-5 h-5 text-blue-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h10M7 11h10M7 15h10"></path>
              </svg>
              <span>Sticker Generator (79 x 10 mm Optical Tag)</span>
            </h3>
            <p class="text-[11px] sm:text-xs text-slate-500">Generate optical barcode/QR stickers (79 x 10 mm). Choose all selection or single self-selection to print.</p>
          </div>
          <button id="btn-close-stk-gen" class="text-slate-400 hover:text-slate-700 text-lg font-bold p-1 cursor-pointer">✕</button>
        </div>

        <!-- Form Controls -->
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 bg-slate-50 p-3 sm:p-4 rounded-xl border border-slate-200">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Brand</label>
            <input type="text" id="stk-brand" placeholder="e.g. Ray-Ban" class="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white font-semibold min-h-[38px]" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Price (RS)</label>
            <input type="text" id="stk-price" placeholder="e.g. 165.00" class="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white font-semibold min-h-[38px]" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Model Number</label>
            <input type="text" id="stk-model" placeholder="RB2140 Black" class="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white font-semibold min-h-[38px]" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Barcode Number</label>
            <input type="text" id="stk-barcode" placeholder="890123456789" class="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white font-bold font-mono min-h-[38px]" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1">Code Format</label>
            <select id="stk-type" class="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white font-semibold min-h-[38px]">
              <option value="CODE128" selected>Barcode (CODE128)</option>
              <option value="QRCODE">QR Code Only</option>
              <option value="both">Both Barcode & QR</option>
              <option value="CODE39">Barcode (CODE39)</option>
              <option value="ITF">Barcode (ITF)</option>
            </select>
          </div>
        </div>

        <!-- Action Buttons & Selection Controls Bar -->
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
          <div class="flex flex-wrap items-center gap-2">
            <button id="stk-btn-save" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-2xs transition-colors cursor-pointer min-h-[36px]">
              + Add Sticker Tag
            </button>
            <div class="h-6 w-px bg-slate-300 mx-1"></div>
            <!-- Selection toggles -->
            <button id="stk-btn-select-all" class="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-bold rounded-lg transition-colors cursor-pointer min-h-[32px]">
              Select All
            </button>
            <button id="stk-btn-deselect-all" class="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-bold rounded-lg transition-colors cursor-pointer min-h-[32px]">
              Deselect All
            </button>
            <span id="stk-selection-count-badge" class="px-2.5 py-1.5 bg-blue-50 text-blue-800 border border-blue-200 text-xs font-bold rounded-lg">
              0 Selected
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button id="stk-btn-export-selected" class="flex-1 sm:flex-none px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-2xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer min-h-[36px]">
              <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              <span id="stk-export-btn-label">Export Selected (79x10mm PDF)</span>
            </button>
            <div class="flex items-center gap-1.5 bg-white p-1 rounded-lg border border-slate-300 flex-1 sm:flex-none">
              <input type="file" id="stk-excel-file" accept=".xlsx,.xls,.csv" class="text-xs text-slate-600 file:mr-2 file:py-1 file:px-2 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-200 file:text-slate-800 cursor-pointer max-w-[140px] sm:max-w-none" />
              <button id="stk-btn-import" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded transition-colors cursor-pointer whitespace-nowrap">
                Import
              </button>
            </div>
            <button id="stk-btn-download-excel" class="px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg shadow-2xs transition-colors cursor-pointer min-h-[36px]">
              Excel
            </button>
          </div>
        </div>

        <!-- Table View -->
        <div class="border border-slate-200 rounded-xl overflow-x-auto touch-scroll max-h-[320px] overflow-y-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-slate-100 text-slate-700 font-bold sticky top-0 border-b border-slate-200">
              <tr>
                <th class="p-2.5 w-10 text-center"><input type="checkbox" id="stk-check-all" class="rounded border-slate-300 cursor-pointer" checked /></th>
                <th class="p-2.5">Brand</th>
                <th class="p-2.5">Price</th>
                <th class="p-2.5">Model Number</th>
                <th class="p-2.5">Barcode Number</th>
                <th class="p-2.5">Format</th>
                <th class="p-2.5 text-right">Single Action</th>
              </tr>
            </thead>
            <tbody id="stk-tbl-body" class="divide-y divide-slate-100">
              <!-- Dynamically populated -->
            </tbody>
          </table>
        </div>
      </div>
    `;

    modal.classList.remove("hidden");

    const brandInput = document.getElementById("stk-brand") as HTMLInputElement;
    const priceInput = document.getElementById("stk-price") as HTMLInputElement;
    const modelInput = document.getElementById("stk-model") as HTMLInputElement;
    const barcodeInput = document.getElementById("stk-barcode") as HTMLInputElement;
    const typeSelect = document.getElementById("stk-type") as HTMLSelectElement;
    const tbody = document.getElementById("stk-tbl-body")!;
    const countBadge = document.getElementById("stk-selection-count-badge")!;
    const exportBtnLabel = document.getElementById("stk-export-btn-label")!;

    const updateSelectionState = () => {
      const allCheckboxes = tbody.querySelectorAll<HTMLInputElement>(".stk-select-chk");
      let selectedCount = 0;
      allCheckboxes.forEach(chk => {
        if (chk.checked) selectedCount++;
      });

      if (countBadge) {
        countBadge.innerText = `${selectedCount} of ${stickerList.length} Selected`;
      }
      if (exportBtnLabel) {
        exportBtnLabel.innerText = selectedCount > 0 
          ? `Export Selected (${selectedCount}) 79x10mm PDF` 
          : `Export All (${stickerList.length}) 79x10mm PDF`;
      }

      const masterChk = document.getElementById("stk-check-all") as HTMLInputElement;
      if (masterChk) {
        masterChk.checked = stickerList.length > 0 && selectedCount === stickerList.length;
        masterChk.indeterminate = selectedCount > 0 && selectedCount < stickerList.length;
      }
    };

    const renderTable = () => {
      if (stickerList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400">No stickers added. Enter details above or import Excel.</td></tr>`;
        updateSelectionState();
        return;
      }

      tbody.innerHTML = stickerList.map((item, idx) => `
        <tr class="hover:bg-slate-50 transition-colors">
          <td class="p-2.5 text-center">
            <input type="checkbox" class="stk-select-chk rounded border-slate-300 cursor-pointer" data-idx="${idx}" checked />
          </td>
          <td class="p-2.5 font-bold text-slate-800">${item.brand}</td>
          <td class="p-2.5 font-semibold text-emerald-700">${item.price}</td>
          <td class="p-2.5 font-medium text-slate-600">${item.model}</td>
          <td class="p-2.5 font-mono font-bold text-slate-900">${item.barcodeCode}</td>
          <td class="p-2.5 text-slate-500">${item.type || "CODE128"}</td>
          <td class="p-2.5 text-right space-x-1.5">
            <button class="stk-btn-print px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold text-[11px] cursor-pointer inline-flex items-center gap-1 shadow-2xs" data-idx="${idx}" title="Print single self-selected optical sticker">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
              Print Tag
            </button>
            <button class="stk-btn-edit text-blue-600 hover:underline font-bold text-xs cursor-pointer" data-idx="${idx}">Edit</button>
            <button class="stk-btn-del text-rose-600 hover:underline font-bold text-xs cursor-pointer" data-idx="${idx}">Delete</button>
          </td>
        </tr>
      `).join("");

      tbody.querySelectorAll<HTMLInputElement>(".stk-select-chk").forEach(chk => {
        chk.addEventListener("change", updateSelectionState);
      });

      // Wire row events
      tbody.querySelectorAll(".stk-btn-print").forEach(btn => {
        btn.addEventListener("click", async () => {
          const idx = parseInt(btn.getAttribute("data-idx")!, 10);
          const item = stickerList[idx];
          if (item) {
            await BarcodePrinter.downloadExact79x10mmPdf([item], `sticker_${item.barcodeCode}.pdf`);
          }
        });
      });

      tbody.querySelectorAll(".stk-btn-edit").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.getAttribute("data-idx")!, 10);
          const item = stickerList[idx];
          if (item) {
            brandInput.value = item.brand;
            priceInput.value = String(item.price);
            modelInput.value = item.model;
            barcodeInput.value = item.barcodeCode;
            typeSelect.value = item.type || "CODE128";
            stickerList.splice(idx, 1);
            renderTable();
          }
        });
      });

      tbody.querySelectorAll(".stk-btn-del").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.getAttribute("data-idx")!, 10);
          stickerList.splice(idx, 1);
          renderTable();
        });
      });

      updateSelectionState();
    };

    renderTable();

    // Event listeners
    document.getElementById("btn-close-stk-gen")?.addEventListener("click", () => {
      modal!.classList.add("hidden");
    });

    document.getElementById("stk-check-all")?.addEventListener("change", (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      tbody.querySelectorAll<HTMLInputElement>(".stk-select-chk").forEach(chk => {
        chk.checked = checked;
      });
      updateSelectionState();
    });

    document.getElementById("stk-btn-select-all")?.addEventListener("click", () => {
      tbody.querySelectorAll<HTMLInputElement>(".stk-select-chk").forEach(chk => {
        chk.checked = true;
      });
      updateSelectionState();
    });

    document.getElementById("stk-btn-deselect-all")?.addEventListener("click", () => {
      tbody.querySelectorAll<HTMLInputElement>(".stk-select-chk").forEach(chk => {
        chk.checked = false;
      });
      updateSelectionState();
    });

    // Save Sticker Action
    document.getElementById("stk-btn-save")?.addEventListener("click", () => {
      const brand = brandInput.value.trim();
      const price = priceInput.value.trim();
      const model = modelInput.value.trim();
      const barcodeCode = barcodeInput.value.trim();
      const type = typeSelect.value;

      if (!brand || !price || !model || !barcodeCode) {
        alert("Please fill brand, price, model, and barcode code before saving.");
        return;
      }

      stickerList.unshift({
        brand,
        price,
        model,
        barcodeCode,
        type,
        storeName
      });

      brandInput.value = "";
      priceInput.value = "";
      modelInput.value = "";
      barcodeInput.value = "";
      typeSelect.value = "CODE128";

      renderTable();
    });

    // Export Selected PDF
    document.getElementById("stk-btn-export-selected")?.addEventListener("click", async () => {
      const selectedIndices: number[] = [];
      tbody.querySelectorAll<HTMLInputElement>(".stk-select-chk").forEach(chk => {
        if (chk.checked) {
          selectedIndices.push(parseInt(chk.getAttribute("data-idx")!, 10));
        }
      });

      const targetItems = selectedIndices.length > 0 
        ? selectedIndices.map(i => stickerList[i])
        : stickerList;

      if (targetItems.length === 0) {
        alert("No stickers available to export.");
        return;
      }

      await BarcodePrinter.downloadExact79x10mmPdf(targetItems, `stickers_${targetItems.length}_tags.pdf`);
    });

    // Import Excel Action
    document.getElementById("stk-btn-import")?.addEventListener("click", async () => {
      const fileInput = document.getElementById("stk-excel-file") as HTMLInputElement;
      const file = fileInput.files?.[0];
      if (!file) {
        alert("Please choose an Excel (.xlsx, .xls) or CSV file first.");
        return;
      }

      try {
        const imported = await BarcodePrinter.parseStickersExcel(file);
        if (imported.length === 0) {
          alert("No valid rows found in Excel file.");
          return;
        }

        imported.forEach(item => {
          item.storeName = storeName;
          stickerList.push(item);
        });

        fileInput.value = "";
        renderTable();
        alert(`Successfully imported ${imported.length} sticker rows from Excel!`);
      } catch (err) {
        console.error("Excel import failed:", err);
        alert("Failed to parse Excel file. Please ensure it follows standard tabular format.");
      }
    });

    // Download Excel Action
    document.getElementById("stk-btn-download-excel")?.addEventListener("click", () => {
      if (stickerList.length === 0) {
        alert("No sticker data to export to Excel.");
        return;
      }
      BarcodePrinter.downloadStickersExcel(stickerList, "stickers.xlsx");
    });
  }
}

export interface Sticker79x10Item {
  id?: string;
  brand: string;
  price: string | number;
  model: string;
  barcodeCode: string;
  billNumber?: string;
  supplierLedgerId?: string;
  type?: string;
  codeType?: "barcode" | "qrcode" | "both" | string;
  storeName?: string;
}

