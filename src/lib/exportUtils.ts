import { jsPDF } from "jspdf";
import { Sale, Expense, Prescription, Customer, StoreSettings, dbService, ensureArray, formatDateStr } from "./db";

export interface DailyReportMetrics {
  dateStr: string;
  totalSalesCount: number;
  grossSales: number;       // Sum of subtotal
  discountTotal: number;   // Sum of discounts
  netSales: number;        // Sum of grandTotal
  advanceCollected: number;// Total cash/UPI/card collected today
  pendingReceivables: number; // Pending balances
  totalExpenses: number;   // Total expense amount
  
  // Payment Breakdown
  cashCollected: number;
  cashExpenses: number;
  cashInHand: number;

  upiCollected: number;
  upiExpenses: number;
  netUPI: number;

  cardCollected: number;
  cardExpenses: number;
  netCard: number;

  netCashFlow: number;     // Advance Collected - Total Expenses
}

export function calculateDailyMetrics(sales: Sale[], expenses: Expense[], targetDateStr?: string): {
  metrics: DailyReportMetrics;
  todaySales: Sale[];
  todayExpenses: Expense[];
} {
  const dateStr = targetDateStr || new Date().toISOString().slice(0, 10);
  
  const todaySales = sales.filter(s => (s.saleDate || s.createdAt || "").startsWith(dateStr));
  const todayExpenses = expenses.filter(e => (e.expenseDate || e.date || e.createdAt || "").startsWith(dateStr));

  const totalSalesCount = todaySales.length;
  const grossSales = todaySales.reduce((sum, s) => sum + (s.subtotal || 0), 0);
  const discountTotal = todaySales.reduce((sum, s) => sum + (s.discountTotal || 0), 0);
  const netSales = todaySales.reduce((sum, s) => sum + (s.grandTotal || 0), 0);
  const advanceCollected = todaySales.reduce((sum, s) => sum + (s.advanceAmount || 0), 0);
  const pendingReceivables = todaySales.reduce((sum, s) => sum + (s.pendingAmount || 0), 0);

  const totalExpenses = todayExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  // Cash
  const cashCollected = todaySales
    .filter(s => s.paymentMethod === "Cash")
    .reduce((sum, s) => sum + (s.advanceAmount || 0), 0);
  const cashExpenses = todayExpenses
    .filter(e => e.paymentMethod === "Cash")
    .reduce((sum, e) => sum + (e.amount || 0), 0);
  const cashInHand = cashCollected - cashExpenses;

  // UPI
  const upiCollected = todaySales
    .filter(s => s.paymentMethod === "UPI")
    .reduce((sum, s) => sum + (s.advanceAmount || 0), 0);
  const upiExpenses = todayExpenses
    .filter(e => e.paymentMethod === "UPI")
    .reduce((sum, e) => sum + (e.amount || 0), 0);
  const netUPI = upiCollected - upiExpenses;

  // Card / Bank
  const cardCollected = todaySales
    .filter(s => s.paymentMethod === "Card")
    .reduce((sum, s) => sum + (s.advanceAmount || 0), 0);
  const cardExpenses = todayExpenses
    .filter(e => e.paymentMethod === "Card" || e.paymentMethod === "Bank Transfer")
    .reduce((sum, e) => sum + (e.amount || 0), 0);
  const netCard = cardCollected - cardExpenses;

  const netCashFlow = advanceCollected - totalExpenses;

  return {
    metrics: {
      dateStr,
      totalSalesCount,
      grossSales,
      discountTotal,
      netSales,
      advanceCollected,
      pendingReceivables,
      totalExpenses,
      cashCollected,
      cashExpenses,
      cashInHand,
      upiCollected,
      upiExpenses,
      netUPI,
      cardCollected,
      cardExpenses,
      netCard,
      netCashFlow
    },
    todaySales,
    todayExpenses
  };
}

/**
 * Direct PDF Generator using jsPDF
 */
