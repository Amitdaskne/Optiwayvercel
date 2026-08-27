import { initAuthGuard } from "../lib/auth";
import { renderAppLayout, Toast } from "../components/layout";
import { dbService, Customer, Product, SaleItem, Sale, Order, Prescription, Receipt, Expense, StoreSettings } from "../lib/db";
import { getIconSvg } from "../lib/icons";
import { BarcodePrinter } from "../lib/barcodePrinter";
import { 
  generateTodaySalesReportCSV, 
  downloadCSV, 
  downloadTodayDetailedPDFReport, 
  printAdvanceReceiptDirect, 
  downloadAdvanceReceiptPDF,
  printThermalReceiptDirect 
} from "../lib/exportUtils";

let customersList: Customer[] = [];
let productsList: Product[] = [];
let selectedCustomer: Customer | null = null;
let cart: SaleItem[] = [];
let storeTaxRate = 18;
let currentTaxRate = 18;
let isTaxEnabled = true;
let storeName = "OPTIWAY OPTICAL";
let activeStoreSettings: StoreSettings | null = null;

initAuthGuard({
  onUserReady: async (user) => {
    renderAppLayout("sales", "New Sale / Point of Sale", user);
    await initSalesData();
  }
});

async function initSalesData() {
  try {
    const settings = await dbService.getSettings();
    activeStoreSettings = settings;
    storeTaxRate = typeof settings.taxRate === "number" ? settings.taxRate : 18;
    currentTaxRate = storeTaxRate;
    if (settings.defaultBillingTaxMode === "without_tax") {
      isTaxEnabled = false;
    } else {
      isTaxEnabled = true;
    }
    if (settings.storeName) storeName = settings.storeName;

    const posTaxRateInput = document.getElementById("input-pos-tax-rate") as HTMLInputElement;
    if (posTaxRateInput) posTaxRateInput.value = String(currentTaxRate);

    const radioWithTax = document.querySelector('input[name="billing-tax-mode"][value="with_tax"]') as HTMLInputElement;
    const radioWithoutTax = document.querySelector('input[name="billing-tax-mode"][value="without_tax"]') as HTMLInputElement;
    if (isTaxEnabled) {
      if (radioWithTax) radioWithTax.checked = true;
    } else {
      if (radioWithoutTax) radioWithoutTax.checked = true;
    }
    updateTaxModeUI();

    customersList = await dbService.getList<Customer>("customers");
    productsList = await dbService.getList<Product>("products");

    // Do NOT auto-select any customer on initial load. Let user search or enter new patient.
    const nameInput = document.getElementById("input-customer-name") as HTMLInputElement;
    const mobileInput = document.getElementById("input-customer-mobile") as HTMLInputElement;
    const addressInput = document.getElementById("input-customer-address") as HTMLInputElement;
    const emailInput = document.getElementById("input-customer-email") as HTMLInputElement;

    selectedCustomer = null;
    if (nameInput) nameInput.value = "";
    if (mobileInput) mobileInput.value = "";
    if (addressInput) addressInput.value = "";
    if (emailInput) emailInput.value = "";
    updateCustomerBadge("Patient: Not Selected");

    // Setup event listeners
    setupCustomerSearchEvents();
    setupProductPickerEvents();
    setupBillingCalculations();
    setupFormActionEvents();
  } catch (err) {
    console.error("Sales initialization failed:", err);
    Toast.show("Failed to load store catalog.", "error");
  }
}

function updateTaxModeUI() {
  const badge = document.getElementById("tax-mode-badge");
  const labelWith = document.getElementById("label-tax-with");
  const labelWithout = document.getElementById("label-tax-without");
  const customWrapper = document.getElementById("tax-rate-custom-wrapper");
  const taxDesc = document.getElementById("label-calc-tax-desc");

  if (isTaxEnabled) {
    if (badge) {
      badge.innerText = `With Tax (${currentTaxRate}% GST)`;
      badge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200";
    }
    if (labelWith) {
      labelWith.className = "flex items-center justify-center gap-1.5 p-2 rounded-lg border-2 border-blue-600 bg-blue-50/80 text-xs font-bold text-blue-900 cursor-pointer transition-all";
    }
    if (labelWithout) {
      labelWithout.className = "flex items-center justify-center gap-1.5 p-2 rounded-lg border-2 border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer transition-all";
    }
    if (customWrapper) customWrapper.classList.remove("hidden");
    if (taxDesc) taxDesc.innerText = `Estimated Tax (GST ${currentTaxRate}%)`;
  } else {
    if (badge) {
      badge.innerText = "Without Tax (0% Non-GST)";
      badge.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-300";
    }
    if (labelWith) {
      labelWith.className = "flex items-center justify-center gap-1.5 p-2 rounded-lg border-2 border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer transition-all";
    }
    if (labelWithout) {
      labelWithout.className = "flex items-center justify-center gap-1.5 p-2 rounded-lg border-2 border-emerald-600 bg-emerald-50/80 text-xs font-bold text-emerald-900 cursor-pointer transition-all";
    }
    if (customWrapper) customWrapper.classList.add("hidden");
    if (taxDesc) taxDesc.innerText = "Tax Free / Non-GST Bill (0%)";
  }
}

function updateCustomerBadge(label: string) {
  const badge = document.getElementById("badge-cust-type");
  if (badge) {
    badge.innerText = label;
    if (label.includes("Not Selected")) {
      badge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200";
    } else if (label.includes("Existing") || label.includes("Saved")) {
      badge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200";
    } else if (label.includes("Walk-in")) {
      badge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300";
    } else {
      badge.className = "px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200";
    }
  }
}

