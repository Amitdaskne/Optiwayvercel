import { initAuthGuard } from "../lib/auth";
import { renderAppLayout, Toast } from "../components/layout";
import { dbService, Supplier, generateUniqueSupplierLedgerId, validateSupplierLedgerId } from "../lib/db";
import { PurchaseBillScanner } from "../lib/purchaseBillScanner";

let suppliersList: Supplier[] = [];
let editingSupplierId: string | null = null;
let isLedgerManuallyEdited = false;

initAuthGuard({
  onUserReady: async (user) => {
    renderAppLayout("suppliers", "Suppliers Directory", user);
    await loadSuppliersData();
  }
});

async function loadSuppliersData() {
  try {
    suppliersList = await dbService.getList<Supplier>("suppliers");
    
    // Ensure data integrity: any existing supplier without a ledgerId gets a unique one assigned
    let updatedAny = false;
    const existingLedgerIds = new Set<string>();
    
    for (const sup of suppliersList) {
      const cleanLedger = (sup.ledgerId || "").trim().toUpperCase();
      if (!cleanLedger || existingLedgerIds.has(cleanLedger)) {
        const uniqueId = generateUniqueSupplierLedgerId(sup.name, suppliersList);
        sup.ledgerId = uniqueId;
        existingLedgerIds.add(uniqueId);
        await dbService.saveItem("suppliers", sup);
        updatedAny = true;
      } else {
        existingLedgerIds.add(cleanLedger);
      }
    }

    if (updatedAny) {
      suppliersList = await dbService.getList<Supplier>("suppliers");
    }

    renderSuppliersTable();
    setupEvents();
  } catch (err) {
    console.error("Failed to load suppliers:", err);
    Toast.show("Failed to load supplier records.", "error");
  }
}

function renderSuppliersTable() {
  const tbody = document.getElementById("tbl-suppliers-body")!;
  const query = (document.getElementById("sup-search") as HTMLInputElement)?.value.trim().toLowerCase() || "";

  const filtered = suppliersList.filter(s =>
    (s.ledgerId || "").toLowerCase().includes(query) ||
    (s.name || "").toLowerCase().includes(query) ||
    (s.contactPerson || "").toLowerCase().includes(query) ||
    (s.mobile || (s as any).phone || "").includes(query) ||
    (s.email || "").toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">No suppliers found matching criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(s => `
    <tr class="hover:bg-slate-50 transition-colors">
      <td class="p-3.5">
        <div class="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-md">
          <span class="font-mono font-bold text-xs text-blue-700 tracking-wide">${s.ledgerId}</span>
          <button title="Copy Ledger ID" class="btn-copy-ledger text-blue-400 hover:text-blue-700 transition-colors cursor-pointer p-0.5" data-ledger="${s.ledgerId}">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
            </svg>
          </button>
        </div>
      </td>
      <td class="p-3.5">
        <div class="font-bold text-slate-900">${s.name}</div>
        ${s.productsSupplied ? `<div class="text-[11px] text-slate-400 truncate max-w-xs">${s.productsSupplied}</div>` : ''}
      </td>
      <td class="p-3.5 text-slate-700">${s.contactPerson || "—"}</td>
      <td class="p-3.5 font-medium text-slate-800">${s.mobile || (s as any).phone || "—"}</td>
      <td class="p-3.5 text-slate-500">${s.email || "—"}</td>
      <td class="p-3.5 text-slate-500 font-mono text-[11px]">${s.taxId || "—"}</td>
      <td class="p-3.5 text-right space-x-2">
        <button class="btn-edit-sup font-bold text-blue-600 hover:underline text-xs cursor-pointer" data-id="${s.id}">Edit</button>
        <button class="btn-del-sup font-bold text-rose-600 hover:underline text-xs cursor-pointer" data-id="${s.id}">Delete</button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btn-copy-ledger").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const ledger = btn.getAttribute("data-ledger");
      if (ledger) {
        navigator.clipboard.writeText(ledger);
        Toast.show(`Copied Ledger ID: ${ledger}`, "info");
      }
    });
  });

  tbody.querySelectorAll(".btn-edit-sup").forEach(btn => {
    btn.addEventListener("click", () => openEditSupplierModal(btn.getAttribute("data-id")!));
  });

  tbody.querySelectorAll(".btn-del-sup").forEach(btn => {
    btn.addEventListener("click", () => deleteSupplier(btn.getAttribute("data-id")!));
  });
}

