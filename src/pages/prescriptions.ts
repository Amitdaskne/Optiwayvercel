import { initAuthGuard } from "../lib/auth";
import { renderAppLayout, Toast } from "../components/layout";
import { dbService, Prescription, Customer, StoreSettings } from "../lib/db";
import { downloadPrescriptionPDF, downloadPrescriptionListPDF } from "../lib/exportUtils";
import { sendPrescriptionWhatsAppPrompt } from "../lib/whatsapp";

let rxList: Prescription[] = [];
let customerList: Customer[] = [];
let storeSettings: StoreSettings | null = null;
let editingRxId: string | null = null;

initAuthGuard({
  onUserReady: async (user) => {
    renderAppLayout("prescriptions", "Prescriptions Management", user);
    await loadRxData();
  }
});

async function loadRxData() {
  try {
    const [prescriptions, customers, settings] = await Promise.all([
      dbService.getList<Prescription>("prescriptions"),
      dbService.getList<Customer>("customers"),
      dbService.getSettings()
    ]);

    rxList = prescriptions;
    customerList = customers;
    storeSettings = settings;

    renderRxTable();
    populateCustomerDropdown();
    setupEvents();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("action") === "add") {
      openAddRxModal();
    }
  } catch (err) {
    console.error("Failed to load prescriptions:", err);
    Toast.show("Failed to load prescription database.", "error");
  }
}

