// Vercel serverless function: reads one delivery docket, merchant receipt or
// supplier invoice (photo or PDF) with Claude and returns its fields as JSON
// for the app to prefill a delivery / cost entry.
//
// Lives under /api so Vercel deploys it alongside the Vite app with no extra
// config. The Anthropic key never reaches the browser — set ANTHROPIC_API_KEY
// in Vercel > Settings > Environment Variables. The caller must send their
// Supabase session token; it's verified here before the model is called.
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { COST_CATEGORY_OPTIONS } from "../src/lib/costCategories.js";

const MODEL = "claude-opus-5";

const SUPPORTED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);

// Structured output schema — the model must return exactly this shape.
// The API allows at most 16 nullable/union-typed fields per schema, so only
// numbers and the paid flag are nullable; text fields use "" for "not shown".
const nullable = (type) => ({ anyOf: [{ type }, { type: "null" }] });

const DOCKET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    transcript: {
      type: "string",
      description:
        "FIRST: every piece of text you can read on the document, top to bottom, as printed — labels, numbers, prices, handwriting, stamps. One line per printed line. Fill this before any other field.",
    },
    document_type: {
      type: "string",
      enum: ["delivery_docket", "receipt", "invoice", "other"],
      description:
        "delivery_docket: a delivery note / weighbridge ticket with no prices, or prices incidental. receipt: a till or counter receipt for goods bought and paid for. invoice: a supplier invoice / account statement line for goods supplied. other: not a materials document at all.",
    },
    docket_no: { type: "string", description: "Docket, ticket, delivery note, receipt, transaction or invoice number as printed." },
    supplier: { type: "string", description: "Company that issued the document (letterhead / logo), e.g. Chadwicks, Roadstone. Include the branch if printed, e.g. 'Chadwicks Sallynoggin'." },
    haulier: { type: "string", description: "Transport company if shown separately from the supplier." },
    delivery_date: { type: "string", description: "Document date as YYYY-MM-DD. Irish documents are day/month/year." },
    delivery_time: { type: "string", description: "Time printed on the document as HH:MM, if any." },
    vehicle_reg: { type: "string", description: "Truck registration plate as printed, e.g. 191-D-12345." },
    po_number: { type: "string", description: "Customer order / PO / job reference number if shown." },
    customer_name: { type: "string", description: "Customer or account name the document is made out to, if shown." },
    delivery_address: { type: "string", description: "Site or delivery address as printed, if any." },
    items: {
      type: "array",
      description: "One entry per product line on the document. Skip lines that are only VAT, totals, discounts, deposits or payment lines.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          product: { type: "string", description: "Short clean product name, e.g. 'Postcrete 20kg', 'Clause 804', 'C30/37 concrete'. Use the exact known name when it clearly matches." },
          raw_description: { type: "string", description: "The product line exactly as written, including any product code." },
          quantity: { ...nullable("number"), description: "Quantity delivered or bought. Net weight on weighbridge tickets." },
          unit: { type: "string", description: "One of: t, m³, m, units, loads, L, kg, bags." },
          unit_price: { ...nullable("number"), description: "Price per unit as printed on that line. Never null when a price is printed beside the item. Null only on documents with no prices." },
          line_total: { ...nullable("number"), description: "Line total as printed on that line (or quantity × unit_price when only a unit price is printed). Never null when a price is printed beside the item. Null only on documents with no prices." },
          vat_rate: { ...nullable("number"), description: "VAT rate for this line as a percentage, e.g. 23 or 13.5, if shown." },
          category: {
            type: "string",
            enum: COST_CATEGORY_OPTIONS,
            description: "Best-fit cost category for this line.",
          },
        },
        required: ["product", "raw_description", "quantity", "unit", "unit_price", "line_total", "vat_rate", "category"],
      },
    },
    subtotal_ex_vat: { ...nullable("number"), description: "Document total excluding VAT, if printed." },
    vat_amount: { ...nullable("number"), description: "Total VAT on the document, if printed." },
    total_inc_vat: { ...nullable("number"), description: "Document grand total including VAT, if printed." },
    prices_include_vat: {
      ...nullable("boolean"),
      description:
        "True if the per-line prices you returned include VAT (typical till receipt), false if they exclude VAT (typical invoice), null if there are no prices or the document doesn't say.",
    },
    currency: { type: "string", description: "Currency code, e.g. EUR. Empty if no prices." },
    paid: { ...nullable("boolean"), description: "True if the document shows it was paid (PAID stamp, card/cash payment line, 'amount tendered'). False if it shows an amount still due. Null if it doesn't say." },
    payment_method: { type: "string", description: "Card, Cash, Account, Bank transfer, or as printed. Null if not shown." },
    confidence: { type: "number", description: "0 to 1: confidence the fields are right without checking the paper document." },
    warnings: { type: "array", items: { type: "string" }, description: "Short notes on anything unreadable, missing or ambiguous." },
    notes: { type: "string", description: "Anything else worth telling the person entering the record." },
  },
  required: [
    "transcript",
    "document_type",
    "docket_no",
    "supplier",
    "haulier",
    "delivery_date",
    "delivery_time",
    "vehicle_reg",
    "po_number",
    "customer_name",
    "delivery_address",
    "items",
    "subtotal_ex_vat",
    "vat_amount",
    "total_inc_vat",
    "prices_include_vat",
    "currency",
    "paid",
    "payment_method",
    "confidence",
    "warnings",
    "notes",
  ],
};