function checkLiveLedgerValidation() {
  const ledgerInput = document.getElementById("sup-ledger") as HTMLInputElement;
  const valMsg = document.getElementById("ledger-validation-msg");
  const submitBtn = document.getElementById("btn-submit-sup") as HTMLButtonElement;
  if (!ledgerInput || !valMsg) return true;

  const currentVal = ledgerInput.value.trim().toUpperCase();
  
  if (!currentVal) {
    valMsg.innerHTML = `<span class="text-rose-600 font-semibold">⚠️ Supplier Ledger ID is required.</span>`;
    ledgerInput.classList.add("border-rose-400", "bg-rose-50/20");
    ledgerInput.classList.remove("border-emerald-400", "border-slate-300");
    if (submitBtn) submitBtn.disabled = true;
    return false;
  }

  const result = validateSupplierLedgerId(currentVal, editingSupplierId || undefined, suppliersList);

  if (!result.isValid) {
    valMsg.innerHTML = `<span class="text-rose-600 font-bold flex items-center gap-1">❌ ${result.error}</span>`;
    ledgerInput.classList.add("border-rose-400", "bg-rose-50/30");
    ledgerInput.classList.remove("border-emerald-400", "border-slate-300");
    if (submitBtn) submitBtn.disabled = true;
    return false;
  } else {
    valMsg.innerHTML = `<span class="text-emerald-600 font-semibold flex items-center gap-1">✓ Unique Ledger ID '${currentVal}' is available.</span>`;
    ledgerInput.classList.remove("border-rose-400", "bg-rose-50/30");
    ledgerInput.classList.add("border-emerald-400");
    if (submitBtn) submitBtn.disabled = false;
    return true;
  }
}

function setupEvents() {
  document.getElementById("btn-scan-purchase-bill")?.addEventListener("click", () => {
    PurchaseBillScanner.openModal({
      defaultDestination: "live",
      onSuccess: async () => {
        await loadSuppliersData();
      }
    });
  });

  document.getElementById("sup-search")?.addEventListener("input", renderSuppliersTable);
  document.getElementById("btn-open-add-sup")?.addEventListener("click", openAddSupplierModal);
  document.getElementById("btn-close-sup-modal")?.addEventListener("click", closeSupplierModal);
  document.getElementById("btn-cancel-sup-modal")?.addEventListener("click", closeSupplierModal);

  // Auto-generate button inside modal
  document.getElementById("btn-generate-ledger")?.addEventListener("click", () => {
    const nameInput = document.getElementById("sup-name") as HTMLInputElement;
    const ledgerInput = document.getElementById("sup-ledger") as HTMLInputElement;
    const newUniqueId = generateUniqueSupplierLedgerId(nameInput?.value || "", suppliersList);
    ledgerInput.value = newUniqueId;
    isLedgerManuallyEdited = true;
    checkLiveLedgerValidation();
  });

  // Name input listener to auto-suggest unique ledger ID in Add mode
  const nameInput = document.getElementById("sup-name") as HTMLInputElement;
  nameInput?.addEventListener("input", () => {
    if (!editingSupplierId && !isLedgerManuallyEdited) {
      const ledgerInput = document.getElementById("sup-ledger") as HTMLInputElement;
      if (ledgerInput) {
        ledgerInput.value = generateUniqueSupplierLedgerId(nameInput.value, suppliersList);
        checkLiveLedgerValidation();
      }
    }
  });

  // Real-time uniqueness check on typing ledger ID
  const ledgerInput = document.getElementById("sup-ledger") as HTMLInputElement;
  ledgerInput?.addEventListener("input", () => {
    isLedgerManuallyEdited = true;
    checkLiveLedgerValidation();
  });

  document.getElementById("form-sup")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = (document.getElementById("sup-name") as HTMLInputElement).value.trim();
    let ledgerId = (document.getElementById("sup-ledger") as HTMLInputElement).value.trim().toUpperCase();
    const contactPerson = (document.getElementById("sup-contact") as HTMLInputElement).value.trim();
    const mobile = (document.getElementById("sup-mobile") as HTMLInputElement).value.trim();
    const email = (document.getElementById("sup-email") as HTMLInputElement).value.trim();
    const taxId = (document.getElementById("sup-taxid") as HTMLInputElement).value.trim();
    const address = (document.getElementById("sup-address") as HTMLInputElement).value.trim();

    if (!name || !mobile) {
      Toast.show("Company name and mobile phone are required.", "error");
      return;
    }

    if (!ledgerId) {
      ledgerId = generateUniqueSupplierLedgerId(name, suppliersList);
      (document.getElementById("sup-ledger") as HTMLInputElement).value = ledgerId;
    }

    // Strict Uniqueness Check
    const validation = validateSupplierLedgerId(ledgerId, editingSupplierId || undefined, suppliersList);
    if (!validation.isValid) {
      Toast.show(validation.error || "Supplier Ledger ID must be unique.", "error");
      checkLiveLedgerValidation();
      return;
    }

    const payload: Partial<Supplier> = {
      id: editingSupplierId || undefined,
      name,
      ledgerId,
      contactPerson,
      mobile,
      email,
      taxId,
      address,
      createdAt: new Date().toISOString()
    };

    await dbService.saveItem("suppliers", payload);
    Toast.show(`Supplier "${name}" (Ledger ID: ${ledgerId}) saved successfully.`, "success");
    closeSupplierModal();
    await loadSuppliersData();
  });
}