// 1. Customer Selection Events
function setupCustomerSearchEvents() {
  const searchInput = document.getElementById("input-cust-search") as HTMLInputElement;
  const resultsBox = document.getElementById("cust-search-results") as HTMLDivElement;
  const nameInput = document.getElementById("input-customer-name") as HTMLInputElement;
  const mobileInput = document.getElementById("input-customer-mobile") as HTMLInputElement;
  const addressInput = document.getElementById("input-customer-address") as HTMLInputElement;
  const emailInput = document.getElementById("input-customer-email") as HTMLInputElement;
  const quickWalkinBtn = document.getElementById("btn-quick-walkin");
  const saveNewPatientBtn = document.getElementById("btn-save-new-patient");

  const syncTypedCustomer = () => {
    const nameVal = nameInput?.value.trim() || "";
    const mobileVal = mobileInput?.value.trim() || "";
    const addressVal = addressInput?.value.trim() || "";
    const emailVal = emailInput?.value.trim() || "";

    if (!nameVal && !mobileVal) {
      selectedCustomer = null;
      updateCustomerBadge("Patient: Not Selected");
      return;
    }

    if (nameVal.toLowerCase() === "walk-in customer") {
      selectedCustomer = {
        id: "c_walkin",
        name: "Walk-in Customer",
        mobile: mobileVal,
        address: addressVal,
        email: emailVal,
        outstandingBalance: 0,
        createdAt: new Date().toISOString()
      };
      updateCustomerBadge("Walk-in Customer");
      return;
    }

    // Check if typed name + mobile matches an existing customer record specifically
    const matched = customersList.find(c => 
      c.name.toLowerCase() === nameVal.toLowerCase() &&
      (!mobileVal || (c.mobile === mobileVal || (c as any).phone === mobileVal))
    );

    if (matched) {
      selectedCustomer = matched;
      updateCustomerBadge(`Existing: ${matched.name}`);
    } else {
      // Allow multiple customers under same mobile (e.g. family members)
      const mobileSharedCount = mobileVal ? customersList.filter(c => c.mobile === mobileVal || (c as any).phone === mobileVal).length : 0;
      selectedCustomer = {
        id: "",
        name: nameVal,
        mobile: mobileVal,
        address: addressVal,
        email: emailVal,
        outstandingBalance: 0,
        createdAt: new Date().toISOString()
      };
      if (mobileSharedCount > 0) {
        updateCustomerBadge(`New Patient (${mobileSharedCount} existing with this phone)`);
      } else {
        updateCustomerBadge("New Patient");
      }
    }
  };

  nameInput?.addEventListener("input", syncTypedCustomer);
  mobileInput?.addEventListener("input", syncTypedCustomer);
  addressInput?.addEventListener("input", syncTypedCustomer);
  emailInput?.addEventListener("input", syncTypedCustomer);

  // Explicit Save New Patient button
  saveNewPatientBtn?.addEventListener("click", async () => {
    const nameVal = nameInput?.value.trim() || "";
    const mobileVal = mobileInput?.value.trim() || "";
    const addressVal = addressInput?.value.trim() || "";
    const emailVal = emailInput?.value.trim() || "";

    if (!nameVal) {
      Toast.show("Please enter customer / patient name.", "error");
      nameInput?.focus();
      return;
    }

    if (!mobileVal) {
      Toast.show("Please enter customer / patient mobile number.", "error");
      mobileInput?.focus();
      return;
    }

    const originalText = saveNewPatientBtn.innerHTML;
    saveNewPatientBtn.innerHTML = `<span class="btn-spinner mr-1"></span> Saving...`;
    (saveNewPatientBtn as HTMLButtonElement).disabled = true;

    try {
      const newCust: Partial<Customer> = {
        name: nameVal,
        mobile: mobileVal,
        address: addressVal,
        email: emailVal,
        outstandingBalance: 0,
        createdAt: new Date().toISOString()
      };

      const newId = await dbService.saveItem("customers", newCust);
      const savedObj = { ...newCust, id: newId } as Customer;
      selectedCustomer = savedObj;
      customersList.push(savedObj);

      updateCustomerBadge(`Saved: ${nameVal}`);
      Toast.show(`Patient "${nameVal}" saved to database.`, "success");
    } catch (err) {
      console.error("Save patient error:", err);
      Toast.show("Failed to save patient.", "error");
    } finally {
      saveNewPatientBtn.innerHTML = originalText;
      (saveNewPatientBtn as HTMLButtonElement).disabled = false;
    }
  });

  quickWalkinBtn?.addEventListener("click", () => {
    if (nameInput) nameInput.value = "Walk-in Customer";
    if (mobileInput) mobileInput.value = "";
    if (addressInput) addressInput.value = "";
    if (emailInput) emailInput.value = "";
    if (searchInput) searchInput.value = "";
    resultsBox?.classList.add("hidden");
    selectedCustomer = {
      id: "c_walkin",
      name: "Walk-in Customer",
      mobile: "",
      outstandingBalance: 0,
      createdAt: new Date().toISOString()
    };
    updateCustomerBadge("Walk-in Customer");
  });

  searchInput?.addEventListener("input", () => {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      resultsBox.classList.add("hidden");
      return;
    }

    // Match by customer name OR mobile number (will display multiple customers if they share phone)
    const matches = customersList.filter(c => 
      (c.name || "").toLowerCase().includes(query) || (c.mobile || (c as any).phone || "").includes(query)
    );

    if (matches.length === 0) {
      resultsBox.innerHTML = `
        <div class="p-3 text-xs text-slate-500 flex justify-between items-center">
          <span>No customer match for "${query}".</span>
          <button type="button" class="btn-use-typed-query text-blue-600 font-bold hover:underline">Use as New Patient &rarr;</button>
        </div>
      `;
      resultsBox.querySelector(".btn-use-typed-query")?.addEventListener("click", () => {
        if (/^\+?[0-9\s-]+$/.test(query)) {
          if (mobileInput) mobileInput.value = searchInput.value.trim();
        } else {
          if (nameInput) nameInput.value = searchInput.value.trim();
        }
        resultsBox.classList.add("hidden");
        syncTypedCustomer();
      });
    } else {
      resultsBox.innerHTML = `
        <div class="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-500 uppercase flex justify-between">
          <span>Found ${matches.length} customer record(s)</span>
          <span>Click to select</span>
        </div>
        ${matches.map(c => `
          <div class="p-2.5 hover:bg-blue-50 cursor-pointer border-b border-slate-100 flex justify-between items-center transition-colors" data-id="${c.id}">
            <div>
              <p class="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <span>👤 ${c.name}</span>
                ${c.outstandingBalance > 0 ? `<span class="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded">Due: RS ${c.outstandingBalance.toFixed(2)}</span>` : ""}
              </p>
              <p class="text-[11px] text-slate-500 font-mono">📱 ${c.mobile || "No mobile"} ${c.address ? `• 📍 ${c.address}` : ""}</p>
            </div>
            <span class="text-[10px] text-blue-600 font-bold bg-blue-100/60 px-2 py-0.5 rounded-full">Select</span>
          </div>
        `).join("")}
      `;

      resultsBox.querySelectorAll("[data-id]").forEach(el => {
        el.addEventListener("click", () => {
          const id = el.getAttribute("data-id");
          const found = customersList.find(c => c.id === id);
          if (found) {
            selectedCustomer = found;
            if (nameInput) nameInput.value = found.name;
            if (mobileInput) mobileInput.value = found.mobile || (found as any).phone || "";
            if (addressInput) addressInput.value = found.address || "";
            if (emailInput) emailInput.value = found.email || "";
            updateCustomerBadge(`Existing: ${found.name}`);
          }
          resultsBox.classList.add("hidden");
          searchInput.value = "";
        });
      });
    }
    resultsBox.classList.remove("hidden");
  });

  // Close results box when clicking outside
  document.addEventListener("click", (e) => {
    if (!searchInput?.contains(e.target as Node) && !resultsBox?.contains(e.target as Node)) {
      resultsBox?.classList.add("hidden");
    }
  });
}

// 2. Product Picker Events
function setupProductPickerEvents() {
  const searchInput = document.getElementById("input-prod-search") as HTMLInputElement;
  const categorySelect = document.getElementById("select-prod-category") as HTMLSelectElement;
  const resultsBox = document.getElementById("product-picker-results") as HTMLDivElement;

  const renderProductCatalog = () => {
    const query = searchInput.value.trim().toLowerCase();
    const category = categorySelect.value;

    const filtered = productsList.filter(p => {
      const matchCat = category === "All" || p.category === category;
      const matchSearch = (p.name || "").toLowerCase().includes(query) || (p.modelNumber || "").toLowerCase().includes(query) || (p.sku || "").toLowerCase().includes(query) || (p.brand || "").toLowerCase().includes(query);
      return matchCat && matchSearch;
    });

    if (filtered.length === 0) {
      resultsBox.innerHTML = `<p class="text-xs text-slate-400 p-3 text-center">No matching products found.</p>`;
      return;
    }

    resultsBox.innerHTML = filtered.map(p => `
      <div class="p-2.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
        <div>
          <span class="font-bold text-xs text-slate-900 block">${p.name || "Unnamed Product"}</span>
          <span class="text-[11px] text-slate-500">${p.category || "General"} | Model: ${p.modelNumber || p.sku || "N/A"} | Stock: <strong class="${(p.stockQuantity || 0) <= (p.minStockLevel || 0) ? "text-rose-600 font-bold" : "text-slate-700"}">${p.stockQuantity || 0}</strong></span>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-bold text-xs text-slate-900">RS ${(p.sellingPrice || 0).toFixed(2)}</span>
          <button type="button" class="btn-pos-print-barcode p-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs" title="Print Barcode/QR Label" data-id="${p.id}">
            <svg class="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"></path>
            </svg>
          </button>
          <button type="button" class="btn-add-cart px-2.5 py-1 bg-blue-600 text-white font-bold text-[11px] rounded hover:bg-blue-700" data-id="${p.id}">
            + Add
          </button>
        </div>
      </div>
    `).join("");

    resultsBox.querySelectorAll(".btn-pos-print-barcode").forEach(btn => {
      btn.addEventListener("click", () => {
        const pId = btn.getAttribute("data-id");
        const prod = productsList.find(p => p.id === pId);
        if (prod) {
          BarcodePrinter.openPrintModal(prod, storeName);
        }
      });
    });

    resultsBox.querySelectorAll(".btn-add-cart").forEach(btn => {
      btn.addEventListener("click", () => {
        const pId = btn.getAttribute("data-id");
        addToCart(pId!);
      });
    });
  };

  searchInput?.addEventListener("input", renderProductCatalog);
  categorySelect?.addEventListener("change", renderProductCatalog);
  renderProductCatalog();

  // Setup Custom Lens with Price & Prescription Details
  setupCustomLensEvents();
}

let selectedEyeSide: "Both" | "RE" | "LE" = "Both";