export function downloadTodayDetailedPDFReport(sales: Sale[], expenses: Expense[], targetDateStr?: string) {
  const { metrics, todaySales, todayExpenses } = calculateDailyMetrics(sales, expenses, targetDateStr);
  const dateStr = metrics.dateStr;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = 12;

  // Header Banner
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(10, y, 190, 22, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("OPTIWAY OPTICAL STORE", 15, y + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225); // slate-300
  doc.text("COMPLETE DAILY SALES, EXPENSES & CASHFLOW REPORT", 15, y + 15);

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Date: ${dateStr}`, 195, y + 8, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toLocaleTimeString()}`, 195, y + 15, { align: "right" });

  y += 27;

  // Section: Financial Metrics Cards
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("1. EXECUTIVE FINANCIAL SUMMARY", 10, y);
  y += 4;

  const cards = [
    { label: "GROSS SALES", val: `RS ${metrics.grossSales.toFixed(2)}`, color: [30, 58, 138] },
    { label: "TOTAL DISCOUNTS", val: `RS ${metrics.discountTotal.toFixed(2)}`, color: [225, 29, 72] },
    { label: "NET SALES (TOTAL)", val: `RS ${metrics.netSales.toFixed(2)}`, color: [2, 132, 199] },
    { label: "TOTAL EXPENSES", val: `RS ${metrics.totalExpenses.toFixed(2)}`, color: [190, 18, 60] },

    { label: "CASH IN HAND", val: `RS ${metrics.cashInHand.toFixed(2)}`, color: [22, 101, 52] },
    { label: "UPI NET TOTAL", val: `RS ${metrics.netUPI.toFixed(2)}`, color: [13, 148, 136] },
    { label: "CARD / BANK NET", val: `RS ${metrics.netCard.toFixed(2)}`, color: [124, 58, 237] },
    { label: "PENDING RECEIVABLES", val: `RS ${metrics.pendingReceivables.toFixed(2)}`, color: [217, 119, 6] },
  ];

  const cardW = 44;
  const cardH = 15;
  const cardGap = 4.5;

  cards.forEach((card, idx) => {
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const cx = 10 + col * (cardW + cardGap);
    const cy = y + row * (cardH + cardGap);

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(cx, cy, cardW, cardH, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(card.label, cx + 3, cy + 5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(card.color[0], card.color[1], card.color[2]);
    doc.text(card.val, cx + 3, cy + 11.5);
  });

  y += 2 * (cardH + cardGap) + 6;

  // PAYMENT MODE RECONCILIATION
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("2. PAYMENT METHOD RECONCILIATION & NET BALANCES", 10, y);
  y += 4;

  doc.setFillColor(241, 245, 249);
  doc.rect(10, y, 190, 5.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);

  doc.text("Payment Mode", 14, y + 4);
  doc.text("Sales Collected (Inflow)", 80, y + 4, { align: "right" });
  doc.text("Expenses Paid (Outflow)", 135, y + 4, { align: "right" });
  doc.text("Net Balance", 188, y + 4, { align: "right" });
  y += 5.5;

  const payModes = [
    { mode: "Cash in Hand", col: metrics.cashCollected, exp: metrics.cashExpenses, net: metrics.cashInHand },
    { mode: "UPI (Digital Payment)", col: metrics.upiCollected, exp: metrics.upiExpenses, net: metrics.netUPI },
    { mode: "Card / Bank Transfer", col: metrics.cardCollected, exp: metrics.cardExpenses, net: metrics.netCard },
  ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);

  payModes.forEach((pm) => {
    doc.setDrawColor(226, 232, 240);
    doc.line(10, y + 5, 200, y + 5);

    doc.text(pm.mode, 14, y + 3.5);
    doc.text(`RS ${pm.col.toFixed(2)}`, 80, y + 3.5, { align: "right" });
    doc.text(`RS ${pm.exp.toFixed(2)}`, 135, y + 3.5, { align: "right" });

    doc.setFont("helvetica", "bold");
    doc.text(`RS ${pm.net.toFixed(2)}`, 188, y + 3.5, { align: "right" });
    doc.setFont("helvetica", "normal");

    y += 6;
  });

  y += 5;

  // ITEMIZED SALES
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`3. ITEMIZED SALES TRANSACTIONS (${todaySales.length})`, 10, y);
  y += 4;

  doc.setFillColor(241, 245, 249);
  doc.rect(10, y, 190, 5.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(51, 65, 85);

  doc.text("Sale #", 12, y + 3.8);
  doc.text("Customer", 34, y + 3.8);
  doc.text("Items Summary", 76, y + 3.8);
  doc.text("Mode", 128, y + 3.8);
  doc.text("Subtotal", 148, y + 3.8, { align: "right" });
  doc.text("Discount", 168, y + 3.8, { align: "right" });
  doc.text("Net Total", 198, y + 3.8, { align: "right" });

  y += 5.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);

  if (todaySales.length === 0) {
    doc.text("No sales recorded for this date.", 12, y + 4);
    y += 7;
  } else {
    todaySales.forEach((s) => {
      if (y > 270) {
        doc.addPage();
        y = 15;
      }

      doc.setDrawColor(241, 245, 249);
      doc.line(10, y + 5, 200, y + 5);

      const itemsStr = ensureArray(s.items).map(i => `${i.productName} (x${i.quantity})`).join(", ");
      const truncCustomer = s.customerName.length > 18 ? s.customerName.substring(0, 16) + ".." : s.customerName;
      const truncItems = itemsStr.length > 32 ? itemsStr.substring(0, 30) + ".." : itemsStr;

      doc.text(s.saleNumber || s.id, 12, y + 3.5);
      doc.text(truncCustomer, 34, y + 3.5);
      doc.text(truncItems, 76, y + 3.5);
      doc.text(s.paymentMethod || "Cash", 128, y + 3.5);
      doc.text(`RS ${(s.subtotal || 0).toFixed(2)}`, 148, y + 3.5, { align: "right" });
      doc.text(`RS ${(s.discountTotal || 0).toFixed(2)}`, 168, y + 3.5, { align: "right" });
      doc.setFont("helvetica", "bold");
      doc.text(`RS ${(s.grandTotal || 0).toFixed(2)}`, 198, y + 3.5, { align: "right" });
      doc.setFont("helvetica", "normal");

      y += 6;
    });
  }

  y += 5;

  // ITEMIZED EXPENSES
  if (y > 250) {
    doc.addPage();
    y = 15;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`4. ITEMIZED EXPENSES (${todayExpenses.length})`, 10, y);
  y += 4;

  doc.setFillColor(241, 245, 249);
  doc.rect(10, y, 190, 5.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(51, 65, 85);

  doc.text("Category", 12, y + 3.8);
  doc.text("Description", 52, y + 3.8);
  doc.text("Payment Mode", 145, y + 3.8);
  doc.text("Amount", 198, y + 3.8, { align: "right" });

  y += 5.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);

  if (todayExpenses.length === 0) {
    doc.text("No expenses recorded for this date.", 12, y + 4);
    y += 7;
  } else {
    todayExpenses.forEach((exp) => {
      if (y > 270) {
        doc.addPage();
        y = 15;
      }

      doc.setDrawColor(241, 245, 249);
      doc.line(10, y + 5, 200, y + 5);

      const truncDesc = exp.description.length > 50 ? exp.description.substring(0, 48) + ".." : exp.description;

      doc.text(exp.category || "General", 12, y + 3.5);
      doc.text(truncDesc, 52, y + 3.5);
      doc.text(exp.paymentMethod || "Cash", 145, y + 3.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(190, 18, 60);
      doc.text(`RS ${(exp.amount || 0).toFixed(2)}`, 198, y + 3.5, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(15, 23, 42);

      y += 6;
    });
  }

  // Footer / Signature block
  if (y > 265) {
    doc.addPage();
    y = 20;
  } else {
    y += 10;
  }

  doc.setDrawColor(203, 213, 225);
  doc.line(10, y, 200, y);
  y += 5;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text("This is an official computer-generated daily revenue statement from OPTIWAY Store Management.", 10, y);
  doc.text("Authorized Signature: _______________________", 198, y, { align: "right" });

  doc.save(`optiway_daily_summary_${dateStr}.pdf`);
}

/**
 * Print View Window with Printable Layout & PDF Trigger
 */
export function printTodayDetailedReportHTML(sales: Sale[], expenses: Expense[], targetDateStr?: string) {
  const { metrics, todaySales, todayExpenses } = calculateDailyMetrics(sales, expenses, targetDateStr);
  const dateStr = metrics.dateStr;

  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const salesRowsHtml = todaySales.length === 0
    ? `<tr><td colspan="8" style="text-align:center; padding:16px; color:#94a3b8;">No sales recorded for ${dateStr}.</td></tr>`
    : todaySales.map(s => `
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:6px 8px; font-weight:bold;">${s.saleNumber || s.id}</td>
        <td style="padding:6px 8px;">${s.customerName}<br/><span style="font-size:10px; color:#64748b;">${s.customerMobile || ""}</span></td>
        <td style="padding:6px 8px; font-size:11px;">${ensureArray(s.items).map(i => `${i.productName} (x${i.quantity})`).join(", ")}</td>
        <td style="padding:6px 8px; text-align:center;">${s.paymentMethod || "Cash"}</td>
        <td style="padding:6px 8px; text-align:right;">RS ${(s.subtotal || 0).toFixed(2)}</td>
        <td style="padding:6px 8px; text-align:right; color:#e11d48;">-RS ${(s.discountTotal || 0).toFixed(2)}</td>
        <td style="padding:6px 8px; text-align:right; font-weight:bold;">RS ${(s.grandTotal || 0).toFixed(2)}</td>
        <td style="padding:6px 8px; text-align:right; color:#16a34a; font-weight:bold;">RS ${(s.advanceAmount || 0).toFixed(2)}</td>
      </tr>
    `).join("");

  const expenseRowsHtml = todayExpenses.length === 0
    ? `<tr><td colspan="4" style="text-align:center; padding:16px; color:#94a3b8;">No expenses recorded for ${dateStr}.</td></tr>`
    : todayExpenses.map(e => `
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:6px 8px; font-weight:bold;">${e.category || "General"}</td>
        <td style="padding:6px 8px;">${e.description}</td>
        <td style="padding:6px 8px; text-align:center;">${e.paymentMethod || "Cash"}</td>
        <td style="padding:6px 8px; text-align:right; color:#be123c; font-weight:bold;">RS ${(e.amount || 0).toFixed(2)}</td>
      </tr>
    `).join("");

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Today's Detailed Financial Report - ${dateStr}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 20px; color: #0f172a; margin: 0; background: #ffffff; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px; }
          .title { font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
          .sub { font-size: 11px; color: #64748b; margin-top: 2px; }
          .section-title { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #1e293b; margin-top: 20px; margin-bottom: 8px; border-left: 3px solid #0284c7; padding-left: 8px; }
          .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px; }
          .card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 12px; border-radius: 8px; }
          .card-label { font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; }
          .card-val { font-size: 16px; font-weight: 800; margin-top: 3px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; }
          th { background: #f1f5f9; padding: 8px; text-align: left; font-size: 10px; text-transform: uppercase; border-bottom: 2px solid #cbd5e1; color: #334155; }
          .footer { margin-top: 30px; border-top: 1px solid #cbd5e1; padding-top: 10px; font-size: 10px; color: #64748b; display: flex; justify-content: space-between; }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom: 15px; display: flex; justify-content: flex-end; gap: 10px;">
          <button onclick="window.print()" style="padding: 8px 16px; background: #0f172a; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">Print / Save PDF</button>
        </div>

        <div class="header">
          <div>
            <div class="title">OPTIWAY OPTICAL STORE</div>
            <div class="sub">COMPLETE DAILY SALES, EXPENSES & CASHFLOW RECONCILIATION</div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: bold; font-size: 14px;">Date: ${dateStr}</div>
            <div style="font-size: 11px; color: #64748b;">Generated: ${new Date().toLocaleTimeString()}</div>
          </div>
        </div>

        <div class="section-title">Executive Financial Summary</div>
        <div class="grid-4">
          <div class="card">
            <div class="card-label">Gross Sales</div>
            <div class="card-val" style="color:#1e3a8a;">RS ${metrics.grossSales.toFixed(2)}</div>
          </div>
          <div class="card">
            <div class="card-label">Total Discounts</div>
            <div class="card-val" style="color:#e11d48;">RS ${metrics.discountTotal.toFixed(2)}</div>
          </div>
          <div class="card">
            <div class="card-label">Net Sales Total</div>
            <div class="card-val" style="color:#0284c7;">RS ${metrics.netSales.toFixed(2)}</div>
          </div>
          <div class="card">
            <div class="card-label">Total Expenses</div>
            <div class="card-val" style="color:#be123c;">RS ${metrics.totalExpenses.toFixed(2)}</div>
          </div>

          <div class="card">
            <div class="card-label">Cash In Hand</div>
            <div class="card-val" style="color:#166534;">RS ${metrics.cashInHand.toFixed(2)}</div>
          </div>
          <div class="card">
            <div class="card-label">UPI Net Total</div>
            <div class="card-val" style="color:#0d9488;">RS ${metrics.netUPI.toFixed(2)}</div>
          </div>
          <div class="card">
            <div class="card-label">Card / Bank Net</div>
            <div class="card-val" style="color:#7c3aed;">RS ${metrics.netCard.toFixed(2)}</div>
          </div>
          <div class="card">
            <div class="card-label">Pending Balance</div>
            <div class="card-val" style="color:#d97706;">RS ${metrics.pendingReceivables.toFixed(2)}</div>
          </div>
        </div>

        <div class="section-title">Payment Method Reconciliation</div>
        <table>
          <thead>
            <tr>
              <th>Payment Mode</th>
              <th style="text-align:right;">Sales Collected (Inflow)</th>
              <th style="text-align:right;">Expenses Paid (Outflow)</th>
              <th style="text-align:right;">Net Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px; font-weight:bold;">Cash In Hand</td>
              <td style="padding:8px; text-align:right;">RS ${metrics.cashCollected.toFixed(2)}</td>
              <td style="padding:8px; text-align:right; color:#be123c;">RS ${metrics.cashExpenses.toFixed(2)}</td>
              <td style="padding:8px; text-align:right; font-weight:bold; color:#166534;">RS ${metrics.cashInHand.toFixed(2)}</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px; font-weight:bold;">UPI (Digital Payment)</td>
              <td style="padding:8px; text-align:right;">RS ${metrics.upiCollected.toFixed(2)}</td>
              <td style="padding:8px; text-align:right; color:#be123c;">RS ${metrics.upiExpenses.toFixed(2)}</td>
              <td style="padding:8px; text-align:right; font-weight:bold; color:#0d9488;">RS ${metrics.netUPI.toFixed(2)}</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px; font-weight:bold;">Card / Bank Transfer</td>
              <td style="padding:8px; text-align:right;">RS ${metrics.cardCollected.toFixed(2)}</td>
              <td style="padding:8px; text-align:right; color:#be123c;">RS ${metrics.cardExpenses.toFixed(2)}</td>
              <td style="padding:8px; text-align:right; font-weight:bold; color:#7c3aed;">RS ${metrics.netCard.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <div class="section-title">Itemized Sales Transactions (${todaySales.length})</div>
        <table>
          <thead>
            <tr>
              <th>Sale #</th>
              <th>Customer</th>
              <th>Items Summary</th>
              <th style="text-align:center;">Mode</th>
              <th style="text-align:right;">Subtotal</th>
              <th style="text-align:right;">Discount</th>
              <th style="text-align:right;">Net Total</th>
              <th style="text-align:right;">Collected</th>
            </tr>
          </thead>
          <tbody>
            ${salesRowsHtml}
          </tbody>
        </table>

        <div class="section-title">Itemized Expenses (${todayExpenses.length})</div>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Description</th>
              <th style="text-align:center;">Payment Mode</th>
              <th style="text-align:right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${expenseRowsHtml}
          </tbody>
        </table>

        <div class="footer">
          <div>This is a computer-generated daily revenue report from OPTIWAY Store Management.</div>
          <div>Authorized Store Signature: _______________________</div>
        </div>
      </body>
    </html>
  `);

  printWindow.document.close();
}

/**
 * Legacy CSV Exporter
 */
export function generateTodaySalesReportCSV(sales: Sale[], targetDateStr?: string): string {
  const dateStr = targetDateStr || new Date().toISOString().slice(0, 10);
  const todaySales = sales.filter(s => (s.saleDate || s.createdAt || "").startsWith(dateStr));

  const totalCount = todaySales.length;
  const totalRevenue = todaySales.reduce((sum, s) => sum + (s.grandTotal || 0), 0);
  const totalAdvance = todaySales.reduce((sum, s) => sum + (s.advanceAmount || 0), 0);
  const totalPending = todaySales.reduce((sum, s) => sum + (s.pendingAmount || 0), 0);

  const lines: string[] = [];

  lines.push(`"OPTIWAY OPTICAL STORE - DAILY SALES REPORT"`);
  lines.push(`"Report Date","${dateStr}"`);
  lines.push(`"Generated At","${new Date().toLocaleString()}"`);
  lines.push(`"Total Sales Count","${totalCount}"`);
  lines.push(`"Total Revenue (INR)","${totalRevenue.toFixed(2)}"`);
  lines.push(`"Total Advance Collected (INR)","${totalAdvance.toFixed(2)}"`);
  lines.push(`"Total Pending Balance (INR)","${totalPending.toFixed(2)}"`);
  lines.push(``);

  const headers = [
    "Sale Number",
    "Date / Time",
    "Customer Name",
    "Customer Mobile",
    "Items Summary",
    "Payment Method",
    "Status",
    "Subtotal (INR)",
    "Discount (INR)",
    "Tax (INR)",
    "Grand Total (INR)",
    "Paid / Advance (INR)",
    "Pending Balance (INR)",
    "Notes"
  ];
  lines.push(headers.map(h => `"${h}"`).join(","));

  if (todaySales.length === 0) {
    lines.push(`"No sales recorded on ${dateStr}."`);
  } else {
    todaySales.forEach(s => {
      const itemsSummary = ensureArray(s.items)
        .map(i => `${i.productName} (x${i.quantity} @ RS ${i.price})`)
        .join(" | ");

      const dateTime = s.createdAt ? new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (s.saleDate || "");

      const row = [
        s.saleNumber || s.id,
        `${s.saleDate || ''} ${dateTime || ''}`.trim(),
        s.customerName || "Walk-in Customer",
        s.customerMobile || "N/A",
        itemsSummary,
        s.paymentMethod || "Cash",
        s.status || "Completed",
        (s.subtotal || 0).toFixed(2),
        (s.discountTotal || 0).toFixed(2),
        (s.taxTotal || 0).toFixed(2),
        (s.grandTotal || 0).toFixed(2),
        (s.advanceAmount || 0).toFixed(2),
        (s.pendingAmount || 0).toFixed(2),
        s.notes || ""
      ];

      lines.push(row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","));
    });
  }

  return lines.join("\r\n");
}

export function downloadCSV(filename: string, csvContent: string) {
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generates an optical patient prescription (Rx) PDF card / document
 */
export async function downloadPrescriptionPDF(
  rx: Prescription,
  customer?: Customer | null,
  storeSettings?: StoreSettings | null
) {
  let settings = storeSettings;
  if (!settings) {
    try {
      settings = await dbService.getSettings();
    } catch {
      settings = null;
    }
  }

  let cust = customer;
  if (!cust && rx.customerId) {
    try {
      cust = await dbService.getItem<Customer>("customers", rx.customerId);
    } catch {
      cust = null;
    }
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = 14;

  const storeName = (settings?.storeName || "OPTIWAY VISION CARE").toUpperCase();
  const storePhone = settings?.phone || "+1 (800) 555-0199";
  const storeEmail = settings?.email || "care@optiway.com";
  const storeAddress = settings?.address || "Optical Clinic & Dispensing Optometry";

  // Top Header Banner
  doc.setFillColor(15, 23, 42); // slate-900
  doc.roundedRect(12, y, 186, 26, 2, 2, "F");

  // Store Brand Title
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(storeName, 18, y + 9);

  // Subtitle
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225); // slate-300
  doc.text(`${storeAddress}  •  Ph: ${storePhone}  •  ${storeEmail}`, 18, y + 17);

  // Right Header Label
  doc.setTextColor(56, 189, 248); // sky-400
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("OPTICAL Rx", 192, y + 9, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(226, 232, 240);
  doc.text(`Ref: RX-${(rx.id || "GEN").slice(-8).toUpperCase()}`, 192, y + 16, { align: "right" });

  y += 32;

  // Rx Document Title & Date Subheader
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(12, y, 186, 9, 1.5, 1.5, "F");
  
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("PATIENT REFRACTION & OPTICAL PRESCRIPTION", 16, y + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  const examDate = rx.prescriptionDate || rx.createdAt ? (rx.prescriptionDate || rx.createdAt.slice(0, 10)) : new Date().toISOString().slice(0, 10);
  doc.text(`Prescription Date: ${examDate}`, 192, y + 6, { align: "right" });

  y += 13;

  // Patient Information Card
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(12, y, 186, 25, 2, 2, "FD");

  const patientName = cust?.name || rx.customerName || "Walk-in Patient";
  const patientMobile = cust?.mobile || (cust as any)?.phone || "N/A";
  const patientEmail = cust?.email || "N/A";
  const patientAddr = cust?.address || "N/A";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("PATIENT NAME", 18, y + 6);
  doc.text("CONTACT NUMBER", 85, y + 6);
  doc.text("EXAMINED BY", 145, y + 6);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(patientName, 18, y + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(patientMobile, 85, y + 12);
  doc.text("Certified Optometrist", 145, y + 12);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("ADDRESS / EMAIL", 18, y + 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  const contactLine = patientAddr !== "N/A" ? patientAddr : (patientEmail !== "N/A" ? patientEmail : "Registered Clinic Patient");
  doc.text(contactLine.length > 55 ? contactLine.slice(0, 52) + "..." : contactLine, 18, y + 22);

  y += 30;

  // Prescription Symbol ℞ & Table Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(30, 58, 138); // blue-900
  doc.text("℞", 13, y + 4);

  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text("REFRACTIVE POWER SPECIFICATIONS", 21, y + 3.5);

  y += 7;

  // Table Column Coordinates
  // 12 to 198 (Total Width = 186)
  const colX = {
    eye: 12,
    sph: 52,
    cyl: 82,
    axis: 112,
    add: 142,
    va: 172,
    end: 198
  };

  // Table Header Row
  doc.setFillColor(30, 58, 138); // Navy header
  doc.roundedRect(12, y, 186, 8.5, 1, 1, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);

  doc.text("EYE (OCULUS)", colX.eye + 4, y + 5.5);
  doc.text("SPHERE (SPH)", colX.sph + 14, y + 5.5, { align: "center" });
  doc.text("CYLINDER (CYL)", colX.cyl + 14, y + 5.5, { align: "center" });
  doc.text("AXIS (DEG)", colX.axis + 14, y + 5.5, { align: "center" });
  doc.text("ADDITION (ADD)", colX.add + 14, y + 5.5, { align: "center" });
  doc.text("V / A (ACUITY)", colX.va + 12, y + 5.5, { align: "center" });

  y += 8.5;

  // Row 1: Right Eye (O.D.)
  doc.setFillColor(239, 246, 255); // light blue
  doc.rect(12, y, 186, 11, "F");
  doc.setDrawColor(219, 234, 254);
  doc.rect(12, y, 186, 11, "S");

  doc.setTextColor(30, 58, 138);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("RIGHT EYE (OD)", colX.eye + 4, y + 7);

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(formatPower(rx.rightEye?.sph), colX.sph + 14, y + 7, { align: "center" });
  doc.text(formatPower(rx.rightEye?.cyl), colX.cyl + 14, y + 7, { align: "center" });
  doc.text(formatAxis(rx.rightEye?.axis), colX.axis + 14, y + 7, { align: "center" });
  doc.text(formatAdd(rx.rightEye?.add), colX.add + 14, y + 7, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(rx.visualAcuity || "6/6", colX.va + 12, y + 7, { align: "center" });

  y += 11;

  // Row 2: Left Eye (O.S.)
  doc.setFillColor(245, 243, 255); // light indigo
  doc.rect(12, y, 186, 11, "F");
  doc.setDrawColor(237, 233, 254);
  doc.rect(12, y, 186, 11, "S");

  doc.setTextColor(67, 56, 202);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("LEFT EYE (OS)", colX.eye + 4, y + 7);

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(formatPower(rx.leftEye?.sph), colX.sph + 14, y + 7, { align: "center" });
  doc.text(formatPower(rx.leftEye?.cyl), colX.cyl + 14, y + 7, { align: "center" });
  doc.text(formatAxis(rx.leftEye?.axis), colX.axis + 14, y + 7, { align: "center" });
  doc.text(formatAdd(rx.leftEye?.add), colX.add + 14, y + 7, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(rx.visualAcuity || "6/6", colX.va + 12, y + 7, { align: "center" });

  y += 16;

  // Additional Parameters Grid (PD, Lens Recommendation, Notes)
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("OPTICAL MEASUREMENTS & RECOMMENDATIONS", 12, y);

  y += 4;

  // Boxes
  const boxW = 59;
  const boxH = 19;
  const boxGap = 4.5;

  // Box 1: Pupillary Distance
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(12, y, boxW, boxH, 1.5, 1.5, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("PUPILLARY DISTANCE (PD)", 16, y + 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(rx.pd ? `${rx.pd} mm` : "Standard (63 mm)", 16, y + 13.5);

  // Box 2: Recommended Lens Type
  const bx2 = 12 + boxW + boxGap;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(bx2, y, boxW, boxH, 1.5, 1.5, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("RECOMMENDED LENS", bx2 + 4, y + 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  const lensRec = determineLensType(rx);
  doc.text(lensRec, bx2 + 4, y + 13.5);

  // Box 3: Usage Type
  const bx3 = bx2 + boxW + boxGap;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(bx3, y, boxW, boxH, 1.5, 1.5, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("USAGE PURPOSE", bx3 + 4, y + 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  const usageText = determineUsage(rx);
  doc.text(usageText, bx3 + 4, y + 13.5);

  y += boxH + 6;

  // Clinical Notes Box
  doc.setFillColor(254, 252, 232); // light amber note
  doc.setDrawColor(254, 240, 138);
  doc.roundedRect(12, y, 186, 16, 1.5, 1.5, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(146, 64, 14); // amber-800
  doc.text("CLINICAL NOTES & INSTRUCTIONS:", 16, y + 5.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(69, 26, 3);
  const notesText = rx.notes?.trim() || "Anti-reflective coating (ARC) and UV420 blue-cut digital protection recommended for daily screen use.";
  doc.text(notesText.length > 95 ? notesText.slice(0, 92) + "..." : notesText, 16, y + 11.5);

  y += 22;

  // Patient Instructions & Advisory
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(12, y, 186, 20, 1.5, 1.5, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text("IMPORTANT CLINICAL ADVISORY & CARE GUIDELINES:", 16, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text("1. This refractive prescription is valid for 12 months from the date of issue unless otherwise advised.", 16, y + 9.5);
  doc.text("2. Adaptation period for newly prescribed lenses or progressive additions typically takes 3 to 7 days.", 16, y + 13.5);
  doc.text("3. Clean ophthalmic lenses only with dedicated micro-fiber cloth and lens cleaning solution.", 16, y + 17.5);

  y += 26;

  // Signature Block
  doc.setDrawColor(203, 213, 225);
  doc.line(135, y + 18, 192, y + 18);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text("AUTHORIZED OPTOMETRIST", 163.5, y + 23, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("Seal & Signature", 163.5, y + 27, { align: "center" });

  // Clinic Stamp Box on left
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(12, y, 65, 28, 1.5, 1.5, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text("CLINIC STAMP / DISPENSARY SEAL", 44.5, y + 14, { align: "center" });

  // Page Footer
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text(`Generated by ${storeName} Dispensing POS  •  ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 105, 288, { align: "center" });

  // Trigger Save
  const cleanCustName = (cust?.name || rx.customerName || "Patient").replace(/[^a-zA-Z0-9]/g, "_");
  const fileName = `Prescription_${cleanCustName}_${examDate}.pdf`;
  doc.save(fileName);
}

/**
 * Generates a compiled PDF table report of multiple prescriptions
 */
export async function downloadPrescriptionListPDF(
  prescriptions: Prescription[],
  storeSettings?: StoreSettings | null
) {
  let settings = storeSettings;
  if (!settings) {
    try {
      settings = await dbService.getSettings();
    } catch {
      settings = null;
    }
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = 14;

  const storeName = (settings?.storeName || "OPTIWAY VISION CARE").toUpperCase();
  const dateStr = new Date().toISOString().slice(0, 10);

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(10, y, 190, 20, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(storeName, 15, y + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text(`PATIENT PRESCRIPTIONS (Rx) MASTER LOG (${prescriptions.length} Records)`, 15, y + 15);

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`Report Date: ${dateStr}`, 195, y + 8, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(`Generated: ${new Date().toLocaleTimeString()}`, 195, y + 15, { align: "right" });

  y += 26;

  // Table Header
  doc.setFillColor(241, 245, 249);
  doc.rect(10, y, 190, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);

  doc.text("Date", 12, y + 5);
  doc.text("Patient Name", 34, y + 5);
  doc.text("Right Eye (OD) [Sph/Cyl/Axis/Add]", 72, y + 5);
  doc.text("Left Eye (OS) [Sph/Cyl/Axis/Add]", 128, y + 5);
  doc.text("PD", 182, y + 5);

  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(15, 23, 42);

  if (prescriptions.length === 0) {
    doc.text("No prescriptions recorded.", 12, y + 6);
  } else {
    prescriptions.forEach((rx) => {
      if (y > 275) {
        doc.addPage();
        y = 15;
      }

      doc.setDrawColor(241, 245, 249);
      doc.line(10, y + 7, 200, y + 7);

      const rEye = `S:${rx.rightEye?.sph || "0"} C:${rx.rightEye?.cyl || "0"} A:${rx.rightEye?.axis || "0"} +${rx.rightEye?.add || "0"}`;
      const lEye = `S:${rx.leftEye?.sph || "0"} C:${rx.leftEye?.cyl || "0"} A:${rx.leftEye?.axis || "0"} +${rx.leftEye?.add || "0"}`;

      doc.text(rx.prescriptionDate || rx.createdAt?.slice(0, 10) || "—", 12, y + 4.5);
      doc.setFont("helvetica", "bold");
      const name = rx.customerName || "Patient";
      doc.text(name.length > 20 ? name.slice(0, 18) + ".." : name, 34, y + 4.5);
      doc.setFont("helvetica", "normal");

      doc.text(rEye, 72, y + 4.5);
      doc.text(lEye, 128, y + 4.5);
      doc.text(rx.pd ? `${rx.pd}mm` : "—", 182, y + 4.5);

      y += 7.5;
    });
  }

  doc.save(`Prescriptions_Master_Report_${dateStr}.pdf`);
}

/**
 * Generates a compiled PDF table report of sales transactions history
 */
export async function downloadSalesHistoryListPDF(
  sales: Sale[],
  storeSettings?: StoreSettings | null,
  reportTitle: string = "SALES HISTORY & BILLING REPORT"
) {
  let settings = storeSettings;
  if (!settings) {
    try {
      settings = await dbService.getSettings();
    } catch {
      settings = null;
    }
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = 14;

  const storeName = (settings?.storeName || "OPTIWAY VISION CARE").toUpperCase();
  const dateStr = new Date().toISOString().slice(0, 10);

  const totalRevenue = sales.reduce((sum, s) => sum + (s.grandTotal || 0), 0);
  const totalAdvance = sales.reduce((sum, s) => sum + (s.advanceAmount || 0), 0);
  const totalPending = sales.reduce((sum, s) => sum + (s.pendingAmount || 0), 0);

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(10, y, 190, 22, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(storeName, 15, y + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text(`${reportTitle.toUpperCase()} (${sales.length} Bills | Total: RS ${totalRevenue.toFixed(2)})`, 15, y + 16);

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`Report Date: ${dateStr}`, 195, y + 8, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(`Generated: ${new Date().toLocaleTimeString()}`, 195, y + 16, { align: "right" });

  y += 28;

  // Summary Metrics Strip
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(10, y, 190, 14, 1.5, 1.5, "F");
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(10, y, 190, 14, 1.5, 1.5, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text("TOTAL BILLS", 20, y + 5);
  doc.text("TOTAL REVENUE", 70, y + 5);
  doc.text("COLLECTED / ADVANCE", 125, y + 5);
  doc.text("PENDING RECEIVABLES", 175, y + 5, { align: "right" });

  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(String(sales.length), 20, y + 10.5);
  doc.setTextColor(2, 132, 199);
  doc.text(`RS ${totalRevenue.toFixed(2)}`, 70, y + 10.5);
  doc.setTextColor(22, 101, 52);
  doc.text(`RS ${totalAdvance.toFixed(2)}`, 125, y + 10.5);
  doc.setTextColor(217, 119, 6);
  doc.text(`RS ${totalPending.toFixed(2)}`, 175, y + 10.5, { align: "right" });

  y += 18;

  // Table Header
  doc.setFillColor(241, 245, 249);
  doc.rect(10, y, 190, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);

  doc.text("Bill #", 12, y + 5);
  doc.text("Date", 42, y + 5);
  doc.text("Customer & Mobile", 68, y + 5);
  doc.text("Items Summary", 112, y + 5);
  doc.text("Mode", 152, y + 5);
  doc.text("Paid", 174, y + 5, { align: "right" });
  doc.text("Total", 198, y + 5, { align: "right" });

  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(15, 23, 42);

  if (sales.length === 0) {
    doc.text("No sales records found for this selection.", 12, y + 6);
  } else {
    sales.forEach((s) => {
      if (y > 275) {
        doc.addPage();
        y = 15;
      }

      doc.setDrawColor(241, 245, 249);
      doc.line(10, y + 7, 200, y + 7);

      const itemsStr = ensureArray(s.items).map(i => `${i.productName} (x${i.quantity})`).join(", ");
      const truncCustomer = s.customerName.length > 20 ? s.customerName.substring(0, 18) + ".." : s.customerName;
      const truncItems = itemsStr.length > 24 ? itemsStr.substring(0, 22) + ".." : (itemsStr || "General Item");

      doc.setFont("helvetica", "bold");
      doc.text(s.saleNumber || s.id, 12, y + 4.5);
      doc.setFont("helvetica", "normal");
      doc.text(s.saleDate || formatDateStr(s.createdAt, "—"), 42, y + 4.5);
      doc.text(`${truncCustomer} (${s.customerMobile || "—"})`, 68, y + 4.5);
      doc.text(truncItems, 112, y + 4.5);
      doc.text(s.paymentMethod || "Cash", 152, y + 4.5);
      doc.text(`RS ${(s.advanceAmount || 0).toFixed(2)}`, 174, y + 4.5, { align: "right" });
      doc.setFont("helvetica", "bold");
      doc.text(`RS ${(s.grandTotal || 0).toFixed(2)}`, 198, y + 4.5, { align: "right" });
      doc.setFont("helvetica", "normal");

      y += 7.5;
    });
  }

  doc.save(`Sales_History_Report_${dateStr}.pdf`);
}

/**
 * Exports any list of sales records to CSV format and downloads it
 */
export function downloadSalesListCSV(sales: Sale[], filenamePrefix: string = "Sales_History") {
  const dateStr = new Date().toISOString().slice(0, 10);
  const totalRevenue = sales.reduce((sum, s) => sum + (s.grandTotal || 0), 0);
  const totalAdvance = sales.reduce((sum, s) => sum + (s.advanceAmount || 0), 0);
  const totalPending = sales.reduce((sum, s) => sum + (s.pendingAmount || 0), 0);

  const lines: string[] = [];
  lines.push(`"OPTIWAY OPTICAL STORE - SALES HISTORY REPORT"`);
  lines.push(`"Generated Date","${dateStr}"`);
  lines.push(`"Generated At","${new Date().toLocaleString()}"`);
  lines.push(`"Total Invoices Count","${sales.length}"`);
  lines.push(`"Total Revenue (INR)","${totalRevenue.toFixed(2)}"`);
  lines.push(`"Total Advance / Paid (INR)","${totalAdvance.toFixed(2)}"`);
  lines.push(`"Total Pending Receivables (INR)","${totalPending.toFixed(2)}"`);
  lines.push(``);

  const headers = [
    "Sale Number",
    "Sale Date",
    "Customer Name",
    "Customer Mobile",
    "Items Purchased",
    "Payment Mode",
    "Status",
    "Subtotal (INR)",
    "Discount (INR)",
    "Tax (INR)",
    "Grand Total (INR)",
    "Paid Amount (INR)",
    "Pending Balance (INR)",
    "Notes"
  ];
  lines.push(headers.map(h => `"${h}"`).join(","));

  if (sales.length === 0) {
    lines.push(`"No sales records match this filter."`);
  } else {
    sales.forEach(s => {
      const itemsDetail = (s.items || []).map(i => `${i.productName} (Qty: ${i.quantity}, Price: ${i.price})`).join("; ");
      const row = [
        s.saleNumber || s.id,
        s.saleDate || s.createdAt || "",
        s.customerName || "Walk-in Customer",
        s.customerMobile || "",
        itemsDetail.replace(/"/g, '""'),
        s.paymentMethod || "Cash",
        s.status || "Completed",
        (s.subtotal || 0).toFixed(2),
        (s.discountTotal || 0).toFixed(2),
        (s.taxTotal || 0).toFixed(2),
        (s.grandTotal || 0).toFixed(2),
        (s.advanceAmount || 0).toFixed(2),
        (s.pendingAmount || 0).toFixed(2),
        (s.notes || "").replace(/"/g, '""')
      ];
      lines.push(row.map(cell => `"${cell}"`).join(","));
    });
  }

  const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent(lines.join("\n"));
  const link = document.createElement("a");
  link.setAttribute("href", csvContent);
  link.setAttribute("download", `${filenamePrefix}_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function formatPower(val?: string | number): string {
  if (val === undefined || val === null || val === "") return "0.00";
  const num = parseFloat(String(val));
  if (isNaN(num)) return String(val);
  if (num > 0) return `+${num.toFixed(2)}`;
  return num.toFixed(2);
}

function formatAxis(val?: string | number): string {
  if (val === undefined || val === null || val === "" || val === "0") return "—";
  return `${val}°`;
}

function formatAdd(val?: string | number): string {
  if (!val || val === "0" || val === "0.00") return "—";
  const num = parseFloat(String(val));
  if (isNaN(num)) return String(val);
  return `+${num.toFixed(2)}`;
}

function determineLensType(rx: Prescription): string {
  const hasAdd = (rx.rightEye?.add && parseFloat(rx.rightEye.add) > 0) || (rx.leftEye?.add && parseFloat(rx.leftEye.add) > 0);
  const hasHighCyl = Math.abs(parseFloat(rx.rightEye?.cyl || "0")) >= 1.5 || Math.abs(parseFloat(rx.leftEye?.cyl || "0")) >= 1.5;
  
  if (hasAdd) return "Progressive / Bifocal Digital";
  if (hasHighCyl) return "Toric Single Vision (ARC)";
  return "Single Vision Blue-Cut UV420";
}

function determineUsage(rx: Prescription): string {
  const hasAdd = (rx.rightEye?.add && parseFloat(rx.rightEye.add) > 0) || (rx.leftEye?.add && parseFloat(rx.leftEye.add) > 0);
  if (hasAdd) return "General / Reading & Distance";
  return "Constant Wear / Digital Screen";
}

/**
 * Resilient Multi-Platform HTML Printer (Hidden iframe + Window fallback)
 * Works seamlessly in embedded iframes, sandboxes, mobile and desktop browsers.
 */
export function printHtmlContent(htmlContent: string, title: string = "Print Document"): boolean {
  try {
    let printIframe = document.getElementById("optiway-print-frame") as HTMLIFrameElement;
    if (!printIframe) {
      printIframe = document.createElement("iframe");
      printIframe.id = "optiway-print-frame";
      printIframe.style.position = "fixed";
      printIframe.style.right = "0";
      printIframe.style.bottom = "0";
      printIframe.style.width = "0";
      printIframe.style.height = "0";
      printIframe.style.border = "none";
      printIframe.style.visibility = "hidden";
      document.body.appendChild(printIframe);
    }

    const doc = printIframe.contentWindow?.document || printIframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(htmlContent);
      doc.close();

      setTimeout(() => {
        try {
          printIframe.contentWindow?.focus();
          printIframe.contentWindow?.print();
        } catch (iframeErr) {
          console.warn("Iframe print triggered fallback window:", iframeErr);
          fallbackPrintWindow(htmlContent, title);
        }
      }, 250);
      return true;
    }
  } catch (err) {
    console.warn("Hidden iframe initialization error, trying window fallback:", err);
  }

  return fallbackPrintWindow(htmlContent, title);
}

function fallbackPrintWindow(htmlContent: string, title: string): boolean {
  try {
    const printWin = window.open("", "_blank");
    if (printWin) {
      printWin.document.open();
      printWin.document.write(htmlContent);
      printWin.document.close();
      setTimeout(() => {
        try {
          printWin.focus();
          printWin.print();
        } catch (e) {
          console.error("Window print invocation error:", e);
        }
      }, 300);
      return true;
    }
  } catch (e) {
    console.error("Popup window open blocked or failed:", e);
  }
  return false;
}

/**
 * Generates an official Tax Invoice PDF using jsPDF for 100% reliable download on any device
 */
export async function downloadInvoicePDF(
  sale: Sale,
  prescription?: Prescription | null,
  storeSettings?: StoreSettings | null
) {
  let settings = storeSettings;
  if (!settings) {
    try {
      settings = await dbService.getSettings();
    } catch {
      settings = null;
    }
  }

  let rx = prescription;
  if (!rx && sale.prescriptionId) {
    try {
      rx = await dbService.getItem<Prescription>("prescriptions", sale.prescriptionId);
    } catch {
      rx = null;
    }
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = 14;

  const storeName = (settings?.storeName || "OPTIWAY VISION CARE").toUpperCase();
  const storePhone = settings?.phone || "+1 (800) 555-0199";
  const storeEmail = settings?.email || "contact@optiway.com";
  const storeAddress = settings?.address || "742 Vision Avenue, Suite 100, New York, NY 10001";
  const storeGst = settings?.taxRate ? `GST/Tax Rate: ${settings.taxRate}%` : "Registered Optical Dispensary";

  const invNumber = (sale.saleNumber || "OPT-SL-0000").replace("OPT-SL-", "OPT-INV-");
  const invDate = sale.saleDate || (sale.createdAt ? sale.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10));

  // Top Banner
  doc.setFillColor(15, 23, 42); // slate-900
  doc.roundedRect(12, y, 186, 26, 2, 2, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(storeName, 18, y + 9);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text(`${storeAddress}  •  Ph: ${storePhone}  •  ${storeEmail}`, 18, y + 16);
  doc.setFontSize(7.5);
  doc.text(storeGst, 18, y + 22);

  // Right Header Label
  const hasTax = (sale.taxTotal || 0) > 0 || sale.taxType === "with_tax";
  const taxRate = sale.taxRate ?? storeSettings?.taxRate ?? 18;

  doc.setTextColor(56, 189, 248); // sky-400
  doc.setFont("helvetica", "bold");
  doc.setFontSize(hasTax ? 12 : 10.5);
  doc.text(hasTax ? "TAX INVOICE" : "RETAIL INVOICE", 192, y + 9, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text(`Invoice No: ${invNumber}`, 192, y + 16, { align: "right" });
  doc.setTextColor(203, 213, 225);
  doc.text(`Date: ${invDate}`, 192, y + 22, { align: "right" });

  y += 32;

  // Billed To Customer & Bill Details Card
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(12, y, 186, 24, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("BILLED TO CUSTOMER", 18, y + 6);
  doc.text("CONTACT NUMBER", 90, y + 6);
  doc.text("PAYMENT METHOD & STATUS", 145, y + 6);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(sale.customerName || "Walk-in Customer", 18, y + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(sale.customerMobile || "N/A", 90, y + 12);

  const isPending = (sale.pendingAmount || 0) > 0 || sale.status === "Pending Fulfillment";
  doc.setFont("helvetica", "bold");
  if (isPending) {
    doc.setTextColor(180, 83, 9); // amber-700
    doc.text(`Pending (Due: RS ${(sale.pendingAmount || 0).toFixed(2)})`, 145, y + 12);
  } else {
    doc.setTextColor(22, 101, 52); // emerald-700
    doc.text("Completed (Fully Paid)", 145, y + 12);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("ADDRESS", 18, y + 18);
  doc.text("PAYMENT MODE", 90, y + 18);
  doc.text("SALE REFERENCE", 145, y + 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text(sale.customerAddress || "Walk-in Patient", 18, y + 22);
  doc.text(sale.paymentMethod || "Cash", 90, y + 22);
  doc.text(sale.saleNumber || "—", 145, y + 22);

  y += 29;

  // Prescription Block if attached
  if (rx) {
    doc.setFillColor(239, 246, 255);
    doc.setDrawColor(219, 234, 254);
    doc.roundedRect(12, y, 186, 20, 1.5, 1.5, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(30, 58, 138);
    doc.text("ATTACHED OPTICAL PRESCRIPTION (Rx):", 16, y + 5);

    if (rx.pd) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text(`PD: ${rx.pd} mm`, 188, y + 5, { align: "right" });
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    const rEye = `Right Eye (OD): SPH ${rx.rightEye?.sph || "0.00"} | CYL ${rx.rightEye?.cyl || "0.00"} | AXIS ${rx.rightEye?.axis ? rx.rightEye.axis + "°" : "—"} | ADD +${rx.rightEye?.add || "0.00"}`;
    const lEye = `Left Eye (OS):  SPH ${rx.leftEye?.sph || "0.00"} | CYL ${rx.leftEye?.cyl || "0.00"} | AXIS ${rx.leftEye?.axis ? rx.leftEye.axis + "°" : "—"} | ADD +${rx.leftEye?.add || "0.00"}`;

    doc.text(rEye, 16, y + 11);
    doc.text(lEye, 16, y + 16);

    y += 24;
  }

  // Itemized Table Header
  doc.setFillColor(30, 58, 138); // Navy header
  doc.roundedRect(12, y, 186, 8, 1, 1, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);

  doc.text("ITEM & SPECIFICATIONS", 16, y + 5.5);
  doc.text("QTY", 125, y + 5.5, { align: "center" });
  doc.text("RATE", 145, y + 5.5, { align: "right" });
  doc.text("DISCOUNT", 168, y + 5.5, { align: "right" });
  doc.text("TOTAL", 192, y + 5.5, { align: "right" });

  y += 8;

  const items = ensureArray(sale.items);
  items.forEach((item, idx) => {
    if (y > 240) {
      doc.addPage();
      y = 15;
    }

    const hasRx = item.lensDetails || item.prescriptionText;
    const rowHeight = hasRx ? 13 : 9;

    doc.setFillColor(idx % 2 === 0 ? 255 : 248, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 252);
    doc.rect(12, y, 186, rowHeight, "F");
    doc.setDrawColor(241, 245, 249);
    doc.line(12, y + rowHeight, 198, y + rowHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(item.productName || "Item", 16, y + 5.5);

    if (hasRx) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(30, 58, 138);
      const rxLabel = `Rx: ${item.lensDetails || item.prescriptionText}`;
      doc.text(rxLabel.length > 70 ? rxLabel.slice(0, 68) + "..." : rxLabel, 16, y + 10);
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(String(item.quantity), 125, y + 5.5, { align: "center" });
    doc.text(`RS ${(item.price || 0).toFixed(2)}`, 145, y + 5.5, { align: "right" });
    
    if (item.discount && item.discount > 0) {
      doc.setTextColor(225, 29, 72);
      doc.text(`-RS ${item.discount.toFixed(2)}`, 168, y + 5.5, { align: "right" });
    } else {
      doc.setTextColor(100, 116, 139);
      doc.text("—", 168, y + 5.5, { align: "right" });
    }

    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(`RS ${(item.total || 0).toFixed(2)}`, 192, y + 5.5, { align: "right" });

    y += rowHeight;
  });

  y += 5;

  // Financial Summary Cards
  if (y > 220) {
    doc.addPage();
    y = 15;
  }

  // Left Note Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(12, y, 95, 34, 1.5, 1.5, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text("TERMS & INSTRUCTIONS:", 16, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text("• Lenses manufactured as per custom ophthalmic prescription.", 16, y + 10);
  doc.text("• Adaptation period for progressive / new lenses is 3-7 days.", 16, y + 14.5);
  doc.text("• Clean eyewear with microfiber cloth and specialized solution only.", 16, y + 19);
  doc.text("• Retain this tax invoice for warranty claims and verification.", 16, y + 23.5);

  // Right Totals Box
  const rxBoxX = 112;
  const rxBoxW = 86;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(rxBoxX, y, rxBoxW, 34, 1.5, 1.5, "FD");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);

  doc.text("Subtotal:", rxBoxX + 4, y + 5.5);
  doc.text(`RS ${(sale.subtotal || 0).toFixed(2)}`, rxBoxX + rxBoxW - 4, y + 5.5, { align: "right" });

  doc.text("Total Discount:", rxBoxX + 4, y + 10);
  doc.setTextColor(225, 29, 72);
  doc.text(`- RS ${(sale.discountTotal || 0).toFixed(2)}`, rxBoxX + rxBoxW - 4, y + 10, { align: "right" });

  doc.setTextColor(71, 85, 105);
  doc.text(hasTax ? `Tax (GST ${taxRate}%):` : "Tax (Non-GST):", rxBoxX + 4, y + 14.5);
  doc.text(hasTax ? `RS ${(sale.taxTotal || 0).toFixed(2)}` : "RS 0.00 (Exempt)", rxBoxX + rxBoxW - 4, y + 14.5, { align: "right" });

  // Grand Total Row
  doc.setDrawColor(203, 213, 225);
  doc.line(rxBoxX + 4, y + 17, rxBoxX + rxBoxW - 4, y + 17);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text("Grand Total:", rxBoxX + 4, y + 21.5);
  doc.setTextColor(2, 132, 199); // blue-600
  doc.text(`RS ${(sale.grandTotal || 0).toFixed(2)}`, rxBoxX + rxBoxW - 4, y + 21.5, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(22, 101, 52);
  doc.text("Paid / Advance:", rxBoxX + 4, y + 26);
  doc.text(`RS ${(sale.advanceAmount || 0).toFixed(2)}`, rxBoxX + rxBoxW - 4, y + 26, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  if (isPending) {
    doc.setTextColor(180, 83, 9);
    doc.text("Balance Due:", rxBoxX + 4, y + 30.5);
    doc.text(`RS ${(sale.pendingAmount || 0).toFixed(2)}`, rxBoxX + rxBoxW - 4, y + 30.5, { align: "right" });
  } else {
    doc.setTextColor(22, 101, 52);
    doc.text("Balance Due:", rxBoxX + 4, y + 30.5);
    doc.text("PAID IN FULL", rxBoxX + rxBoxW - 4, y + 30.5, { align: "right" });
  }

  y += 42;

  // Signatures
  doc.setDrawColor(203, 213, 225);
  doc.line(135, y + 12, 192, y + 12);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text("FOR OPTIWAY VISION CARE", 163.5, y + 16, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text("Authorized Signatory", 163.5, y + 20, { align: "center" });

  // Footer
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text(`Generated by ${storeName} Billing Terminal  •  Thank you for your business!`, 105, 288, { align: "center" });

  doc.save(`Tax_Invoice_${invNumber}_${invDate}.pdf`);
}

/**
 * Standalone A4 Tax Invoice Direct Print (Triggered via Hidden iframe or Window)
 */
export function printInvoiceDirect(
  sale: Sale,
  prescription?: Prescription | null,
  storeSettings?: StoreSettings | null
): boolean {
  const storeName = storeSettings?.storeName || "OPTIWAY VISION CARE";
  const storeAddress = storeSettings?.address || "742 Vision Avenue, Suite 100, New York, NY 10001";
  const storePhone = storeSettings?.phone || "+1 800-555-0199";
  const storeEmail = storeSettings?.email || "contact@optiway.com";

  const invNumber = (sale.saleNumber || "OPT-SL-0000").replace("OPT-SL-", "OPT-INV-");
  const invDate = sale.saleDate || (sale.createdAt ? sale.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const isPending = (sale.pendingAmount || 0) > 0 || sale.status === "Pending Fulfillment";
  const hasTax = (sale.taxTotal || 0) > 0 || sale.taxType === "with_tax";
  const taxRate = sale.taxRate ?? storeSettings?.taxRate ?? 18;

  const itemsHtml = ensureArray(sale.items).map(item => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 10px 12px;">
        <div style="font-weight: 800; font-size: 13px; color: #0f172a;">${item.productName || "Eyewear Item"}</div>
        ${item.lensDetails || item.prescriptionText ? `
          <div style="margin-top: 4px; font-family: monospace; font-size: 11px; color: #1e40af; background: #eff6ff; border: 1px solid #bfdbfe; padding: 2px 6px; border-radius: 4px; display: inline-block;">
            Rx: ${item.lensDetails || item.prescriptionText}
          </div>
        ` : ""}
      </td>
      <td style="padding: 10px 12px; text-align: center; font-weight: bold; font-size: 12px;">${item.quantity}</td>
      <td style="padding: 10px 12px; text-align: right; font-size: 12px;">RS ${(item.price || 0).toFixed(2)}</td>
      <td style="padding: 10px 12px; text-align: right; color: #e11d48; font-size: 12px;">${item.discount ? `-RS ${item.discount.toFixed(2)}` : "—"}</td>
      <td style="padding: 10px 12px; text-align: right; font-weight: 800; font-size: 13px; color: #0f172a;">RS ${(item.total || 0).toFixed(2)}</td>
    </tr>
  `).join("");

  const rxHtml = prescription ? `
    <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 14px; margin-bottom: 18px; font-size: 12px;">
      <div style="display: flex; justify-content: space-between; font-weight: 800; color: #1e3a8a; margin-bottom: 6px;">
        <span>ATTACHED OPTICAL PRESCRIPTION (Rx)</span>
        <span>PD: ${prescription.pd ? prescription.pd + " mm" : "Standard"}</span>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 11.5px; color: #1e293b;">
        <div><strong>Right Eye (OD):</strong> SPH ${prescription.rightEye?.sph || "0.00"} | CYL ${prescription.rightEye?.cyl || "0.00"} | AXIS ${prescription.rightEye?.axis ? prescription.rightEye.axis + "°" : "—"} | ADD +${prescription.rightEye?.add || "0.00"}</div>
        <div><strong>Left Eye (OS):</strong> SPH ${prescription.leftEye?.sph || "0.00"} | CYL ${prescription.leftEye?.cyl || "0.00"} | AXIS ${prescription.leftEye?.axis ? prescription.leftEye.axis + "°" : "—"} | ADD +${prescription.leftEye?.add || "0.00"}</div>
      </div>
    </div>
  ` : "";

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${hasTax ? "Tax Invoice" : "Retail Invoice"} - ${invNumber}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 24px;
            color: #0f172a;
            background: #ffffff;
            font-size: 12px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 16px;
            margin-bottom: 18px;
          }
          .brand-title {
            font-size: 20px;
            font-weight: 900;
            letter-spacing: -0.5px;
            color: #0f172a;
          }
          .subtext { font-size: 11px; color: #64748b; margin-top: 2px; }
          .tax-badge {
            background: ${hasTax ? "#eff6ff" : "#f1f5f9"};
            color: ${hasTax ? "#2563eb" : "#475569"};
            font-weight: 900;
            font-size: 11px;
            padding: 3px 8px;
            border-radius: 4px;
            border: 1px solid ${hasTax ? "#bfdbfe" : "#cbd5e1"};
            display: inline-block;
            margin-bottom: 4px;
          }
          .customer-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 14px;
            margin-bottom: 18px;
            font-size: 11.5px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
          }
          th {
            background: #0f172a;
            color: #ffffff;
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
            padding: 9px 12px;
            text-align: left;
          }
          .totals-grid {
            display: grid;
            grid-template-columns: 1fr 1.2fr;
            gap: 20px;
            margin-top: 10px;
          }
          .notes-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px;
            font-size: 11px;
            color: #64748b;
          }
          .summary-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px 16px;
            font-size: 12px;
          }
          .summary-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 6px;
          }
          .grand-total-row {
            display: flex;
            justify-content: space-between;
            font-size: 15px;
            font-weight: 900;
            color: #0f172a;
            border-top: 2px solid #cbd5e1;
            padding-top: 8px;
            margin-top: 6px;
          }
          .footer {
            margin-top: 40px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            border-top: 1px solid #e2e8f0;
            padding-top: 15px;
            font-size: 10.5px;
            color: #94a3b8;
          }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand-title">${storeName}</div>
            <div class="subtext">${storeAddress}</div>
            <div class="subtext">Phone: ${storePhone} | Email: ${storeEmail}</div>
          </div>
          <div style="text-align: right;">
            <div class="tax-badge">${hasTax ? `TAX INVOICE (${taxRate}% GST)` : "RETAIL INVOICE / BILL OF SUPPLY"}</div>
            <div style="font-weight: 800; font-size: 13px;">${invNumber}</div>
            <div class="subtext">Date: ${invDate}</div>
            <div class="subtext">Ref: ${sale.saleNumber || "—"}</div>
          </div>
        </div>

        <div class="customer-grid">
          <div>
            <div style="font-size: 9px; font-weight: 800; text-transform: uppercase; color: #94a3b8; margin-bottom: 3px;">BILLED TO CUSTOMER</div>
            <div style="font-size: 13px; font-weight: 800; color: #0f172a;">${sale.customerName || "Walk-in Customer"}</div>
            <div style="color: #475569;">${sale.customerMobile || "No Mobile"}</div>
            <div style="color: #64748b;">${sale.customerAddress || "Walk-in Patient"}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 9px; font-weight: 800; text-transform: uppercase; color: #94a3b8; margin-bottom: 3px;">PAYMENT & STATUS</div>
            <div style="font-weight: 800; color: ${isPending ? "#b45309" : "#166534"}; font-size: 13px;">
              ${isPending ? `Pending (Due: RS ${(sale.pendingAmount || 0).toFixed(2)})` : "Fully Settled & Paid"}
            </div>
            <div style="color: #475569;">Mode: ${sale.paymentMethod || "Cash"}</div>
            <div style="color: #64748b;">Dispensary Counter Sale</div>
          </div>
        </div>

        ${rxHtml}

        <table>
          <thead>
            <tr>
              <th style="width: 45%;">Item Description & Lens Specifications</th>
              <th style="text-align: center; width: 10%;">Qty</th>
              <th style="text-align: right; width: 15%;">Price</th>
              <th style="text-align: right; width: 15%;">Discount</th>
              <th style="text-align: right; width: 15%;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="totals-grid">
          <div class="notes-card">
            <strong style="color: #1e293b; display: block; margin-bottom: 4px;">Dispensary Guidelines:</strong>
            <div>1. Progressive & High-index custom lenses are crafted with precision.</div>
            <div>2. Lens adaptation period ranges from 3 to 7 days for new Rx.</div>
            <div>3. Please check vision periodically every 12 months.</div>
          </div>

          <div class="summary-card">
            <div class="summary-row">
              <span style="color: #64748b;">Subtotal:</span>
              <span style="font-weight: bold;">RS ${(sale.subtotal || 0).toFixed(2)}</span>
            </div>
            <div class="summary-row">
              <span style="color: #64748b;">Discount:</span>
              <span style="font-weight: bold; color: #e11d48;">- RS ${(sale.discountTotal || 0).toFixed(2)}</span>
            </div>
            <div class="summary-row">
              <span style="color: #64748b;">${hasTax ? `Tax (GST ${taxRate}%):` : "Tax (Non-GST):"}</span>
              <span style="font-weight: bold;">${hasTax ? `RS ${(sale.taxTotal || 0).toFixed(2)}` : "RS 0.00 (Exempt)"}</span>
            </div>
            <div class="grand-total-row">
              <span>Grand Total:</span>
              <span style="color: #2563eb;">RS ${(sale.grandTotal || 0).toFixed(2)}</span>
            </div>
            <div class="summary-row" style="margin-top: 6px; color: #166534; font-weight: bold;">
              <span>Amount Paid:</span>
              <span>RS ${(sale.advanceAmount || 0).toFixed(2)}</span>
            </div>
            <div class="summary-row" style="color: ${isPending ? "#b45309" : "#166534"}; font-weight: 800; font-size: 13px;">
              <span>Balance Due:</span>
              <span>${isPending ? `RS ${(sale.pendingAmount || 0).toFixed(2)}` : "RS 0.00 (PAID FULL)"}</span>
            </div>
          </div>
        </div>

        <div class="footer">
          <div>Computer-generated ${hasTax ? "Tax Invoice" : "Retail Invoice"} from ${storeName}.</div>
          <div style="text-align: right;">
            <div style="border-bottom: 1px solid #64748b; width: 140px; margin-bottom: 4px; display: inline-block;"></div>
            <div>Authorized Signatory</div>
          </div>
        </div>
      </body>
    </html>
  `;

  return printHtmlContent(html, `Invoice - ${invNumber}`);
}

/**
 * 80mm / 72mm POS Thermal Receipt Printer
 */
export function printThermalReceiptDirect(
  sale: Sale,
  storeSettings?: StoreSettings | null
): boolean {
  const storeName = storeSettings?.storeName || "OPTIWAY VISION CARE";
  const storeAddress = storeSettings?.address || "Vision Care Center";
  const storePhone = storeSettings?.phone || "Store Contact";

  const invNumber = (sale.saleNumber || "OPT-SL-0000").replace("OPT-SL-", "OPT-INV-");
  const invDate = sale.saleDate || (sale.createdAt ? sale.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const hasTax = (sale.taxTotal || 0) > 0 || sale.taxType === "with_tax";
  const taxRate = sale.taxRate ?? storeSettings?.taxRate ?? 18;

  const itemsHtml = ensureArray(sale.items).map(item => `
    <div style="margin-bottom: 4px;">
      <div style="display: flex; justify-content: space-between; font-weight: bold;">
        <span>${item.productName || "Item"} x${item.quantity}</span>
        <span>RS ${(item.total || 0).toFixed(2)}</span>
      </div>
      ${item.lensDetails || item.prescriptionText ? `
        <div style="font-size: 10px; color: #444; padding-left: 6px;">
          Rx: ${item.lensDetails || item.prescriptionText}
        </div>
      ` : ""}
    </div>
  `).join("");

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Receipt - ${invNumber}</title>
        <style>
          body {
            font-family: "Courier New", Courier, monospace, sans-serif;
            font-size: 11.5px;
            color: #000;
            padding: 10px;
            margin: 0 auto;
            max-width: 300px;
          }
          .center { text-align: center; }
          .header { border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px; }
          .grid { display: flex; justify-content: space-between; margin: 3px 0; }
          .items { border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 6px 0; margin: 6px 0; }
          .total { font-weight: bold; font-size: 13px; border-top: 1px solid #000; padding-top: 4px; margin-top: 4px; }
          .footer { text-align: center; margin-top: 12px; font-size: 10px; border-top: 1px dashed #000; padding-top: 6px; }
          @media print {
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="header center">
          <div style="font-size: 14px; font-weight: bold;">${storeName}</div>
          <div>${storeAddress}</div>
          <div>Tel: ${storePhone}</div>
          <div style="margin-top: 4px; font-weight: bold;">${hasTax ? "TAX INVOICE" : "RETAIL BILL"}: ${invNumber}</div>
          <div>Date: ${invDate}</div>
        </div>

        <div class="grid">
          <span>Customer:</span>
          <span>${sale.customerName || "Walk-in"}</span>
        </div>
        <div class="grid">
          <span>Mobile:</span>
          <span>${sale.customerMobile || "—"}</span>
        </div>

        <div class="items">
          ${itemsHtml}
        </div>

        <div class="grid">
          <span>Subtotal:</span>
          <span>RS ${(sale.subtotal || 0).toFixed(2)}</span>
        </div>
        <div class="grid">
          <span>Discount:</span>
          <span>-RS ${(sale.discountTotal || 0).toFixed(2)}</span>
        </div>
        <div class="grid">
          <span>${hasTax ? `Tax (${taxRate}%):` : "Tax (0%):"}</span>
          <span>${hasTax ? `RS ${(sale.taxTotal || 0).toFixed(2)}` : "RS 0.00 (Exempt)"}</span>
        </div>
        <div class="grid total">
          <span>GRAND TOTAL:</span>
          <span>RS ${(sale.grandTotal || 0).toFixed(2)}</span>
        </div>
        <div class="grid">
          <span>Paid (${sale.paymentMethod || "Cash"}):</span>
          <span>RS ${(sale.advanceAmount || 0).toFixed(2)}</span>
        </div>
        <div class="grid" style="font-weight: bold;">
          <span>Balance Due:</span>
          <span>RS ${(sale.pendingAmount || 0).toFixed(2)}</span>
        </div>

        <div class="footer">
          <div>Thank you for choosing ${storeName}!</div>
          <div>Have your vision checked every 12 months.</div>
        </div>
      </body>
    </html>
  `;

  return printHtmlContent(html, `Receipt - ${invNumber}`);
}

/**
 * Optical Lab Fitting Job Slip Direct Printer
 */
export function printLabJobSlip(
  order: any,
  storeSettings?: StoreSettings | null
): boolean {
  const storeName = storeSettings?.storeName || "OPTIWAY VISION CARE";
  const rx = order.prescriptionDetails;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Lab Job Slip - ${order.orderNumber}</title>
        <style>
          body {
            font-family: monospace, sans-serif;
            padding: 16px;
            color: #000;
            max-width: 380px;
            margin: 0 auto;
            font-size: 11.5px;
          }
          .center { text-align: center; }
          .header { border-bottom: 2px dashed #000; padding-bottom: 8px; margin-bottom: 10px; }
          .title { font-size: 15px; font-weight: bold; }
          .grid { display: flex; justify-content: space-between; margin-bottom: 4px; }
          .section { border: 1px solid #000; padding: 8px; margin: 8px 0; border-radius: 4px; }
          .rx-table { width: 100%; border-collapse: collapse; margin-top: 5px; font-size: 10.5px; }
          .rx-table th, .rx-table td { border: 1px solid #333; padding: 3px; text-align: center; }
          .footer { text-align: center; margin-top: 12px; font-size: 10px; border-top: 1px dashed #000; padding-top: 6px; }
        </style>
      </head>
      <body>
        <div class="header center">
          <div class="title">${storeName}</div>
          <div style="font-weight: bold; font-size: 13px; margin-top: 2px;">OPTICAL LAB JOB SLIP</div>
          <div>Job Ref: ${order.orderNumber}</div>
          <div>Date: ${order.orderDate || new Date().toISOString().slice(0, 10)}</div>
        </div>

        <div class="grid">
          <span><strong>Patient:</strong> ${order.customerName || "Walk-in"}</span>
          <span><strong>Mobile:</strong> ${order.customerMobile || "—"}</span>
        </div>

        <div class="section">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <strong>LENS / EYEWEAR PRESCRIPTION (Rx)</strong>
            ${rx?.eyeSide ? `
              <span style="font-size: 10px; font-weight: bold; padding: 2px 6px; border: 1px solid #333; border-radius: 3px; background: #eee;">
                ${rx.eyeSide === "RE" ? "RIGHT EYE (RE / OD) ONLY" : rx.eyeSide === "LE" ? "LEFT EYE (LE / OS) ONLY" : "PAIR (RE + LE)"}
              </span>
            ` : ""}
          </div>
          ${rx ? `
            <div style="margin-top: 4px; margin-bottom: 4px;">PD: <strong>${rx.pd ? rx.pd + " mm" : "Standard"}</strong></div>
            <table class="rx-table">
              <tr>
                <th>Eye</th>
                <th>SPH</th>
                <th>CYL</th>
                <th>AXIS</th>
                <th>ADD</th>
              </tr>
              ${rx.eyeSide !== "LE" ? `
                <tr>
                  <td><strong>OD (R)</strong></td>
                  <td>${rx.rightEye?.sph || "0.00"}</td>
                  <td>${rx.rightEye?.cyl || "0.00"}</td>
                  <td>${rx.rightEye?.axis ? rx.rightEye.axis + "°" : "—"}</td>
                  <td>${rx.rightEye?.add ? "+" + rx.rightEye.add : "—"}</td>
                </tr>
              ` : `
                <tr>
                  <td><strong>OD (R)</strong></td>
                  <td colspan="4" style="color: #666; font-style: italic;">N/A (Single Left Eye lens order)</td>
                </tr>
              `}
              ${rx.eyeSide !== "RE" ? `
                <tr>
                  <td><strong>OS (L)</strong></td>
                  <td>${rx.leftEye?.sph || "0.00"}</td>
                  <td>${rx.leftEye?.cyl || "0.00"}</td>
                  <td>${rx.leftEye?.axis ? rx.leftEye.axis + "°" : "—"}</td>
                  <td>${rx.leftEye?.add ? "+" + rx.leftEye.add : "—"}</td>
                </tr>
              ` : `
                <tr>
                  <td><strong>OS (L)</strong></td>
                  <td colspan="4" style="color: #666; font-style: italic;">N/A (Single Right Eye lens order)</td>
                </tr>
              `}
            </table>
          ` : `<div>No specific Rx attached. Standard lens assembly.</div>`}
        </div>

        <div class="section">
          <strong>FRAME & LENS SPECIFICATIONS</strong>
          <div style="margin-top: 4px;">
            ${ensureArray(order.items).map(i => `• ${i.productName} (Qty: ${i.quantity}) ${i.lensDetails ? `<br/>&nbsp;&nbsp;[${i.lensDetails}]` : ""}`).join("<br/>")}
          </div>
        </div>

        <div class="grid" style="margin-top: 8px;">
          <span><strong>Total:</strong> RS ${(order.grandTotal || 0).toFixed(2)}</span>
          <span><strong>Balance Due:</strong> RS ${(order.pendingBalance || 0).toFixed(2)}</span>
        </div>

        <div class="footer">
          <div>Technician Signature: __________________</div>
          <div style="margin-top: 3px;">Quality Inspection Passed [ ]</div>
        </div>
      </body>
    </html>
  `;

  return printHtmlContent(html, `Lab Job - ${order.orderNumber}`);
}

/**
 * Direct A4 / Thermal Advance Payment Receipt Printer
 */
export function printAdvanceReceiptDirect(
  data: {
    receiptNumber?: string;
    saleNumber?: string;
    orderNumber?: string;
    customerName?: string;
    customerMobile?: string;
    customerAddress?: string;
    items?: any[];
    grandTotal?: number;
    advanceAmount?: number;
    pendingAmount?: number;
    paymentMethod?: string;
    date?: string;
    notes?: string;
    taxTotal?: number;
    taxRate?: number;
    isTaxExempt?: boolean;
    taxType?: string;
  },
  prescription?: Prescription | null,
  storeSettings?: StoreSettings | null
): boolean {
  const storeName = storeSettings?.storeName || "OPTIWAY VISION CARE";
  const storeAddress = storeSettings?.address || "742 Vision Avenue, Suite 100, New York, NY 10001";
  const storePhone = storeSettings?.phone || "+1 800-555-0199";
  const storeEmail = storeSettings?.email || "billing@optiway.com";
  const storeGst = storeSettings?.gstNumber ? `GSTIN: ${storeSettings.gstNumber}` : "";

  const receiptNum = data.receiptNumber || "OPT-REC-" + Math.floor(1000 + Math.random() * 9000);
  const orderRef = data.orderNumber || data.saleNumber || "OPT-ORD-" + Math.floor(1000 + Math.random() * 9000);
  const receiptDate = data.date || new Date().toISOString().slice(0, 10);

  const grandTotal = data.grandTotal || 0;
  const advanceAmount = data.advanceAmount || 0;
  const pendingAmount = Math.max(0, grandTotal - advanceAmount);

  const itemsHtml = ensureArray(data.items).map(item => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 10px 12px;">
        <div style="font-weight: 800; font-size: 12.5px; color: #0f172a;">${item.productName || "Eyewear Item"}</div>
        ${item.lensDetails || item.prescriptionText ? `
          <div style="margin-top: 3px; font-family: monospace; font-size: 11px; color: #1e40af; background: #eff6ff; border: 1px solid #bfdbfe; padding: 2px 6px; border-radius: 4px; display: inline-block;">
            Rx: ${item.lensDetails || item.prescriptionText}
          </div>
        ` : ""}
      </td>
      <td style="padding: 10px 12px; text-align: center; font-weight: bold; font-size: 12px;">${item.quantity || 1}</td>
      <td style="padding: 10px 12px; text-align: right; font-size: 12px;">RS ${(item.price || 0).toFixed(2)}</td>
      <td style="padding: 10px 12px; text-align: right; font-weight: 800; font-size: 12.5px; color: #0f172a;">RS ${(item.total || item.price * (item.quantity || 1) || 0).toFixed(2)}</td>
    </tr>
  `).join("");

  const rxHtml = prescription ? `
    <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px 12px; margin-bottom: 16px; font-size: 11.5px;">
      <div style="display: flex; justify-content: space-between; align-items: center; font-weight: 800; color: #1e3a8a; margin-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span>PRESCRIPTION DETAILS (Rx)</span>
          ${prescription.eyeSide ? `
            <span style="font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; ${prescription.eyeSide === "RE" ? "background:#d1fae5; color:#065f46; border:1px solid #a7f3d0;" : prescription.eyeSide === "LE" ? "background:#f3e8ff; color:#6b21a8; border:1px solid #e9d5ff;" : "background:#dbeafe; color:#1e40af; border:1px solid #bfdbfe;"}">
              ${prescription.eyeSide === "RE" ? "Right Eye (RE / OD) Only" : prescription.eyeSide === "LE" ? "Left Eye (LE / OS) Only" : "Pair (RE + LE)"}
            </span>
          ` : ""}
        </div>
        <span>PD: ${prescription.pd ? prescription.pd + " mm" : "Standard"}</span>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; color: #1e293b;">
        <div>
          ${prescription.eyeSide !== "LE" ? `
            <strong>Right Eye (RE / OD):</strong> SPH ${prescription.rightEye?.sph || "0.00"} | CYL ${prescription.rightEye?.cyl || "0.00"} | AXIS ${prescription.rightEye?.axis ? prescription.rightEye.axis + "°" : "—"} | ADD +${prescription.rightEye?.add || "0.00"}
          ` : `<span style="color: #64748b; font-style: italic;">Right Eye (RE / OD): N/A (Single Left Eye lens order)</span>`}
        </div>
        <div>
          ${prescription.eyeSide !== "RE" ? `
            <strong>Left Eye (LE / OS):</strong> SPH ${prescription.leftEye?.sph || "0.00"} | CYL ${prescription.leftEye?.cyl || "0.00"} | AXIS ${prescription.leftEye?.axis ? prescription.leftEye.axis + "°" : "—"} | ADD +${prescription.leftEye?.add || "0.00"}
          ` : `<span style="color: #64748b; font-style: italic;">Left Eye (LE / OS): N/A (Single Right Eye lens order)</span>`}
        </div>
      </div>
    </div>
  ` : "";

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Advance Receipt - ${receiptNum}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 24px;
            color: #0f172a;
            background: #ffffff;
            font-size: 12px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 14px;
            margin-bottom: 16px;
          }
          .brand-title {
            font-size: 19px;
            font-weight: 900;
            color: #0f172a;
          }
          .subtext { font-size: 11px; color: #64748b; margin-top: 2px; }
          .receipt-badge {
            background: #fef3c7;
            color: #92400e;
            font-weight: 900;
            font-size: 11px;
            padding: 4px 10px;
            border-radius: 4px;
            border: 1px solid #fde68a;
            display: inline-block;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px 14px;
            margin-bottom: 16px;
            font-size: 11.5px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
          }
          th {
            background: #0f172a;
            color: #ffffff;
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
            padding: 8px 12px;
            text-align: left;
          }
          .totals-section {
            display: grid;
            grid-template-columns: 1.2fr 1fr;
            gap: 16px;
            margin-top: 8px;
          }
          .terms-box {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 10px 12px;
            font-size: 10.5px;
            color: #64748b;
          }
          .financial-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px 14px;
            font-size: 12px;
          }
          .row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
          }
          .advance-row {
            display: flex;
            justify-content: space-between;
            background: #ecfdf5;
            color: #065f46;
            font-weight: 800;
            font-size: 13px;
            padding: 6px 8px;
            border-radius: 4px;
            border: 1px solid #a7f3d0;
            margin: 6px 0;
          }
          .pending-row {
            display: flex;
            justify-content: space-between;
            background: #fffbeb;
            color: #92400e;
            font-weight: 900;
            font-size: 13px;
            padding: 6px 8px;
            border-radius: 4px;
            border: 1px solid #fde68a;
          }
          .footer {
            margin-top: 30px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            border-top: 1px solid #e2e8f0;
            padding-top: 12px;
            font-size: 10.5px;
            color: #94a3b8;
          }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand-title">${storeName}</div>
            <div class="subtext">${storeAddress}</div>
            <div class="subtext">Phone: ${storePhone} | Email: ${storeEmail}</div>
            ${storeGst ? `<div class="subtext" style="font-weight: bold;">${storeGst}</div>` : ""}
          </div>
          <div style="text-align: right;">
            <div class="receipt-badge">ADVANCE PAYMENT RECEIPT</div>
            <div style="font-weight: 800; font-size: 13px; color: #0f172a;">${receiptNum}</div>
            <div class="subtext">Date: ${receiptDate}</div>
            <div class="subtext">Order Ref: <strong>${orderRef}</strong></div>
          </div>
        </div>

        <div class="info-grid">
          <div>
            <div style="font-size: 9px; font-weight: 800; text-transform: uppercase; color: #94a3b8; margin-bottom: 2px;">CUSTOMER / PATIENT</div>
            <div style="font-size: 13px; font-weight: 800; color: #0f172a;">${data.customerName || "Walk-in Customer"}</div>
            <div style="color: #475569;">Mobile: ${data.customerMobile || "—"}</div>
            <div style="color: #64748b;">${data.customerAddress || "Walk-in Patient"}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 9px; font-weight: 800; text-transform: uppercase; color: #94a3b8; margin-bottom: 2px;">BOOKING & PAYMENT STATUS</div>
            <div style="font-weight: 800; color: #92400e; font-size: 12.5px;">Advance Received (Pending Lab Delivery)</div>
            <div style="color: #475569;">Payment Mode: <strong>${data.paymentMethod || "Cash"}</strong></div>
            <div style="color: #64748b;">Final Tax Invoice will be generated upon full settlement.</div>
          </div>
        </div>

        ${rxHtml}

        <table>
          <thead>
            <tr>
              <th style="width: 50%;">Item / Lens Specification</th>
              <th style="text-align: center; width: 12%;">Qty</th>
              <th style="text-align: right; width: 18%;">Unit Price</th>
              <th style="text-align: right; width: 20%;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="totals-section">
          <div class="terms-box">
            <strong style="color: #1e293b; display: block; margin-bottom: 4px;">Advance Deposit Terms:</strong>
            <div>1. Please present this original receipt for fitting and eyewear collection.</div>
            <div>2. Custom prescription lenses cannot be refunded once edging has started.</div>
            <div>3. Balance due is payable at pickup prior to final delivery.</div>
          </div>

          <div class="financial-card">
            <div class="row">
              <span style="color: #64748b;">Total Order Value:</span>
              <span style="font-weight: bold; font-size: 13px;">RS ${grandTotal.toFixed(2)}</span>
            </div>
            
            <div class="advance-row">
              <span>Advance Paid Received:</span>
              <span>RS ${advanceAmount.toFixed(2)}</span>
            </div>

            <div class="pending-row">
              <span>Remaining Balance Due:</span>
              <span>RS ${pendingAmount.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div class="footer">
          <div>Thank you for choosing ${storeName}!</div>
          <div style="text-align: right;">
            <div style="border-bottom: 1px solid #64748b; width: 140px; margin-bottom: 4px; display: inline-block;"></div>
            <div>Cashier / Store Representative</div>
          </div>
        </div>
      </body>
    </html>
  `;

  return printHtmlContent(html, `Advance Receipt - ${receiptNum}`);
}

/**
 * Download Advance Receipt as PDF
 */
export function downloadAdvanceReceiptPDF(
  data: {
    receiptNumber?: string;
    saleNumber?: string;
    orderNumber?: string;
    customerName?: string;
    customerMobile?: string;
    customerAddress?: string;
    items?: any[];
    grandTotal?: number;
    advanceAmount?: number;
    pendingAmount?: number;
    paymentMethod?: string;
    date?: string;
    notes?: string;
  },
  prescription?: Prescription | null,
  storeSettings?: StoreSettings | null
): void {
  const doc = new jsPDF();
  const storeName = storeSettings?.storeName || "OPTIWAY VISION CARE";
  const storeAddress = storeSettings?.address || "742 Vision Avenue, Suite 100, NY 10001";
  const storePhone = storeSettings?.phone || "+1 800-555-0199";
  const receiptNum = data.receiptNumber || "OPT-REC-" + Math.floor(1000 + Math.random() * 9000);
  const orderRef = data.orderNumber || data.saleNumber || "OPT-ORD-" + Math.floor(1000 + Math.random() * 9000);
  const dateStr = data.date || new Date().toISOString().slice(0, 10);
  const grandTotal = data.grandTotal || 0;
  const advanceAmount = data.advanceAmount || 0;
  const pendingAmount = Math.max(0, grandTotal - advanceAmount);

  // Header Banner
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(12, 10, 186, 26, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(storeName, 18, 19);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  doc.text(`${storeAddress}  •  Ph: ${storePhone}`, 18, 26);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(251, 191, 36); // amber-400
  doc.text("ADVANCE RECEIPT", 192, 19, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(`Receipt No: ${receiptNum}`, 192, 26, { align: "right" });
  doc.text(`Date: ${dateStr}  •  Ref: ${orderRef}`, 192, 31, { align: "right" });

  let y = 42;

  // Customer Card
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(12, y, 186, 20, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text("CUSTOMER DETAILS", 18, y + 6);
  doc.text("PAYMENT STATUS", 140, y + 6);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(data.customerName || "Walk-in Customer", 18, y + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(`Mobile: ${data.customerMobile || "N/A"}`, 18, y + 17);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(180, 83, 9);
  doc.text(`Advance Paid (Balance Due: RS ${pendingAmount.toFixed(2)})`, 140, y + 12);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text(`Mode: ${data.paymentMethod || "Cash"}`, 140, y + 17);

  y += 26;

  // Prescription Box if present
  if (prescription) {
    doc.setFillColor(239, 246, 255);
    doc.setDrawColor(191, 219, 254);
    doc.roundedRect(12, y, 186, 18, 2, 2, "FD");

    const eyeSideTag = prescription.eyeSide === "RE" ? " [RIGHT EYE ONLY]" : prescription.eyeSide === "LE" ? " [LEFT EYE ONLY]" : " [PAIR RE+LE]";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(30, 58, 138);
    doc.text(`ATTACHED OPTICAL PRESCRIPTION (Rx)${eyeSideTag}`, 18, y + 6);
    doc.text(`PD: ${prescription.pd ? prescription.pd + " mm" : "Standard"}`, 192, y + 6, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);

    if (prescription.eyeSide !== "LE") {
      doc.text(`RE / OD (Right Eye): SPH ${prescription.rightEye?.sph || "0.00"}, CYL ${prescription.rightEye?.cyl || "0.00"}, AXIS ${prescription.rightEye?.axis || "0"}°, ADD +${prescription.rightEye?.add || "0.00"}`, 18, y + 12);
    } else {
      doc.setTextColor(100, 116, 139);
      doc.text("RE / OD (Right Eye): N/A (Single Left Eye lens order)", 18, y + 12);
      doc.setTextColor(30, 41, 59);
    }

    if (prescription.eyeSide !== "RE") {
      doc.text(`LE / OS (Left Eye): SPH ${prescription.leftEye?.sph || "0.00"}, CYL ${prescription.leftEye?.cyl || "0.00"}, AXIS ${prescription.leftEye?.axis || "0"}°, ADD +${prescription.leftEye?.add || "0.00"}`, 18, y + 16);
    } else {
      doc.setTextColor(100, 116, 139);
      doc.text("LE / OS (Left Eye): N/A (Single Right Eye lens order)", 18, y + 16);
      doc.setTextColor(30, 41, 59);
    }

    y += 24;
  }

  // Items Header
  doc.setFillColor(15, 23, 42);
  doc.rect(12, y, 186, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text("ITEM / PRODUCT", 18, y + 5);
  doc.text("QTY", 120, y + 5, { align: "center" });
  doc.text("PRICE", 155, y + 5, { align: "right" });
  doc.text("TOTAL", 192, y + 5, { align: "right" });

  y += 7;

  // Items Rows
  const items = ensureArray(data.items);
  items.forEach(item => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(241, 245, 249);
    doc.rect(12, y, 186, 7, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(item.productName || "Item", 18, y + 5);

    doc.setFont("helvetica", "normal");
    doc.text(String(item.quantity || 1), 120, y + 5, { align: "center" });
    doc.text(`RS ${(item.price || 0).toFixed(2)}`, 155, y + 5, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(`RS ${(item.total || item.price * (item.quantity || 1) || 0).toFixed(2)}`, 192, y + 5, { align: "right" });

    y += 7;
  });

  y += 6;

  // Financial Box
  const fbX = 112;
  const fbW = 86;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(fbX, y, fbW, 26, 1.5, 1.5, "FD");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text("Total Order Value:", fbX + 4, y + 6);
  doc.setFont("helvetica", "bold");
  doc.text(`RS ${grandTotal.toFixed(2)}`, fbX + fbW - 4, y + 6, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setTextColor(22, 101, 52); // emerald-700
  doc.text("Advance Paid:", fbX + 4, y + 13);
  doc.text(`RS ${advanceAmount.toFixed(2)}`, fbX + fbW - 4, y + 13, { align: "right" });

  doc.setDrawColor(203, 213, 225);
  doc.line(fbX + 4, y + 17, fbX + fbW - 4, y + 17);

  doc.setTextColor(180, 83, 9); // amber-700
  doc.text("Remaining Balance Due:", fbX + 4, y + 22);
  doc.text(`RS ${pendingAmount.toFixed(2)}`, fbX + fbW - 4, y + 22, { align: "right" });

  doc.save(`Advance_Receipt_${receiptNum}.pdf`);
}