function renderRxTable() {
  const tbody = document.getElementById("tbl-rx-body")!;
  const query = (document.getElementById("rx-search") as HTMLInputElement)?.value.trim().toLowerCase() || "";

  const filtered = rxList.filter(r =>
    (r.customerName || "").toLowerCase().includes(query) ||
    (r.prescriptionDate || "").includes(query) ||
    (r.notes || "").toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">No prescriptions found.</td></tr>`;
    return;
  }

  const sorted = [...filtered].sort((a, b) => new Date(b.prescriptionDate || b.createdAt || 0).getTime() - new Date(a.prescriptionDate || a.createdAt || 0).getTime());

  tbody.innerHTML = sorted.map(r => `
    <tr class="hover:bg-slate-50 transition-colors">
      <td class="p-3.5 font-medium text-slate-700 whitespace-nowrap">${r.prescriptionDate || "—"}</td>
      <td class="p-3.5 font-bold text-slate-900">${r.customerName || "Walk-in Patient"}</td>
      <td class="p-3.5 text-xs text-blue-900 bg-blue-50/50">
        <div class="font-semibold">SPH: <span class="font-bold">${r.rightEye.sph || "0.00"}</span> | CYL: ${r.rightEye.cyl || "0.00"}</div>
        <div class="text-[11px] text-blue-700">AXIS: ${r.rightEye.axis || "—"} | ADD: ${r.rightEye.add || "—"}</div>
      </td>
      <td class="p-3.5 text-xs text-indigo-900 bg-indigo-50/50">
        <div class="font-semibold">SPH: <span class="font-bold">${r.leftEye.sph || "0.00"}</span> | CYL: ${r.leftEye.cyl || "0.00"}</div>
        <div class="text-[11px] text-indigo-700">AXIS: ${r.leftEye.axis || "—"} | ADD: ${r.leftEye.add || "—"}</div>
      </td>
      <td class="p-3.5 font-bold text-slate-800">${r.pd || "—"} mm</td>
      <td class="p-3.5 text-slate-500 italic max-w-xs truncate">${r.notes || "—"}</td>
      <td class="p-3.5 text-right whitespace-nowrap">
        <div class="inline-flex items-center gap-1.5">
          <button class="btn-whatsapp-rx px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-xs rounded border border-emerald-300 flex items-center gap-1 cursor-pointer transition-colors shadow-2xs" data-id="${r.id}" title="Send Prescription to Patient on WhatsApp">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span>WhatsApp</span>
          </button>
          <button class="btn-pdf-rx px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded border border-rose-200 flex items-center gap-1 cursor-pointer transition-colors shadow-2xs" data-id="${r.id}" title="Download Prescription PDF">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            <span>PDF</span>
          </button>
          <button class="btn-edit-rx px-2 py-1 text-blue-600 hover:bg-blue-50 rounded font-semibold text-xs transition-colors" data-id="${r.id}">Edit</button>
          <button class="btn-del-rx px-2 py-1 text-rose-600 hover:bg-rose-50 rounded font-semibold text-xs transition-colors" data-id="${r.id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btn-whatsapp-rx").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id")!;
      const match = rxList.find(r => r.id === id);
      if (!match) return;
      const cust = customerList.find(c => c.id === match.customerId) || null;
      sendPrescriptionWhatsAppPrompt(match, cust?.mobile || "", storeSettings);
    });
  });

  tbody.querySelectorAll(".btn-pdf-rx").forEach(btn => {
    btn.addEventListener("click", () => exportSingleRxPDF(btn.getAttribute("data-id")!));
  });

  tbody.querySelectorAll(".btn-edit-rx").forEach(btn => {
    btn.addEventListener("click", () => openEditRxModal(btn.getAttribute("data-id")!));
  });

  tbody.querySelectorAll(".btn-del-rx").forEach(btn => {
    btn.addEventListener("click", () => deleteRx(btn.getAttribute("data-id")!));
  });
}

async function exportSingleRxPDF(id: string) {
  const match = rxList.find(r => r.id === id);
  if (!match) return;

  const cust = customerList.find(c => c.id === match.customerId) || null;
  Toast.show("Generating optical prescription PDF...", "info");
  try {
    await downloadPrescriptionPDF(match, cust, storeSettings);
    Toast.show(`Prescription PDF downloaded for ${match.customerName || "Patient"}`, "success");
  } catch (err) {
    console.error("PDF generation failed:", err);
    Toast.show("Failed to generate prescription PDF.", "error");
  }
}

function populateCustomerDropdown() {
  const select = document.getElementById("rx-cust-select") as HTMLSelectElement;
  select.innerHTML = customerList.map(c => `<option value="${c.id}">${c.name} (${c.mobile})</option>`).join("");
}

function getFormData(): { payload: Partial<Prescription>; cust: Customer | undefined } | null {
  const custId = (document.getElementById("rx-cust-select") as HTMLSelectElement).value;
  const cust = customerList.find(c => c.id === custId);
  if (!cust) {
    Toast.show("Please select a valid patient.", "error");
    return null;
  }

  const prescriptionDate = (document.getElementById("rx-date") as HTMLInputElement).value || new Date().toISOString().slice(0, 10);

  const payload: Partial<Prescription> = {
    id: editingRxId || undefined,
    customerId: cust.id,
    customerName: cust.name,
    prescriptionDate,
    rightEye: {
      sph: (document.getElementById("rx-m-od-sph") as HTMLInputElement).value || "0.00",
      cyl: (document.getElementById("rx-m-od-cyl") as HTMLInputElement).value || "0.00",
      axis: (document.getElementById("rx-m-od-axis") as HTMLInputElement).value || "0",
      add: (document.getElementById("rx-m-od-add") as HTMLInputElement).value || "0.00",
    },
    leftEye: {
      sph: (document.getElementById("rx-m-os-sph") as HTMLInputElement).value || "0.00",
      cyl: (document.getElementById("rx-m-os-cyl") as HTMLInputElement).value || "0.00",
      axis: (document.getElementById("rx-m-os-axis") as HTMLInputElement).value || "0",
      add: (document.getElementById("rx-m-os-add") as HTMLInputElement).value || "0.00",
    },
    pd: (document.getElementById("rx-m-pd") as HTMLInputElement).value.trim(),
    visualAcuity: (document.getElementById("rx-m-acuity") as HTMLInputElement).value.trim(),
    notes: (document.getElementById("rx-m-notes") as HTMLInputElement).value.trim(),
    createdAt: new Date().toISOString()
  };

  return { payload, cust };
}

function setupEvents() {
  document.getElementById("rx-search")?.addEventListener("input", renderRxTable);
  document.getElementById("btn-open-add-rx")?.addEventListener("click", openAddRxModal);
  document.getElementById("btn-close-rx-modal")?.addEventListener("click", closeRxModal);
  document.getElementById("btn-cancel-rx-modal")?.addEventListener("click", closeRxModal);

  document.getElementById("btn-export-rx-pdf")?.addEventListener("click", async () => {
    if (rxList.length === 0) {
      Toast.show("No prescriptions available to export.", "info");
      return;
    }
    Toast.show("Exporting master prescriptions PDF...", "info");
    try {
      await downloadPrescriptionListPDF(rxList, storeSettings);
      Toast.show("Prescriptions list PDF exported successfully.", "success");
    } catch (err) {
      console.error(err);
      Toast.show("Failed to export prescription list PDF.", "error");
    }
  });

  // Save & WhatsApp button
  document.getElementById("btn-save-whatsapp-rx")?.addEventListener("click", async () => {
    const formData = getFormData();
    if (!formData) return;

    try {
      const savedId = await dbService.saveItem("prescriptions", formData.payload);
      const fullRx: Prescription = {
        ...(formData.payload as Prescription),
        id: savedId || formData.payload.id || "RX"
      };

      Toast.show(`Prescription for ${formData.cust.name} saved.`, "success");
      closeRxModal();
      await loadRxData();

      sendPrescriptionWhatsAppPrompt(fullRx, formData.cust.mobile, storeSettings);
    } catch (err) {
      console.error(err);
      Toast.show("Failed to save and send prescription.", "error");
    }
  });

  // Save & Download PDF button
  document.getElementById("btn-save-download-rx")?.addEventListener("click", async () => {
    const formData = getFormData();
    if (!formData) return;

    try {
      const savedId = await dbService.saveItem("prescriptions", formData.payload);
      const fullRx: Prescription = {
        ...(formData.payload as Prescription),
        id: savedId || formData.payload.id || "RX"
      };

      Toast.show(`Prescription for ${formData.cust.name} saved. Generating PDF...`, "success");
      closeRxModal();
      await loadRxData();

      // Trigger download
      await downloadPrescriptionPDF(fullRx, formData.cust, storeSettings);
      Toast.show("Prescription PDF downloaded.", "success");
    } catch (err) {
      console.error(err);
      Toast.show("Failed to save and generate prescription PDF.", "error");
    }
  });

  document.getElementById("form-rx")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = getFormData();
    if (!formData) return;

    await dbService.saveItem("prescriptions", formData.payload);
    Toast.show(`Prescription for ${formData.cust.name} saved.`, "success");
    closeRxModal();
    await loadRxData();
  });
}

function openAddRxModal() {
  editingRxId = null;
  document.getElementById("modal-rx-title")!.innerText = "New Optical Prescription";
  (document.getElementById("form-rx") as HTMLFormElement).reset();
  (document.getElementById("rx-date") as HTMLInputElement).value = new Date().toISOString().slice(0, 10);
  document.getElementById("modal-rx")?.classList.remove("hidden");
}

function openEditRxModal(id: string) {
  const match = rxList.find(r => r.id === id);
  if (!match) return;

  editingRxId = id;
  document.getElementById("modal-rx-title")!.innerText = "Edit Prescription";
  (document.getElementById("rx-cust-select") as HTMLSelectElement).value = match.customerId;
  (document.getElementById("rx-date") as HTMLInputElement).value = match.prescriptionDate;

  (document.getElementById("rx-m-od-sph") as HTMLInputElement).value = match.rightEye?.sph || "";
  (document.getElementById("rx-m-od-cyl") as HTMLInputElement).value = match.rightEye?.cyl || "";
  (document.getElementById("rx-m-od-axis") as HTMLInputElement).value = match.rightEye?.axis || "";
  (document.getElementById("rx-m-od-add") as HTMLInputElement).value = match.rightEye?.add || "";

  (document.getElementById("rx-m-os-sph") as HTMLInputElement).value = match.leftEye?.sph || "";
  (document.getElementById("rx-m-os-cyl") as HTMLInputElement).value = match.leftEye?.cyl || "";
  (document.getElementById("rx-m-os-axis") as HTMLInputElement).value = match.leftEye?.axis || "";
  (document.getElementById("rx-m-os-add") as HTMLInputElement).value = match.leftEye?.add || "";

  (document.getElementById("rx-m-pd") as HTMLInputElement).value = match.pd || "";
  (document.getElementById("rx-m-acuity") as HTMLInputElement).value = match.visualAcuity || "";
  (document.getElementById("rx-m-notes") as HTMLInputElement).value = match.notes || "";

  document.getElementById("modal-rx")?.classList.remove("hidden");
}

function closeRxModal() {
  document.getElementById("modal-rx")?.classList.add("hidden");
  editingRxId = null;
}

async function deleteRx(id: string) {
  if (confirm("Are you sure you want to delete this optical prescription?")) {
    await dbService.deleteItem("prescriptions", id);
    Toast.show("Prescription deleted.", "success");
    await loadRxData();
  }
}
