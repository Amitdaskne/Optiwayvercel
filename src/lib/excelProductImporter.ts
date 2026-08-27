import * as XLSX from "xlsx";
import { dbService, Product, PendingProduct, InventoryMovement, Supplier } from "./db";
import { Toast } from "../components/layout";

export interface ParsedProductRow {
  name: string;
  modelNumber: string;
  sku: string;
  barcode?: string;
  hsnCode?: string;
  size?: string;
  color?: string;
  category: Product["category"];
  brand: string;
  model: string;
  supplierName: string;
  supplierLedgerId?: string;
  billNumber?: string;
  sellingPrice: number;
  purchasePrice: number;
  stockQuantity: number;
  minStockLevel: number;
  imageUrl?: string;
  status: "Active" | "Inactive";
  isValid: boolean;
  validationError?: string;
  isExisting?: boolean;
  existingId?: string;
}

export class ExcelProductImporter {
  /**
   * Generates and downloads a sample Excel (.xlsx) template for bulk product import
   */
  public static downloadSampleTemplate() {
    const sampleData = [
      {
        "Bill Number": "BIL-2026-081",
        "Supplier Ledger ID": "LED-ESS-01",
        "Supplier": "EssilorLuxottica",
        "Product Name": "Ray-Ban Aviator Classic",
        "Model Number": "FRM-RB3025",
        "Barcode / EAN": "8056597123456",
        "HSN Code": "90031100",
        "Size": "58/14",
        "Colour": "Gold / Green G-15",
        "Category": "Frame",
        "Brand": "Ray-Ban",
        "Model / Specs": "RB3025 Aviator",
        "Selling Price": 180.00,
        "Cost Price": 95.00,
        "Stock Quantity": 25,
        "Min Stock Alert": 5,
        "Status": "Active",
        "Image URL": "https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=500&q=80"
      },
      {
        "Bill Number": "BIL-2026-081",
        "Supplier Ledger ID": "LED-ESS-01",
        "Supplier": "EssilorLuxottica",
        "Product Name": "Oakley Holbrook Polarized",
        "Model Number": "FRM-OK9102",
        "Barcode / EAN": "700285910201",
        "HSN Code": "90031100",
        "Size": "55/18",
        "Colour": "Matte Black / Prizm Grey",
        "Category": "Frame",
        "Brand": "Oakley",
        "Model / Specs": "OO9102 Holbrook",
        "Selling Price": 165.00,
        "Cost Price": 88.00,
        "Stock Quantity": 18,
        "Min Stock Alert": 4,
        "Status": "Active",
        "Image URL": "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=500&q=80"
      },
      {
        "Bill Number": "BIL-2026-090",
        "Supplier Ledger ID": "LED-ZSS-02",
        "Supplier": "Zeiss Vision Care",
        "Product Name": "Zeiss Single Vision ClearView 1.6",
        "Model Number": "LNS-ZS160-CR",
        "Barcode / EAN": "4047865123901",
        "HSN Code": "90015000",
        "Size": "70mm",
        "Colour": "Clear",
        "Category": "Lens",
        "Brand": "Zeiss",
        "Model / Specs": "1.60 Index DuraVision Platinum",
        "Selling Price": 120.00,
        "Cost Price": 55.00,
        "Stock Quantity": 40,
        "Min Stock Alert": 10,
        "Status": "Active",
        "Image URL": ""
      },
      {
        "Bill Number": "BIL-2026-102",
        "Supplier Ledger ID": "LED-JNJ-03",
        "Supplier": "Johnson & Johnson Vision",
        "Product Name": "Acuvue Oasys with HydraLuxe 30PK",
        "Model Number": "CL-ACV-OAS30",
        "Barcode / EAN": "073390518342",
        "HSN Code": "90013000",
        "Size": "8.5 BC / -2.50",
        "Colour": "Clear",
        "Category": "Contact Lens",
        "Brand": "Johnson & Johnson",
        "Model / Specs": "Daily Disposable 30PK",
        "Selling Price": 38.50,
        "Cost Price": 21.00,
        "Stock Quantity": 60,
        "Min Stock Alert": 15,
        "Status": "Active",
        "Image URL": ""
      },
      {
        "Bill Number": "BIL-2026-110",
        "Supplier Ledger ID": "LED-DIR-04",
        "Supplier": "OptiWay Direct",
        "Product Name": "Anti-Fog Lens Cleaning Spray 60ml",
        "Model Number": "ACC-CLN-SP60",
        "Barcode / EAN": "8901234567890",
        "HSN Code": "34029099",
        "Size": "60ml",
        "Colour": "Transparent",
        "Category": "Accessories",
        "Brand": "OptiWay",
        "Model / Specs": "Microfiber cloth included",
        "Selling Price": 12.00,
        "Cost Price": 4.00,
        "Stock Quantity": 100,
        "Min Stock Alert": 20,
        "Status": "Active",
        "Image URL": ""
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    
    // Auto-fit column widths
    worksheet["!cols"] = [
      { wch: 18 }, // Bill Number
      { wch: 20 }, // Supplier Ledger ID
      { wch: 22 }, // Supplier
      { wch: 32 }, // Product Name
      { wch: 18 }, // Model Number
      { wch: 18 }, // Barcode / EAN
      { wch: 14 }, // HSN Code
      { wch: 12 }, // Size
      { wch: 18 }, // Colour
      { wch: 15 }, // Category
      { wch: 18 }, // Brand
      { wch: 26 }, // Model
      { wch: 14 }, // Selling Price
      { wch: 12 }, // Cost Price
      { wch: 15 }, // Stock Quantity
      { wch: 16 }, // Min Stock Alert
      { wch: 10 }, // Status
      { wch: 35 }, // Image URL
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Products Template");

    XLSX.writeFile(workbook, "optiway_product_import_template.xlsx");
  }

  /**
   * Export all existing products to an Excel (.xlsx) file
   */
  public static exportProductsToExcel(products: Product[], filename: string = "optiway_products_catalog.xlsx") {
    if (!products || products.length === 0) {
      Toast.show("No products available to export.", "error");
      return;
    }

    const exportRows = products.map((p) => ({
      "Bill Number": p.billNumber || "",
      "Supplier Ledger ID": p.supplierLedgerId || "",
      "Supplier": p.supplierName || "",
      "Product Name": p.name || "",
      "Model Number": p.modelNumber || p.sku || "",
      "Barcode / EAN": p.barcode || "",
      "HSN Code": p.hsnCode || "",
      "Size": p.size || "",
      "Colour": p.color || "",
      "Category": p.category || "Frame",
      "Brand": p.brand || "",
      "Model / Specs": p.model || "",
      "Selling Price": p.sellingPrice || 0,
      "Cost Price": p.purchasePrice || 0,
      "Stock Quantity": p.stockQuantity || 0,
      "Min Stock Alert": p.minStockLevel || 5,
      "Status": p.status || "Active",
      "Image URL": p.imageUrl || "",
      "Created At": p.createdAt || ""
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    worksheet["!cols"] = [
      { wch: 18 },
      { wch: 20 },
      { wch: 22 },
      { wch: 32 },
      { wch: 18 },
      { wch: 18 },
      { wch: 14 },
      { wch: 12 },
      { wch: 18 },
      { wch: 15 },
      { wch: 18 },
      { wch: 26 },
      { wch: 14 },
      { wch: 12 },
      { wch: 15 },
      { wch: 16 },
      { wch: 10 },
      { wch: 35 },
      { wch: 22 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Products Catalog");

    XLSX.writeFile(workbook, filename);
    Toast.show(`Exported ${products.length} products to Excel!`, "success");
  }

  /**
   * Reads and parses an uploaded file (.xlsx, .xls, or .csv)
   */
  public static async parseExcelFile(file: File, existingProducts: Product[]): Promise<ParsedProductRow[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });

          const firstSheetName = workbook.SheetNames[0];
          if (!firstSheetName) {
            throw new Error("No sheets found in Excel file.");
          }

          const worksheet = workbook.Sheets[firstSheetName];
          const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

          if (!rawRows || rawRows.length === 0) {
            throw new Error("Excel sheet is empty or contains no data rows.");
          }

          const existingModelMap = new Map<string, Product>();
          existingProducts.forEach((p) => {
            const key = (p.modelNumber || p.sku || "").trim().toLowerCase();
            if (key) existingModelMap.set(key, p);
          });

          const parsedList: ParsedProductRow[] = rawRows.map((row, index) => {
            return ExcelProductImporter.mapRowToProduct(row, index, existingModelMap);
          });

          resolve(parsedList);
        } catch (err: any) {
          console.error("Error parsing Excel file:", err);
          reject(err);
        }
      };

      reader.onerror = (err) => {
        console.error("FileReader error:", err);
        reject(new Error("Failed to read file from disk."));
      };

      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Maps dynamic row keys from Excel to a standardized Product structure with auto-detection
   */
  private static mapRowToProduct(
    row: Record<string, any>,
    index: number,
    existingModelMap: Map<string, Product>
  ): ParsedProductRow {
    // Normalization lookup helper
    const getValue = (candidateKeys: string[]): string => {
      for (const [key, val] of Object.entries(row)) {
        const cleanKey = key.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const cand of candidateKeys) {
          const cleanCand = cand.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (cleanKey === cleanCand || cleanKey.includes(cleanCand)) {
            if (val !== undefined && val !== null) {
              return String(val).trim();
            }
          }
        }
      }
      return "";
    };

    // 0. Bill Number & Supplier Ledger ID
    const billNumber = getValue([
      "Bill Number",
      "Bill No",
      "BillNo",
      "Invoice Number",
      "Invoice No",
      "Invoice",
      "Bill",
      "Purchase Bill",
      "Bill #"
    ]);

    const supplierLedgerId = getValue([
      "Supplier Ledger ID",
      "Supplier Ledger",
      "Ledger ID",
      "LedgerId",
      "Ledger Code",
      "Ledger No",
      "Ledger",
      "Supplier Code"
    ]);

    // 1. Product Name
    const name = getValue([
      "Product Name",
      "ProductName",
      "Name",
      "Item Name",
      "Title",
      "Product",
      "Description"
    ]);

    // 2. Barcode & HSN Code (Separate fields)
    const barcode = getValue([
      "Barcode / EAN",
      "Barcode",
      "Bar Code",
      "EAN",
      "UPC",
      "EAN-13",
      "EAN13",
      "Item Barcode"
    ]);

    const hsnCode = getValue([
      "HSN Code",
      "HSN",
      "HSN/SAC",
      "SAC",
      "HSNCode",
      "Tax Code"
    ]);

    // 3. Size & Colour (Optional, separate fields)
    const size = getValue([
      "Size",
      "Frame Size",
      "Eye Size",
      "Lens Size",
      "Dimensions",
      "Dimension"
    ]);

    const color = getValue([
      "Colour",
      "Color",
      "Color Code",
      "Colour Code",
      "Shade",
      "Frame Color",
      "Frame Colour"
    ]);

    // 4. Model Number / SKU / Code
    let modelNumber = getValue([
      "Model Number",
      "Model No",
      "ModelNumber",
      "Model Code",
      "SKU / Code",
      "SKU",
      "Code",
      "Article",
      "Article No",
      "Item Code",
      "Product Code",
      "SKUCode"
    ]);

    // If Model Number is missing, auto-generate a clean one
    if (!modelNumber && name) {
      const cleanPrefix = name.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, "PRD");
      modelNumber = `${cleanPrefix}-${Date.now().toString().slice(-4)}${index + 1}`;
    }

    // 5. Category
    const rawCat = getValue(["Category", "category", "Type", "Product Category", "Group"]).toLowerCase();
    let category: Product["category"] = "Frame";
    if (rawCat.includes("lens") && !rawCat.includes("contact")) {
      category = "Lens";
    } else if (rawCat.includes("contact")) {
      category = "Contact Lens";
    } else if (rawCat.includes("acc") || rawCat.includes("spray") || rawCat.includes("case") || rawCat.includes("cloth")) {
      category = "Accessories";
    } else if (rawCat.includes("serv") || rawCat.includes("exam") || rawCat.includes("repair") || rawCat.includes("fitting")) {
      category = "Services";
    } else {
      category = "Frame";
    }

    // 6. Brand & Model
    const brand = getValue(["Brand", "Brand Name", "Manufacturer", "Make"]) || "OptiWay";
    const model = getValue(["Model / Specs", "Model", "Specs", "Specification"]);
    const supplierName = getValue(["Supplier", "Supplier Name", "Vendor", "Distributor"]);

    // 7. Numerical values
    const parseNum = (raw: string, fallback: number = 0): number => {
      if (!raw) return fallback;
      const clean = String(raw).replace(/[^0-9.-]/g, "");
      const val = parseFloat(clean);
      return isNaN(val) ? fallback : Math.max(0, val);
    };

    const sellingPrice = parseNum(
      getValue(["Selling Price", "Price", "MRP", "Rate", "Sale Price", "Retail Price", "Unit Price", "Price (INR)", "Price ($)"]),
      0
    );

    const purchasePrice = parseNum(
      getValue(["Cost Price", "Cost", "Purchase Price", "Buy Price", "Purchase Cost", "Cost ($)", "Cost (INR)"]),
      0
    );

    const stockQuantity = Math.round(
      parseNum(
        getValue(["Stock Quantity", "Stock", "Quantity", "Qty", "Current Stock", "Count", "Units"]),
        0
      )
    );

    const minStockLevel = Math.round(
      parseNum(
        getValue(["Min Stock Alert", "Min Stock Level", "Min Stock", "Minimum Stock", "Alert Level", "Reorder Level"]),
        5
      )
    );

    // 8. Status & Image URL
    const rawStatus = getValue(["Status", "Active"]).toLowerCase();
    const status: "Active" | "Inactive" = (rawStatus === "inactive" || rawStatus === "no" || rawStatus === "0") ? "Inactive" : "Active";
    const imageUrl = getValue(["Image URL", "ImageUrl", "Image", "Photo", "Picture"]);

    // Validation Check
    let isValid = true;
    let validationError = "";

    if (!name) {
      isValid = false;
      validationError = "Missing Product Name";
    } else if (sellingPrice < 0) {
      isValid = false;
      validationError = "Selling price cannot be negative";
    }

    // Check if Model Number already exists in catalog
    const existing = modelNumber ? existingModelMap.get(modelNumber.toLowerCase()) : undefined;

    return {
      name,
      modelNumber: modelNumber || "MOD-" + (index + 1),
      sku: modelNumber || "MOD-" + (index + 1),
      barcode: barcode || undefined,
      hsnCode: hsnCode || undefined,
      size: size || undefined,
      color: color || undefined,
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
      status,
      isValid,
      validationError,
      isExisting: !!existing,
      existingId: existing?.id
    };
  }

  /**
   * Execute batch import of verified products into the database (supports Pending queue or direct Live stock)
   */
  public static async executeBatchImport(
    productsToImport: ParsedProductRow[],
    options: {
      targetDestination: "pending" | "live";
      updateExisting: boolean;
      recordInventoryMovement: boolean;
      defaultBillNumber?: string;
      defaultSupplierLedgerId?: string;
      onProgress?: (current: number, total: number, itemName: string) => void;
    }
  ): Promise<{ added: number; updated: number; failed: number; pendingCount: number }> {
    let addedCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    let pendingCount = 0;
    const total = productsToImport.length;
    const batchId = `BAT-${Date.now().toString().slice(-6)}`;

    for (let i = 0; i < total; i++) {
      const item = productsToImport[i];
      if (!item.isValid) {
        failedCount++;
        continue;
      }

      if (options.onProgress) {
        options.onProgress(i + 1, total, item.name);
      }

      const finalBillNumber = item.billNumber || options.defaultBillNumber || "";
      const finalSupplierLedgerId = item.supplierLedgerId || options.defaultSupplierLedgerId || "";

      try {
        if (options.targetDestination === "pending") {
          // Route to Pending Products queue for barcode generation & confirmation
          const pendingPayload: Partial<PendingProduct> = {
            name: item.name,
            modelNumber: item.modelNumber || item.sku,
            sku: item.modelNumber || item.sku,
            barcode: item.barcode || "",
            hsnCode: item.hsnCode || "",
            size: item.size || "",
            color: item.color || "",
            category: item.category,
            brand: item.brand,
            model: item.model,
            supplierName: item.supplierName,
            supplierLedgerId: finalSupplierLedgerId,
            billNumber: finalBillNumber,
            sellingPrice: item.sellingPrice,
            purchasePrice: item.purchasePrice,
            stockQuantity: item.stockQuantity,
            minStockLevel: item.minStockLevel,
            imageUrl: item.imageUrl,
            status: "Pending",
            batchId: batchId,
            importDate: new Date().toISOString(),
            createdAt: new Date().toISOString()
          };

          await dbService.saveItem("pendingProducts", pendingPayload);
          pendingCount++;
        } else {
          // Direct Live Catalog Import
          const payload: Partial<Product> = {
            name: item.name,
            modelNumber: item.modelNumber || item.sku,
            sku: item.modelNumber || item.sku,
            barcode: item.barcode || "",
            hsnCode: item.hsnCode || "",
            size: item.size || "",
            color: item.color || "",
            category: item.category,
            brand: item.brand,
            model: item.model,
            supplierName: item.supplierName,
            supplierLedgerId: finalSupplierLedgerId,
            billNumber: finalBillNumber,
            sellingPrice: item.sellingPrice,
            purchasePrice: item.purchasePrice,
            stockQuantity: item.stockQuantity,
            minStockLevel: item.minStockLevel,
            imageUrl: item.imageUrl,
            status: item.status,
            createdAt: new Date().toISOString()
          };

          if (item.isExisting && options.updateExisting && item.existingId) {
            payload.id = item.existingId;
            await dbService.saveItem("products", payload);
            updatedCount++;
          } else {
            // New product
            delete payload.id;
            const newId = await dbService.saveItem("products", payload);
            addedCount++;

            // Record initial inventory movement log if requested
            if (options.recordInventoryMovement && item.stockQuantity > 0) {
              const movement: Partial<InventoryMovement> = {
                productId: newId,
                productName: item.name,
                type: "Stock-In",
                quantityChange: item.stockQuantity,
                previousQuantity: 0,
                newQuantity: item.stockQuantity,
                reason: `Bulk Excel Import (Bill #${finalBillNumber || 'N/A'}, Ledger #${finalSupplierLedgerId || 'N/A'})`,
                createdAt: new Date().toISOString(),
                user: "Excel Importer"
              };
              await dbService.saveItem("inventoryLogs", movement);
            }
          }
        }
      } catch (err) {
        console.error(`Failed to import item "${item.name}":`, err);
        failedCount++;
      }
    }

    return { added: addedCount, updated: updatedCount, failed: failedCount, pendingCount };
  }

  /**
   * Opens the Excel Import Modal dialog
   */
  public static async openImportModal(
    existingProducts: Product[],
    onImportComplete: (destination?: "pending" | "live") => Promise<void>
  ) {
    // Remove existing modal if any
    const oldModal = document.getElementById("modal-excel-import");
    if (oldModal) oldModal.remove();

    // Fetch suppliers list for ledger ID autocomplete
    const suppliers = await dbService.getList<Supplier>("suppliers");
    const todayBillDefault = `BIL-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-01`;

    const supplierOptionsHtml = suppliers.map(s => `
      <option value="${s.ledgerId || ""}" data-name="${s.name}">${s.name} ${s.ledgerId ? `(${s.ledgerId})` : ""}</option>
    `).join("");

    const modalHtml = `
      <div id="modal-excel-import" class="fixed inset-0 bg-slate-900/80 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4">
        <div class="bg-white rounded-2xl max-w-4xl w-full border border-slate-200 shadow-2xl flex flex-col max-h-[94vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          
          <!-- Header -->
          <div class="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80 shrink-0">
            <div class="flex items-center gap-2.5 sm:gap-3">
              <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-2xs shrink-0">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
              </div>
              <div>
                <h3 class="font-bold text-slate-900 text-sm sm:text-base">Import Products via Excel / CSV</h3>
                <p class="text-[11px] sm:text-xs text-slate-500">Stage into Pending Queue with Bill Number & Supplier Ledger ID</p>
              </div>
            </div>
            <button id="btn-close-excel-modal" class="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg text-lg leading-none cursor-pointer">✕</button>
          </div>

          <!-- Body -->
          <div class="p-3.5 sm:p-6 overflow-y-auto space-y-4 sm:space-y-5 flex-1">
            
            <!-- Step 1: Download Template or Upload File -->
            <div id="import-step-upload" class="space-y-3 sm:space-y-4">
              <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 sm:p-3.5 bg-blue-50/80 border border-blue-200/80 rounded-xl text-blue-900">
                <div class="flex items-center gap-2.5">
                  <svg class="w-5 h-5 text-blue-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                  </svg>
                  <div>
                    <span class="font-bold text-xs">Need an Excel template with Bill No & Ledger ID?</span>
                    <p class="text-[11px] text-blue-700">Download our pre-formatted spreadsheet with Bill Number, Supplier Ledger, Categories, and Specs.</p>
                  </div>
                </div>
                <button id="btn-download-sample-template" class="w-full sm:w-auto px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition-colors shadow-2xs shrink-0 flex items-center justify-center gap-1.5 cursor-pointer min-h-[36px]">
                  <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
                  </svg>
                  <span>Download Template (.xlsx)</span>
                </button>
              </div>

              <!-- Drag and drop upload zone -->
              <div id="drop-zone-excel" class="border-2 border-dashed border-slate-300 hover:border-emerald-500 bg-slate-50/60 hover:bg-emerald-50/30 rounded-2xl p-6 sm:p-8 text-center transition-all cursor-pointer space-y-3">
                <input type="file" id="input-excel-file" accept=".xlsx, .xls, .csv" class="hidden" />
                <div class="w-12 h-12 sm:w-14 sm:h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto shadow-2xs">
                  <svg class="w-6 h-6 sm:w-7 sm:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                  </svg>
                </div>
                <div>
                  <p class="font-bold text-slate-800 text-xs sm:text-sm">Drag & drop your Excel file here, or <span class="text-emerald-600 underline">browse files</span></p>
                  <p class="text-[11px] sm:text-xs text-slate-400 mt-1">Supports Microsoft Excel (.xlsx, .xls) and CSV (.csv) spreadsheets</p>
                </div>
              </div>
            </div>

            <!-- Step 2: Parsed Preview & Configuration (Initially Hidden) -->
            <div id="import-step-preview" class="hidden space-y-4">
              <!-- Summary Statistics Cards -->
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                <div class="p-2.5 sm:p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <span class="text-[10px] sm:text-[11px] font-bold text-slate-500 uppercase block">Total Rows</span>
                  <span id="stat-total-rows" class="text-base sm:text-lg font-bold text-slate-900">0</span>
                </div>
                <div class="p-2.5 sm:p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <span class="text-[10px] sm:text-[11px] font-bold text-emerald-700 uppercase block">Valid Items</span>
                  <span id="stat-valid-rows" class="text-base sm:text-lg font-bold text-emerald-800">0</span>
                </div>
                <div class="p-2.5 sm:p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <span class="text-[10px] sm:text-[11px] font-bold text-blue-700 uppercase block">With Bill Number</span>
                  <span id="stat-bill-rows" class="text-base sm:text-lg font-bold text-blue-800">0</span>
                </div>
                <div class="p-2.5 sm:p-3 bg-rose-50 border border-rose-200 rounded-xl">
                  <span class="text-[10px] sm:text-[11px] font-bold text-rose-700 uppercase block">Invalid / Errors</span>
                  <span id="stat-invalid-rows" class="text-base sm:text-lg font-bold text-rose-800">0</span>
                </div>
              </div>

              <!-- Default Fallback Bill No & Ledger ID (if not present in row) -->
              <div class="p-3 sm:p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5 sm:space-y-3">
                <div class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                  <svg class="w-4 h-4 text-blue-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
                  </svg>
                  <span>Batch Bill & Supplier Details (Applies to rows missing Bill / Ledger in Excel)</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                  <div>
                    <label class="block text-xs font-semibold text-slate-700 mb-1">Default Bill / Invoice Number</label>
                    <input type="text" id="imp-default-bill" value="${todayBillDefault}" placeholder="e.g. BIL-2026-081" class="w-full px-3 py-1.5 text-xs font-mono font-bold uppercase border border-slate-300 rounded-lg outline-none bg-white min-h-[36px]" />
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-700 mb-1">Default Supplier & Ledger ID</label>
                    <div class="flex flex-col sm:flex-row gap-2">
                      <select id="imp-select-supplier" class="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none bg-white font-medium min-h-[36px]">
                        <option value="">-- Choose Existing Supplier --</option>
                        ${supplierOptionsHtml}
                      </select>
                      <input type="text" id="imp-custom-ledger" placeholder="Ledger ID" class="w-full sm:w-32 px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg outline-none bg-white font-bold min-h-[36px]" />
                    </div>
                  </div>
                </div>
              </div>

              <!-- Staging Destination & Options -->
              <div class="p-3 sm:p-4 bg-emerald-50/60 rounded-xl border border-emerald-200 space-y-2.5 text-xs">
                <div class="font-bold text-emerald-950 uppercase text-[11px] tracking-wider">Workflow Routing & Destination</div>
                
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 pt-1">
                  <label class="flex items-start gap-2.5 p-2.5 bg-white rounded-lg border border-emerald-300 cursor-pointer shadow-2xs">
                    <input type="radio" name="import-destination" value="pending" checked class="mt-0.5 text-emerald-600 focus:ring-emerald-500" />
                    <div>
                      <span class="font-bold text-slate-900 block text-xs">Stage into Pending Queue (Recommended)</span>
                      <span class="text-[11px] text-slate-500 leading-snug">Verify rows, edit bill details, print 79x10mm optical stickers / QR codes, then click "Confirm to Stock" when ready.</span>
                    </div>
                  </label>

                  <label class="flex items-start gap-2.5 p-2.5 bg-white rounded-lg border border-slate-200 hover:border-slate-300 cursor-pointer shadow-2xs">
                    <input type="radio" name="import-destination" value="live" class="mt-0.5 text-blue-600 focus:ring-blue-500" />
                    <div>
                      <span class="font-bold text-slate-900 block text-xs">Direct to Live Catalog Stock</span>
                      <span class="text-[11px] text-slate-500 leading-snug">Immediately updates active inventory counts and records Stock-In logs.</span>
                    </div>
                  </label>
                </div>

                <div class="flex flex-wrap items-center gap-4 pt-1 border-t border-emerald-100 text-slate-700">
                  <label class="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" id="chk-update-existing" checked class="rounded text-emerald-600 focus:ring-emerald-500" />
                    <span>Update matching Model Number product info</span>
                  </label>
                  <label class="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" id="chk-log-movement" checked class="rounded text-emerald-600 focus:ring-emerald-500" />
                    <span>Record Stock-In inventory movement</span>
                  </label>
                </div>
              </div>

              <!-- Scrollable Table Preview -->
              <div class="border border-slate-200 rounded-xl overflow-hidden">
                <div class="max-h-52 sm:max-h-56 overflow-y-auto overflow-x-auto touch-scroll">
                  <table class="w-full text-left text-xs border-collapse">
                    <thead class="bg-slate-100 text-slate-700 font-bold uppercase text-[10px] sticky top-0 border-b border-slate-200 whitespace-nowrap">
                      <tr>
                        <th class="p-2.5">Status</th>
                        <th class="p-2.5">Bill Number</th>
                        <th class="p-2.5">Ledger ID</th>
                        <th class="p-2.5">Product Name</th>
                        <th class="p-2.5">Model Number</th>
                        <th class="p-2.5">Category</th>
                        <th class="p-2.5 text-right">Price</th>
                        <th class="p-2.5 text-right">Stock</th>
                      </tr>
                    </thead>
                    <tbody id="tbl-excel-preview-body" class="divide-y divide-slate-100 text-slate-700">
                      <!-- Populated via JS -->
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Progress bar container (Hidden during preview, shown when importing) -->
              <div id="import-progress-box" class="hidden p-3.5 sm:p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div class="flex justify-between text-xs font-bold text-slate-700">
                  <span id="import-progress-status">Importing products...</span>
                  <span id="import-progress-percent">0%</span>
                </div>
                <div class="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
                  <div id="import-progress-fill" class="bg-emerald-600 h-full w-0 transition-all duration-100"></div>
                </div>
              </div>
            </div>

          </div>

          <!-- Footer Actions -->
          <div class="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
            <button id="btn-cancel-excel-import" class="px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer min-h-[36px]">
              Cancel
            </button>
            <div class="flex items-center gap-2">
              <button id="btn-reselect-excel" class="hidden px-3 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 font-bold text-xs rounded-lg transition-colors cursor-pointer min-h-[36px]">
                Choose Different File
              </button>
              <button id="btn-execute-import" disabled class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                </svg>
                <span id="btn-execute-label">Upload to Pending Queue</span>
              </button>
            </div>
          </div>

        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", modalHtml);

    const modal = document.getElementById("modal-excel-import")!;
    const dropZone = document.getElementById("drop-zone-excel")!;
    const fileInput = document.getElementById("input-excel-file") as HTMLInputElement;
    const downloadTemplateBtn = document.getElementById("btn-download-sample-template")!;
    const closeBtn = document.getElementById("btn-close-excel-modal")!;
    const cancelBtn = document.getElementById("btn-cancel-excel-import")!;
    const reselectBtn = document.getElementById("btn-reselect-excel")!;
    const executeBtn = document.getElementById("btn-execute-import") as HTMLButtonElement;
    const executeLabel = document.getElementById("btn-execute-label")!;

    const supplierSelect = document.getElementById("imp-select-supplier") as HTMLSelectElement;
    const customLedgerInput = document.getElementById("imp-custom-ledger") as HTMLInputElement;

    supplierSelect?.addEventListener("change", () => {
      customLedgerInput.value = supplierSelect.value;
    });

    const destinationRadios = document.querySelectorAll<HTMLInputElement>('input[name="import-destination"]');
    destinationRadios.forEach(radio => {
      radio.addEventListener("change", () => {
        if (radio.value === "pending") {
          executeLabel.innerText = "Upload to Pending Queue";
        } else {
          executeLabel.innerText = "Import to Live Catalog";
        }
      });
    });

    const stepUpload = document.getElementById("import-step-upload")!;
    const stepPreview = document.getElementById("import-step-preview")!;

    let currentParsedRows: ParsedProductRow[] = [];

    const closeModal = () => modal.remove();

    closeBtn.addEventListener("click", closeModal);
    cancelBtn.addEventListener("click", closeModal);

    downloadTemplateBtn.addEventListener("click", () => {
      ExcelProductImporter.downloadSampleTemplate();
      Toast.show("Sample Excel template downloaded!", "success");
    });

    dropZone.addEventListener("click", () => fileInput.click());

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("border-emerald-500", "bg-emerald-50/40");
    });

    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("border-emerald-500", "bg-emerald-50/40");
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("border-emerald-500", "bg-emerald-50/40");
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        handleFileSelection(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleFileSelection(fileInput.files[0]);
      }
    });

    reselectBtn.addEventListener("click", () => {
      stepPreview.classList.add("hidden");
      stepUpload.classList.remove("hidden");
      reselectBtn.classList.add("hidden");
      executeBtn.disabled = true;
      fileInput.value = "";
      currentParsedRows = [];
    });

    const handleFileSelection = async (file: File) => {
      try {
        Toast.show(`Reading "${file.name}"...`, "info");
        const parsed = await ExcelProductImporter.parseExcelFile(file, existingProducts);

        if (parsed.length === 0) {
          Toast.show("No valid product rows could be found in the file.", "error");
          return;
        }

        currentParsedRows = parsed;
        renderParsedPreview(parsed);

        stepUpload.classList.add("hidden");
        stepPreview.classList.remove("hidden");
        reselectBtn.classList.remove("hidden");
        executeBtn.disabled = parsed.filter(p => p.isValid).length === 0;
      } catch (err: any) {
        console.error("Excel import parse error:", err);
        Toast.show(err.message || "Failed to parse Excel file.", "error");
      }
    };

    const renderParsedPreview = (rows: ParsedProductRow[]) => {
      const validCount = rows.filter(r => r.isValid).length;
      const invalidCount = rows.filter(r => !r.isValid).length;
      const withBillCount = rows.filter(r => !!r.billNumber).length;

      document.getElementById("stat-total-rows")!.innerText = String(rows.length);
      document.getElementById("stat-valid-rows")!.innerText = String(validCount);
      document.getElementById("stat-bill-rows")!.innerText = String(withBillCount);
      document.getElementById("stat-invalid-rows")!.innerText = String(invalidCount);

      const tbody = document.getElementById("tbl-excel-preview-body")!;
      tbody.innerHTML = rows.map((r) => {
        let badgeHtml = "";
        if (!r.isValid) {
          badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800" title="${r.validationError}">Invalid</span>`;
        } else if (r.isExisting) {
          badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">Existing</span>`;
        } else {
          badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">New</span>`;
        }

        const metaTags: string[] = [];
        if (r.size) metaTags.push(`<span class="px-1.5 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded text-[9px] font-bold">Size: ${r.size}</span>`);
        if (r.color) metaTags.push(`<span class="px-1.5 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 rounded text-[9px] font-bold">Col: ${r.color}</span>`);
        if (r.hsnCode) metaTags.push(`<span class="px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[9px] font-mono">HSN: ${r.hsnCode}</span>`);
        if (r.barcode) metaTags.push(`<span class="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[9px] font-mono">Bar: ${r.barcode}</span>`);

        return `
          <tr class="hover:bg-slate-50 ${!r.isValid ? "bg-rose-50/40" : ""}">
            <td class="p-2.5">${badgeHtml}</td>
            <td class="p-2.5 font-mono text-[11px] text-blue-700 font-bold">${r.billNumber || "<span class='text-slate-400 font-normal italic'>Default</span>"}</td>
            <td class="p-2.5 font-mono text-[11px] text-purple-700 font-semibold">${r.supplierLedgerId || "<span class='text-slate-400 font-normal italic'>Default</span>"}</td>
            <td class="p-2.5">
              <div class="font-bold text-slate-900">${r.name || "<span class='text-rose-500 italic'>Missing Name</span>"}</div>
              ${metaTags.length > 0 ? `<div class="flex flex-wrap gap-1 mt-1">${metaTags.join("")}</div>` : ""}
            </td>
            <td class="p-2.5 font-mono text-[11px] text-slate-600">${r.modelNumber || r.sku}</td>
            <td class="p-2.5 text-slate-600">${r.category}</td>
            <td class="p-2.5 text-right font-bold text-slate-900">RS ${(r.sellingPrice || 0).toFixed(2)}</td>
            <td class="p-2.5 text-right font-bold text-slate-800">${r.stockQuantity || 0}</td>
          </tr>
        `;
      }).join("");
    };

