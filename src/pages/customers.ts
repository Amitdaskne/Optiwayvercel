import { initAuthGuard } from "../lib/auth";
import { renderAppLayout, Toast } from "../components/layout";
import { dbService, Customer, Sale, Prescription } from "../lib/db";
import { downloadPrescriptionPDF } from "../lib/exportUtils";

let customersList: Customer[] = [];
let editingCustomerId: string | null = null;

initAuthGuard({
  onUserReady: async (user) => {
    renderAppLayout("customers", "Customers Directory", user);
    await loadCustomersData();
  }
});

async function loadCustomersData() {
  try {
    customersList = await dbService.getList<Customer>("customers");
    renderCustomersTable();
    setupEvents();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("action") === "add") {
      openAddCustomerModal();
    }
  } catch (err) {
    console.error("Failed to load customers:", err);
    Toast.show("Failed to load customer list.", "error");
  }
}

function renderCustomersTable() {
  const tbody = document.getElementById("tbl-customers-body")!;
  const query = (document.getElementById("cust-search") as HTMLInputElement)?.value.trim().toLowerCase() || "";

  const filtered = customersList.filter(c => 
    (c.name || "").toLowerCase().includes(query) ||
    (c.mobile || (c as any).phone || "").includes(query) ||
    (c.email || "").toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">No customers found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => `
    <tr class="hover:bg-slate-50 transition-colors">
      <td class="p-3.5 font-bold text-slate-900">${c.name}</td>
      <td class="p-3.5 font-medium text-slate-800">${c.mobile}</td>
      <td class="p-3.5 text-slate-500">${c.email || "—"}</td>
      <td class="p-3.5 text-slate-500 truncate max-w-xs">${c.address || "—"}</td>
      <td class="p-3.5 ${c.outstandingBalance > 0 ? "text-amber-700 font-bold" : "text-slate-400"}">RS ${(c.outstandingBalance || 0).toFixed(2)}</td>
      <td class="p-3.5 text-slate-500">${c.lastPurchaseDate ? c.lastPurchaseDate.slice(0, 10) : "—"}</td>
      <td class="p-3.5 text-right space-x-2">
        <button class="btn-hist-cust font-bold text-blue-600 hover:underline" data-id="${c.id}">History</button>
        <button class="btn-edit-cust font-bold text-slate-700 hover:underline" data-id="${c.id}">Edit</button>
        <button class="btn-del-cust font-bold text-rose-600 hover:underline" data-id="${c.id}">Delete</button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btn-hist-cust").forEach(btn => {
    btn.addEventListener("click", () => openHistoryModal(btn.getAttribute("data-id")!));
  });

  tbody.querySelectorAll(".btn-edit-cust").forEach(btn => {
    btn.addEventListener("click", () => openEditCustomerModal(btn.getAttribute("data-id")!));
  });

  tbody.querySelectorAll(".btn-del-cust").forEach(btn => {
    btn.addEventListener("click", () => deleteCustomer(btn.getAttribute("data-id")!));
  });
}

function setupEvents() {
  document.getElementById("cust-search")?.addEventListener("input", renderCustomersTable);
  document.getElementById("btn-open-add-cust")?.addEventListener("click", openAddCustomerModal);
  document.getElementById("btn-close-cust-modal")?.addEventListener("click", closeCustomerModal);
  document.getElementById("btn-cancel-cust-modal")?.addEventListener("click", closeCustomerModal);
  document.getElementById("btn-close-hist-modal")?.addEventListener("click", closeHistoryModal);

  document.getElementById("form-cust")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = (document.getElementById("cust-field-name") as HTMLInputElement).value.trim();
    const mobile = (document.getElementById("cust-field-mobile") as HTMLInputElement).value.trim();
    const email = (document.getElementById("cust-field-email") as HTMLInputElement).value.trim();
    const address = (document.getElementById("cust-field-address") as HTMLInputElement).value.trim();

    if (!name || !mobile) {
      Toast.show("Name and mobile phone are required.", "error");
      return;
    }

    const payload: Partial<Customer> = {
      id: editingCustomerId || undefined,
      name,
      mobile,
      email,
      address,
      outstandingBalance: editingCustomerId 
        ? customersList.find(c => c.id === editingCustomerId)?.outstandingBalance || 0 
        : 0,
      createdAt: new Date().toISOString()
    };

    await dbService.saveItem("customers", payload);
    Toast.show(`Customer ${name} saved successfully.`, "success");
    closeCustomerModal();
    await loadCustomersData();
  });
}

function openAddCustomerModal() {
  editingCustomerId = null;
  document.getElementById("modal-cust-title")!.innerText = "Add New Customer";
  (document.getElementById("cust-field-name") as HTMLInputElement).value = "";
  (document.getElementById("cust-field-mobile") as HTMLInputElement).value = "";
  (document.getElementById("cust-field-email") as HTMLInputElement).value = "";
  (document.getElementById("cust-field-address") as HTMLInputElement).value = "";
  document.getElementById("modal-cust")?.classList.remove("hidden");
}

