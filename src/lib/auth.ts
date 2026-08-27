import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut as firebaseSignOut,
  User 
} from "firebase/auth";
import { auth, formatFirebaseError } from "./firebase";

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
 * Listens to onAuthStateChanged and performs clean navigation based on page protection.
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

  // Prevent multiple executions
  if (authInitialized) return;
  authInitialized = true;

  let handled = false;

  const demoProfile: UserProfile = {
    uid: "demo-optician-001",
    email: "admin@optiway.com",
    displayName: "OPTIWAY Admin",
    role: "Store Manager"
  };

  function processUser(user: UserProfile | null) {
    if (handled) return;
    handled = true;

    if (user) {
      currentUserProfile = user;
      localStorage.setItem("optiway_auth_state", "authenticated");

      if (isIndexPage || (isPublicPage && (currentPath.endsWith("/login.html") || currentPath.endsWith("/login")))) {
        window.location.replace("dashboard.html");
        return;
      }

      if (options.onUserReady) {
        options.onUserReady(user);
      }
    } else {
      currentUserProfile = null;
      localStorage.removeItem("optiway_auth_state");

      const localDemoBypass = localStorage.getItem("optiway_demo_mode") !== "false";

      if (localDemoBypass) {
        currentUserProfile = demoProfile;
        localStorage.setItem("optiway_demo_mode", "true");
        if (isIndexPage || (isPublicPage && (currentPath.endsWith("/login.html") || currentPath.endsWith("/login")))) {
          window.location.replace("dashboard.html");
          return;
        }
        if (options.onUserReady) {
          options.onUserReady(demoProfile);
        }
        return;
      }

      if (isIndexPage || (!isPublicPage && !currentPath.endsWith("/login.html") && !currentPath.endsWith("/login"))) {
        window.location.replace("login.html");
        return;
      }
    }
  }

  // Instant check for index page redirect
  const hasAuth = localStorage.getItem("optiway_auth_state") === "authenticated";
  const isDemo = localStorage.getItem("optiway_demo_mode") !== "false";

  if (isIndexPage) {
    if (hasAuth || isDemo) {
      window.location.replace("dashboard.html");
      return;
    } else {
      window.location.replace("login.html");
      return;
    }
  }

  // Fast safety timeout in case Firebase Auth onAuthStateChanged takes time or hangs
  const timeoutId = setTimeout(() => {
    if (!handled) {
      if (hasAuth || isDemo) {
        processUser(demoProfile);
      } else {
        processUser(null);
      }
    }
  }, 250);

  try {
    onAuthStateChanged(
      auth,
      (user: User | null) => {
        clearTimeout(timeoutId);
        if (user) {
          processUser({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || user.email?.split("@")[0] || "OPTICIAN Admin",
            role: "Store Manager"
          });
        } else {
          processUser(null);
        }
      },
      (err) => {
        clearTimeout(timeoutId);
        console.warn("Auth state change error, using fallback profile:", err);
        processUser(demoProfile);
      }
    );
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn("Auth initialization error, using fallback profile:", err);
    processUser(demoProfile);
  }
}

/**
 * Login with email and password
 */
export async function loginWithEmail(email: string, pass: string): Promise<{ success: boolean; message?: string }> {
  try {
    localStorage.removeItem("optiway_demo_mode");
    await signInWithEmailAndPassword(auth, email, pass);
    return { success: true };
  } catch (error) {
    return { success: false, message: formatFirebaseError(error) };
  }
}

/**
 * Fast Demo Login for quick testing
 */
export async function loginAsDemo(): Promise<void> {
  localStorage.setItem("optiway_demo_mode", "true");
  localStorage.setItem("optiway_auth_state", "authenticated");
  window.location.replace("dashboard.html");
}

/**
 * Sign out current user
 */
export async function logoutUser(): Promise<void> {
  localStorage.removeItem("optiway_demo_mode");
  localStorage.removeItem("optiway_auth_state");
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
  if (!currentUserProfile && localStorage.getItem("optiway_demo_mode") === "true") {
    return {
      uid: "demo-optician-001",
      email: "admin@optiway.com",
      displayName: "OPTIWAY Admin",
      role: "Store Manager"
    };
  }
  return currentUserProfile;
}
