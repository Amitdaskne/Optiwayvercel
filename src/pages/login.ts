import { initAuthGuard, loginWithEmail, loginAsDemo } from "../lib/auth";

// Initialize public auth guard (prevents loop, redirects to dashboard if authenticated)
initAuthGuard({ isPublicPage: true });

const loginForm = document.getElementById("login-form") as HTMLFormElement;
const emailInput = document.getElementById("login-email") as HTMLInputElement;
const passwordInput = document.getElementById("login-password") as HTMLInputElement;
const errorAlert = document.getElementById("login-error-alert") as HTMLDivElement;
const submitBtn = document.getElementById("btn-login-submit") as HTMLButtonElement;
const demoBtn = document.getElementById("btn-demo-login") as HTMLButtonElement;

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorAlert.classList.add("hidden");

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showError("Please fill in both email address and password.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span>Signing in...</span>`;

  const result = await loginWithEmail(email, password);
  if (result.success) {
    window.location.replace("dashboard.html");
  } else {
    showError(result.message || "Failed to sign in. Please verify your email and password.");
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Sign In to Terminal</span>`;
  }
});

demoBtn?.addEventListener("click", async () => {
  demoBtn.disabled = true;
  demoBtn.innerText = "Accessing Demo...";
  await loginAsDemo();
});

function showError(msg: string) {
  errorAlert.innerText = msg;
  errorAlert.classList.remove("hidden");
}