function openEditCustomerModal(id: string) {
  const match = customersList.find(c => c.id === id);
  if (!match) return;

  editingCustomerId = id;
  document.getElementById("modal-cust-title")!.innerText = "Edit Customer Details";
  (document.getElementById("cust-field-name") as HTMLInputElement).value = match.name;
  (document.getElementById("cust-field-mobile") as HTMLInputElement).value = match.mobile;
  (document.getElementById("cust-field-email") as HTMLInputElement).value = match.email || "";
  (document.getElementById("cust-field-address") as HTMLInputElement).value = match.address || "";
  document.getElementById("modal-cust")?.classList.remove("hidden");
}

function closeCustomerModal() {
  document.getElementById("modal-cust")?.classList.add("hidden");
  editingCustomerId = null;
}

async function openHistoryModal(customerId: string) {
  const customer = customersList.find(c => c.id === customerId);
  if (!customer) return;

  document.getElementById("hist-cust-name")!.innerText = customer.name;
  document.getElementById("hist-cust-info")!.innerText = `${customer.mobile} | ${customer.email || "No email"}`;

  const sales = await dbService.getList<Sale>("sales");
  const prescriptions = await dbService.getList<Prescription>("prescriptions");

  const customerSales = sales.filter(s => s.customerId === customerId);
  const customerRx = prescriptions.filter(r => r.customerId === customerId);
  const targetCustomer = customersList.find(c => c.id === customerId);

  const modalContent = document.getElementById("hist-modal-content")!;
  modalContent.innerHTML = `
    <!-- Prescription Section -->
    <div class="space-y-2">
      <h4 class="font-bold text-slate-800 uppercase text-[10px] tracking-wider border-b border-slate-200 pb-1">Prescription History</h4>
      ${customerRx.length === 0 ? '<p class="text-slate-400 py-1">No recorded prescriptions found.</p>' : customerRx.map(rx => `
        <div class="p-3 bg-blue-50/60 rounded-lg border border-blue-100 space-y-1.5">
          <div class="flex justify-between items-center font-bold text-blue-900">
            <span>Date: ${rx.prescriptionDate}</span>
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-slate-600">PD: ${rx.pd || "N/A"} mm</span>
              <button class="btn-cust-hist-rx-pdf px-2 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-[11px] rounded border border-rose-200 flex items-center gap-1 cursor-pointer transition-colors" data-rx-id="${rx.id}">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                <span>Download PDF</span>
              </button>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2 text-[11px] bg-white/70 p-2 rounded border border-blue-100/70">
            <div><strong class="text-blue-950">OD:</strong> Sph ${rx.rightEye.sph}, Cyl ${rx.rightEye.cyl}, Axis ${rx.rightEye.axis}, Add ${rx.rightEye.add || "0.00"}</div>
            <div><strong class="text-indigo-950">OS:</strong> Sph ${rx.leftEye.sph}, Cyl ${rx.leftEye.cyl}, Axis ${rx.leftEye.axis}, Add ${rx.leftEye.add || "0.00"}</div>
          </div>
          ${rx.notes ? `<p class="text-slate-500 italic text-[10px]">Notes: ${rx.notes}</p>` : ""}
        </div>
      `).join("")}
    </div>

    <!-- Purchase History Section -->
    <div class="space-y-2 pt-2">
      <h4 class="font-bold text-slate-800 uppercase text-[10px] tracking-wider border-b border-slate-200 pb-1">Purchase & Sales History</h4>
      ${customerSales.length === 0 ? '<p class="text-slate-400 py-1">No previous purchase records found.</p>' : customerSales.map(s => `
        <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 flex justify-between items-center">
          <div>
            <span class="font-bold text-slate-900 block">${s.saleNumber} (${s.saleDate})</span>
            <span class="text-slate-500 text-[11px]">${s.items.map(i => i.productName).join(", ")}</span>
          </div>
          <div class="text-right">
            <span class="font-bold text-slate-900 block">RS ${(s.grandTotal || 0).toFixed(2)}</span>
            <span class="text-[10px] ${(s.pendingAmount || 0) > 0 ? "text-amber-700 font-bold" : "text-emerald-700"}">
              ${(s.pendingAmount || 0) > 0 ? `Pending: RS ${(s.pendingAmount || 0).toFixed(2)}` : "Fully Paid"}
            </span>
          </div>
        </div>
      `).join("")}
    </div>
  `;

  modalContent.querySelectorAll(".btn-cust-hist-rx-pdf").forEach(btn => {
    btn.addEventListener("click", async () => {
      const rxId = btn.getAttribute("data-rx-id");
      const matchRx = customerRx.find(r => r.id === rxId);
      if (!matchRx) return;
      Toast.show("Generating prescription PDF...", "info");
      try {
        const settings = await dbService.getSettings();
        await downloadPrescriptionPDF(matchRx, targetCustomer || null, settings);
        Toast.show("Prescription PDF downloaded.", "success");
      } catch (err) {
        console.error(err);
        Toast.show("Failed to download prescription PDF.", "error");
      }
    });
  });

  document.getElementById("modal-cust-history")?.classList.remove("hidden");
}

function closeHistoryModal() {
  document.getElementById("modal-cust-history")?.classList.add("hidden");
}

async function deleteCustomer(id: string) {
  const cust = customersList.find(c => c.id === id);
  if (!cust) return;

  if (confirm(`Are you sure you want to delete customer record for "${cust.name}"?`)) {
    await dbService.deleteItem("customers", id);
    Toast.show(`Customer ${cust.name} deleted.`, "success");
    await loadCustomersData();
  }
}
