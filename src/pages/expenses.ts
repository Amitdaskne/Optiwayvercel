import { initAuthGuard } from "../lib/auth";
import { renderAppLayout, Toast } from "../components/layout";
import { dbService, Expense } from "../lib/db";

let expensesList: Expense[] = [];

initAuthGuard({
  onUserReady: async (user) => {
    renderAppLayout("expenses", "Operating Expense Tracker", user);
    await loadExpensesData();
  }
});

async function loadExpensesData() {
  try {
    expensesList = await dbService.getList<Expense>("expenses");
    renderTotalSummary();
    renderExpensesTable();
    setupEvents();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("action") === "add") {
      openAddExpenseModal();
    }
  } catch (err) {
    console.error("Failed to load expenses:", err);
    Toast.show("Failed to load expense records.", "error");
  }
}

function renderTotalSummary() {
  const total = expensesList.reduce((sum, e) => sum + (e.amount || 0), 0);
  const totalEl = document.getElementById("exp-total-amount");
  if (totalEl) totalEl.innerText = `RS ${(total || 0).toFixed(2)}`;
}

function renderExpensesTable() {
  const tbody = document.getElementById("tbl-expenses-body")!;
  const query = (document.getElementById("exp-search") as HTMLInputElement)?.value.trim().toLowerCase() || "";
  const catFilter = (document.getElementById("exp-cat-filter") as HTMLSelectElement)?.value || "All";

  const filtered = expensesList.filter(e => {
    const matchSearch = (e.description || "").toLowerCase().includes(query) || (e.category || "").toLowerCase().includes(query);
    const matchCat = catFilter === "All" || e.category === catFilter;
    return matchSearch && matchCat;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400">No expense logs recorded.</td></tr>`;
    return;
  }

  const sorted = [...filtered].sort((a, b) => new Date(b.expenseDate).getTime() - new Date(a.expenseDate).getTime());

  tbody.innerHTML = sorted.map(e => `
    <tr class="hover:bg-slate-50 transition-colors">
      <td class="p-3.5 font-medium text-slate-700">${e.expenseDate}</td>
      <td class="p-3.5">
        <span class="px-2.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-800">${e.category}</span>
      </td>
      <td class="p-3.5 text-slate-900 font-medium">${e.description}</td>
      <td class="p-3.5 text-slate-500">${e.paymentMethod || "Cash"}</td>
      <td class="p-3.5 font-bold text-rose-600">RS ${(e.amount || 0).toFixed(2)}</td>
      <td class="p-3.5 text-right">
        <button class="btn-del-exp font-bold text-rose-600 hover:underline text-xs" data-id="${e.id}">Delete</button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btn-del-exp").forEach(btn => {
    btn.addEventListener("click", () => deleteExpense(btn.getAttribute("data-id")!));
  });
}

function setupEvents() {
  document.getElementById("exp-search")?.addEventListener("input", renderExpensesTable);
  document.getElementById("exp-cat-filter")?.addEventListener("change", renderExpensesTable);
  document.getElementById("btn-open-add-exp")?.addEventListener("click", openAddExpenseModal);
  document.getElementById("btn-close-exp-modal")?.addEventListener("click", closeExpenseModal);
  document.getElementById("btn-cancel-exp-modal")?.addEventListener("click", closeExpenseModal);

  document.getElementById("form-exp")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const category = (document.getElementById("exp-category") as HTMLSelectElement).value as Expense["category"];
    const amount = parseFloat((document.getElementById("exp-amount") as HTMLInputElement).value) || 0;
    const expenseDate = (document.getElementById("exp-date") as HTMLInputElement).value || new Date().toISOString().slice(0, 10);
    const paymentMethod = ((document.getElementById("exp-payment-method") as HTMLSelectElement).value || "Cash") as Expense["paymentMethod"];
    const description = (document.getElementById("exp-description") as HTMLInputElement).value.trim();

    if (!description || amount <= 0) {
      Toast.show("Description and a valid amount are required.", "error");
      return;
    }

    const payload: Partial<Expense> = {
      category,
      amount,
      date: expenseDate,
      expenseDate,
      paymentMethod,
      description,
      createdAt: new Date().toISOString()
    };

    await dbService.saveItem("expenses", payload);
    Toast.show(`Expense of RS ${(amount || 0).toFixed(2)} recorded.`, "success");
    closeExpenseModal();
    await loadExpensesData();
  });
}

function openAddExpenseModal() {
  (document.getElementById("form-exp") as HTMLFormElement).reset();
  (document.getElementById("exp-date") as HTMLInputElement).value = new Date().toISOString().slice(0, 10);
  document.getElementById("modal-exp")?.classList.remove("hidden");
}

function closeExpenseModal() {
  document.getElementById("modal-exp")?.classList.add("hidden");
}

async function deleteExpense(id: string) {
  if (confirm("Are you sure you want to delete this expense record?")) {
    await dbService.deleteItem("expenses", id);
    Toast.show("Expense log deleted.", "success");
    await loadExpensesData();
  }
}
