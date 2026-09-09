// Vercel serverless function: reads one delivery docket (photo or PDF) with
// Claude and returns its fields as JSON for the app to prefill a delivery.
//
// Lives under /api so Vercel deploys it alongside the Vite app with no extra
// config. The Anthropic key never reaches the browser — set ANTHROPIC_API_KEY
// in Vercel > Settings > Environment Variables. The caller must send their
// Supabase session token; it's verified here before the model is called.
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const MODEL = "claude-opus-5";

const SUPPORTED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);

// Structured output schema — the model must return exactly this shape.
const nullable = (type) => ({ anyOf: [{ type }, { type: "null" }] });

const DOCKET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    transcript: {
      type: "string",
      description:
        "FIRST: every piece of text you can read on the docket, top to bottom, as printed — labels, numbers, handwriting, stamps. One line per printed line. Fill this before any other field.",
    },
    is_docket: { type: "boolean", description: "False if the file is not a delivery docket / ticket / delivery note at all." },
    docket_no: { ...nullable("string"), description: "Printed docket, ticket or delivery-note number." },
    supplier: { ...nullable("string"), description: "Company that issued the docket (letterhead)." },
    haulier: { ...nullable("string"), description: "Transport company if shown separately from the supplier." },
    delivery_date: { ...nullable("string"), description: "Delivery date as YYYY-MM-DD. Irish dockets are day/month/year." },
    delivery_time: { ...nullable("string"), description: "Delivery or weigh-out time as HH:MM if shown." },
    vehicle_reg: { ...nullable("string"), description: "Truck registration plate as printed, e.g. 191-D-12345." },
    po_number: { ...nullable("string"), description: "Customer order / PO number if shown." },
    delivery_address: { ...nullable("string"), description: "Site or delivery address as printed." },
    items: {
      type: "array",
      description: "One entry per product line on the docket.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          product: { type: "string", description: "Short clean product name. Use the exact known name when it clearly matches." },
          raw_description: { ...nullable("string"), description: "The product line as written on the docket." },
          quantity: { ...nullable("number"), description: "Quantity delivered. Net weight on weighbridge tickets." },
          unit: { ...nullable("string"), description: "One of: t, m³, m, units, loads, L, kg, bags." },
        },
        required: ["product", "raw_description", "quantity", "unit"],
      },
    },
    confidence: { type: "number", description: "0 to 1: confidence the fields are right without checking the paper docket." },
    warnings: { type: "array", items: { type: "string" }, description: "Short notes on anything unreadable, missing or ambiguous." },
    notes: { ...nullable("string"), description: "Anything else worth telling the person entering the delivery." },
  },
  required: [
    "transcript",
    "is_docket",
    "docket_no",
    "supplier",
    "haulier",
    "delivery_date",
    "delivery_time",
    "vehicle_reg",
    "po_number",
    "delivery_address",
    "items",
    "confidence",
    "warnings",
    "notes",
  ],
};

const SYSTEM_PROMPT = `You read delivery dockets from Irish construction sites — quarry weighbridge tickets, readymix concrete delivery notes, builders' merchant delivery notes, pipe and ducting delivery notes — and return the fields as JSON so they can be entered into a delivery register.

Work in two passes. First, transcribe everything printed or written on the docket into the transcript field, line by line, exactly as it appears, including field labels. Second, fill in the other fields from your transcript. A value that appears in your transcript must not be returned as null.

Where things usually are:
- The docket number is normally the most prominent number near the top, labelled Docket No, Ticket No, Delivery Note, DN, Del. Note, Doc No, or just No. It is often pre-printed in red or bold. Read it even if it has letters in it.
- The supplier is the company name in the letterhead or logo at the top.
- The customer or delivery address block is usually below that; the product lines are in the middle, in a table or as a list; the weights, driver signature and time are near the bottom.

How to read them:
- Dates are day/month/year. "03/09/2026" is 3 September 2026. Return delivery_date as YYYY-MM-DD.
- The quantity is what was delivered. On a weighbridge ticket that is the NET weight (gross minus tare), never the gross. Concrete dockets give cubic metres. Pipe, duct, kerb and merchant dockets give lengths or counts.
- Normalise units to one of: t, m³, m, units, loads, L, kg, bags. Tonnes may be written as T, tonne, tn or TNE. Convert kg to t only on a weighbridge ticket.
- A docket can carry several product lines; return one item per line. Put the docket's own wording in raw_description and a short clean name in product. If the material clearly matches one of the known product names supplied by the user, use that exact name; otherwise keep a sensible short name from the docket.
- supplier is the company that issued the docket (the letterhead). haulier is a separate transport company only if one is shown.
- docket_no is the printed ticket / docket / delivery-note number — not the order number, customer account, weighbridge ID or batch number.
- Read what is there. Return null only when a field is genuinely absent from the docket or truly illegible, and add a short warning saying which. Do not withhold a value just because you are not certain which label it belongs under — return your best reading and note the doubt in warnings. Legible handwriting counts as readable.
- confidence is your overall confidence, 0 to 1, that these fields could go straight into the register without being checked against the paper docket. Handwritten quantities, faded thermal prints and photos taken at an angle should lower it.
- If the file is not a delivery docket at all, set is_docket to false, leave the other fields null or empty, and say what it appears to be in notes.`;

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
    "Read this delivery docket and return the fields.",
    "",
    "Known product names (use the exact name when the docket's material clearly matches one):",
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
      return res.status(502).json({ error: "The reader returned something that wasn't a docket record." });
    }
    // Visible in Vercel > Logs, for working out why a docket read badly.
    console.log(
      "read-docket:",
      JSON.stringify({
        user: user.email,
        media_type: mediaType,
        bytes: Math.round((data.length * 3) / 4),
        docket_no: docket.docket_no,
        supplier: docket.supplier,
        items: Array.isArray(docket.items) ? docket.items.length : 0,
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
      return res.status(502).json({ error: `Docket reader error (${err.status}): ${err.message}` });
    }
    console.error(err);
    return res.status(500).json({ error: err.message || "Docket reader failed." });
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