function openAddSupplierModal() {
  editingSupplierId = null;
  isLedgerManuallyEdited = false;
  document.getElementById("modal-sup-title")!.innerText = "Add New Supplier";
  (document.getElementById("form-sup") as HTMLFormElement).reset();
  
  const initialUniqueLedger = generateUniqueSupplierLedgerId("", suppliersList);
  const ledgerInput = document.getElementById("sup-ledger") as HTMLInputElement;
  ledgerInput.value = initialUniqueLedger;
  
  document.getElementById("modal-sup")?.classList.remove("hidden");
  checkLiveLedgerValidation();
}

function openEditSupplierModal(id: string) {
  const match = suppliersList.find(s => s.id === id);
  if (!match) return;

  editingSupplierId = id;
  isLedgerManuallyEdited = true;
  document.getElementById("modal-sup-title")!.innerText = `Edit Supplier: ${match.name}`;
  (document.getElementById("sup-name") as HTMLInputElement).value = match.name;
  (document.getElementById("sup-ledger") as HTMLInputElement).value = match.ledgerId || "";
  (document.getElementById("sup-contact") as HTMLInputElement).value = match.contactPerson || "";
  (document.getElementById("sup-mobile") as HTMLInputElement).value = match.mobile || (match as any).phone || "";
  (document.getElementById("sup-email") as HTMLInputElement).value = match.email || "";
  (document.getElementById("sup-taxid") as HTMLInputElement).value = match.taxId || "";
  (document.getElementById("sup-address") as HTMLInputElement).value = match.address || "";

  document.getElementById("modal-sup")?.classList.remove("hidden");
  checkLiveLedgerValidation();
}

function closeSupplierModal() {
  document.getElementById("modal-sup")?.classList.add("hidden");
  editingSupplierId = null;
  isLedgerManuallyEdited = false;
}

async function deleteSupplier(id: string) {
  const match = suppliersList.find(s => s.id === id);
  if (!match) return;

  if (confirm(`Are you sure you want to delete supplier "${match.name}" (Ledger ID: ${match.ledgerId})?`)) {
    await dbService.deleteItem("suppliers", id);
    Toast.show(`Supplier "${match.name}" removed.`, "success");
    await loadSuppliersData();
  }
}

