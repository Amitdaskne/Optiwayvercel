import { rtdb } from "./firebase";
import { ref, get, set, update, push, remove, onValue } from "firebase/database";

// Entity Type Definitions
export interface Customer {
  id: string;
  name: string;
  mobile: string;
  email?: string;
  address?: string;
  createdAt: string;
  outstandingBalance: number;
  lastPurchaseDate?: string;
}

export interface Prescription {
  id: string;
  customerId: string;
  customerName?: string;
  saleId?: string;
  orderId?: string;
  eyeSide?: "Both" | "RE" | "LE";
  prescriptionDate: string;
  rightEye: {
    sph: string;
    cyl: string;
    axis: string;
    add: string;
  };
  leftEye: {
    sph: string;
    cyl: string;
    axis: string;
    add: string;
  };
  pd?: string; // Pupillary distance
  visualAcuity?: string;
  notes?: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  category: "Frame" | "Lens" | "Contact Lens" | "Accessories" | "Services";
  modelNumber?: string;
  sku?: string;
  barcode?: string;
  hsnCode?: string;
  size?: string;
  color?: string;
  brand: string;
  model?: string;
  sellingPrice: number;
  purchasePrice: number;
  stockQuantity: number;
  minStockLevel: number;
  imageUrl?: string;
  supplierId?: string;
  supplierName?: string;
  supplierLedgerId?: string;
  billNumber?: string;
  status: "Active" | "Inactive";
  createdAt: string;
}

export interface PendingProduct {
  id: string;
  name: string;
  category: "Frame" | "Lens" | "Contact Lens" | "Accessories" | "Services";
  modelNumber?: string;
  sku?: string;
  barcode?: string;
  hsnCode?: string;
  size?: string;
  color?: string;
  brand: string;
  model?: string;
  sellingPrice: number;
  purchasePrice: number;
  stockQuantity: number;
  minStockLevel: number;
  imageUrl?: string;
  supplierId?: string;
  supplierName?: string;
  supplierLedgerId?: string;
  billNumber?: string;
  status: "Pending" | "Confirmed" | "Rejected";
  createdAt: string;
  batchId?: string;
  importDate?: string;
  notes?: string;
}

export interface PurchaseBillItem {
  name: string;
  modelNumber?: string;
  sku?: string;
  barcode?: string;
  hsnCode?: string;
  size?: string;
  color?: string;
  category: "Frame" | "Lens" | "Contact Lens" | "Accessories" | "Services";
  brand: string;
  model: string;
  quantity: number;
  purchasePrice: number;
  sellingPrice: number;
  taxRate?: number;
  discount?: number;
  minStockLevel?: number;
}

export interface PurchaseBill {
  id: string;
  billNumber: string;
  supplierName: string;
  supplierLedgerId?: string;
  supplierPhone?: string;
  supplierEmail?: string;
  supplierTaxId?: string;
  supplierAddress?: string;
  billDate: string;
  dueDate?: string;
  paymentStatus: "Paid" | "Unpaid" | "Partial";
  paymentMethod: string;
  subtotal: number;
  taxRate?: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  items: PurchaseBillItem[];
  destination: "live" | "pending";
  notes?: string;
  fileUrl?: string;
  fileName?: string;
  createdAt: string;
}

export interface InventoryMovement {
  id: string;
  productId: string;
  productName: string;
  type: "Stock-In" | "Stock-Out" | "Adjustment" | "Damage" | "Correction" | "Sale";
  quantityChange: number;
  previousQuantity: number;
  newQuantity: number;
  reason?: string;
  createdAt: string;
  user?: string;
}

export type InventoryLog = InventoryMovement;

export interface Supplier {
  id: string;
  name: string;
  ledgerId: string;
  contactPerson?: string;
  mobile: string;
  phone?: string;
  email?: string;
  taxId?: string;
  address?: string;
  productsSupplied?: string;
  outstandingBalance: number;
  createdAt: string;
}

export interface SaleItem {
  productId: string;
  productName: string;
  category: string;
  quantity: number;
  price: number;
  discount: number;
  total: number;
  eyeSide?: "Both" | "RE" | "LE";
  lensDetails?: string;
  prescriptionText?: string;
  isCustomLens?: boolean;
}

export interface Sale {
  id: string;
  saleNumber: string;
  customerId: string;
  customerName: string;
  customerMobile: string;
  customerEmail?: string;
  customerAddress?: string;
  items: SaleItem[];
  subtotal: number;
  discountTotal: number;
  billDiscountAmount?: number;
  billDiscountType?: "fixed" | "percentage";
  billDiscountValue?: number;
  discountReason?: string;
  taxTotal: number;
  taxRate?: number;
  taxType?: "with_tax" | "without_tax";
  isTaxExempt?: boolean;
  grandTotal: number;
  advanceAmount: number;
  pendingAmount: number;
  paymentMethod: "Cash" | "UPI" | "Card";
  saleDate: string;
  status: "Completed" | "Pending Fulfillment" | "Cancelled";
  orderId?: string;
  invoiceId?: string;
  receiptId?: string;
  prescriptionId?: string;
  notes?: string;
  createdAt: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  saleId: string;
  customerId: string;
  customerName: string;
  customerMobile: string;
  items: SaleItem[];
  subtotal?: number;
  discountTotal?: number;
  billDiscountAmount?: number;
  billDiscountType?: "fixed" | "percentage";
  billDiscountValue?: number;
  discountReason?: string;
  taxRate?: number;
  taxTotal?: number;
  grandTotal: number;
  advancePaid: number;
  pendingBalance: number;
  status: "Pending" | "In Progress" | "Ready for Pickup" | "Completed" | "Cancelled";
  paymentStatus: "Advance-paid" | "Fully-paid" | "Pending" | "Unpaid";
  orderDate: string;
  expectedDeliveryDate?: string;
  prescriptionDetails?: Prescription;
  notes?: string;
  createdAt: string;
}

export interface Receipt {
  id: string;
  receiptNumber: string;
  saleId: string;
  orderId?: string;
  customerId: string;
  customerName: string;
  customerMobile: string;
  date: string;
  totalAmount: number;
  advanceAmount: number;
  pendingAmount: number;
  paymentMethod: string;
  itemsSummary: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  saleId: string;
  orderId?: string;
  customerId: string;
  customerName: string;
  customerMobile: string;
  customerAddress?: string;
  items: SaleItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  taxRate?: number;
  taxType?: "with_tax" | "without_tax";
  isTaxExempt?: boolean;
  grandTotal: number;
  advancePaid: number;
  pendingBalance: number;
  paymentMethod: string;
  date: string;
  prescriptionDetails?: Prescription;
  notes?: string;
  createdAt: string;
}

