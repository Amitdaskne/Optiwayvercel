import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyALHFd8-PhTpNSn8ipHlLsQYeUjEiBDRMs",
  authDomain: "chat2-6bd92.firebaseapp.com",
  databaseURL: "https://chat2-6bd92-default-rtdb.firebaseio.com",
  projectId: "chat2-6bd92",
  storageBucket: "chat2-6bd92.appspot.com",
  messagingSenderId: "1052210817036",
  appId: "1:1052210817036:web:80674c39836371f46487e4"
};

// Global error handler for background database connection closing or hidden tab events
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    const reasonMsg = event.reason?.message || String(event.reason || "");
    if (
      reasonMsg.includes("Database is closing") ||
      reasonMsg.includes("hidden") ||
      reasonMsg.includes("closing") ||
      event.reason?.name === "InvalidStateError"
    ) {
      event.preventDefault();
      console.warn("Handled background database closing/hidden error gracefully:", reasonMsg);
    }
  });
}

// Initialize Firebase App once
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);
export const rtdb = getDatabase(app);

let firestoreInstance: ReturnType<typeof getFirestore> | null = null;
export function getFirestoreDb() {
  if (!firestoreInstance) {
    firestoreInstance = getFirestore(app);
  }
  return firestoreInstance;
}
export const storage = getStorage(app);

/**
 * Format Firebase error messages into clean user-friendly messages without emojis.
 */
export function formatFirebaseError(error: any): string {
  if (!error) return "An unexpected error occurred. Please try again.";
  const code = error.code || "";
  const message = error.message || String(error);

  switch (code) {
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Invalid email address or password. Please check your credentials.";
    case "auth/email-already-in-use":
      return "An account with this email address already exists.";
    case "auth/weak-password":
      return "Password should be at least 6 characters long.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Please wait a few minutes before trying again.";
    case "auth/network-request-failed":
      return "Network connection issue. Please check your internet connection.";
    case "PERMISSION_DENIED":
    case "permission-denied":
      return "Access denied. You do not have permission to perform this action.";
    default:
      if (message.includes("network") || message.includes("offline")) {
        return "Network connection unavailable. Please verify your internet connection.";
      }
      return "Operation failed. Please verify input data and try again.";
  }
}
