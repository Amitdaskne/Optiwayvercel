import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  User 
} from "firebase/auth";
import { auth, formatFirebaseError } from "./firebase";

export const AUTHORIZED_OWNER_EMAIL = "amitdaskishanganj@gmail.com";

export function isAuthorizedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === AUTHORIZED_OWNER_EMAIL.toLowerCase();
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: string;
}

let currentUserProfile: UserProfile | null = null;
let authInitialized = false;

/**
 * Initialize page authentication guard.
 * Strictly verifies that the signed in Firebase user is amitdaskishanganj@gmail.com.
 * Unauthenticated or unauthorized users are denied entry and redirected to login.
 */
export function initAuthGuard(options: {
  isPublicPage?: boolean;
  onUserReady?: (user: UserProfile) => void;
}) {
  const isPublicPage = options.isPublicPage ?? false;
  const currentPath = window.location.pathname.toLowerCase();
  const isIndexPage =
    currentPath === "/" ||
    currentPath.endsWith("/index.html") ||
    currentPath.endsWith("/index") ||
    currentPath === "";
  const isLoginPage =
    currentPath.endsWith("/login.html") ||
    currentPath.endsWith("/login");

  if (authInitialized) return;
  authInitialized = true;

  let handled = false;

  async function processUser(user: User | null) {
    if (handled) return;
    handled = true;

    if (user && isAuthorizedEmail(user.email)) {
      currentUserProfile = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || "Amit Das (Owner)",
        role: "Store Owner / Administrator"
      };
      localStorage.setItem("optiway_auth_state", "authenticated");
      localStorage.setItem("optiway_auth_email", user.email || AUTHORIZED_OWNER_EMAIL);

      if (isIndexPage || isLoginPage) {
        window.location.replace("dashboard.html");
        return;
      }

      if (options.onUserReady) {
        options.onUserReady(currentUserProfile);
      }
    } else {
      currentUserProfile = null;
      localStorage.removeItem("optiway_auth_state");
      localStorage.removeItem("optiway_auth_email");

      // If a non-authorized user somehow had a Firebase session, immediately sign out
      if (user && !isAuthorizedEmail(user.email)) {
        try {
          await firebaseSignOut(auth);
        } catch {
          // ignore
        }
      }

      if (isIndexPage || (!isPublicPage && !isLoginPage)) {
        window.location.replace("login.html");
        return;
      }
    }
  }

  // Check onAuthStateChanged directly from Firebase
  try {
    onAuthStateChanged(auth, async (user: User | null) => {
      await processUser(user);
    });
  } catch (err) {
    console.error("Firebase Auth initialization error:", err);
    processUser(null);
  }
}

/**
 * Login with email and password strictly for amitdaskishanganj@gmail.com
 */
export async function loginWithEmail(email: string, pass: string): Promise<{ success: boolean; message?: string }> {
  const cleanEmail = email.trim().toLowerCase();

  if (!isAuthorizedEmail(cleanEmail)) {
    return {
      success: false,
      message: `Access Denied: Only ${AUTHORIZED_OWNER_EMAIL} is authorized to access this Optiway terminal.`
    };
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, AUTHORIZED_OWNER_EMAIL, pass);
    if (!isAuthorizedEmail(cred.user.email)) {
      await firebaseSignOut(auth);
      return {
        success: false,
        message: `Access Denied: Only ${AUTHORIZED_OWNER_EMAIL} is authorized.`
      };
    }
    return { success: true };
  } catch (error: any) {
    const code = error?.code || "";
    if (code === "auth/user-not-found" || code === "auth/invalid-credential") {
      return {
        success: false,
        message: `Invalid password or account not created yet for ${AUTHORIZED_OWNER_EMAIL}. You can also create your password or use Google Sign-In.`
      };
    }
    return { success: false, message: formatFirebaseError(error) };
  }
}

/**
 * Login with Google strictly for amitdaskishanganj@gmail.com
 */
export async function loginWithGoogle(): Promise<{ success: boolean; message?: string }> {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: "select_account",
      login_hint: AUTHORIZED_OWNER_EMAIL
    });

    const result = await signInWithPopup(auth, provider);
    const userEmail = result.user?.email || "";

    if (!isAuthorizedEmail(userEmail)) {
      await firebaseSignOut(auth);
      return {
        success: false,
        message: `Access Denied: You signed in with '${userEmail}'. Only ${AUTHORIZED_OWNER_EMAIL} is authorized.`
      };
    }

    return { success: true };
  } catch (error: any) {
    if (error?.code === "auth/popup-closed-by-user") {
      return { success: false, message: "Google sign-in popup was closed." };
    }
    return { success: false, message: formatFirebaseError(error) };
  }
}

/**
 * Register or set initial password for amitdaskishanganj@gmail.com in Firebase Auth
 */
export async function registerAuthorizedOwner(password: string): Promise<{ success: boolean; message?: string }> {
  if (!password || password.length < 6) {
    return { success: false, message: "Password must be at least 6 characters long." };
  }

  try {
    await createUserWithEmailAndPassword(auth, AUTHORIZED_OWNER_EMAIL, password);
    return { success: true };
  } catch (error: any) {
    if (error?.code === "auth/email-already-in-use") {
      // Account exists, try signing in with this password
      try {
        await signInWithEmailAndPassword(auth, AUTHORIZED_OWNER_EMAIL, password);
        return { success: true };
      } catch (signInErr: any) {
        return {
          success: false,
          message: `Account for ${AUTHORIZED_OWNER_EMAIL} already exists in Firebase Auth. Please use 'Sign In' or 'Reset Password'.`
        };
      }
    }
    return { success: false, message: formatFirebaseError(error) };
  }
}

/**
 * Send password reset email to amitdaskishanganj@gmail.com
 */
export async function sendOwnerPasswordReset(): Promise<{ success: boolean; message?: string }> {
  try {
    await sendPasswordResetEmail(auth, AUTHORIZED_OWNER_EMAIL);
    return {
      success: true,
      message: `Password reset link sent to ${AUTHORIZED_OWNER_EMAIL}. Please check your inbox / spam folder.`
    };
  } catch (error: any) {
    return { success: false, message: formatFirebaseError(error) };
  }
}

/**
 * Sign out current user
 */
export async function logoutUser(): Promise<void> {
  localStorage.removeItem("optiway_auth_state");
  localStorage.removeItem("optiway_auth_email");
  try {
    await firebaseSignOut(auth);
  } catch (err) {
    console.error("Logout error:", err);
  }
  window.location.replace("login.html");
}

/**
 * Get current user profile synchronously
 */
export function getCurrentUser(): UserProfile | null {
  return currentUserProfile;
}