export interface Expense {
  id: string;
  category: string;
  amount: number;
  date: string;
  expenseDate: string;
  description: string;
  paymentMethod: "Cash" | "UPI" | "Card" | "Bank Transfer";
  createdAt: string;
}

export interface StoreSettings {
  storeName: string;
  phone: string;
  email: string;
  address: string;
  taxRate: number; // percentage e.g. 8.5 or 18
  defaultBillingTaxMode?: "with_tax" | "without_tax";
  gstNumber?: string;
  invoicePrefix: string;
  receiptPrefix: string;
  logoUrl?: string;
  themeColor?: string;
  updatedAt?: string;
}

export function ensureArray<T = any>(val: any): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "object") return Object.values(val);
  return [];
}

export function ensureDateString(val: any, fallback: string = ""): string {
  if (!val) return fallback;
  if (typeof val === "string") return val;
  if (typeof val === "number") {
    try {
      const d = val > 1e11 ? new Date(val) : new Date(val * 1000);
      return isNaN(d.getTime()) ? fallback : d.toISOString();
    } catch {
      return fallback;
    }
  }
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? fallback : val.toISOString();
  }
  if (typeof val === "object") {
    if (typeof val.toDate === "function") {
      try {
        const d = val.toDate();
        return isNaN(d.getTime()) ? fallback : d.toISOString();
      } catch {
        return fallback;
      }
    }
    if (typeof val.toMillis === "function") {
      try {
        const d = new Date(val.toMillis());
        return isNaN(d.getTime()) ? fallback : d.toISOString();
      } catch {
        return fallback;
      }
    }
    const sec = val.seconds ?? val._seconds;
    if (typeof sec === "number") {
      try {
        const d = new Date(sec * 1000);
        return isNaN(d.getTime()) ? fallback : d.toISOString();
      } catch {
        return fallback;
      }
    }
  }
  return String(val || fallback);
}

export function formatDateStr(val: any, fallback: string = "—"): string {
  const str = ensureDateString(val);
  if (!str) return fallback;
  return str.length >= 10 ? str.slice(0, 10) : str;
}

export function normalizeDbItem<T>(item: any): T {
  if (!item || typeof item !== "object") return item;
  const normalized = { ...item };
  if ("sku" in normalized && !normalized.modelNumber) {
    normalized.modelNumber = normalized.sku;
  }
  if ("modelNumber" in normalized && !normalized.sku) {
    normalized.sku = normalized.modelNumber;
  }
  if ("items" in normalized) {
    normalized.items = ensureArray(normalized.items).map(line => {
      if (line && typeof line === "object") {
        const copy = { ...line };
        if (copy.sku && !copy.modelNumber) copy.modelNumber = copy.sku;
        if (copy.modelNumber && !copy.sku) copy.sku = copy.modelNumber;
        return copy;
      }
      return line;
    });
  }
  if ("createdAt" in normalized && normalized.createdAt !== undefined) {
    normalized.createdAt = ensureDateString(normalized.createdAt, new Date().toISOString());
  }
  if ("updatedAt" in normalized && normalized.updatedAt !== undefined) {
    normalized.updatedAt = ensureDateString(normalized.updatedAt, new Date().toISOString());
  }
  if ("orderDate" in normalized && normalized.orderDate !== undefined) {
    normalized.orderDate = formatDateStr(normalized.orderDate, new Date().toISOString().slice(0, 10));
  }
  if ("saleDate" in normalized && normalized.saleDate !== undefined) {
    normalized.saleDate = formatDateStr(normalized.saleDate, new Date().toISOString().slice(0, 10));
  }
  if ("date" in normalized && normalized.date !== undefined) {
    normalized.date = formatDateStr(normalized.date, new Date().toISOString().slice(0, 10));
  }
  return normalized as T;
}

/**
 * Generates a guaranteed unique supplier ledger ID (e.g. LED-ESS-01, LED-ZSS-02, LED-1001)
 */
export function generateUniqueSupplierLedgerId(name?: string, existingSuppliers: Supplier[] = []): string {
  const existingCodes = new Set(
    existingSuppliers
      .map(s => (s.ledgerId || "").trim().toUpperCase())
      .filter(Boolean)
  );

  let prefix = "SUP";
  if (name && name.trim()) {
    const clean = name.trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (clean.length >= 3) {
      prefix = clean.slice(0, 3);
    } else if (clean.length > 0) {
      prefix = clean;
    }
  }

  // Try standard prefix: LED-PREFIX-01, LED-PREFIX-02, ...
  for (let i = 1; i <= 99; i++) {
    const candidate = `LED-${prefix}-${i.toString().padStart(2, "0")}`;
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
  }

  // Fallback sequential numbered ledger IDs
  for (let i = 1001; i <= 9999; i++) {
    const candidate = `LED-${i}`;
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
  }

  return `LED-${Date.now().toString().slice(-4)}`;
}

/**
 * Validates that a supplier ledger ID is unique across all existing suppliers
 */
export function validateSupplierLedgerId(
  ledgerId: string,
  excludeSupplierId?: string,
  existingSuppliers: Supplier[] = []
): { isValid: boolean; error?: string; conflictSupplier?: Supplier } {
  const cleanId = (ledgerId || "").trim().toUpperCase();
  if (!cleanId) {
    return { isValid: false, error: "Supplier Ledger ID is required." };
  }

  const conflict = existingSuppliers.find(
    s => s.id !== excludeSupplierId && (s.ledgerId || "").trim().toUpperCase() === cleanId
  );

  if (conflict) {
    return {
      isValid: false,
      error: `Ledger ID '${cleanId}' is already assigned to "${conflict.name}". Every supplier must have a unique Ledger ID.`,
      conflictSupplier: conflict
    };
  }

  return { isValid: true };
}

// In-Memory Local Cache Fallback & Seed Engine
class DBService {
  private cache: Record<string, any> = {};

  constructor() {
    this.initDatabaseAndSeed().catch((err) => {
      console.warn("RTDB initialization error caught safely:", err);
    });
  }