const SYSTEM_PROMPT = `You read paperwork for materials on Irish construction sites and turn it into structured records for a delivery and cost register. The paperwork is one of three kinds:

1. Delivery dockets: quarry weighbridge tickets, readymix concrete delivery notes, pipe/ducting/kerb delivery notes. Usually no prices. What matters is what was delivered, how much, when, and the docket number.
2. Receipts: till or counter receipts from builders' merchants (Chadwicks, Heiton Buckley, Brooks, Woodie's, TileStyle, Screwfix and the like) or fuel stations. Goods were bought and usually paid for on the spot. What matters is each item, its quantity, its price, the total, and that it was paid.
3. Invoices: supplier invoices or account delivery notes with prices, to be paid later. What matters is the same as a receipt, plus that it is NOT yet paid unless it says so.

Work in two passes. First, transcribe everything printed or written on the document into the transcript field, line by line, exactly as it appears, including field labels and prices. Second, fill in the other fields from your transcript. A value that appears in your transcript must not be returned as null.

Where things usually are:
- The document number is normally the most prominent number near the top, labelled Docket No, Ticket No, Delivery Note, DN, Doc No, Receipt No, Invoice No, Transaction, Ref, or just No. It is often pre-printed in red or bold. Read it even if it has letters in it.
- The supplier is the company name in the letterhead or logo at the top. On a merchant receipt include the branch, e.g. "Chadwicks Sallynoggin".
- The customer / account name and any site address are below that; the product lines are in the middle, in a table or list; the weights, VAT, totals, payment and signature are near the bottom.

How to read them:
- Dates are day/month/year. "03/09/2026" is 3 September 2026. Return delivery_date as YYYY-MM-DD.
- The quantity is what was delivered or bought. On a weighbridge ticket that is the NET weight (gross minus tare), never the gross. Concrete dockets give cubic metres. Merchant receipts give a Qty column; the unit is usually implied by the description (a "25kg bag" is bags, "Lgth" or "6m" is m, a count of items is units).
- Normalise units to one of: t, m³, m, units, loads, L, kg, bags. Tonnes may be written as T, tonne, tn or TNE. Convert kg to t only on a weighbridge ticket.
- One item per product line. Put the document's own wording (including any product code) in raw_description and a short clean name in product. If the material clearly matches one of the known product names supplied by the user, use that exact name. Skip lines that are only VAT, subtotals, discounts, deposits, delivery charges rolled into totals, or payment lines — but a separately priced delivery charge or skip hire IS an item.
- Prices: every item that has a price printed beside it MUST come back with that price. Copy the figures as printed into unit_price and line_total — do not leave them null because you are unsure whether they include VAT. Then say which basis the document uses in prices_include_vat: till receipts from merchants and shops almost always print inc-VAT prices per line with a VAT summary at the bottom (true); trade invoices print ex-VAT lines and add VAT below (false). If both ex-VAT and inc-VAT figures are printed for a line, return the ex-VAT ones and set prices_include_vat false. Irish VAT is 23% on most goods and 13.5% on some services and fuel; read the rate printed, don't assume. Batteries, consumables, tools, PPE and fuel on a receipt are priced items like any other.
- paid: true when the document shows payment taken (PAID stamp, "Card", "Visa", "Cash", "Tendered", "Change due", "Amount paid"). false when it shows a balance due or is an invoice with payment terms. null when it doesn't say.
- category: pick the best-fit cost category for each line from the list in the schema.
- supplier / haulier: haulier only if a separate transport company is shown.
- Read what is there. Leave a field empty (an empty string for text, null for numbers and for paid) only when it is genuinely absent from the document or truly illegible, and add a short warning saying which. Do not withhold a value just because you are not certain which label it belongs under — return your best reading and note the doubt in warnings. Legible handwriting counts as readable.
- confidence is your overall confidence, 0 to 1, that these fields could go straight into the register without being checked against the paper. Handwritten quantities, faded thermal receipts and photos taken at an angle should lower it.
- If the file is not materials paperwork at all, set document_type to "other", leave the other fields null or empty, and say what it appears to be in notes.`;

function bearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

async function verifySupabaseUser(req) {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase env vars are missing on the server.");
  const token = bearerToken(req);
  if (!token) return null;
  const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

function formatList(items) {
  const list = (Array.isArray(items) ? items : []).filter((s) => typeof s === "string" && s.trim()).slice(0, 100);
  return list.length ? list.map((s) => `- ${s}`).join("\n") : "(none supplied)";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in the Vercel project settings." });
  }

  let user;
  try {
    user = await verifySupabaseUser(req);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
  if (!user) return res.status(401).json({ error: "Not signed in." });

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const data = body.data;
  const mediaType = body.media_type;
  if (!data || typeof data !== "string" || !mediaType) {
    return res.status(400).json({ error: "Expected { data: <base64>, media_type }." });
  }
  if (!SUPPORTED_MEDIA.has(mediaType)) {
    return res.status(400).json({ error: `Unsupported file type ${mediaType}. Use a JPEG/PNG photo or a PDF.` });
  }

  const fileBlock =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data } };

  const userText = [
    "Read this document and return the fields.",
    "",
    "Known product names (use the exact name when the document's material clearly matches one):",
    formatList(body.known_products),
    "",
    "Known suppliers (use the exact name when the letterhead clearly matches one):",
    formatList(body.known_suppliers),
  ].join("\n");

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: userText }] }],
      output_config: { format: { type: "json_schema", schema: DOCKET_SCHEMA } },
    });

    if (response.stop_reason === "refusal") {
      const why = response.stop_details?.explanation ? ` ${response.stop_details.explanation}` : "";
      return res.status(422).json({ error: `The reader declined this file.${why}` });
    }
    if (response.stop_reason === "max_tokens") {
      return res.status(502).json({ error: "The reader ran out of room before finishing. Try a clearer photo." });
    }

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    const docket = safeParse(text);
    if (!docket || typeof docket !== "object") {
      console.error("read-docket: unparseable output", text.slice(0, 500));
      return res.status(502).json({ error: "The reader returned something that wasn't a document record." });
    }
    // Visible in Vercel > Logs, for working out why a document read badly.
    console.log(
      "read-docket:",
      JSON.stringify({
        user: user.email,
        media_type: mediaType,
        bytes: Math.round((data.length * 3) / 4),
        document_type: docket.document_type,
        docket_no: docket.docket_no,
        supplier: docket.supplier,
        items: Array.isArray(docket.items) ? docket.items.length : 0,
        items_with_price: Array.isArray(docket.items) ? docket.items.filter((i) => typeof i.line_total === "number" || typeof i.unit_price === "number").length : 0,
        prices_include_vat: docket.prices_include_vat,
        total_inc_vat: docket.total_inc_vat,
        confidence: docket.confidence,
        transcript_chars: (docket.transcript || "").length,
        warnings: docket.warnings,
      })
    );

    return res.status(200).json({
      docket,
      usage: { input_tokens: response.usage?.input_tokens, output_tokens: response.usage?.output_tokens },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(500).json({ error: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Vercel." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "The reader is busy. Wait a moment and try again." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(err);
      return res.status(502).json({ error: `Document reader error (${err.status}): ${err.message}` });
    }
    console.error(err);
    return res.status(500).json({ error: err.message || "Document reader failed." });
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
