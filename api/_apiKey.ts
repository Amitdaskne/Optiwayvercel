/**
 * ============================================================================
 * GEMINI API KEY CONFIGURATION (Vercel & Local Server)
 * ============================================================================
 * Agar aap Vercel Dashboard par Environment Variables (GEMINI_API_KEY) set nahi kar pa rahe hain,
 * toh aap apni Gemini API Key seedhe yahan niche quotes ke andar daal sakte hain:
 *
 * Example:
 * export const GEMINI_API_KEY = "AIzaSyD-your-actual-api-key-here";
 * ============================================================================
 */

export const GEMINI_API_KEY: string = "AIzaSyCe6SPRFnMpAXyyWfWwv7rSWU2DupI4MmI";

/**
 * Helper function to retrieve the Gemini API key from environment variables
 * or fall back to the manual GEMINI_API_KEY constant above.
 */
export function getGeminiApiKey(): string {
  let raw = (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || GEMINI_API_KEY || "").trim();

  // Remove wrapping quotes if user pasted with quotes like '"AIza..."' or "'AIza...'"
  raw = raw.replace(/^['"`]+|['"`]+$/g, "").trim();

  // Remove "Bearer " prefix if user accidentally included it
  if (raw.toLowerCase().startsWith("bearer ")) {
    raw = raw.slice(7).trim();
  }

  return raw;
}

/**
 * Validates whether the key is a valid Gemini API Key or accidentally an OAuth credential.
 */
export function validateGeminiApiKey(key: string): { valid: boolean; error?: string } {
  if (!key || key.length === 0) {
    return {
      valid: false,
      error: "GEMINI_API_KEY nahi mili! Kripya 'api/_apiKey.ts' file me 'export const GEMINI_API_KEY = \"...\";' me apni key daalein ya Vercel Environment Variables me set karein."
    };
  }

  // Common user mistake: pasting Google Cloud OAuth Client ID
  if (key.includes(".apps.googleusercontent.com")) {
    return {
      valid: false,
      error: "Galat Key! Aapne Google OAuth Client ID paste kiya hai (...apps.googleusercontent.com). Gemini AI ke liye 'API Key' chahiye hoti hai jo 'AIzaSy...' se start hoti hai. Kripya https://aistudio.google.com/app/apikey se 'Create API Key' banayein."
    };
  }

  // Common user mistake: pasting OAuth Client Secret
  if (key.startsWith("GOCSPX-")) {
    return {
      valid: false,
      error: "Galat Key! Yeh OAuth Client Secret hai ('GOCSPX-...'). Kripya https://aistudio.google.com/app/apikey par jakar 'Create API Key' karein."
    };
  }

  // Common user mistake: pasting temporary OAuth access token
  if (key.startsWith("ya29.")) {
    return {
      valid: false,
      error: "Yeh temporary Google OAuth access token hai ('ya29...'). Gemini AI ke liye permanent API Key chahiye jo 'AIzaSy...' se start hoti hai."
    };
  }

  return { valid: true };
}