  private async initDatabaseAndSeed() {
    try {
      if (typeof document !== "undefined" && document.hidden) {
        console.log("Tab/iframe is hidden, initializing fallback database cache.");
        if (!localStorage.getItem("optiway_seeded")) {
          this.seedLocalStorage();
        }
        return;
      }
      const rootRef = ref(rtdb, "/");
      const snapshot = await get(rootRef);
      if (!snapshot.exists() || !snapshot.hasChild("settings")) {
        await this.seedInitialData();
      }
    } catch (err) {
      console.warn("RTDB initialization check using local storage fallback:", err);
      if (!localStorage.getItem("optiway_seeded")) {
        this.seedLocalStorage();
      }
    }
  }

  // Seed Firebase with Initial OPTIWAY Demo Data
  public async seedInitialData() {
    const seedSettings: StoreSettings = {
      storeName: "OPTIWAY Vision Care",
      phone: "+1 (800) 555-6784",
      email: "contact@optiway.com",
      address: "742 Vision Avenue, Suite 100, New York, NY 10001",
      taxRate: 8.5,
      invoicePrefix: "OPT-INV-",
      receiptPrefix: "OPT-REC-",
      updatedAt: new Date().toISOString()
    };

    const seedProducts: Record<string, Product> = {
      p1: {
        id: "p1",
        name: "Ray-Ban Wayfarer Classic RB2140",
        category: "Frame",
        sku: "FRM-RB2140",
        brand: "Ray-Ban",
        model: "RB2140 Black 50mm",
        sellingPrice: 165.00,
        purchasePrice: 85.00,
        stockQuantity: 14,
        minStockLevel: 5,
        imageUrl: "https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=500&auto=format&fit=crop&q=60",
        supplierName: "EssilorLuxottica",
        status: "Active",
        createdAt: new Date().toISOString()
      },
      p2: {
        id: "p2",
        name: "Oakley Holbrook Matte Black",
        category: "Frame",
        sku: "FRM-OAK-HB",
        brand: "Oakley",
        model: "OO9102-01",
        sellingPrice: 142.00,
        purchasePrice: 70.00,
        stockQuantity: 8,
        minStockLevel: 4,
        imageUrl: "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=500&auto=format&fit=crop&q=60",
        supplierName: "EssilorLuxottica",
        status: "Active",
        createdAt: new Date().toISOString()
      },
      p3: {
        id: "p3",
        name: "Gucci Rectangular Acetate Frame",
        category: "Frame",
        sku: "FRM-GUC-01",
        brand: "Gucci",
        model: "GG0061O",
        sellingPrice: 340.00,
        purchasePrice: 180.00,
        stockQuantity: 3,
        minStockLevel: 3,
        imageUrl: "https://images.unsplash.com/photo-1577803645773-f96470509666?w=500&auto=format&fit=crop&q=60",
        supplierName: "EssilorLuxottica",
        status: "Active",
        createdAt: new Date().toISOString()
      },
      p4: {
        id: "p4",
        name: "Essilor Anti-Reflective Progressive Lenses",
        category: "Lens",
        sku: "LNS-PROG-AR",
        brand: "Essilor",
        model: "Varilux Comfort Max",
        sellingPrice: 220.00,
        purchasePrice: 95.00,
        stockQuantity: 25,
        minStockLevel: 10,
        supplierName: "EssilorLuxottica",
        status: "Active",
        createdAt: new Date().toISOString()
      },
      p5: {
        id: "p5",
        name: "Zeiss Blue Light Filter Single Vision 1.67",
        category: "Lens",
        sku: "LNS-BLU-167",
        brand: "Zeiss",
        model: "DuraVision BlueProtect",
        sellingPrice: 145.00,
        purchasePrice: 60.00,
        stockQuantity: 30,
        minStockLevel: 10,
        supplierName: "Zeiss Vision Care",
        status: "Active",
        createdAt: new Date().toISOString()
      },
      p6: {
        id: "p6",
        name: "Acuvue Oasys 1-Day Contact Lenses (90 Pack)",
        category: "Contact Lens",
        sku: "CL-ACU-90",
        brand: "Johnson & Johnson",
        model: "HydraLuxe 90",
        sellingPrice: 88.00,
        purchasePrice: 45.00,
        stockQuantity: 2, // Low stock!
        minStockLevel: 8,
        supplierName: "Johnson & Johnson Vision",
        status: "Active",
        createdAt: new Date().toISOString()
      },
      p7: {
        id: "p7",
        name: "Microfiber Lens Cleaning Cloth & Solution Kit",
        category: "Accessories",
        sku: "ACC-CLN-KIT",
        brand: "OPTIWAY",
        model: "Anti-Fog 60ml",
        sellingPrice: 12.00,
        purchasePrice: 3.50,
        stockQuantity: 50,
        minStockLevel: 15,
        supplierName: "OPTIWAY Direct",
        status: "Active",
        createdAt: new Date().toISOString()
      }
    };

    const seedCustomers: Record<string, Customer> = {
      c1: {
        id: "c1",
        name: "Sarah Jenkins",
        mobile: "+1 555-019-2834",
        email: "sarah.j@example.com",
        address: "128 Pine St, New York, NY 10002",
        createdAt: new Date().toISOString(),
        outstandingBalance: 0,
        lastPurchaseDate: new Date(Date.now() - 86400000 * 2).toISOString()
      },
      c2: {
        id: "c2",
        name: "Robert Chen",
        mobile: "+1 555-018-9921",
        email: "rchen@example.com",
        address: "452 Elm St, New York, NY 10003",
        createdAt: new Date().toISOString(),
        outstandingBalance: 75.00,
        lastPurchaseDate: new Date(Date.now() - 86400000 * 5).toISOString()
      },
      c3: {
        id: "c3",
        name: "Marcus Vance",
        mobile: "+1 555-012-4488",
        email: "marcus.v@example.com",
        address: "89 Oak Rd, Brooklyn, NY 11201",
        createdAt: new Date().toISOString(),
        outstandingBalance: 120.00,
        lastPurchaseDate: new Date(Date.now() - 86400000 * 10).toISOString()
      }
    };

    const seedPrescriptions: Record<string, Prescription> = {
      rx1: {
        id: "rx1",
        customerId: "c1",
        customerName: "Sarah Jenkins",
        prescriptionDate: new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10),
        rightEye: { sph: "-2.25", cyl: "-0.75", axis: "180", add: "0.00" },
        leftEye: { sph: "-2.50", cyl: "-0.50", axis: "175", add: "0.00" },
        pd: "63",
        visualAcuity: "20/20",
        notes: "Slight astigmatism, anti-reflective coating recommended",
        createdAt: new Date().toISOString()
      },
      rx2: {
        id: "rx2",
        customerId: "c2",
        customerName: "Robert Chen",
        prescriptionDate: new Date(Date.now() - 86400000 * 5).toISOString().slice(0, 10),
        rightEye: { sph: "+1.50", cyl: "-1.00", axis: "90", add: "+2.00" },
        leftEye: { sph: "+1.75", cyl: "-0.75", axis: "85", add: "+2.00" },
        pd: "65",
        visualAcuity: "20/25",
        notes: "Presbyopia. Progressive lenses prescribed.",
        createdAt: new Date().toISOString()
      }
    };

