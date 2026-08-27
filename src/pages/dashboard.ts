import { initAuthGuard } from "../lib/auth";
import { renderAppLayout, Toast } from "../components/layout";
import { dbService, Sale, Order, Customer, Product, Expense } from "../lib/db";
import { generateTodaySalesReportCSV, downloadCSV, downloadTodayDetailedPDFReport } from "../lib/exportUtils";

initAuthGuard({
  onUserReady: async (user) => {
    renderAppLayout("dashboard", "Dashboard Overview", user);
    await loadDashboardMetrics();
  }
});

async function loadDashboardMetrics() {
  try {
    const [sales, orders, customers, products, expenses] = await Promise.all([
      dbService.getList<Sale>("sales"),
      dbService.getList<Order>("orders"),
      dbService.getList<Customer>("customers"),
      dbService.getList<Product>("products"),
      dbService.getList<Expense>("expenses")
    ]);

    // 1. Calculate Stats
    const totalSalesAmount = sales.reduce((sum, s) => sum + (s.grandTotal || 0), 0);
    const todayStr = new Date().toISOString().slice(0, 10);
    const todaySalesAmount = sales
      .filter(s => s.saleDate === todayStr)
      .reduce((sum, s) => sum + (s.grandTotal || 0), 0);

    const pendingPaymentsAmount = sales.reduce((sum, s) => sum + (s.pendingAmount || 0), 0);
    const pendingOrdersCount = orders.filter(o => o.status !== "Completed" && o.status !== "Cancelled").length;
    const lowStockProducts = products.filter(p => (p.stockQuantity || 0) <= (p.minStockLevel || 5));

    // Update UI Stats
    document.getElementById("stat-total-sales")!.innerText = `RS ${(totalSalesAmount || 0).toFixed(2)}`;
    document.getElementById("stat-today-sales")!.innerText = `RS ${(todaySalesAmount || 0).toFixed(2)}`;
    document.getElementById("stat-pending-payments")!.innerText = `RS ${(pendingPaymentsAmount || 0).toFixed(2)}`;
    document.getElementById("stat-pending-orders")!.innerText = String(pendingOrdersCount);
    document.getElementById("stat-total-customers")!.innerText = String(customers.length);
    document.getElementById("stat-low-stock")!.innerText = String(lowStockProducts.length);

    // 2. Render Recent Sales Table
    const recentSales = [...sales].sort((a, b) => new Date(b.createdAt || b.saleDate).getTime() - new Date(a.createdAt || a.saleDate).getTime()).slice(0, 5);
    const salesTbody = document.getElementById("tbl-recent-sales")!;
    if (recentSales.length === 0) {
      salesTbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400">No sales transactions recorded yet.</td></tr>`;
    } else {
      salesTbody.innerHTML = recentSales.map(s => `
        <tr class="hover:bg-slate-50">
          <td class="py-3 px-4 font-bold text-slate-900">${s.saleNumber}</td>
          <td class="py-3 px-4 font-medium text-slate-800">${s.customerName}</td>
          <td class="py-3 px-4 font-semibold text-slate-900">RS ${(s.grandTotal || 0).toFixed(2)}</td>
          <td class="py-3 px-4 text-emerald-700 font-medium">RS ${(s.advanceAmount || 0).toFixed(2)}</td>
          <td class="py-3 px-4 ${s.pendingAmount > 0 ? "text-amber-700 font-bold" : "text-slate-400"}">RS ${(s.pendingAmount || 0).toFixed(2)}</td>
          <td class="py-3 px-4">
            <a href="invoice.html?saleId=${s.id}" class="text-blue-600 hover:underline font-semibold">Invoice</a>
          </td>
        </tr>
      `).join("");
    }

    // 3. Render Recent Orders Table
    const recentOrders = [...orders].sort((a, b) => new Date(b.createdAt || b.orderDate).getTime() - new Date(a.createdAt || a.orderDate).getTime()).slice(0, 5);
    const ordersTbody = document.getElementById("tbl-recent-orders")!;
    if (recentOrders.length === 0) {
      ordersTbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400">No orders found.</td></tr>`;
    } else {
      ordersTbody.innerHTML = recentOrders.map(o => `
        <tr class="hover:bg-slate-50">
          <td class="py-3 px-4 font-bold text-slate-900">${o.orderNumber}</td>
          <td class="py-3 px-4 font-medium text-slate-800">${o.customerName}</td>
          <td class="py-3 px-4 text-slate-500">${o.orderDate}</td>
          <td class="py-3 px-4">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
              o.status === "Completed" ? "bg-emerald-100 text-emerald-800" :
              o.status === "In Progress" ? "bg-blue-100 text-blue-800" :
              "bg-amber-100 text-amber-800"
            }">${o.status}</span>
          </td>
          <td class="py-3 px-4 font-medium">${o.paymentStatus}</td>
          <td class="py-3 px-4 ${o.pendingBalance > 0 ? "text-amber-700 font-bold" : "text-slate-400"}">RS ${(o.pendingBalance || 0).toFixed(2)}</td>
          <td class="py-3 px-4">
            <a href="orders.html?orderId=${o.id}" class="text-blue-600 hover:underline font-semibold">View</a>
          </td>
        </tr>
      `).join("");
    }

    // 4. Render Outstanding Customer Balances List
    const outstandingCustomers = customers.filter(c => (c.outstandingBalance || 0) > 0);
    const balancesList = document.getElementById("list-outstanding-balances")!;
    if (outstandingCustomers.length === 0) {
      balancesList.innerHTML = `<p class="text-xs text-slate-400 text-center py-3">All customer balances are fully paid.</p>`;
    } else {
      balancesList.innerHTML = outstandingCustomers.map(c => `
        <div class="flex items-center justify-between p-2.5 bg-amber-50/60 rounded-lg border border-amber-100">
          <div>
            <p class="text-xs font-bold text-slate-900">${c.name}</p>
            <p class="text-[11px] text-slate-500">${c.mobile}</p>
          </div>
          <span class="text-xs font-extrabold text-amber-700">RS ${(c.outstandingBalance || 0).toFixed(2)}</span>
        </div>
      `).join("");
    }

    // 5. Render Low Stock Product Alerts List
    const alertsList = document.getElementById("list-inventory-alerts")!;
    if (lowStockProducts.length === 0) {
      alertsList.innerHTML = `<p class="text-xs text-slate-400 text-center py-3">All product inventory levels are healthy.</p>`;
    } else {
      alertsList.innerHTML = lowStockProducts.map(p => `
        <div class="flex items-center justify-between p-2.5 bg-rose-50/60 rounded-lg border border-rose-100">
          <div>
            <p class="text-xs font-bold text-slate-900">${p.name}</p>
            <p class="text-[11px] text-slate-500">${p.category} | Model: ${p.modelNumber || p.sku || "N/A"}</p>
          </div>
          <div class="text-right">
            <span class="text-xs font-extrabold text-rose-700 block">${p.stockQuantity} in stock</span>
            <span class="text-[10px] text-slate-400 font-medium">Min: ${p.minStockLevel}</span>
          </div>
        </div>
      `).join("");
    }

    // 6. Download Today Sales Report Handlers
    const handleDownloadTodayPDF = () => {
      const todayStr = new Date().toISOString().slice(0, 10);
      downloadTodayDetailedPDFReport(sales, expenses, todayStr);
      Toast.show("Downloading Today's Detailed Report PDF...", "success");
    };

    const handleDownloadTodayCSV = () => {
      const todayStr = new Date().toISOString().slice(0, 10);
      const csv = generateTodaySalesReportCSV(sales, todayStr);
      downloadCSV(`optiway_today_sales_${todayStr}.csv`, csv);
      Toast.show("Today's sales report downloaded as CSV.", "success");
    };

    document.getElementById("btn-dash-download-today-pdf")?.addEventListener("click", handleDownloadTodayPDF);
    document.getElementById("btn-dash-download-today-icon")?.addEventListener("click", handleDownloadTodayPDF);
    document.getElementById("btn-dash-download-today")?.addEventListener("click", handleDownloadTodayCSV);

  } catch (err) {
    console.error("Failed to load dashboard metrics:", err);
  }
}