function setupCustomLensEvents() {
  const addLensBtn = document.getElementById("btn-add-custom-lens");
  const addLensLabel = document.getElementById("btn-add-lens-label");
  const lensNameInput = document.getElementById("input-custom-lens-name") as HTMLInputElement;
  const lensPriceInput = document.getElementById("input-custom-lens-price") as HTMLInputElement;

  const odSph = document.getElementById("rx-od-sph") as HTMLInputElement;
  const odCyl = document.getElementById("rx-od-cyl") as HTMLInputElement;
  const odAxis = document.getElementById("rx-od-axis") as HTMLInputElement;
  const odAdd = document.getElementById("rx-od-add") as HTMLInputElement;
  const odVa = document.getElementById("rx-od-va") as HTMLInputElement;

  const osSph = document.getElementById("rx-os-sph") as HTMLInputElement;
  const osCyl = document.getElementById("rx-os-cyl") as HTMLInputElement;
  const osAxis = document.getElementById("rx-os-axis") as HTMLInputElement;
  const osAdd = document.getElementById("rx-os-add") as HTMLInputElement;
  const osVa = document.getElementById("rx-os-va") as HTMLInputElement;

  const rxPd = document.getElementById("rx-pd") as HTMLInputElement;
  const rxNotes = document.getElementById("rx-notes") as HTMLInputElement;

  const badgeEyeStatus = document.getElementById("badge-eye-side-status");
  const labelBoth = document.getElementById("label-eye-both");
  const labelRe = document.getElementById("label-eye-re");
  const labelLe = document.getElementById("label-eye-le");
  const containerOd = document.getElementById("container-rx-od");
  const containerOs = document.getElementById("container-rx-os");
  const badgeOdStatus = document.getElementById("badge-od-status");
  const badgeOsStatus = document.getElementById("badge-os-status");
  const hintOdDisabled = document.getElementById("hint-od-disabled");
  const hintOsDisabled = document.getElementById("hint-os-disabled");

  const updateEyeSideUI = () => {
    // Reset borders
    labelBoth?.classList.remove("border-blue-600", "shadow-2xs", "border-slate-200");
    labelRe?.classList.remove("border-emerald-600", "shadow-2xs", "border-slate-200");
    labelLe?.classList.remove("border-purple-600", "shadow-2xs", "border-slate-200");

    if (selectedEyeSide === "Both") {
      labelBoth?.classList.add("border-blue-600", "shadow-2xs");
      labelRe?.classList.add("border-slate-200");
      labelLe?.classList.add("border-slate-200");

      if (badgeEyeStatus) {
        badgeEyeStatus.innerText = "Both Eyes (Pair - RE & LE)";
        badgeEyeStatus.className = "text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-300 self-start sm:self-auto";
      }

      // Both containers active
      containerOd?.classList.remove("opacity-50", "bg-slate-100/70", "border-emerald-500", "bg-emerald-50/30");
      containerOd?.classList.add("border-blue-200", "bg-slate-50");
      if (badgeOdStatus) {
        badgeOdStatus.innerText = "Active";
        badgeOdStatus.className = "text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800";
      }
      hintOdDisabled?.classList.add("hidden");

      containerOs?.classList.remove("opacity-50", "bg-slate-100/70", "border-purple-500", "bg-purple-50/30");
      containerOs?.classList.add("border-blue-200", "bg-slate-50");
      if (badgeOsStatus) {
        badgeOsStatus.innerText = "Active";
        badgeOsStatus.className = "text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800";
      }
      hintOsDisabled?.classList.add("hidden");

      if (addLensLabel) addLensLabel.innerText = "+ Add Pair (RE + LE) Lens to Cart";
    } else if (selectedEyeSide === "RE") {
      labelRe?.classList.add("border-emerald-600", "shadow-2xs");
      labelBoth?.classList.add("border-slate-200");
      labelLe?.classList.add("border-slate-200");

      if (badgeEyeStatus) {
        badgeEyeStatus.innerText = "Right Eye (RE / OD) Only";
        badgeEyeStatus.className = "text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 self-start sm:self-auto";
      }

      // OD active with emerald highlight
      containerOd?.classList.remove("opacity-50", "bg-slate-100/70", "border-blue-200");
      containerOd?.classList.add("border-emerald-500", "bg-emerald-50/30");
      if (badgeOdStatus) {
        badgeOdStatus.innerText = "Active [RE Lens]";
        badgeOdStatus.className = "text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800";
      }
      hintOdDisabled?.classList.add("hidden");

      // OS dimmed / optional
      containerOs?.classList.remove("border-blue-200", "bg-slate-50", "border-purple-500", "bg-purple-50/30");
      containerOs?.classList.add("opacity-50", "bg-slate-100/70", "border-slate-200");
      if (badgeOsStatus) {
        badgeOsStatus.innerText = "Omitted (N/A)";
        badgeOsStatus.className = "text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600";
      }
      hintOsDisabled?.classList.remove("hidden");

      if (addLensLabel) addLensLabel.innerText = "+ Add Right Eye (RE) Lens to Cart";
    } else if (selectedEyeSide === "LE") {
      labelLe?.classList.add("border-purple-600", "shadow-2xs");
      labelBoth?.classList.add("border-slate-200");
      labelRe?.classList.add("border-slate-200");

      if (badgeEyeStatus) {
        badgeEyeStatus.innerText = "Left Eye (LE / OS) Only";
        badgeEyeStatus.className = "text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-300 self-start sm:self-auto";
      }

      // OS active with purple highlight
      containerOs?.classList.remove("opacity-50", "bg-slate-100/70", "border-blue-200");
      containerOs?.classList.add("border-purple-500", "bg-purple-50/30");
      if (badgeOsStatus) {
        badgeOsStatus.innerText = "Active [LE Lens]";
        badgeOsStatus.className = "text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800";
      }
      hintOsDisabled?.classList.add("hidden");

      // OD dimmed / optional
      containerOd?.classList.remove("border-blue-200", "bg-slate-50", "border-emerald-500", "bg-emerald-50/30");
      containerOd?.classList.add("opacity-50", "bg-slate-100/70", "border-slate-200");
      if (badgeOdStatus) {
        badgeOdStatus.innerText = "Omitted (N/A)";
        badgeOdStatus.className = "text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600";
      }
      hintOdDisabled?.classList.remove("hidden");

      if (addLensLabel) addLensLabel.innerText = "+ Add Left Eye (LE) Lens to Cart";
    }
  };

  // Radio listener for Eye side
  document.querySelectorAll('input[name="lens-eye-side"]').forEach(radio => {
    radio.addEventListener("change", (e) => {
      selectedEyeSide = (e.target as HTMLInputElement).value as "Both" | "RE" | "LE";
      updateEyeSideUI();
      Toast.show(`Lens side set to ${selectedEyeSide === "Both" ? "Both Eyes (Pair)" : selectedEyeSide === "RE" ? "Right Eye (RE) Only" : "Left Eye (LE) Only"}`, "info");
    });
  });

  const formatLensRxSummary = (side: "Both" | "RE" | "LE") => {
    const odS = odSph?.value || "0.00";
    const odC = odCyl?.value || "0.00";
    const odAx = odAxis?.value ? ` Ax:${odAxis.value}°` : "";
    const odAd = odAdd?.value ? ` Add:+${odAdd.value}` : "";
    const odV = odVa?.value ? ` VA:${odVa.value}` : "";

    const osS = osSph?.value || "0.00";
    const osC = osCyl?.value || "0.00";
    const osAx = osAxis?.value ? ` Ax:${osAxis.value}°` : "";
    const osAd = osAdd?.value ? ` Add:+${osAdd.value}` : "";
    const osV = osVa?.value ? ` VA:${osVa.value}` : "";

    const pd = rxPd?.value ? ` | PD: ${rxPd.value}mm` : "";

    if (side === "RE") {
      return `[RE (Right Eye) Only] OD: SPH ${odS} CYL ${odC}${odAx}${odAd}${odV}${pd}`;
    } else if (side === "LE") {
      return `[LE (Left Eye) Only] OS: SPH ${osS} CYL ${osC}${osAx}${osAd}${osV}${pd}`;
    }
    return `[Pair: RE+LE] OD: SPH ${odS} CYL ${odC}${odAx}${odAd}${odV} | OS: SPH ${osS} CYL ${osC}${osAx}${osAd}${osV}${pd}`;
  };

  // Copy OD to OS
  document.getElementById("btn-copy-od-to-os")?.addEventListener("click", () => {
    if (osSph && odSph) osSph.value = odSph.value;
    if (osCyl && odCyl) osCyl.value = odCyl.value;
    if (osAxis && odAxis) osAxis.value = odAxis.value;
    if (osAdd && odAdd) osAdd.value = odAdd.value;
    if (osVa && odVa) osVa.value = odVa.value;
    Toast.show("Copied Right Eye (RE) parameters to Left Eye (LE).", "info");
  });

  // Quick Presets
  document.querySelectorAll(".btn-rx-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      const addVal = btn.getAttribute("data-add") || "+2.00";
      if (odAdd) odAdd.value = addVal.replace("+", "");
      if (osAdd) osAdd.value = addVal.replace("+", "");
      Toast.show(`Set Near Addition to ${addVal}`, "info");
    });
  });

  // Clear Rx Form
  document.getElementById("btn-clear-rx")?.addEventListener("click", () => {
    [odSph, odCyl, odAxis, odAdd, odVa, osSph, osCyl, osAxis, osAdd, osVa, rxPd, rxNotes].forEach(el => {
      if (el) el.value = "";
    });
    Toast.show("Prescription fields cleared.", "info");
  });

  addLensBtn?.addEventListener("click", () => {
    const lensName = lensNameInput?.value.trim() || "Single Vision Optical Lens";
    const priceVal = parseFloat(lensPriceInput?.value) || 0;

    if (priceVal <= 0) {
      Toast.show("Please enter a valid price for the lens.", "error");
      lensPriceInput?.focus();
      return;
    }

    const rxText = formatLensRxSummary(selectedEyeSide);
    const eyeSideSuffix = selectedEyeSide === "RE" ? " [Right Eye / RE Only]" : selectedEyeSide === "LE" ? " [Left Eye / LE Only]" : " (Pair - RE & LE)";

    const customLensItem: SaleItem = {
      productId: "lens_" + Math.random().toString(36).substring(2, 9),
      productName: `Lens: ${lensName}${eyeSideSuffix}`,
      category: "Lens",
      quantity: 1,
      price: priceVal,
      discount: 0,
      total: priceVal,
      eyeSide: selectedEyeSide,
      lensDetails: rxText,
      prescriptionText: rxText,
      isCustomLens: true
    };

    cart.push(customLensItem);
    renderCartTable();
    recalculateTotals();

    Toast.show(`Added ${customLensItem.productName} (RS ${priceVal.toFixed(2)}) with Rx to Cart!`, "success");

    // Clear lens name/price inputs for next entry if desired
    if (lensNameInput) lensNameInput.value = "";
    if (lensPriceInput) lensPriceInput.value = "";
  });

  // Initialize UI
  updateEyeSideUI();
}

function addToCart(productId: string) {
  const product = productsList.find(p => p.id === productId);
  if (!product) return;

  const stock = product.stockQuantity || 0;
  const price = product.sellingPrice || 0;

  if (stock <= 0) {
    Toast.show(`Product "${product.name}" is out of stock.`, "error");
    return;
  }

  const existing = cart.find(item => item.productId === productId);
  if (existing) {
    if (existing.quantity + 1 > stock) {
      Toast.show(`Cannot add more. Available stock is ${stock}.`, "error");
      return;
    }
    existing.quantity += 1;
    existing.total = (existing.price - existing.discount) * existing.quantity;
  } else {
    cart.push({
      productId: product.id,
      productName: product.name || "Item",
      category: product.category || "General",
      quantity: 1,
      price: price,
      discount: 0,
      total: price
    });
  }

  renderCartTable();
  recalculateTotals();
}