    const seedSuppliers: Record<string, Supplier> = {
      s1: {
        id: "s1",
        name: "EssilorLuxottica",
        ledgerId: "LED-ESS-01",
        phone: "+1 800-422-2020",
        mobile: "+1 800-422-2020",
        email: "orders@essilorluxottica.com",
        address: "4000 Luxottica Place, Mason, OH 45040",
        productsSupplied: "Ray-Ban, Oakley, Gucci, Essilor Lenses",
        outstandingBalance: 0,
        createdAt: new Date().toISOString()
      },
      s2: {
        id: "s2",
        name: "Zeiss Vision Care",
        ledgerId: "LED-ZSS-02",
        phone: "+1 800-338-2984",
        mobile: "+1 800-338-2984",
        email: "support@zeiss.com",
        address: "1050 JVL Court, Suite 100, Norcross, GA 30093",
        productsSupplied: "Zeiss Precision Lenses",
        outstandingBalance: 450.00,
        createdAt: new Date().toISOString()
      },
      s3: {
        id: "s3",
        name: "Johnson & Johnson Vision",
        ledgerId: "LED-JNJ-03",
        phone: "+1 800-874-5278",
        mobile: "+1 800-874-5278",
        email: "clorders@jnj.com",
        address: "7500 Centurion Parkway, Jacksonville, FL 32256",
        productsSupplied: "Acuvue Contact Lenses",
        outstandingBalance: 0,
        createdAt: new Date().toISOString()
      }
    };

