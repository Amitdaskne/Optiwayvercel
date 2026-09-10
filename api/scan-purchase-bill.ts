import { GoogleGenAI } from "@google/genai";
import { getGeminiApiKey } from "./_apiKey";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
    },
  },
  maxDuration: 60,
};

export default async function handler(req: any, res: any) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  try {
    const { fileData, rawText, mimeType, fileName } = req.body || {};

    if (!fileData && !rawText) {
      return res.status(400).json({
        success: false,
        error: "Please provide either document 'fileData' (image/PDF base64) or 'rawText' (copied invoice text)."
      });
    }

    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "GEMINI_API_KEY missing! Please paste your key into 'api/_apiKey.ts' (export const GEMINI_API_KEY = '...') or set it in Vercel Environment Variables."
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });

    const promptInstructions = `You are an expert optical retail procurement & billing auditor.
Analyze this optical invoice/purchase bill (covers optical frames, ophthalmic prescription lenses, contact lenses, sunglasses, accessories, lab charges).
Extract all supplier details, invoice metadata, payment status, and every line item.

Return a valid JSON object matching EXACTLY this schema:
{
  "supplierName": "Company or distributor name (e.g. 'EssilorLuxottica', 'Zeiss Vision Care', 'Safilo', or local distributor)",
  "supplierLedgerId": "Supplier vendor code / ledger ID ONLY if explicitly printed on the bill/invoice, otherwise return ''",
  "supplierPhone": "Supplier contact number if visible, else ''",
  "supplierEmail": "Supplier email if visible, else ''",
  "supplierTaxId": "GSTIN / VAT / Tax ID if visible, else ''",
  "supplierAddress": "Supplier address if visible, else ''",
  "billNumber": "Invoice or Bill reference number (e.g. 'BIL-2026-081')",
  "billDate": "Invoice date in 'YYYY-MM-DD' format (default to today if missing)",
  "dueDate": "Payment due date in 'YYYY-MM-DD' format if present, else ''",
  "paymentStatus": "Paid" | "Unpaid" | "Partial",
  "paymentMethod": "Bank Transfer" | "Cash" | "UPI" | "Cheque" | "Card" | "Credit",
  "subtotal": number (Subtotal before tax in currency/RS),
  "taxRate": number (Overall GST/tax percentage e.g. 18, 12, 5, 0),
  "taxTotal": number (Total tax amount in currency/RS),
  "discountTotal": number (Total invoice discount AMOUNT in currency/RS, NOT a percentage. Can be ANY numerical value from 0.01 to any amount, e.g. 0.01, 0.25, 0.50, 15.75, 120, 2500, etc. If the bill specifies a percentage like 5% or 10%, calculate and return the exact currency discount amount. Default to 0 ONLY if no discount is present on the bill),
  "grandTotal": number (Net invoice total payable in currency/RS),
  "items": [
    {
      "name": "Full optical product name (e.g. 'Ray-Ban Aviator RB3025 Gold', 'Zeiss Single Vision ClearView 1.60')",
      "modelNumber": "Article Model Number / Code or SKU from invoice (e.g. 'MOD-RB3025', 'RB3025-001', 'LNS-ZS160')",
      "sku": "Article Model Number / Code or SKU from invoice (e.g. 'MOD-RB3025', 'RB3025-001', 'LNS-ZS160')",
      "barcode": "Barcode or EAN-13/UPC 12-13 digit number if printed on invoice (e.g. '8053672495669'). Barcode is DIFFERENT from HSN code. Return '' if not present",
      "hsnCode": "HSN/SAC 4-8 digit tax classification code (e.g. '9003', '90041000', '90014000', '9001', '9002'). HSN code is strictly a government tax classification code and is DIFFERENT from barcode. Return '' if not present",
      "size": "Optical frame eye size or lens dimensions if mentioned on bill (e.g. '54', '54/24', '52-18-140', '58mm', '8.5 BC'). Return '' if not present",
      "color": "Frame colour or lens color code if mentioned on bill (e.g. 'Red', 'C2', 'C43', 'Matte Black', 'Gold', 'Silver', 'Tortoise'). Return '' if not present",
      "category": "Frame" | "Lens" | "Contact Lens" | "Accessories" | "Services",
      "brand": "Brand name (e.g. 'Ray-Ban', 'Zeiss', 'Essilor', 'Oakley', 'Titan', 'Acuvue', 'OptiWay')",
      "model": "Model or specification e.g. 'RB3025 Aviator' or '1.60 Index Anti-Reflective'",
      "quantity": number (integer >= 1),
      "purchasePrice": number (Unit cost/purchase price before or net of tax),
      "sellingPrice": number (Retail Selling Price / MRP. If not printed on bill, calculate standard optical retail price with 1.8x - 2.0x markup over purchase price),
      "taxRate": number (Item tax percentage, e.g. 18),
      "discount": number (Item-level discount amount in currency if present, e.g. 0.01 to any value, else 0),
      "minStockLevel": number (Default 3 to 5)
    }
  ],
  "notes": "Any payment terms, remarks or optical lab notes"
}

Important rules:
1. Ensure all numeric amounts are pure numbers (no currency symbols or commas).
2. HSN code and Barcode MUST NOT be confused: HSN/SAC is the 4-8 digit tax code (e.g. 9003, 9004, 9001), while Barcode is the EAN/UPC product barcode.
3. If size (e.g. 54, 54/24, 52-18-140) or colour (e.g. Red, C2, C43) is present in the bill item description or columns, extract them into 'size' and 'color'. If not present, return empty string ''.
4. If sellingPrice is not specified, multiply purchasePrice by 1.8 to 2.0 to calculate a sensible optical retail price.
5. If multiple items are listed in rows, parse every row accurately. If it's a single item or description, parse it as a single line item.
6. Output MUST be ONLY valid JSON.`;

    const contentsList: any[] = [];

    if (fileData) {
      let cleanBase64 = fileData;
      let detectedMime = mimeType || "application/pdf";

      if (fileData.includes(";base64,")) {
        const parts = fileData.split(";base64,");
        const match = parts[0].match(/data:(.*?)$/);
        if (match && match[1]) {
          detectedMime = match[1];
        }
        cleanBase64 = parts[1];
      }

      if (detectedMime.includes("pdf")) {
        detectedMime = "application/pdf";
      } else if (detectedMime.includes("jpeg") || detectedMime.includes("jpg")) {
        detectedMime = "image/jpeg";
      } else if (detectedMime.includes("png")) {
        detectedMime = "image/png";
      } else if (detectedMime.includes("webp")) {
        detectedMime = "image/webp";
      }

      contentsList.push({
        inlineData: {
          mimeType: detectedMime,
          data: cleanBase64
        }
      });
    }

    if (rawText) {
      contentsList.push(`Raw Invoice / Purchase Bill Text to parse:\n${rawText}`);
    }

    contentsList.push(promptInstructions);

    // Preferred candidate models per Gemini SDK guidelines with automatic retry on transient or network errors
    const candidateModels = ["gemini-2.5-flash", "gemini-3.7-flash", "gemini-2.5-flash-lite"];
    let responseText = "";
    let lastError: any = null;

    for (const modelName of candidateModels) {
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts) {
        attempts++;
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: contentsList,
            config: {
              responseMimeType: "application/json"
            }
          });

          if (response && response.text) {
            responseText = response.text;
            break;
          }
        } catch (modelErr: any) {
          lastError = modelErr;
          const errMsg = String(modelErr?.message || modelErr);
          const isTransient = modelErr?.status === 503 || modelErr?.status === 429 ||
            errMsg.includes("503") || errMsg.includes("demand") || errMsg.includes("rate") || errMsg.includes("fetch failed") || errMsg.includes("ECONNRESET");

          if (isTransient && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          console.warn(`Model ${modelName} attempt ${attempts} failed:`, errMsg);
          break;
        }
      }

      if (responseText) {
        break;
      }
    }

    if (!responseText) {
      throw new Error(lastError?.message || "No response received from AI models.");
    }

    let parsedData: any;
    try {
      parsedData = JSON.parse(responseText);
    } catch (parseError) {
      const cleaned = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
      parsedData = JSON.parse(cleaned);
    }

    // Ensure minimal default fields if omitted
    if (!parsedData.items || !Array.isArray(parsedData.items)) {
      parsedData.items = [];
    } else {
      parsedData.items = parsedData.items.map((item: any, idx: number) => {
        const purchasePrice = typeof item.purchasePrice === "number" ? item.purchasePrice : (parseFloat(String(item.purchasePrice || 0).replace(/[^0-9.]/g, "")) || 0);
        const sellingPrice = typeof item.sellingPrice === "number" ? item.sellingPrice : (parseFloat(String(item.sellingPrice || 0).replace(/[^0-9.]/g, "")) || (purchasePrice > 0 ? Math.round(purchasePrice * 1.8) : 0));
        const quantity = parseInt(String(item.quantity || 1).replace(/[^0-9]/g, "")) || 1;
        const taxRate = typeof item.taxRate === "number" ? item.taxRate : (parseFloat(String(item.taxRate || 18).replace(/[^0-9.]/g, "")) || 18);
        const discount = typeof item.discount === "number" ? item.discount : (parseFloat(String(item.discount || 0).replace(/[^0-9.]/g, "")) || 0);

        const modelNumberVal = String(item.modelNumber || item.sku || `MOD-${Math.floor(1000 + Math.random() * 9000)}`).trim();

        // Auto-generate unique 12-13 digit optical barcode if not explicitly printed on invoice
        const rawBarcode = item.barcode ? String(item.barcode).trim() : "";
        const generatedBarcode = rawBarcode || `890${Math.floor(100000000 + Math.random() * 900000000)}`;

        return {
          name: String(item.name || `Optical Item #${idx + 1}`).trim(),
          modelNumber: modelNumberVal,
          sku: modelNumberVal,
          barcode: generatedBarcode,
          hsnCode: item.hsnCode ? String(item.hsnCode).trim() : "",
          size: item.size ? String(item.size).trim() : "",
          color: item.color ? String(item.color).trim() : (item.colour ? String(item.colour).trim() : ""),
          category: item.category || "Frame",
          brand: String(item.brand || "OptiWay").trim(),
          model: String(item.model || "").trim(),
          quantity: Math.max(1, quantity),
          purchasePrice: Math.max(0, purchasePrice),
          sellingPrice: Math.max(0, sellingPrice),
          taxRate: Math.max(0, taxRate),
          discount: Math.max(0, discount),
          minStockLevel: item.minStockLevel || 3
        };
      });
    }
    if (!parsedData.supplierName) {
      parsedData.supplierName = "Optical Supplier";
    }
    if (!parsedData.billNumber) {
      parsedData.billNumber = `BIL-${Date.now().toString().slice(-6)}`;
    }
    if (!parsedData.billDate) {
      parsedData.billDate = new Date().toISOString().slice(0, 10);
    }

    if (parsedData.discountTotal !== undefined && parsedData.discountTotal !== null) {
      const parsedDisc = parseFloat(String(parsedData.discountTotal).replace(/[^0-9.]/g, ""));
      parsedData.discountTotal = !isNaN(parsedDisc) && parsedDisc >= 0 ? parsedDisc : 0;
    } else {
      parsedData.discountTotal = 0;
    }

    if (parsedData.subtotal !== undefined && parsedData.subtotal !== null) {
      const parsedSub = parseFloat(String(parsedData.subtotal).replace(/[^0-9.]/g, ""));
      parsedData.subtotal = !isNaN(parsedSub) && parsedSub >= 0 ? parsedSub : 0;
    }
    if (parsedData.taxTotal !== undefined && parsedData.taxTotal !== null) {
      const parsedTax = parseFloat(String(parsedData.taxTotal).replace(/[^0-9.]/g, ""));
      parsedData.taxTotal = !isNaN(parsedTax) && parsedTax >= 0 ? parsedTax : 0;
    }
    if (parsedData.taxRate !== undefined && parsedData.taxRate !== null) {
      const parsedRate = parseFloat(String(parsedData.taxRate).replace(/[^0-9.]/g, ""));
      parsedData.taxRate = !isNaN(parsedRate) && parsedRate >= 0 ? parsedRate : 18;
    }
    if (parsedData.grandTotal !== undefined && parsedData.grandTotal !== null) {
      const parsedGrand = parseFloat(String(parsedData.grandTotal).replace(/[^0-9.]/g, ""));
      parsedData.grandTotal = !isNaN(parsedGrand) && parsedGrand >= 0 ? parsedGrand : 0;
    }

    return res.json({
      success: true,
      fileName: fileName || "scanned_bill",
      data: parsedData
    });
  } catch (err: any) {
    console.error("Purchase bill scanning failed:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to process and extract purchase bill data with AI."
    });
  }
}
