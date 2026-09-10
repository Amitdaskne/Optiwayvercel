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

export const GEMINI_API_KEY: string = "";

/**
 * Helper function to retrieve the Gemini API key from environment variables
 * or fall back to the manual GEMINI_API_KEY constant above.
 */
export function getGeminiApiKey(): string {
  const envKey = (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "").trim();
  if (envKey.length > 0) {
    return envKey;
  }

  const manualKey = (GEMINI_API_KEY || "").trim();
  if (manualKey.length > 0) {
    return manualKey;
  }

  return "";
}
