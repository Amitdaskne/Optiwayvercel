import { initAuthGuard } from "../lib/auth";
import { renderAppLayout, Toast } from "../components/layout";
import { dbService, Sale, Expense } from "../lib/db";
import {
  generateTodaySalesReportCSV,
  downloadCSV,
  downloadTodayDetailedPDFReport,
  printTodayDetailedReportHTML,
  calculateDailyMetrics
} from "../lib/exportUtils";

initAuthGuard({
  onUserReady: async (user) => {
    renderAppLayout("reports", "Analytics & Reports", user);
    await loadReportsData();
  }
});

async function loadReportsData() {
  try {
    const [sales, expenses] = await Promise.all([
      dbService.getList<Sale>("sales"),
      dbService.getList<Expense>("expenses")
    ]);

    // 1. Calculate Today's Live Detailed Metrics
    const todayStr = new Date().toISOString().slice(0, 10);
    const { metrics: todayMetrics } = calculateDailyMetrics(sales, expenses, todayStr);

    const grossEl = document.getElementById("today-gross-sales");
    const discEl = document.getElementById("today-discounts");
    const netSaleEl = document.getElementById("today-net-sales");
    const expTodayEl = document.getElementById("today-expenses");
    const cashHandEl = document.getElementById("today-cash-in-hand");
    const upiEl = document.getElementById("today-upi-amount");
    const cardEl = document.getElementById("today-card-amount");
    const pendingTodayEl = document.getElementById("today-pending-receivables");

    if (grossEl) grossEl.innerText = `RS ${todayMetrics.grossSales.toFixed(2)}`;
    if (discEl) discEl.innerText = `RS ${todayMetrics.discountTotal.toFixed(2)}`;
    if (netSaleEl) netSaleEl.innerText = `RS ${todayMetrics.netSales.toFixed(2)}`;
    if (expTodayEl) expTodayEl.innerText = `RS ${todayMetrics.totalExpenses.toFixed(2)}`;
    if (cashHandEl) cashHandEl.innerText = `RS ${todayMetrics.cashInHand.toFixed(2)}`;
    if (upiEl) upiEl.innerText = `RS ${todayMetrics.netUPI.toFixed(2)}`;
    if (cardEl) cardEl.innerText = `RS ${todayMetrics.netCard.toFixed(2)}`;
    if (pendingTodayEl) pendingTodayEl.innerText = `RS ${todayMetrics.pendingReceivables.toFixed(2)}`;

    // 2. Calculate All-time summary
    const totalRevenue = sales.reduce((sum, s) => sum + (s.grandTotal || 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netProfit = totalRevenue - totalExpenses;
    const pendingReceivables = sales.reduce((sum, s) => sum + (s.pendingAmount || 0), 0);

    const revEl = document.getElementById("rep-total-revenue");
    const expEl = document.getElementById("rep-total-expenses");
    const netEl = document.getElementById("rep-net-profit");
    const recEl = document.getElementById("rep-pending-receivables");

    if (revEl) revEl.innerText = `RS ${(totalRevenue || 0).toFixed(2)}`;
    if (expEl) expEl.innerText = `RS ${(totalExpenses || 0).toFixed(2)}`;
    if (netEl) netEl.innerText = `RS ${(netProfit || 0).toFixed(2)}`;
    if (recEl) recEl.innerText = `RS ${(pendingReceivables || 0).toFixed(2)}`;

    // Category Breakdown
    const catMap: Record<string, number> = {};
    const payMap: Record<string, number> = {};
    const prodMap: Record<string, { name: string; category: string; qty: number; total: number }> = {};

    sales.forEach(s => {
      const pMethod = s.paymentMethod || "Cash";
      payMap[pMethod] = (payMap[pMethod] || 0) + (s.advanceAmount || s.grandTotal || 0);

      (s.items || []).forEach(item => {
        const cat = item.category || "Frame";
        catMap[cat] = (catMap[cat] || 0) + (item.total || 0);

        if (!prodMap[item.productId]) {
          prodMap[item.productId] = { name: item.productName, category: cat, qty: 0, total: 0 };
        }
        prodMap[item.productId].qty += item.quantity;
        prodMap[item.productId].total += item.total;
      });
    });

    // Render Categories
    const catContainer = document.getElementById("rep-category-list")!;
    const catKeys = Object.keys(catMap);
    if (catKeys.length === 0) {
      catContainer.innerHTML = `<p class="text-slate-400">No category data recorded.</p>`;
    } else {
      catContainer.innerHTML = catKeys.map(k => `
        <div class="flex justify-between items-center p-2 bg-slate-50 rounded border border-slate-100">
          <span class="font-semibold text-slate-800">${k}</span>
          <span class="font-bold text-slate-900">RS ${(catMap[k] || 0).toFixed(2)}</span>
        </div>
      `).join("");
    }

    // Render Payment Methods
    const payContainer = document.getElementById("rep-payment-methods")!;
    const payKeys = Object.keys(payMap);
    if (payKeys.length === 0) {
      payContainer.innerHTML = `<p class="text-slate-400">No payment data recorded.</p>`;
    } else {
      payContainer.innerHTML = payKeys.map(k => `
        <div class="flex justify-between items-center p-2 bg-slate-50 rounded border border-slate-100">
          <span class="font-semibold text-slate-800">${k}</span>
          <span class="font-bold text-emerald-700">RS ${(payMap[k] || 0).toFixed(2)}</span>
        </div>
      `).join("");
    }

    // Render Top Products Table
    const topProds = Object.values(prodMap).sort((a, b) => b.total - a.total).slice(0, 5);
    const tbody = document.getElementById("tbl-top-products")!;
    if (topProds.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-slate-400">No items sold yet.</td></tr>`;
    } else {
      tbody.innerHTML = topProds.map(p => `
        <tr class="hover:bg-slate-50">
          <td class="p-3 font-bold text-slate-900">${p.name || "Item"}</td>
          <td class="p-3 text-slate-600">${p.category || "General"}</td>
          <td class="p-3 font-semibold text-slate-800">${p.qty} units</td>
          <td class="p-3 text-right font-bold text-slate-900">RS ${(p.total || 0).toFixed(2)}</td>
        </tr>
      `).join("");
    }

    // Event Handlers
    const handleDownloadTodayPDF = () => {
      downloadTodayDetailedPDFReport(sales, expenses, todayStr);
      Toast.show("Downloading Today's Detailed Report PDF...", "success");
    };

    document.getElementById("btn-download-today-pdf")?.addEventListener("click", handleDownloadTodayPDF);
    document.getElementById("btn-today-pdf-inner")?.addEventListener("click", handleDownloadTodayPDF);

    document.getElementById("btn-download-today-csv")?.addEventListener("click", () => {
      const csv = generateTodaySalesReportCSV(sales, todayStr);
      downloadCSV(`optiway_today_sales_${todayStr}.csv`, csv);
      Toast.show("Today's sales report downloaded as CSV.", "success");
    });

    document.getElementById("btn-print-today-report")?.addEventListener("click", () => {
      printTodayDetailedReportHTML(sales, expenses, todayStr);
    });

    document.getElementById("btn-print-report")?.addEventListener("click", () => {
      window.print();
    });
  } catch (err) {
    console.error("Failed to load reports:", err);
    Toast.show("Failed to load reports data.", "error");
  }
}
