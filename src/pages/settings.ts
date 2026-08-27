import { initAuthGuard } from "../lib/auth";
import { renderAppLayout, Toast } from "../components/layout";
import { dbService, StoreSettings } from "../lib/db";
import { uploadImageToCloudinary } from "../lib/cloudinary";
import { THEME_COLOR_PRESETS, DEFAULT_THEME_COLOR, applyThemeColor } from "../lib/theme";

let activeThemeColor = DEFAULT_THEME_COLOR;

initAuthGuard({
  onUserReady: async (user) => {
    renderAppLayout("settings", "Store Settings", user);
    await loadSettingsData();
  }
});

async function loadSettingsData() {
  try {
    const settings = await dbService.getSettings();

    const nameInput = document.getElementById("set-store-name") as HTMLInputElement;
    const phoneInput = document.getElementById("set-phone") as HTMLInputElement;
    const emailInput = document.getElementById("set-email") as HTMLInputElement;
    const addressInput = document.getElementById("set-address") as HTMLInputElement;
    const gstInput = document.getElementById("set-gst-number") as HTMLInputElement;
    const taxRateInput = document.getElementById("set-tax-rate") as HTMLInputElement;
    const taxModeSelect = document.getElementById("set-tax-mode") as HTMLSelectElement;
    const invPrefixInput = document.getElementById("set-inv-prefix") as HTMLInputElement;
    const recPrefixInput = document.getElementById("set-rec-prefix") as HTMLInputElement;
    const logoUrlInput = document.getElementById("set-logo-url") as HTMLInputElement;

    if (nameInput) nameInput.value = settings.storeName || "OPTIWAY Vision Care";
    if (phoneInput) phoneInput.value = settings.phone || "+1 800-555-0199";
    if (emailInput) emailInput.value = settings.email || "contact@optiway.com";
    if (addressInput) addressInput.value = settings.address || "742 Vision Avenue, Suite 100, New York, NY 10001";
    if (gstInput) gstInput.value = settings.gstNumber || "";
    if (taxRateInput) taxRateInput.value = String(typeof settings.taxRate === "number" ? settings.taxRate : 18);
    if (taxModeSelect) taxModeSelect.value = settings.defaultBillingTaxMode || "with_tax";
    if (invPrefixInput) invPrefixInput.value = settings.invoicePrefix || "OPT-INV-";
    if (recPrefixInput) recPrefixInput.value = settings.receiptPrefix || "OPT-REC-";
    if (logoUrlInput) logoUrlInput.value = settings.logoUrl || "";

    activeThemeColor = settings.themeColor || localStorage.getItem("optiway_theme_color") || DEFAULT_THEME_COLOR;
    applyThemeColor(activeThemeColor);
    renderThemePalette();

    updateLivePreview();
    setupEvents();
  } catch (err) {
    console.error("Failed to load store settings:", err);
    Toast.show("Failed to load store configuration.", "error");
  }
}

function renderThemePalette() {
  const container = document.getElementById("theme-color-palette-grid");
  const hexInput = document.getElementById("set-theme-hex-input") as HTMLInputElement;
  const colorPicker = document.getElementById("set-custom-theme-picker") as HTMLInputElement;
  const label = document.getElementById("theme-selected-label");

  if (hexInput) hexInput.value = activeThemeColor.toUpperCase();
  if (colorPicker) colorPicker.value = activeThemeColor;
  if (label) {
    label.innerText = activeThemeColor.toUpperCase();
    label.style.borderColor = activeThemeColor;
    label.style.color = activeThemeColor;
  }

  if (!container) return;

  container.innerHTML = THEME_COLOR_PRESETS.map(preset => {
    const isSelected = preset.hex.toLowerCase() === activeThemeColor.toLowerCase();
    return `
      <button type="button" 
        data-hex="${preset.hex}" 
        title="${preset.name} (${preset.hex})" 
        class="theme-color-swatch group relative w-full aspect-square rounded-xl transition-all transform hover:scale-110 active:scale-95 flex items-center justify-center cursor-pointer shadow-xs ${isSelected ? "ring-3 ring-offset-2 ring-slate-900 scale-105" : "hover:shadow-md"}" 
        style="background-color: ${preset.hex};">
        ${isSelected ? `
          <svg class="w-4 h-4 text-white drop-shadow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path>
          </svg>
        ` : `
          <span class="opacity-0 group-hover:opacity-100 transition-opacity absolute inset-0 rounded-xl bg-black/15 flex items-center justify-center"></span>
        `}
      </button>
    `;
  }).join("");

  // Attach click listeners to palette swatches
  container.querySelectorAll(".theme-color-swatch").forEach(btn => {
    btn.addEventListener("click", () => {
      const hex = btn.getAttribute("data-hex");
      if (hex) {
        setThemeColor(hex);
      }
    });
  });
}

function setThemeColor(hex: string) {
  if (!hex.startsWith("#")) hex = `#${hex}`;
  activeThemeColor = hex;
  applyThemeColor(hex);
  renderThemePalette();
  updateLivePreview();
}

