import { redirect } from "next/navigation";

// Valuation page deactivated — not ready for production.
// Valuation data per stock is still available via the stocks page.
export default function ValuationRedirect() {
  redirect("/stocks");
}