function renderCartTable() {
  const tbody = document.getElementById("tbl-cart-body")!;
  const itemCountEl = document.getElementById("cart-item-count")!;

  const totalCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  itemCountEl.innerText = `${totalCount} item${totalCount === 1 ? "" : "s"} in cart`;

  if (cart.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Cart is empty. Select products from above or add custom lens below.</td></tr>`;
    return;
  }

  tbody.innerHTML = cart.map((item, index) => {
    let eyeSideBadge = "";
    if (item.eyeSide === "RE") {
      eyeSideBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300 mr-1.5">RE Only (OD)</span>`;
    } else if (item.eyeSide === "LE") {
      eyeSideBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-purple-100 text-purple-800 border border-purple-300 mr-1.5">LE Only (OS)</span>`;
    } else if (item.eyeSide === "Both" || item.isCustomLens) {
      eyeSideBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-blue-100 text-blue-800 border border-blue-300 mr-1.5">Pair (RE+LE)</span>`;
    }

    return `
    <tr>
      <td class="p-2.5">
        <div class="flex items-center flex-wrap gap-1">
          ${eyeSideBadge}
          <span class="font-bold text-slate-900">${item.productName || "Item"}</span>
        </div>
        ${item.lensDetails || item.prescriptionText ? `
          <span class="text-[10px] font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 inline-block mt-0.5">
            Rx: ${item.lensDetails || item.prescriptionText}
          </span>
        ` : ""}
      </td>
      <td class="p-2.5">RS ${(item.price || 0).toFixed(2)}</td>
      <td class="p-2.5">
        <input type="number" min="1" value="${item.quantity}" class="cart-qty w-12 px-1.5 py-1 text-center border border-slate-300 rounded" data-index="${index}" />
      </td>
      <td class="p-2.5">
        <input type="number" min="0" value="${item.discount}" class="cart-disc w-14 px-1 py-1 text-center border border-slate-300 rounded" data-index="${index}" />
      </td>
      <td class="p-2.5 text-right font-bold text-slate-900">RS ${(item.total || 0).toFixed(2)}</td>
      <td class="p-2.5 text-center">
        <button class="cart-remove text-rose-600 hover:text-rose-800 p-1 cursor-pointer" data-index="${index}">
          ${getIconSvg("x", "w-3.5 h-3.5")}
        </button>
      </td>
    </tr>
  `;
  }).join("");

  // Attach event handlers for qty, disc and removal
  tbody.querySelectorAll(".cart-qty").forEach(input => {
    input.addEventListener("change", (e) => {
      const idx = parseInt((e.target as HTMLElement).getAttribute("data-index")!);
      const newQty = parseInt((e.target as HTMLInputElement).value) || 1;
      cart[idx].quantity = Math.max(1, newQty);
      cart[idx].total = (cart[idx].price - cart[idx].discount) * cart[idx].quantity;
      renderCartTable();
      recalculateTotals();
    });
  });

  tbody.querySelectorAll(".cart-disc").forEach(input => {
    input.addEventListener("change", (e) => {
      const idx = parseInt((e.target as HTMLElement).getAttribute("data-index")!);
      const newDisc = parseFloat((e.target as HTMLInputElement).value) || 0;
      cart[idx].discount = Math.max(0, newDisc);
      cart[idx].total = Math.max(0, (cart[idx].price - cart[idx].discount) * cart[idx].quantity);
      renderCartTable();
      recalculateTotals();
    });
  });

  tbody.querySelectorAll(".cart-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-index")!);
      cart.splice(idx, 1);
      renderCartTable();
      recalculateTotals();
    });
  });
}

// 3. Billing & Discount Calculations
let lastReceiptData: any = null;
let lastPrescriptionData: Prescription | null = null;
let posDiscountType: "fixed" | "percentage" = "fixed";
let posDiscountValue: number = 0;
let posDiscountReason: string = "";

function calculatePOSFinancials() {
  const itemsSubtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemDiscountsTotal = cart.reduce((sum, item) => sum + (item.discount || 0) * item.quantity, 0);
  const netAfterItemDiscount = Math.max(0, itemsSubtotal - itemDiscountsTotal);

  let billDiscountAmount = 0;
  if (posDiscountValue > 0) {
    if (posDiscountType === "fixed") {
      billDiscountAmount = Math.min(netAfterItemDiscount, posDiscountValue);
    } else {
      billDiscountAmount = Math.min(netAfterItemDiscount, (netAfterItemDiscount * posDiscountValue) / 100);
      billDiscountAmount = Math.round(billDiscountAmount * 100) / 100;
    }
  }

  const totalDiscount = itemDiscountsTotal + billDiscountAmount;
  const taxableAmount = Math.max(0, itemsSubtotal - totalDiscount);
  const taxTotal = isTaxEnabled ? (taxableAmount * currentTaxRate) / 100 : 0;
  const grandTotal = taxableAmount + taxTotal;

  return {
    itemsSubtotal,
    itemDiscountsTotal,
    billDiscountAmount,
    totalDiscount,
    taxableAmount,
    taxTotal,
    grandTotal
  };
}

function updateDiscountModeUI() {
  const labelFixed = document.getElementById("label-disc-fixed");
  const labelPercent = document.getElementById("label-disc-percent");
  const prefixType = document.getElementById("prefix-disc-type");
  const discountInput = document.getElementById("input-pos-discount-value") as HTMLInputElement;

  if (posDiscountType === "fixed") {
    labelFixed?.classList.add("border-rose-600", "text-rose-900", "shadow-2xs");
    labelFixed?.classList.remove("border-slate-200", "text-slate-600");
    labelPercent?.classList.remove("border-rose-600", "text-rose-900", "shadow-2xs");
    labelPercent?.classList.add("border-slate-200", "text-slate-600");
    if (prefixType) prefixType.innerText = "RS";
    if (discountInput) {
      discountInput.placeholder = "0.00";
      discountInput.max = "999999";
    }
  } else {
    labelPercent?.classList.add("border-rose-600", "text-rose-900", "shadow-2xs");
    labelPercent?.classList.remove("border-slate-200", "text-slate-600");
    labelFixed?.classList.remove("border-rose-600", "text-rose-900", "shadow-2xs");
    labelFixed?.classList.add("border-slate-200", "text-slate-600");
    if (prefixType) prefixType.innerText = "%";
    if (discountInput) {
      discountInput.placeholder = "10";
      discountInput.max = "100";
    }
  }
}

