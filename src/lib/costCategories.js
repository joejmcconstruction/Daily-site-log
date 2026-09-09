// Cost categories a material line can be filed under. Shared by the docket
// reader (api/read-docket.js, which asks the model to pick one) and the app.
// No imports here on purpose: the Vercel function can't load supabaseClient.
export const COST_CATEGORY_OPTIONS = [
  "Aggregates & stone",
  "Concrete",
  "Drainage & pipework",
  "Ducting & cabling",
  "Kerbs, blocks & paving",
  "Steel & rebar",
  "Timber & formwork",
  "Fixings & consumables",
  "Tools & PPE",
  "Fuel",
  "Plant & equipment hire",
  "Skips & muck away",
  "Other",
];

export const DOC_TYPES = ["docket", "receipt", "invoice", "other"];

export const DOC_TYPE_LABEL = {
  docket: "Docket",
  receipt: "Receipt",
  invoice: "Invoice",
  other: "Other",
};