    executeBtn.addEventListener("click", async () => {
      const validRows = currentParsedRows.filter(r => r.isValid);
      if (validRows.length === 0) {
        Toast.show("No valid products to import.", "error");
        return;
      }

      const dest = (document.querySelector('input[name="import-destination"]:checked') as HTMLInputElement)?.value as "pending" | "live" || "pending";
      const defaultBill = (document.getElementById("imp-default-bill") as HTMLInputElement)?.value.trim() || todayBillDefault;
      const defaultLedger = (document.getElementById("imp-custom-ledger") as HTMLInputElement)?.value.trim() || "";
      const updateExisting = (document.getElementById("chk-update-existing") as HTMLInputElement)?.checked ?? true;
      const recordMovement = (document.getElementById("chk-log-movement") as HTMLInputElement)?.checked ?? true;

      const progressBox = document.getElementById("import-progress-box")!;
      const progressFill = document.getElementById("import-progress-fill")!;
      const progressText = document.getElementById("import-progress-status")!;
      const progressPercent = document.getElementById("import-progress-percent")!;

      progressBox.classList.remove("hidden");
      executeBtn.disabled = true;
      reselectBtn.classList.add("hidden");

      try {
        const result = await ExcelProductImporter.executeBatchImport(validRows, {
          targetDestination: dest,
          defaultBillNumber: defaultBill,
          defaultSupplierLedgerId: defaultLedger,
          updateExisting,
          recordInventoryMovement: recordMovement,
          onProgress: (current, total, itemName) => {
            const pct = Math.round((current / total) * 100);
            progressFill.style.width = `${pct}%`;
            progressPercent.innerText = `${pct}%`;
            progressText.innerText = `Processing (${current}/${total}): ${itemName.slice(0, 24)}...`;
          }
        });

        if (dest === "pending") {
          Toast.show(
            `Successfully uploaded ${result.pendingCount} items to Pending Queue with Bill No "${defaultBill}"!`,
            "success"
          );
        } else {
          Toast.show(
            `Import Complete: ${result.added} added, ${result.updated} updated${result.failed ? `, ${result.failed} failed` : ""}`,
            "success"
          );
        }

        await onImportComplete(dest);
        setTimeout(() => closeModal(), 900);
      } catch (err: any) {
        console.error("Batch import execution error:", err);
        Toast.show("Import failed: " + err.message, "error");
        executeBtn.disabled = false;
      }
    });
  }
}