function recalculateTotals() {
  const {
    itemsSubtotal,
    itemDiscountsTotal,
    billDiscountAmount,
    totalDiscount,
    taxableAmount,
    taxTotal,
    grandTotal
  } = calculatePOSFinancials();

  const advanceInput = document.getElementById("input-advance-amount") as HTMLInputElement;
  
  // If the user hasn't explicitly set any value, initialize with grandTotal if cart has items
  if (advanceInput && !advanceInput.dataset.userModified && grandTotal > 0 && !advanceInput.value) {
    advanceInput.value = grandTotal.toFixed(2);
  }

  let advanceVal = parseFloat(advanceInput?.value || "0") || 0;
  
  // If user entered more than grand total
  const advanceErrorEl = document.getElementById("advance-val-error");
  if (advanceVal > grandTotal && grandTotal > 0) {
    advanceErrorEl?.classList.remove("hidden");
  } else {
    advanceErrorEl?.classList.add("hidden");
  }

  const pendingAmount = Math.max(0, grandTotal - advanceVal);
  const isFullySettled = (cart.length > 0 && pendingAmount <= 0.001) || (cart.length === 0);

  // Update UI Elements
  const subtotalEl = document.getElementById("calc-subtotal");
  const rowItemDisc = document.getElementById("row-calc-item-discount");
  const itemDiscEl = document.getElementById("calc-item-discount");
  const rowBillDisc = document.getElementById("row-calc-bill-discount");
  const billDiscLabel = document.getElementById("label-calc-bill-discount");
  const billDiscEl = document.getElementById("calc-bill-discount");
  const discountEl = document.getElementById("calc-discount");
  const taxableNetEl = document.getElementById("calc-taxable-net");
  const taxEl = document.getElementById("calc-tax");
  const grandEl = document.getElementById("calc-grand-total");
  const pendingEl = document.getElementById("calc-pending-amount");
  const statusBadge = document.getElementById("pos-settlement-status");
  const settlementCard = document.getElementById("box-settlement-card");
  const settlementNote = document.getElementById("label-settlement-note");
  const directLockHint = document.getElementById("direct-invoice-lock-hint");
  const hintPendingDue = document.getElementById("hint-pending-due");
  const saleBtn = document.getElementById("btn-save-as-sale") as HTMLButtonElement;
  const saleBtnText = document.getElementById("btn-sale-text");

  // Discount Panel UI
  const badgeDiscountApplied = document.getElementById("badge-discount-applied");
  const labelDiscSavingAmt = document.getElementById("label-disc-saving-amt");

  if (subtotalEl) subtotalEl.innerText = `RS ${(itemsSubtotal || 0).toFixed(2)}`;

  if (rowItemDisc && itemDiscEl) {
    if (itemDiscountsTotal > 0) {
      rowItemDisc.classList.remove("hidden");
      itemDiscEl.innerText = `-RS ${itemDiscountsTotal.toFixed(2)}`;
    } else {
      rowItemDisc.classList.add("hidden");
    }
  }

  if (rowBillDisc && billDiscEl) {
    if (billDiscountAmount > 0) {
      rowBillDisc.classList.remove("hidden");
      if (billDiscLabel) {
        billDiscLabel.innerText = posDiscountType === "percentage" ? `Bill Discount (${posDiscountValue}%):` : "Bill Discount:";
      }
      billDiscEl.innerText = `-RS ${billDiscountAmount.toFixed(2)}`;
    } else {
      rowBillDisc.classList.add("hidden");
    }
  }

  if (discountEl) discountEl.innerText = `-RS ${(totalDiscount || 0).toFixed(2)}`;
  if (taxableNetEl) taxableNetEl.innerText = `RS ${(taxableAmount || 0).toFixed(2)}`;

  if (badgeDiscountApplied) {
    if (totalDiscount > 0) {
      const tagText = billDiscountAmount > 0 
        ? (posDiscountType === "percentage" ? `${posDiscountValue}% OFF` : `RS ${billDiscountAmount.toFixed(0)} OFF`)
        : `RS ${totalDiscount.toFixed(0)} OFF`;
      badgeDiscountApplied.innerText = `${tagText} (Total: -RS ${totalDiscount.toFixed(2)})`;
      badgeDiscountApplied.className = "text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300";
    } else {
      badgeDiscountApplied.innerText = "No Discount";
      badgeDiscountApplied.className = "text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200";
    }
  }

  if (labelDiscSavingAmt) {
    labelDiscSavingAmt.innerText = `-RS ${(billDiscountAmount || 0).toFixed(2)}`;
  }
  
  if (taxEl) {
    if (isTaxEnabled) {
      taxEl.innerText = `RS ${(taxTotal || 0).toFixed(2)}`;
    } else {
      taxEl.innerText = `RS 0.00 (Exempt)`;
    }
  }

  if (grandEl) grandEl.innerText = `RS ${(grandTotal || 0).toFixed(2)}`;
  if (pendingEl) pendingEl.innerText = `RS ${(pendingAmount || 0).toFixed(2)}`;
  if (hintPendingDue) hintPendingDue.innerText = pendingAmount.toFixed(2);

  if (isFullySettled) {
    if (statusBadge) {
      statusBadge.innerText = "Full Payment (100%)";
      statusBadge.className = "text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300";
    }
    if (settlementCard) {
      settlementCard.className = "p-3 bg-emerald-50/80 rounded-lg border border-emerald-200 space-y-1 text-xs";
    }
    if (settlementNote) {
      settlementNote.innerText = "✓ Full payment received. Direct Invoice is ready to be generated.";
      settlementNote.className = "text-[10.5px] font-semibold text-emerald-700";
    }
    if (directLockHint) directLockHint.classList.add("hidden");
    if (saleBtn) {
      saleBtn.className = "w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-2xs transition-all flex items-center justify-center gap-2 cursor-pointer";
    }
    if (saleBtnText) {
      saleBtnText.innerText = "Generate Direct Invoice (Full Payment)";
    }
  } else {
    if (statusBadge) {
      statusBadge.innerText = `Advance Paid (Due: RS ${pendingAmount.toFixed(2)})`;
      statusBadge.className = "text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300";
    }
    if (settlementCard) {
      settlementCard.className = "p-3 bg-amber-50/80 rounded-lg border border-amber-200 space-y-1 text-xs";
    }
    if (settlementNote) {
      settlementNote.innerText = `⚠️ Partial payment received (Due: RS ${pendingAmount.toFixed(2)}). Generate Advance Receipt below. Direct Invoice locked until full payment.`;
      settlementNote.className = "text-[10.5px] font-semibold text-amber-800";
    }
    if (directLockHint) directLockHint.classList.remove("hidden");
    if (saleBtn) {
      saleBtn.className = "w-full py-3 px-4 bg-slate-400 hover:bg-slate-500 text-white font-bold text-xs sm:text-sm rounded-xl shadow-2xs transition-all flex items-center justify-center gap-2 cursor-not-allowed opacity-80";
    }
    if (saleBtnText) {
      saleBtnText.innerText = `Direct Invoice Locked (Due: RS ${pendingAmount.toFixed(2)})`;
    }
  }
}

function setupBillingCalculations() {
  const advanceInput = document.getElementById("input-advance-amount") as HTMLInputElement;
  const fullAdvanceBtn = document.getElementById("btn-set-full-advance");
  const halfAdvanceBtn = document.getElementById("btn-set-half-advance");
  const zeroAdvanceBtn = document.getElementById("btn-set-zero-advance");

  advanceInput?.addEventListener("input", () => {
    if (advanceInput) advanceInput.dataset.userModified = "true";
    recalculateTotals();
  });

  fullAdvanceBtn?.addEventListener("click", () => {
    const { grandTotal } = calculatePOSFinancials();

    if (advanceInput) {
      advanceInput.value = grandTotal.toFixed(2);
      advanceInput.dataset.userModified = "true";
    }
    recalculateTotals();
    Toast.show(`Amount set to Full Payment (RS ${grandTotal.toFixed(2)})`, "info");
  });

  halfAdvanceBtn?.addEventListener("click", () => {
    const { grandTotal } = calculatePOSFinancials();
    const halfVal = Math.round(grandTotal / 2);

    if (advanceInput) {
      advanceInput.value = halfVal.toFixed(2);
      advanceInput.dataset.userModified = "true";
    }
    recalculateTotals();
    Toast.show(`Amount set to 50% Advance (RS ${halfVal.toFixed(2)})`, "info");
  });

  zeroAdvanceBtn?.addEventListener("click", () => {
    if (advanceInput) {
      advanceInput.value = "0.00";
      advanceInput.dataset.userModified = "true";
    }
    recalculateTotals();
    Toast.show("Amount set to RS 0 (Unpaid / Booking Only)", "info");
  });

  // Discount Controls
  setupDiscountControls();

  // Tax Mode radio buttons: With Tax vs Without Tax
  const taxRadios = document.querySelectorAll('input[name="billing-tax-mode"]');
  taxRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      const mode = (document.querySelector('input[name="billing-tax-mode"]:checked') as HTMLInputElement)?.value;
      isTaxEnabled = (mode === "with_tax");
      updateTaxModeUI();
      recalculateTotals();
    });
  });

  // POS Tax Rate input
  const posTaxInput = document.getElementById("input-pos-tax-rate") as HTMLInputElement;
  posTaxInput?.addEventListener("input", () => {
    const val = parseFloat(posTaxInput.value);
    if (!isNaN(val) && val >= 0) {
      currentTaxRate = val;
      updateTaxModeUI();
      recalculateTotals();
    }
  });
}

function setupDiscountControls() {
  const discountInput = document.getElementById("input-pos-discount-value") as HTMLInputElement;
  const reasonInput = document.getElementById("input-pos-disc-reason") as HTMLInputElement;
  const clearBtn = document.getElementById("btn-clear-pos-disc");
  const presetButtons = document.querySelectorAll(".btn-pos-disc-preset");
  const modeRadios = document.querySelectorAll('input[name="pos-discount-mode"]');

  // Mode radio switch (flat RS vs percentage %)
  modeRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      const selected = (document.querySelector('input[name="pos-discount-mode"]:checked') as HTMLInputElement)?.value;
      posDiscountType = (selected === "percentage") ? "percentage" : "fixed";
      updateDiscountModeUI();
      recalculateTotals();
    });
  });

  // Direct numeric input
  discountInput?.addEventListener("input", () => {
    const rawVal = parseFloat(discountInput.value) || 0;
    posDiscountValue = Math.max(0, rawVal);
    recalculateTotals();
  });

  // Reason / Note input
  reasonInput?.addEventListener("input", () => {
    posDiscountReason = reasonInput.value.trim();
  });

  // Preset Buttons
  presetButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetType = btn.getAttribute("data-type") as "fixed" | "percentage";
      const targetVal = parseFloat(btn.getAttribute("data-val") || "0");

      posDiscountType = targetType;
      posDiscountValue = targetVal;

      // Update UI selection
      const radioFixed = document.querySelector('input[name="pos-discount-mode"][value="fixed"]') as HTMLInputElement;
      const radioPercent = document.querySelector('input[name="pos-discount-mode"][value="percentage"]') as HTMLInputElement;

      if (targetType === "percentage") {
        if (radioPercent) radioPercent.checked = true;
      } else {
        if (radioFixed) radioFixed.checked = true;
      }

      if (discountInput) {
        discountInput.value = String(targetVal);
      }

      updateDiscountModeUI();
      recalculateTotals();
      Toast.show(`Discount set to ${targetType === "percentage" ? `${targetVal}%` : `RS ${targetVal}`}`, "info");
    });
  });

  // Clear Discount Button
  clearBtn?.addEventListener("click", () => {
    posDiscountValue = 0;
    if (discountInput) discountInput.value = "";
    recalculateTotals();
    Toast.show("Discount cleared (RS 0.00)", "info");
  });
}

