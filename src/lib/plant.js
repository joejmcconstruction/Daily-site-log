import { supabase } from "../supabaseClient";
import { MACHINE_OPTIONS } from "./helpers";

// The plant list lives in the `plant` table so it can be added to from the
// Certs page. MACHINE_OPTIONS is only the fallback for before that SQL block
// has been run (or if the read fails), so the report form never ends up with
// an empty machine dropdown.
const FALLBACK = MACHINE_OPTIONS.map((name) => ({ id: null, name, fuel_tank_litres: null, archived_at: null }));

// Every plant row, removed ones included (old reports and certs still name
// them). Use activePlant() for anything that offers a choice.
export async function fetchPlant() {
  const { data, error } = await supabase.from("plant").select("*").order("name", { ascending: true });
  if (error || !data || data.length === 0) {
    if (error) console.warn("plant not readable, using built-in list:", error.message);
    return { rows: FALLBACK, fromDb: false };
  }
  return { rows: data, fromDb: true };
}

export function activePlant(rows) {
  return rows.filter((p) => !p.archived_at);
}

export async function fetchActivePlantNames() {
  const { rows } = await fetchPlant();
  return activePlant(rows).map((p) => p.name);
}