function updateLivePreview() {
  const name = (document.getElementById("set-store-name") as HTMLInputElement)?.value.trim() || "OPTIWAY VISION CARE";
  const phone = (document.getElementById("set-phone") as HTMLInputElement)?.value.trim() || "+1 800-555-0199";
  const email = (document.getElementById("set-email") as HTMLInputElement)?.value.trim() || "contact@optiway.com";
  const address = (document.getElementById("set-address") as HTMLInputElement)?.value.trim() || "742 Vision Avenue, Suite 100, New York, NY 10001";
  const gst = (document.getElementById("set-gst-number") as HTMLInputElement)?.value.trim() || "";
  const logoUrl = (document.getElementById("set-logo-url") as HTMLInputElement)?.value.trim() || "";

  const previewName = document.getElementById("preview-store-name");
  const previewAddress = document.getElementById("preview-store-address");
  const previewContact = document.getElementById("preview-store-contact");
  const previewGst = document.getElementById("preview-store-gst");
  const previewLogoBox = document.getElementById("preview-logo-box");
  const previewLogoImg = document.getElementById("preview-logo-img") as HTMLImageElement;

  if (previewName) previewName.innerText = name.toUpperCase();
  if (previewAddress) previewAddress.innerText = address;
  if (previewContact) previewContact.innerText = `Ph: ${phone} | ${email}`;
  
  if (previewGst) {
    if (gst) {
      previewGst.innerText = `GSTIN: ${gst}`;
      previewGst.classList.remove("hidden");
    } else {
      previewGst.classList.add("hidden");
    }
  }

  if (previewLogoBox && previewLogoImg) {
    if (logoUrl) {
      previewLogoImg.src = logoUrl;
      previewLogoBox.classList.remove("hidden");
    } else {
      previewLogoBox.classList.add("hidden");
    }
  }
}

function setupEvents() {
  const logoFile = document.getElementById("set-logo-file") as HTMLInputElement;
  const logoUrlInput = document.getElementById("set-logo-url") as HTMLInputElement;
  const progress = document.getElementById("set-logo-progress")!;
  const saveBtn = document.getElementById("btn-save-settings") as HTMLButtonElement;
  const saveText = document.getElementById("btn-save-text");
  const statusMsg = document.getElementById("save-status-msg");
  const colorPicker = document.getElementById("set-custom-theme-picker") as HTMLInputElement;
  const hexInput = document.getElementById("set-theme-hex-input") as HTMLInputElement;
  const resetThemeBtn = document.getElementById("btn-reset-theme-default");

  // Real-time Live Preview binding
  const watchInputs = [
    "set-store-name", "set-phone", "set-email", "set-address", "set-gst-number", "set-logo-url"
  ];
  watchInputs.forEach(id => {
    document.getElementById(id)?.addEventListener("input", updateLivePreview);
  });

  // Custom Color Picker input
  colorPicker?.addEventListener("input", (e) => {
    const val = (e.target as HTMLInputElement).value;
    setThemeColor(val);
  });

  // Hex Text Input
  hexInput?.addEventListener("input", (e) => {
    let val = (e.target as HTMLInputElement).value.trim();
    if (!val.startsWith("#")) val = `#${val}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      setThemeColor(val);
    }
  });

  // Reset Theme Button
  resetThemeBtn?.addEventListener("click", () => {
    setThemeColor(DEFAULT_THEME_COLOR);
    Toast.show("Theme reset to Optiway Royal Blue", "info");
  });

  logoFile?.addEventListener("change", async () => {
    if (!logoFile.files || logoFile.files.length === 0) return;

    progress.classList.remove("hidden");
    progress.innerText = "Uploading logo to Cloudinary...";

    try {
      const url = await uploadImageToCloudinary(logoFile.files[0], (pct) => {
        progress.innerText = `Uploading logo... ${pct}%`;
      });
      logoUrlInput.value = url;
      progress.innerText = "Logo uploaded successfully!";
      updateLivePreview();
      Toast.show("Logo uploaded successfully.", "success");
    } catch (err: any) {
      console.error(err);
      progress.innerText = "Upload failed.";
      Toast.show(err.message || "Failed to upload logo.", "error");
    }
  });

  document.getElementById("form-settings")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (saveBtn) saveBtn.disabled = true;
    if (saveText) saveText.innerText = "Saving settings...";

    try {
      const taxVal = parseFloat((document.getElementById("set-tax-rate") as HTMLInputElement).value);
      const payload: StoreSettings = {
        storeName: (document.getElementById("set-store-name") as HTMLInputElement).value.trim(),
        phone: (document.getElementById("set-phone") as HTMLInputElement).value.trim(),
        email: (document.getElementById("set-email") as HTMLInputElement).value.trim(),
        address: (document.getElementById("set-address") as HTMLInputElement).value.trim(),
        gstNumber: (document.getElementById("set-gst-number") as HTMLInputElement).value.trim(),
        taxRate: isNaN(taxVal) ? 18 : taxVal,
        defaultBillingTaxMode: ((document.getElementById("set-tax-mode") as HTMLSelectElement)?.value as any) || "with_tax",
        invoicePrefix: (document.getElementById("set-inv-prefix") as HTMLInputElement).value.trim() || "OPT-INV-",
        receiptPrefix: (document.getElementById("set-rec-prefix") as HTMLInputElement).value.trim() || "OPT-REC-",
        logoUrl: logoUrlInput.value.trim(),
        themeColor: activeThemeColor
      };

      await dbService.saveSettings(payload);
      applyThemeColor(activeThemeColor);
      updateLivePreview();

      if (statusMsg) {
        statusMsg.classList.remove("hidden");
        setTimeout(() => statusMsg.classList.add("hidden"), 4000);
      }

      Toast.show(`Store details & theme color updated!`, "success");
    } catch (err: any) {
      console.error("Save settings failed:", err);
      Toast.show("Failed to update store settings.", "error");
    } finally {
      if (saveBtn) saveBtn.disabled = false;
      if (saveText) saveText.innerText = "Save Store Settings";
    }
  });

  document.getElementById("btn-reseed-data")?.addEventListener("click", async () => {
    if (confirm("Reset and populate database with sample store records?")) {
      await dbService.seedInitialData();
      Toast.show("Database re-seeded with demo records.", "success");
      setTimeout(() => window.location.reload(), 800);
    }
  });
}