// 4. Save Sale & Advance Receipt Logic
function setupFormActionEvents() {
  const saveAsSaleBtn = document.getElementById("btn-save-as-sale");
  const saveAsPendingBtn = document.getElementById("btn-save-as-pending");
  const advanceReceiptBtn = document.getElementById("btn-gen-advance-receipt");
  const quickFullInvoiceBtn = document.getElementById("btn-quick-full-invoice");

  const processCheckout = async (targetMode: "sale" | "pending") => {
    if (cart.length === 0) {
      Toast.show("Please add at least one product to the cart.", "error");
      return;
    }

    const {
      itemsSubtotal: subtotal,
      billDiscountAmount,
      totalDiscount: discountTotal,
      taxTotal,
      grandTotal
    } = calculatePOSFinancials();

    const advanceInput = document.getElementById("input-advance-amount") as HTMLInputElement;
    let advanceAmount = parseFloat(advanceInput?.value || "0") || 0;

    if (advanceAmount > grandTotal) {
      Toast.show("Advance amount cannot exceed the grand total.", "error");
      return;
    }

    const pendingAmount = Math.max(0, grandTotal - advanceAmount);

    // DIRECT INVOICE VALIDATION: Cannot be generated without 100% full payment!
    if (targetMode === "sale") {
      if (pendingAmount > 0.001) {
        Toast.show(`Direct invoice cannot be generated without full payment! Remaining balance due: RS ${pendingAmount.toFixed(2)}. Please collect the full amount (RS ${grandTotal.toFixed(2)}) or click 'Generate Advance Receipt'.`, "error");
        
        // Highlight hint and shake input
        const lockHint = document.getElementById("direct-invoice-lock-hint");
        if (lockHint) {
          lockHint.classList.remove("hidden");
          lockHint.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        advanceInput?.focus();
        return;
      }
    }

    // Determine the actual active customer from input fields
    const nameVal = (document.getElementById("input-customer-name") as HTMLInputElement)?.value.trim() || "Walk-in Customer";
    const mobileVal = (document.getElementById("input-customer-mobile") as HTMLInputElement)?.value.trim() || "";
    const addressVal = (document.getElementById("input-customer-address") as HTMLInputElement)?.value.trim() || "";
    const emailVal = (document.getElementById("input-customer-email") as HTMLInputElement)?.value.trim() || "";

    let finalCustomer: Customer;

    if (!nameVal || nameVal.toLowerCase() === "walk-in customer") {
      finalCustomer = {
        id: "c_walkin",
        name: "Walk-in Customer",
        mobile: mobileVal,
        address: addressVal,
        email: emailVal,
        outstandingBalance: 0,
        createdAt: new Date().toISOString()
      };
    } else if (selectedCustomer && selectedCustomer.id && selectedCustomer.id !== "c_walkin" && selectedCustomer.name.toLowerCase() === nameVal.toLowerCase()) {
      // Explicitly selected customer profile from search
      finalCustomer = selectedCustomer;
      if (mobileVal) finalCustomer.mobile = mobileVal;
      if (addressVal && !finalCustomer.address) finalCustomer.address = addressVal;
      if (emailVal && !finalCustomer.email) finalCustomer.email = emailVal;
    } else {
      // Look for exact match on both name and mobile
      const exactMatch = customersList.find(c => 
        c.name.toLowerCase() === nameVal.toLowerCase() &&
        (!mobileVal || (c.mobile === mobileVal || (c as any).phone === mobileVal))
      );

      if (exactMatch) {
        finalCustomer = exactMatch;
        if (addressVal && !finalCustomer.address) finalCustomer.address = addressVal;
        if (emailVal && !finalCustomer.email) finalCustomer.email = emailVal;
      } else {
        // Create new patient record (allows multiple patients with same family mobile)
        const newCustObj: Partial<Customer> = {
          name: nameVal,
          mobile: mobileVal || "N/A",
          address: addressVal,
          email: emailVal,
          outstandingBalance: pendingAmount,
          createdAt: new Date().toISOString()
        };
        const newId = await dbService.saveItem("customers", newCustObj);
        finalCustomer = { ...newCustObj, id: newId } as Customer;
        customersList.push(finalCustomer);
      }
    }

    const payMethodEl = document.querySelector('input[name="pay-method"]:checked') as HTMLInputElement;
    const paymentMethod = (payMethodEl ? payMethodEl.value : "Cash") as "Cash" | "UPI" | "Card";
    const notes = (document.getElementById("sale-notes") as HTMLTextAreaElement).value.trim();

    // Check Prescription details from the optical form or cart items
    const odSphVal = (document.getElementById("rx-od-sph") as HTMLInputElement)?.value.trim();
    const odCylVal = (document.getElementById("rx-od-cyl") as HTMLInputElement)?.value.trim();
    const osSphVal = (document.getElementById("rx-os-sph") as HTMLInputElement)?.value.trim();
    const osCylVal = (document.getElementById("rx-os-cyl") as HTMLInputElement)?.value.trim();
    const rxPdVal = (document.getElementById("rx-pd") as HTMLInputElement)?.value.trim();
    const hasLensItem = cart.some(i => i.isCustomLens || i.lensDetails || i.prescriptionText);

    const hasRx = odSphVal || odCylVal || osSphVal || osCylVal || rxPdVal || hasLensItem;
    let prescriptionId: string | undefined = undefined;
    let savedPrescriptionObj: Prescription | null = null;

    if (hasRx) {
      const rxNotesVal = (document.getElementById("rx-notes") as HTMLInputElement)?.value.trim();
      const rxObj: Partial<Prescription> = {
        customerId: finalCustomer.id,
        customerName: finalCustomer.name,
        eyeSide: selectedEyeSide,
        prescriptionDate: new Date().toISOString().slice(0, 10),
        rightEye: {
          sph: selectedEyeSide === "LE" ? "0.00" : ((document.getElementById("rx-od-sph") as HTMLInputElement)?.value || "0.00"),
          cyl: selectedEyeSide === "LE" ? "0.00" : ((document.getElementById("rx-od-cyl") as HTMLInputElement)?.value || "0.00"),
          axis: selectedEyeSide === "LE" ? "0" : ((document.getElementById("rx-od-axis") as HTMLInputElement)?.value || "0"),
          add: selectedEyeSide === "LE" ? "0.00" : ((document.getElementById("rx-od-add") as HTMLInputElement)?.value || "0.00"),
        },
        leftEye: {
          sph: selectedEyeSide === "RE" ? "0.00" : ((document.getElementById("rx-os-sph") as HTMLInputElement)?.value || "0.00"),
          cyl: selectedEyeSide === "RE" ? "0.00" : ((document.getElementById("rx-os-cyl") as HTMLInputElement)?.value || "0.00"),
          axis: selectedEyeSide === "RE" ? "0" : ((document.getElementById("rx-os-axis") as HTMLInputElement)?.value || "0"),
          add: selectedEyeSide === "RE" ? "0.00" : ((document.getElementById("rx-os-add") as HTMLInputElement)?.value || "0.00"),
        },
        pd: rxPdVal,
        notes: rxNotesVal || (selectedEyeSide === "RE" ? `Right Eye (RE) Single Lens for ${finalCustomer.name}` : selectedEyeSide === "LE" ? `Left Eye (LE) Single Lens for ${finalCustomer.name}` : `Prescription for ${finalCustomer.name}`),
        createdAt: new Date().toISOString()
      };
      prescriptionId = await dbService.saveItem("prescriptions", rxObj);
      savedPrescriptionObj = { ...rxObj, id: prescriptionId } as Prescription;
    }

    const saleNum = "OPT-SL-" + Math.floor(1000 + Math.random() * 9000);
    const orderNum = "OPT-ORD-" + Math.floor(1000 + Math.random() * 9000);
    const receiptNum = "OPT-REC-" + Math.floor(1000 + Math.random() * 9000);

    const isFullyCompletedSale = targetMode === "sale" || pendingAmount === 0;

    const newSale: Partial<Sale> = {
      saleNumber: saleNum,
      customerId: finalCustomer.id,
      customerName: finalCustomer.name,
      customerMobile: finalCustomer.mobile,
      customerEmail: finalCustomer.email,
      customerAddress: finalCustomer.address,
      items: [...cart],
      subtotal,
      discountTotal,
      billDiscountAmount,
      billDiscountType: posDiscountType,
      billDiscountValue: posDiscountValue,
      discountReason: posDiscountReason,
      taxTotal,
      taxRate: isTaxEnabled ? currentTaxRate : 0,
      taxType: isTaxEnabled ? "with_tax" : "without_tax",
      isTaxExempt: !isTaxEnabled,
      grandTotal,
      advanceAmount,
      pendingAmount,
      paymentMethod,
      saleDate: new Date().toISOString().slice(0, 10),
      status: isFullyCompletedSale ? "Completed" : "Pending Fulfillment",
      prescriptionId,
      notes,
      createdAt: new Date().toISOString()
    };

    const saleId = await dbService.saveItem("sales", newSale);

    // Create Order record
    let orderId = "";
    if (!isFullyCompletedSale || cart.some(i => i.category === "Lens" || i.category === "Frame")) {
      const newOrder: Partial<Order> = {
        orderNumber: orderNum,
        saleId,
        customerId: finalCustomer.id,
        customerName: finalCustomer.name,
        customerMobile: finalCustomer.mobile,
        items: [...cart],
        subtotal,
        discountTotal,
        billDiscountAmount,
        billDiscountType: posDiscountType,
        billDiscountValue: posDiscountValue,
        discountReason: posDiscountReason,
        grandTotal,
        advancePaid: advanceAmount,
        pendingBalance: pendingAmount,
        status: isFullyCompletedSale ? "Completed" : "Pending",
        paymentStatus: isFullyCompletedSale ? "Fully-paid" : (advanceAmount > 0 ? "Advance-paid" : "Unpaid"),
        orderDate: new Date().toISOString().slice(0, 10),
        prescriptionDetails: savedPrescriptionObj || (prescriptionId ? await dbService.getItem<Prescription>("prescriptions", prescriptionId) : undefined),
        notes,
        createdAt: new Date().toISOString()
      };
      orderId = await dbService.saveItem("orders", newOrder);
    }

    // Save Receipt record
    const newReceipt: Partial<Receipt> = {
      receiptNumber: receiptNum,
      saleId,
      orderId,
      customerId: finalCustomer.id,
      customerName: finalCustomer.name,
      customerMobile: finalCustomer.mobile,
      date: new Date().toISOString().slice(0, 10),
      totalAmount: grandTotal,
      advanceAmount,
      pendingAmount,
      paymentMethod,
      itemsSummary: cart.map(i => `${i.productName} (x${i.quantity})`).join(", "),
      createdAt: new Date().toISOString()
    };
    await dbService.saveItem("receipts", newReceipt);

    // Update Customer outstanding balance if pending
    if (pendingAmount > 0 && finalCustomer.id !== "c_walkin") {
      finalCustomer.outstandingBalance = (finalCustomer.outstandingBalance || 0) + pendingAmount;
      finalCustomer.lastPurchaseDate = new Date().toISOString();
      await dbService.saveItem("customers", finalCustomer);
    }

    // Deduct Product Inventory Stock
    for (const cartItem of cart) {
      const prod = productsList.find(p => p.id === cartItem.productId);
      if (prod) {
        prod.stockQuantity = Math.max(0, prod.stockQuantity - cartItem.quantity);
        await dbService.saveItem("products", prod);
      }
    }

    const currentCartCopy = [...cart];

    // Store receipt data for immediate printing
    lastReceiptData = {
      receiptNumber: receiptNum,
      saleNumber: saleNum,
      orderNumber: orderNum,
      customerName: finalCustomer.name,
      customerMobile: finalCustomer.mobile,
      customerAddress: finalCustomer.address,
      items: currentCartCopy,
      subtotal,
      discountTotal,
      billDiscountAmount,
      grandTotal,
      advanceAmount,
      pendingAmount,
      paymentMethod,
      date: new Date().toISOString().slice(0, 10),
      notes,
      taxTotal,
      taxRate: isTaxEnabled ? currentTaxRate : 0,
      isTaxExempt: !isTaxEnabled,
      taxType: isTaxEnabled ? "with_tax" : "without_tax"
    };
    lastPrescriptionData = savedPrescriptionObj;

    if (targetMode === "sale") {
      Toast.show(`Direct Invoice generated for Sale ${saleNum} (Full Paid: RS ${grandTotal.toFixed(2)})!`, "success");
      
      // Reset Cart
      cart = [];
      renderCartTable();
      recalculateTotals();

      // Redirect to invoice page
      setTimeout(() => {
        window.location.href = `invoice.html?saleId=${saleId}`;
      }, 800);
    } else {
      // ADVANCE RECEIPT FLOW: Open Advance Receipt Modal & provide instant print
      Toast.show(`Advance Receipt generated for Order ${orderNum} (Advance: RS ${advanceAmount.toFixed(2)}, Due: RS ${pendingAmount.toFixed(2)})!`, "success");
      
      renderAdvanceReceiptModalContent(lastReceiptData, lastPrescriptionData);
      document.getElementById("modal-advance-receipt")?.classList.remove("hidden");

      // Reset Cart for next sale
      cart = [];
      renderCartTable();
      if (advanceInput) {
        advanceInput.value = "";
        delete advanceInput.dataset.userModified;
      }
      recalculateTotals();
    }
  };

  saveAsSaleBtn?.addEventListener("click", () => processCheckout("sale"));
  saveAsPendingBtn?.addEventListener("click", () => processCheckout("pending"));

  // Quick Pay Full & Invoice Shortcut
  quickFullInvoiceBtn?.addEventListener("click", () => {
    const { grandTotal } = calculatePOSFinancials();

    const advanceInput = document.getElementById("input-advance-amount") as HTMLInputElement;
    if (advanceInput) {
      advanceInput.value = grandTotal.toFixed(2);
      advanceInput.dataset.userModified = "true";
    }
    recalculateTotals();
    processCheckout("sale");
  });

  // Advance Receipt Preview Modal Trigger
  advanceReceiptBtn?.addEventListener("click", () => {
    if (cart.length === 0) {
      Toast.show("Please add products to cart to preview advance receipt.", "error");
      return;
    }

    const {
      itemsSubtotal: subtotal,
      billDiscountAmount,
      totalDiscount: discountTotal,
      taxTotal,
      grandTotal
    } = calculatePOSFinancials();

    const advanceInput = document.getElementById("input-advance-amount") as HTMLInputElement;
    const advanceAmount = parseFloat(advanceInput?.value || "0") || 0;
    const pendingAmount = Math.max(0, grandTotal - advanceAmount);

    const nameVal = (document.getElementById("input-customer-name") as HTMLInputElement)?.value.trim() || "Walk-in Customer";
    const mobileVal = (document.getElementById("input-customer-mobile") as HTMLInputElement)?.value.trim() || "";

    const previewData = {
      receiptNumber: "OPT-REC-" + Math.floor(1000 + Math.random() * 9000),
      orderNumber: "OPT-ORD-" + Math.floor(1000 + Math.random() * 9000),
      customerName: nameVal,
      customerMobile: mobileVal,
      items: [...cart],
      subtotal,
      discountTotal,
      billDiscountAmount,
      grandTotal,
      advanceAmount,
      pendingAmount,
      paymentMethod: (document.querySelector('input[name="pay-method"]:checked') as HTMLInputElement)?.value || "Cash",
      date: new Date().toISOString().slice(0, 10),
      notes: (document.getElementById("sale-notes") as HTMLTextAreaElement)?.value || ""
    };

    lastReceiptData = previewData;
    renderAdvanceReceiptModalContent(previewData, null);
    document.getElementById("modal-advance-receipt")?.classList.remove("hidden");
  });

  // Modal Print / PDF Actions & New POS
  document.getElementById("btn-close-receipt-modal")?.addEventListener("click", () => {
    document.getElementById("modal-advance-receipt")?.classList.add("hidden");
  });

  document.getElementById("btn-modal-new-pos")?.addEventListener("click", () => {
    resetPOSForNewSale();
  });

  document.getElementById("btn-print-receipt")?.addEventListener("click", () => {
    if (lastReceiptData) {
      printAdvanceReceiptDirect(lastReceiptData, lastPrescriptionData, activeStoreSettings);
    } else {
      window.print();
    }
  });

  document.getElementById("btn-print-receipt-thermal")?.addEventListener("click", () => {
    if (lastReceiptData) {
      printThermalReceiptDirect(lastReceiptData, activeStoreSettings);
    }
  });

  document.getElementById("btn-download-receipt-pdf")?.addEventListener("click", () => {
    if (lastReceiptData) {
      downloadAdvanceReceiptPDF(lastReceiptData, lastPrescriptionData, activeStoreSettings);
      Toast.show("Advance Receipt PDF downloaded successfully.", "success");
    }
  });

  // Detailed Reports
  document.getElementById("btn-sales-download-today-pdf")?.addEventListener("click", async () => {
    const [sales, expenses] = await Promise.all([
      dbService.getList<Sale>("sales"),
      dbService.getList<Expense>("expenses")
    ]);
    const todayStr = new Date().toISOString().slice(0, 10);
    downloadTodayDetailedPDFReport(sales, expenses, todayStr);
    Toast.show("Downloading Today's Detailed Report PDF...", "success");
  });

  document.getElementById("btn-sales-download-today")?.addEventListener("click", async () => {
    const sales = await dbService.getList<Sale>("sales");
    const todayStr = new Date().toISOString().slice(0, 10);
    const csv = generateTodaySalesReportCSV(sales, todayStr);
    downloadCSV(`optiway_today_sales_${todayStr}.csv`, csv);
    Toast.show("Today's sales report downloaded as CSV.", "success");
  });
}

function resetPOSForNewSale() {
  // Clear patient/customer inputs
  selectedCustomer = null;
  const nameInput = document.getElementById("input-customer-name") as HTMLInputElement;
  const mobileInput = document.getElementById("input-customer-mobile") as HTMLInputElement;
  const addressInput = document.getElementById("input-customer-address") as HTMLInputElement;
  const emailInput = document.getElementById("input-customer-email") as HTMLInputElement;
  const custSearchInput = document.getElementById("input-cust-search") as HTMLInputElement;

  if (nameInput) nameInput.value = "";
  if (mobileInput) mobileInput.value = "";
  if (addressInput) addressInput.value = "";
  if (emailInput) emailInput.value = "";
  if (custSearchInput) custSearchInput.value = "";
  updateCustomerBadge("Patient: Not Selected");

  // Clear Prescription inputs
  const rxFieldIds = [
    "rx-od-sph", "rx-od-cyl", "rx-od-axis", "rx-od-add", "rx-od-va",
    "rx-os-sph", "rx-os-cyl", "rx-os-axis", "rx-os-add", "rx-os-va",
    "rx-pd", "rx-notes", "input-custom-lens-name", "input-custom-lens-price"
  ];
  rxFieldIds.forEach(id => {
    const el = document.getElementById(id) as HTMLInputElement;
    if (el) el.value = "";
  });

  // Reset Eye Side radio to Both
  selectedEyeSide = "Both";
  const radioBoth = document.querySelector('input[name="lens-eye-side"][value="Both"]') as HTMLInputElement;
  if (radioBoth) radioBoth.checked = true;

  // Reset Eye Side UI
  const badgeEyeStatus = document.getElementById("badge-eye-side-status");
  const labelBoth = document.getElementById("label-eye-both");
  const labelRe = document.getElementById("label-eye-re");
  const labelLe = document.getElementById("label-eye-le");
  const containerOd = document.getElementById("container-rx-od");
  const containerOs = document.getElementById("container-rx-os");
  const badgeOdStatus = document.getElementById("badge-od-status");
  const badgeOsStatus = document.getElementById("badge-os-status");
  const hintOdDisabled = document.getElementById("hint-od-disabled");
  const hintOsDisabled = document.getElementById("hint-os-disabled");
  const addLensLabel = document.getElementById("btn-add-lens-label");

  labelBoth?.classList.add("border-blue-600", "shadow-2xs");
  labelBoth?.classList.remove("border-slate-200");
  labelRe?.classList.remove("border-emerald-600", "shadow-2xs");
  labelRe?.classList.add("border-slate-200");
  labelLe?.classList.remove("border-purple-600", "shadow-2xs");
  labelLe?.classList.add("border-slate-200");

  if (badgeEyeStatus) {
    badgeEyeStatus.innerText = "Both Eyes (Pair - RE & LE)";
    badgeEyeStatus.className = "text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-300 self-start sm:self-auto";
  }
  containerOd?.classList.remove("opacity-50", "bg-slate-100/70", "border-emerald-500", "bg-emerald-50/30");
  containerOd?.classList.add("border-blue-200", "bg-slate-50");
  if (badgeOdStatus) {
    badgeOdStatus.innerText = "Active";
    badgeOdStatus.className = "text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800";
  }
  hintOdDisabled?.classList.add("hidden");

  containerOs?.classList.remove("opacity-50", "bg-slate-100/70", "border-purple-500", "bg-purple-50/30");
  containerOs?.classList.add("border-blue-200", "bg-slate-50");
  if (badgeOsStatus) {
    badgeOsStatus.innerText = "Active";
    badgeOsStatus.className = "text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800";
  }
  hintOsDisabled?.classList.add("hidden");
  if (addLensLabel) addLensLabel.innerText = "+ Add Pair (RE + LE) Lens to Cart";

  // Clear Discount Inputs & state
  posDiscountValue = 0;
  posDiscountReason = "";
  posDiscountType = "fixed";
  const discValueInput = document.getElementById("input-pos-discount-value") as HTMLInputElement;
  const discReasonInput = document.getElementById("input-pos-disc-reason") as HTMLInputElement;
  const radioFixedDisc = document.querySelector('input[name="pos-discount-mode"][value="fixed"]') as HTMLInputElement;
  if (discValueInput) discValueInput.value = "";
  if (discReasonInput) discReasonInput.value = "";
  if (radioFixedDisc) radioFixedDisc.checked = true;
  updateDiscountModeUI();

  // Clear Cart & notes
  cart = [];
  renderCartTable();
  const notesTextarea = document.getElementById("sale-notes") as HTMLTextAreaElement;
  if (notesTextarea) notesTextarea.value = "";

  // Clear Advance input & recalculate
  const advanceInput = document.getElementById("input-advance-amount") as HTMLInputElement;
  if (advanceInput) {
    advanceInput.value = "";
    delete advanceInput.dataset.userModified;
  }
  recalculateTotals();

  // Close Advance Receipt Modal
  document.getElementById("modal-advance-receipt")?.classList.add("hidden");

  // Focus on customer search
  setTimeout(() => {
    if (custSearchInput) {
      custSearchInput.focus();
    } else if (nameInput) {
      nameInput.focus();
    }
  }, 100);

  Toast.show("POS Counter reset — Ready for new sale / order!", "info");
}

function renderAdvanceReceiptModalContent(data: any, rx: Prescription | null) {
  const content = document.getElementById("receipt-modal-content");
  if (!content) return;

  const currentStore = activeStoreSettings?.storeName || storeName || "OPTIWAY VISION CARE";
  const address = activeStoreSettings?.address || "742 Vision Avenue, Suite 100, New York, NY 10001";
  const phone = activeStoreSettings?.phone || "+1 800-555-0199";

  content.innerHTML = `
    <!-- Success Banner inside Receipt Preview -->
    <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center space-y-1">
      <div class="inline-flex items-center gap-1.5 text-xs font-black text-emerald-900">
        <svg class="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
        <span>Advance Receipt Generated Successfully</span>
      </div>
      <p class="text-[11px] text-emerald-800 font-medium">
        Advance payment of <strong>RS ${(data.advanceAmount || 0).toFixed(2)}</strong> logged for <strong>${data.customerName || "Customer"}</strong>. Balance Due: <strong>RS ${(data.pendingAmount || 0).toFixed(2)}</strong>.
      </p>
    </div>

    <div class="text-center border-b border-slate-200 pb-3 pt-1">
      <h2 class="text-base font-extrabold text-slate-900">${currentStore}</h2>
      <p class="text-[11px] text-slate-500">${address} | Ph: ${phone}</p>
      <div class="inline-block mt-1.5 px-3 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-extrabold text-[10px] tracking-wider uppercase">
        ADVANCE PAYMENT RECEIPT
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2 text-[11px] bg-white p-3 rounded-lg border border-slate-200">
      <div><strong>Receipt No:</strong> ${data.receiptNumber || "OPT-REC"}</div>
      <div class="text-right"><strong>Date:</strong> ${data.date || new Date().toISOString().slice(0, 10)}</div>
      <div><strong>Patient:</strong> ${data.customerName || "Walk-in Customer"}</div>
      <div class="text-right"><strong>Mobile:</strong> ${data.customerMobile || "—"}</div>
      <div><strong>Order Ref:</strong> ${data.orderNumber || data.saleNumber || "—"}</div>
      <div class="text-right"><strong>Pay Mode:</strong> ${data.paymentMethod || "Cash"}</div>
    </div>

    ${rx ? `
      <div class="bg-blue-50/70 p-2.5 rounded-lg border border-blue-200 text-[10.5px]">
        <div class="flex justify-between items-center font-bold text-blue-900 mb-1">
          <span>Prescription (Rx) Attached:</span>
          <span class="text-[9.5px] px-2 py-0.5 rounded font-extrabold ${rx.eyeSide === "RE" ? "bg-emerald-100 text-emerald-800 border border-emerald-300" : rx.eyeSide === "LE" ? "bg-purple-100 text-purple-800 border border-purple-300" : "bg-blue-100 text-blue-800 border border-blue-300"}">
            ${rx.eyeSide === "RE" ? "Right Eye (RE) Only" : rx.eyeSide === "LE" ? "Left Eye (LE) Only" : "Pair (RE + LE)"}
          </span>
        </div>
        ${rx.eyeSide !== "LE" ? `<div><strong>Right Eye (RE / OD):</strong> SPH ${rx.rightEye?.sph || "0.00"} | CYL ${rx.rightEye?.cyl || "0.00"} | AXIS ${rx.rightEye?.axis || "0"}° | ADD +${rx.rightEye?.add || "0.00"}</div>` : `<div class="text-slate-400 italic">Right Eye (RE / OD): N/A (Single Left Eye lens order)</div>`}
        ${rx.eyeSide !== "RE" ? `<div><strong>Left Eye (LE / OS):</strong> SPH ${rx.leftEye?.sph || "0.00"} | CYL ${rx.leftEye?.cyl || "0.00"} | AXIS ${rx.leftEye?.axis || "0"}° | ADD +${rx.leftEye?.add || "0.00"}</div>` : `<div class="text-slate-400 italic">Left Eye (LE / OS): N/A (Single Right Eye lens order)</div>`}
        <div class="mt-0.5 text-slate-600">PD: ${rx.pd ? rx.pd + " mm" : "Standard"}</div>
      </div>
    ` : ""}

    <div class="space-y-1 bg-white p-3 rounded-lg border border-slate-200 text-[11px]">
      <strong class="block text-slate-800 border-b border-slate-100 pb-1 mb-1">Booked Items:</strong>
      ${data.items && data.items.length > 0 ? data.items.map((i: any) => `
        <div class="flex justify-between py-0.5">
          <span>${i.productName || "Item"} (x${i.quantity || 1})</span>
          <span class="font-bold">RS ${(i.total || i.price * (i.quantity || 1) || 0).toFixed(2)}</span>
        </div>
      `).join("") : '<p class="text-slate-400">No items listed</p>'}
    </div>

    <div class="p-3 bg-white rounded-lg border border-slate-200 text-xs space-y-1.5">
      <div class="flex justify-between text-slate-600">
        <span>Total Order Value:</span>
        <span class="font-bold text-slate-900">RS ${(data.grandTotal || 0).toFixed(2)}</span>
      </div>
      ${(data.discountTotal || 0) > 0 ? `
      <div class="flex justify-between text-rose-700 font-semibold">
        <span>Discount Concession:</span>
        <span>-RS ${(data.discountTotal || 0).toFixed(2)}</span>
      </div>
      ` : ""}
      <div class="flex justify-between text-emerald-800 bg-emerald-50 p-1.5 rounded font-extrabold border border-emerald-200">
        <span>Advance Amount Paid:</span>
        <span>RS ${(data.advanceAmount || 0).toFixed(2)}</span>
      </div>
      <div class="flex justify-between text-amber-900 bg-amber-50 p-1.5 rounded font-extrabold border border-amber-200">
        <span>Remaining Balance Due:</span>
        <span>RS ${(data.pendingAmount || 0).toFixed(2)}</span>
      </div>
    </div>

    <p class="text-[10px] text-slate-400 text-center italic">
      Please present this advance receipt at the time of eyewear delivery and balance payment.
    </p>
  `;
}
