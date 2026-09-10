import { 
  initAuthGuard, 
  loginWithEmail, 
  registerAuthorizedOwner, 
  sendOwnerPasswordReset, 
  AUTHORIZED_OWNER_EMAIL 
} from "../lib/auth";

// Initialize public auth guard (redirects to dashboard if already authenticated as amitdaskishanganj@gmail.com)
initAuthGuard({ isPublicPage: true });

const loginForm = document.getElementById("login-form") as HTMLFormElement;
const emailInput = document.getElementById("login-email") as HTMLInputElement;
const passwordInput = document.getElementById("login-password") as HTMLInputElement;
const errorAlert = document.getElementById("login-error-alert") as HTMLDivElement;
const successAlert = document.getElementById("login-success-alert") as HTMLDivElement;
const submitBtn = document.getElementById("btn-login-submit") as HTMLButtonElement;
const submitText = document.getElementById("btn-submit-text") as HTMLSpanElement;
const togglePasswordBtn = document.getElementById("btn-toggle-password") as HTMLButtonElement;
const forgotPasswordBtn = document.getElementById("btn-forgot-password") as HTMLButtonElement;
const createAccountToggle = document.getElementById("btn-create-account-toggle") as HTMLButtonElement;

let isCreateMode = false;

// Check URL params for error
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("error") === "unauthorized") {
  showError(`Access Denied: Only ${AUTHORIZED_OWNER_EMAIL} is authorized to access Optiway.`);
}

// Toggle create mode vs sign in mode
createAccountToggle?.addEventListener("click", () => {
  isCreateMode = !isCreateMode;
  errorAlert?.classList.add("hidden");
  successAlert?.classList.add("hidden");

  if (isCreateMode) {
    if (submitText) submitText.innerText = "Set Password & Activate";
    if (createAccountToggle) createAccountToggle.innerText = "Back to Sign In";
    if (passwordInput) passwordInput.placeholder = "Create new password (min 6 chars)";
  } else {
    if (submitText) submitText.innerText = "Sign In";
    if (createAccountToggle) createAccountToggle.innerText = "Create / Set Password";
    if (passwordInput) passwordInput.placeholder = "Enter your password";
  }
});

// Toggle password visibility
togglePasswordBtn?.addEventListener("click", () => {
  if (passwordInput) {
    passwordInput.type = passwordInput.type === "password" ? "text" : "password";
  }
});

// Forgot Password handler
forgotPasswordBtn?.addEventListener("click", async () => {
  hideAlerts();
  forgotPasswordBtn.disabled = true;
  forgotPasswordBtn.innerText = "Sending link...";

  try {
    const result = await sendOwnerPasswordReset();
    if (result.success) {
      showSuccess(result.message || `Reset link sent to ${AUTHORIZED_OWNER_EMAIL}`);
    } else {
      showError(result.message || "Failed to send reset email.");
    }
  } catch (err: any) {
    showError(err.message || "Error sending reset email.");
  } finally {
    forgotPasswordBtn.disabled = false;
    forgotPasswordBtn.innerText = "Forgot password?";
  }
});

// Email/Password form submit handler
loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlerts();

  const email = (emailInput?.value || AUTHORIZED_OWNER_EMAIL).trim();
  const password = passwordInput?.value || "";

  if (!password) {
    showError("Please enter your password.");
    return;
  }

  if (submitBtn) submitBtn.disabled = true;

  if (isCreateMode) {
    if (submitText) submitText.innerText = "Creating account...";
    const result = await registerAuthorizedOwner(password);
    if (result.success) {
      showSuccess("Password set successfully! Redirecting...");
      window.location.replace("dashboard.html");
    } else {
      showError(result.message || "Failed to set password.");
      if (submitBtn) submitBtn.disabled = false;
      if (submitText) submitText.innerText = "Set Password & Activate";
    }
  } else {
    if (submitText) submitText.innerText = "Signing in...";
    const result = await loginWithEmail(email, password);
    if (result.success) {
      showSuccess("Signed in successfully! Redirecting...");
      window.location.replace("dashboard.html");
    } else {
      showError(result.message || "Failed to sign in. Please verify your password.");
      if (submitBtn) submitBtn.disabled = false;
      if (submitText) submitText.innerText = "Sign In";
    }
  }
});

function hideAlerts() {
  if (errorAlert) errorAlert.classList.add("hidden");
  if (successAlert) successAlert.classList.add("hidden");
}

function showError(msg: string) {
  if (errorAlert) {
    errorAlert.innerText = msg;
    errorAlert.classList.remove("hidden");
  }
}

function showSuccess(msg: string) {
  if (successAlert) {
    successAlert.innerText = msg;
    successAlert.classList.remove("hidden");
  }
}