    const seedSales: Record<string, Sale> = {
      s001: {
        id: "s001",
        saleNumber: "OPT-SL-1001",
        customerId: "c1",
        customerName: "Sarah Jenkins",
        customerMobile: "+1 555-019-2834",
        items: [
          { productId: "p1", productName: "Ray-Ban Wayfarer Classic RB2140", category: "Frame", quantity: 1, price: 165.00, discount: 15.00, total: 150.00 },
          { productId: "p5", productName: "Zeiss Blue Light Filter Single Vision 1.67", category: "Lens", quantity: 1, price: 145.00, discount: 0, total: 145.00 }
        ],
        subtotal: 310.00,
        discountTotal: 15.00,
        taxTotal: 25.08,
        grandTotal: 320.08,
        advanceAmount: 320.08,
        pendingAmount: 0,
        paymentMethod: "Card",
        saleDate: new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10),
        status: "Completed",
        orderId: "ord1001",
        invoiceId: "inv1001",
        receiptId: "rec1001",
        prescriptionId: "rx1",
        notes: "Full payment received.",
        createdAt: new Date().toISOString()
      },
      s002: {
        id: "s002",
        saleNumber: "OPT-SL-1002",
        customerId: "c2",
        customerName: "Robert Chen",
        customerMobile: "+1 555-018-9921",
        items: [
          { productId: "p3", productName: "Gucci Rectangular Acetate Frame", category: "Frame", quantity: 1, price: 340.00, discount: 20.00, total: 320.00 },
          { productId: "p4", productName: "Essilor Anti-Reflective Progressive Lenses", category: "Lens", quantity: 1, price: 220.00, discount: 0, total: 220.00 }
        ],
        subtotal: 560.00,
        discountTotal: 20.00,
        taxTotal: 45.90,
        grandTotal: 585.90,
        advanceAmount: 300.00,
        pendingAmount: 285.90,
        paymentMethod: "UPI",
        saleDate: new Date(Date.now() - 86400000 * 1).toISOString().slice(0, 10),
        status: "Pending Fulfillment",
        orderId: "ord1002",
        invoiceId: "inv1002",
        receiptId: "rec1002",
        prescriptionId: "rx2",
        notes: "Advance receipt issued. Balance due on delivery.",
        createdAt: new Date().toISOString()
      }
    };

    const seedOrders: Record<string, Order> = {
      ord1001: {
        id: "ord1001",
        orderNumber: "OPT-ORD-1001",
        saleId: "s001",
        customerId: "c1",
        customerName: "Sarah Jenkins",
        customerMobile: "+1 555-019-2834",
        items: [
          { productId: "p1", productName: "Ray-Ban Wayfarer Classic RB2140", category: "Frame", quantity: 1, price: 165.00, discount: 15.00, total: 150.00 },
          { productId: "p5", productName: "Zeiss Blue Light Filter Single Vision 1.67", category: "Lens", quantity: 1, price: 145.00, discount: 0, total: 145.00 }
        ],
        grandTotal: 320.08,
        advancePaid: 320.08,
        pendingBalance: 0,
        status: "Completed",
        paymentStatus: "Fully-paid",
        orderDate: new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10),
        expectedDeliveryDate: new Date(Date.now() - 86400000 * 1).toISOString().slice(0, 10),
        createdAt: new Date().toISOString()
      },
      ord1002: {
        id: "ord1002",
        orderNumber: "OPT-ORD-1002",
        saleId: "s002",
        customerId: "c2",
        customerName: "Robert Chen",
        customerMobile: "+1 555-018-9921",
        items: [
          { productId: "p3", productName: "Gucci Rectangular Acetate Frame", category: "Frame", quantity: 1, price: 340.00, discount: 20.00, total: 320.00 },
          { productId: "p4", productName: "Essilor Anti-Reflective Progressive Lenses", category: "Lens", quantity: 1, price: 220.00, discount: 0, total: 220.00 }
        ],
        grandTotal: 585.90,
        advancePaid: 300.00,
        pendingBalance: 285.90,
        status: "In Progress",
        paymentStatus: "Advance-paid",
        orderDate: new Date(Date.now() - 86400000 * 1).toISOString().slice(0, 10),
        expectedDeliveryDate: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10),
        createdAt: new Date().toISOString()
      }
    };

    const seedExpenses: Record<string, Expense> = {
      exp1: {
        id: "exp1",
        category: "Rent",
        amount: 2500.00,
        date: new Date(Date.now() - 86400000 * 15).toISOString().slice(0, 10),
        expenseDate: new Date(Date.now() - 86400000 * 15).toISOString().slice(0, 10),
        description: "Monthly store lease - Suite 100",
        paymentMethod: "Bank Transfer",
        createdAt: new Date().toISOString()
      },
      exp2: {
        id: "exp2",
        category: "Lab Equipment",
        amount: 350.00,
        date: new Date(Date.now() - 86400000 * 8).toISOString().slice(0, 10),
        expenseDate: new Date(Date.now() - 86400000 * 8).toISOString().slice(0, 10),
        description: "Lens edger calibration service",
        paymentMethod: "UPI",
        createdAt: new Date().toISOString()
      },
      exp3: {
        id: "exp3",
        category: "Utilities",
        amount: 180.00,
        date: new Date(Date.now() - 86400000 * 3).toISOString().slice(0, 10),
        expenseDate: new Date(Date.now() - 86400000 * 3).toISOString().slice(0, 10),
        description: "Electricity and high-speed internet",
        paymentMethod: "Card",
        createdAt: new Date().toISOString()
      }
    };

    const seedPendingProducts: Record<string, PendingProduct> = {
      pend1: {
        id: "pend1",
        name: "Tom Ford FT5634-B Blue Block Frame",
        category: "Frame",
        sku: "FRM-TF5634",
        brand: "Tom Ford",
        model: "FT5634-B Shiny Black 53mm",
        sellingPrice: 295.00,
        purchasePrice: 150.00,
        stockQuantity: 12,
        minStockLevel: 3,
        supplierName: "EssilorLuxottica",
        supplierLedgerId: "LED-ESS-01",
        billNumber: "BIL-2026-135",
        status: "Pending",
        batchId: "BATCH-20260813-01",
        createdAt: new Date().toISOString()
      },
      pend2: {
        id: "pend2",
        name: "Prada Linea Rossa Sport Sunglasses",
        category: "Frame",
        sku: "FRM-PRD-LR01",
        brand: "Prada",
        model: "SPS01W Matte Grey 59mm",
        sellingPrice: 260.00,
        purchasePrice: 130.00,
        stockQuantity: 8,
        minStockLevel: 2,
        supplierName: "EssilorLuxottica",
        supplierLedgerId: "LED-ESS-01",
        billNumber: "BIL-2026-135",
        status: "Pending",
        batchId: "BATCH-20260813-01",
        createdAt: new Date().toISOString()
      },
      pend3: {
        id: "pend3",
        name: "Zeiss PhotoFusion X Extra Grey 1.6",
        category: "Lens",
        sku: "LNS-ZS-PFX16",
        brand: "Zeiss",
        model: "Photochromic 1.60 Index",
        sellingPrice: 190.00,
        purchasePrice: 90.00,
        stockQuantity: 20,
        minStockLevel: 5,
        supplierName: "Zeiss Vision Care",
        supplierLedgerId: "LED-ZSS-02",
        billNumber: "BIL-2026-142",
        status: "Pending",
        batchId: "BATCH-20260813-02",
        createdAt: new Date().toISOString()
      }
    };

    const seedPurchaseBills: Record<string, PurchaseBill> = {
      pb1: {
        id: "pb1",
        billNumber: "BIL-2026-081",
        supplierName: "EssilorLuxottica",
        supplierLedgerId: "LED-ESS-01",
        supplierPhone: "+1 800-422-2020",
        supplierEmail: "orders@essilorluxottica.com",
        supplierTaxId: "GST-ESS-992144",
        supplierAddress: "4000 Luxottica Place, Mason, OH 45040",
        billDate: new Date(Date.now() - 86400000 * 6).toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 86400000 * 24).toISOString().slice(0, 10),
        paymentStatus: "Paid",
        paymentMethod: "Bank Transfer",
        subtotal: 1280.00,
        taxRate: 18,
        taxTotal: 230.40,
        discountTotal: 50.00,
        grandTotal: 1460.40,
        destination: "live",
        fileName: "essilor_aug_procurement.pdf",
        notes: "Frames stock intake with complimentary demo lenses",
        createdAt: new Date(Date.now() - 86400000 * 6).toISOString(),
        items: [
          {
            name: "Ray-Ban Wayfarer Classic RB2140",
            sku: "FRM-RB2140",
            category: "Frame",
            brand: "Ray-Ban",
            model: "RB2140 Black 50mm",
            quantity: 8,
            purchasePrice: 85.00,
            sellingPrice: 165.00,
            taxRate: 18,
            minStockLevel: 5
          },
          {
            name: "Ray-Ban Aviator Classic Gold RB3025",
            sku: "FRM-RB3025",
            category: "Frame",
            brand: "Ray-Ban",
            model: "RB3025 Arista Gold 58mm",
            quantity: 6,
            purchasePrice: 90.00,
            sellingPrice: 175.00,
            taxRate: 18,
            minStockLevel: 4
          }
        ]
      },
      pb2: {
        id: "pb2",
        billNumber: "BIL-2026-094",
        supplierName: "Zeiss Vision Care",
        supplierLedgerId: "LED-ZSS-02",
        supplierPhone: "+1 800-338-2984",
        supplierEmail: "support@zeiss.com",
        supplierTaxId: "GST-ZSS-883100",
        supplierAddress: "1050 JVL Court, Suite 100, Norcross, GA 30093",
        billDate: new Date(Date.now() - 86400000 * 3).toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 86400000 * 15).toISOString().slice(0, 10),
        paymentStatus: "Partial",
        paymentMethod: "Bank Transfer",
        subtotal: 1340.00,
        taxRate: 18,
        taxTotal: 241.20,
        discountTotal: 0,
        grandTotal: 1581.20,
        destination: "live",
        fileName: "zeiss_lens_invoice_94.pdf",
        notes: "BlueProtect and PhotoFusion prescription stock lenses",
        createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        items: [
          {
            name: "Zeiss Blue Light Filter Single Vision 1.67",
            sku: "LNS-BLU-167",
            category: "Lens",
            brand: "Zeiss",
            model: "DuraVision BlueProtect 1.67",
            quantity: 15,
            purchasePrice: 60.00,
            sellingPrice: 145.00,
            taxRate: 18,
            minStockLevel: 8
          },
          {
            name: "Zeiss Single Vision ClearView 1.60",
            sku: "LNS-ZS160-CR",
            category: "Lens",
            brand: "Zeiss",
            model: "DuraVision Platinum 1.60",
            quantity: 10,
            purchasePrice: 44.00,
            sellingPrice: 120.00,
            taxRate: 18,
            minStockLevel: 5
          }
        ]
      },
      pb3: {
        id: "pb3",
        billNumber: "BIL-2026-105",
        supplierName: "Johnson & Johnson Vision",
        supplierLedgerId: "LED-JNJ-03",
        supplierPhone: "+1 800-874-5278",
        supplierEmail: "clorders@jnj.com",
        supplierTaxId: "GST-JNJ-771120",
        supplierAddress: "7500 Centurion Parkway, Jacksonville, FL 32256",
        billDate: new Date(Date.now() - 86400000 * 1).toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10),
        paymentStatus: "Paid",
        paymentMethod: "UPI",
        subtotal: 870.00,
        taxRate: 12,
        taxTotal: 104.40,
        discountTotal: 25.00,
        grandTotal: 949.40,
        destination: "live",
        fileName: "jnj_acuvue_batch_105.pdf",
        notes: "Monthly and Daily Contact Lenses replenishment",
        createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
        items: [
          {
            name: "Acuvue Oasys 1-Day Contact Lenses (90 Pack)",
            sku: "CL-ACU-90",
            category: "Contact Lens",
            brand: "Johnson & Johnson",
            model: "HydraLuxe 90 Pack 8.5 BC",
            quantity: 12,
            purchasePrice: 45.00,
            sellingPrice: 88.00,
            taxRate: 12,
            minStockLevel: 6
          },
          {
            name: "Acuvue Oasys with HydraLuxe 30PK",
            sku: "CL-ACV-OAS30",
            category: "Contact Lens",
            brand: "Johnson & Johnson",
            model: "Daily Disposable 8.5 BC",
            quantity: 15,
            purchasePrice: 22.00,
            sellingPrice: 42.00,
            taxRate: 12,
            minStockLevel: 10
          }
        ]
      }
    };

    const rootData = {
      settings: seedSettings,
      products: seedProducts,
      pendingProducts: seedPendingProducts,
      purchaseBills: seedPurchaseBills,
      customers: seedCustomers,
      prescriptions: seedPrescriptions,
      suppliers: seedSuppliers,
      sales: seedSales,
      orders: seedOrders,
      expenses: seedExpenses
    };

    try {
      await set(ref(rtdb, "/"), rootData);
    } catch (err) {
      console.warn("Writing to Firebase failed, caching locally:", err);
      localStorage.setItem("optiway_local_db", JSON.stringify(rootData));
      localStorage.setItem("optiway_seeded", "true");
    }
  }

  private seedLocalStorage() {
    // Local storage fallback seed
    const seedSettings: StoreSettings = {
      storeName: "OPTIWAY Vision Care",
      phone: "+1 (800) 555-6784",
      email: "contact@optiway.com",
      address: "742 Vision Avenue, Suite 100, New York, NY 10001",
      taxRate: 8.5,
      invoicePrefix: "OPT-INV-",
      receiptPrefix: "OPT-REC-",
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem("optiway_local_db", JSON.stringify({
      settings: seedSettings,
      products: {},
      pendingProducts: {},
      purchaseBills: {},
      customers: {},
      prescriptions: {},
      suppliers: {},
      sales: {},
      orders: {},
      expenses: {}
    }));
    localStorage.setItem("optiway_seeded", "true");
  }

  // Universal GET helper
  public async getList<T>(path: string): Promise<T[]> {
    try {
      const dbRef = ref(rtdb, path);
      const snapshot = await get(dbRef);
      if (snapshot.exists()) {
        const val = snapshot.val();
        let rawList: any[] = [];
        if (Array.isArray(val)) {
          rawList = val.filter(Boolean);
        } else {
          rawList = Object.keys(val).map(key => ({ id: key, ...val[key] }));
        }
        return rawList.map(item => normalizeDbItem<T>(item));
      }
    } catch (e) {
      console.warn(`Error reading ${path} from Firebase:`, e);
    }

    // LocalStorage fallback
    const local = localStorage.getItem("optiway_local_db");
    if (local) {
      const parsed = JSON.parse(local);
      const data = parsed[path];
      if (!data) return [];
      let rawList: any[] = [];
      if (Array.isArray(data)) {
        rawList = data.filter(Boolean);
      } else {
        rawList = Object.keys(data).map(key => ({ id: key, ...data[key] }));
      }
      return rawList.map(item => normalizeDbItem<T>(item));
    }
    return [];
  }

  // Universal GET item helper
  public async getItem<T>(path: string, id: string): Promise<T | null> {
    try {
      const itemRef = ref(rtdb, `${path}/${id}`);
      const snapshot = await get(itemRef);
      if (snapshot.exists()) {
        return normalizeDbItem<T>({ id, ...snapshot.val() });
      }
    } catch (e) {
      console.warn(`Error reading ${path}/${id}:`, e);
    }

    const local = localStorage.getItem("optiway_local_db");
    if (local) {
      const parsed = JSON.parse(local);
      if (parsed[path] && parsed[path][id]) {
        return normalizeDbItem<T>({ id, ...parsed[path][id] });
      }
    }
    return null;
  }

  // Universal Save/Update item
  public async saveItem<T extends { id?: string }>(path: string, item: T): Promise<string> {
    const isNew = !item.id;
    let itemId = item.id;

    if (isNew && !itemId) {
      try {
        const newRef = push(ref(rtdb, path));
        itemId = newRef.key || "loc_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
      } catch {
        itemId = "loc_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
      }
    }

    const payload = {
      ...item,
      id: itemId,
      updatedAt: new Date().toISOString(),
      ...(isNew ? { createdAt: (item as any).createdAt || new Date().toISOString() } : {})
    };

    // Always update localStorage mirror first for instant resilience
    try {
      const local = localStorage.getItem("optiway_local_db") || "{}";
      const parsed = JSON.parse(local);
      if (!parsed[path]) parsed[path] = {};
      parsed[path][itemId!] = payload;
      localStorage.setItem("optiway_local_db", JSON.stringify(parsed));
    } catch (localErr) {
      console.warn("Local storage write error:", localErr);
    }

    // Then attempt Firebase RTDB write
    try {
      const itemRef = ref(rtdb, `${path}/${itemId}`);
      await set(itemRef, payload);
    } catch (e) {
      console.warn(`Firebase write error on ${path}:`, e);
    }

    return itemId!;
  }

  // Universal Delete item
  public async deleteItem(path: string, id: string): Promise<boolean> {
    // Always remove from localStorage
    try {
      const local = localStorage.getItem("optiway_local_db");
      if (local) {
        const parsed = JSON.parse(local);
        if (parsed[path] && parsed[path][id]) {
          delete parsed[path][id];
          localStorage.setItem("optiway_local_db", JSON.stringify(parsed));
        }
      }
    } catch (localErr) {
      console.warn("Local storage delete error:", localErr);
    }

    // Also attempt Firebase RTDB remove
    try {
      await remove(ref(rtdb, `${path}/${id}`));
    } catch (e) {
      console.warn(`Firebase delete error on ${path}/${id}:`, e);
    }

    return true;
  }

  // Realtime subscription helper
  public subscribe<T>(path: string, callback: (data: T[]) => void) {
    try {
      const dbRef = ref(rtdb, path);
      return onValue(
        dbRef,
        (snapshot) => {
          try {
            if (snapshot.exists()) {
              const val = snapshot.val();
              let rawList: any[] = [];
              if (Array.isArray(val)) {
                rawList = val.filter(Boolean);
              } else {
                rawList = Object.keys(val || {}).map(key => ({ id: key, ...val[key] }));
              }
              callback(rawList.map(item => normalizeDbItem<T>(item)));
            } else {
              callback([]);
            }
          } catch (err) {
            console.warn(`Callback processing error on ${path}:`, err);
          }
        },
        (error) => {
          console.warn(`Subscription error on ${path}:`, error);
          this.getList<T>(path).then(callback).catch(() => callback([]));
        }
      );
    } catch (e) {
      console.warn(`Subscription setup error on ${path}:`, e);
      this.getList<T>(path).then(callback).catch(() => callback([]));
      return () => {};
    }
  }

  // Specialized Settings Get/Save
  public async getSettings(): Promise<StoreSettings> {
    const defaultSettings: StoreSettings = {
      storeName: "OPTIWAY Vision Care",
      phone: "+1 (800) 555-6784",
      email: "contact@optiway.com",
      address: "742 Vision Avenue, Suite 100, New York, NY 10001",
      taxRate: 18,
      defaultBillingTaxMode: "with_tax",
      gstNumber: "",
      invoicePrefix: "OPT-INV-",
      receiptPrefix: "OPT-REC-",
      themeColor: "#1f6feb",
      updatedAt: new Date().toISOString()
    };

    try {
      const dbRef = ref(rtdb, "settings");
      const snapshot = await get(dbRef);
      if (snapshot.exists()) {
        const val = snapshot.val();
        if (val && typeof val === "object") {
          // If val is the direct settings object:
          if ("storeName" in val || "phone" in val || "address" in val || "taxRate" in val) {
            const merged = { ...defaultSettings, ...val };
            if (typeof merged.taxRate === "string") merged.taxRate = parseFloat(merged.taxRate) || 18;
            return merged;
          }
          // If val was stored under a key
          const keys = Object.keys(val);
          if (keys.length > 0 && typeof val[keys[0]] === "object" && val[keys[0]] !== null) {
            const merged = { ...defaultSettings, ...val[keys[0]] };
            if (typeof merged.taxRate === "string") merged.taxRate = parseFloat(merged.taxRate) || 18;
            return merged;
          }
        }
      }
    } catch (e) {
      console.warn("Error reading settings from Firebase:", e);
    }

    // Check direct localStorage fallback
    const directLocal = localStorage.getItem("optiway_settings");
    if (directLocal) {
      try {
        const parsed = JSON.parse(directLocal);
        if (parsed && typeof parsed === "object") {
          const merged = { ...defaultSettings, ...parsed };
          if (typeof merged.taxRate === "string") merged.taxRate = parseFloat(merged.taxRate) || 18;
          return merged;
        }
      } catch (err) {
        console.warn("Error parsing optiway_settings:", err);
      }
    }

    // Check local database fallback
    const local = localStorage.getItem("optiway_local_db");
    if (local) {
      try {
        const parsed = JSON.parse(local);
        if (parsed && parsed.settings && typeof parsed.settings === "object") {
          const s = parsed.settings;
          if ("storeName" in s || "phone" in s || "address" in s || "taxRate" in s) {
            const merged = { ...defaultSettings, ...s };
            if (typeof merged.taxRate === "string") merged.taxRate = parseFloat(merged.taxRate) || 18;
            return merged;
          }
        }
      } catch (err) {
        console.warn("Error parsing optiway_local_db settings:", err);
      }
    }

    return defaultSettings;
  }

  public async saveSettings(settings: StoreSettings): Promise<void> {
    const payload: StoreSettings = {
      ...settings,
      taxRate: typeof settings.taxRate === "number" ? settings.taxRate : (parseFloat(String(settings.taxRate)) || 18),
      updatedAt: new Date().toISOString()
    };

    // Update localStorage immediately so changes are 100% instant and persistent across all tabs/windows
    try {
      localStorage.setItem("optiway_settings", JSON.stringify(payload));
      const local = localStorage.getItem("optiway_local_db") || "{}";
      const parsed = JSON.parse(local);
      parsed.settings = payload;
      localStorage.setItem("optiway_local_db", JSON.stringify(parsed));
    } catch (err) {
      console.warn("Error caching settings locally:", err);
    }

    try {
      await set(ref(rtdb, "settings"), payload);
    } catch (e) {
      console.warn("Error saving settings to Firebase:", e);
    }
  }

  // Pending Product to Live Stock Confirmation Helper
  public async confirmPendingProduct(pendingId: string): Promise<Product> {
    const pendingList = await this.getList<PendingProduct>("pendingProducts");
    let pendingItem = pendingList.find(p => String(p.id).trim() === String(pendingId).trim());
    
    // If not found in primary getList, fallback to local storage search
    if (!pendingItem) {
      try {
        const local = localStorage.getItem("optiway_local_db");
        if (local) {
          const parsed = JSON.parse(local);
          if (parsed.pendingProducts && parsed.pendingProducts[pendingId]) {
            pendingItem = { id: pendingId, ...parsed.pendingProducts[pendingId] };
          }
        }
      } catch (err) {
        console.warn("Local storage pending search error:", err);
      }
    }

    if (!pendingItem) {
      throw new Error(`Pending product #${pendingId} could not be located.`);
    }

    const currentProducts = await this.getList<Product>("products");
    const cleanSku = (pendingItem.sku || "").trim().toLowerCase();
    const cleanName = (pendingItem.name || "").trim().toLowerCase();

    const existingIndex = currentProducts.findIndex(p => {
      const pSku = (p.sku || "").trim().toLowerCase();
      const pName = (p.name || "").trim().toLowerCase();
      if (cleanSku && pSku) {
        return pSku === cleanSku;
      }
      return cleanName && pName && pName === cleanName;
    });

    const pendingQty = Math.max(0, Number(pendingItem.stockQuantity) || 1);
    const sellingPrice = Math.max(0, Number(pendingItem.sellingPrice) || 0);
    const purchasePrice = Math.max(0, Number(pendingItem.purchasePrice) || 0);
    const minStockLevel = Math.max(1, Number(pendingItem.minStockLevel) || 5);

    let savedProduct: Product;
    if (existingIndex !== -1) {
      // Update existing product stock & info
      const existing = currentProducts[existingIndex];
      const prevQty = Number(existing.stockQuantity) || 0;
      const newQty = prevQty + pendingQty;

      const updatedPayload: Partial<Product> = {
        ...existing,
        name: pendingItem.name || existing.name,
        category: pendingItem.category || existing.category || "Frame",
        barcode: pendingItem.barcode || existing.barcode || "",
        hsnCode: pendingItem.hsnCode || existing.hsnCode || "",
        size: pendingItem.size || existing.size || "",
        color: pendingItem.color || existing.color || "",
        brand: pendingItem.brand || existing.brand || "OptiWay",
        model: pendingItem.model || existing.model || "",
        sellingPrice: sellingPrice > 0 ? sellingPrice : (existing.sellingPrice || 0),
        purchasePrice: purchasePrice > 0 ? purchasePrice : (existing.purchasePrice || 0),
        supplierName: pendingItem.supplierName || existing.supplierName || "",
        supplierLedgerId: pendingItem.supplierLedgerId || existing.supplierLedgerId || "",
        billNumber: pendingItem.billNumber || existing.billNumber || "",
        stockQuantity: newQty,
        status: "Active",
        minStockLevel: existing.minStockLevel || minStockLevel
      };

      await this.saveItem("products", updatedPayload);
      savedProduct = updatedPayload as Product;

      // Log movement
      if (pendingQty > 0) {
        await this.saveItem("inventoryLogs", {
          productId: existing.id,
          productName: existing.name || pendingItem.name,
          type: "Stock-In",
          quantityChange: pendingQty,
          previousQuantity: prevQty,
          newQuantity: newQty,
          reason: `Confirmed from Pending Queue (Bill #${pendingItem.billNumber || 'N/A'}, Ledger #${pendingItem.supplierLedgerId || 'N/A'})`,
          createdAt: new Date().toISOString(),
          user: "Stock Manager"
        } as Partial<InventoryMovement>);
      }
    } else {
      // Create new live product
      const newSku = pendingItem.sku || `SKU-${Date.now().toString().slice(-6)}`;
      const newPayload: Partial<Product> = {
        name: pendingItem.name || "Optical Product",
        sku: newSku,
        barcode: pendingItem.barcode || "",
        hsnCode: pendingItem.hsnCode || "",
        size: pendingItem.size || "",
        color: pendingItem.color || "",
        category: pendingItem.category || "Frame",
        brand: pendingItem.brand || "OptiWay",
        model: pendingItem.model || "",
        sellingPrice: sellingPrice,
        purchasePrice: purchasePrice,
        supplierName: pendingItem.supplierName || "",
        supplierLedgerId: pendingItem.supplierLedgerId || "",
        supplierId: pendingItem.supplierId || "",
        billNumber: pendingItem.billNumber || "",
        stockQuantity: pendingQty,
        minStockLevel: minStockLevel,
        imageUrl: pendingItem.imageUrl || "",
        status: "Active",
        createdAt: new Date().toISOString()
      };

      const newId = await this.saveItem("products", newPayload);
      savedProduct = { ...newPayload, id: newId } as Product;

      if (pendingQty > 0) {
        await this.saveItem("inventoryLogs", {
          productId: newId,
          productName: newPayload.name,
          type: "Stock-In",
          quantityChange: pendingQty,
          previousQuantity: 0,
          newQuantity: pendingQty,
          reason: `Initial Stock-In from Pending Intake (Bill #${pendingItem.billNumber || 'N/A'}, Ledger #${pendingItem.supplierLedgerId || 'N/A'})`,
          createdAt: new Date().toISOString(),
          user: "Stock Manager"
        } as Partial<InventoryMovement>);
      }
    }

    // Remove from pendingProducts
    await this.deleteItem("pendingProducts", pendingId);
    return savedProduct;
  }

  public async confirmAllPendingProducts(ids?: string[]): Promise<{ confirmedCount: number; errors: string[] }> {
    const pendingList = await this.getList<PendingProduct>("pendingProducts");
    const targetItems = ids && ids.length > 0 
      ? pendingList.filter(p => ids.includes(p.id)) 
      : pendingList;

    let confirmedCount = 0;
    const errors: string[] = [];

    for (const item of targetItems) {
      try {
        await this.confirmPendingProduct(item.id);
        confirmedCount++;
      } catch (err: any) {
        console.error(`Failed to confirm pending product ${item.name}:`, err);
        errors.push(`${item.name || item.id}: ${err.message || "Unknown error"}`);
      }
    }
    return { confirmedCount, errors };
  }
}

export const dbService = new DBService();
