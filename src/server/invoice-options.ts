import "server-only";
import type { ContactOption, ProductOption } from "@/components/invoices/InvoiceForm";
import { formatAmountInput } from "@/lib/amount-input";
import { listContacts } from "./contacts";
import type { Db } from "./db";
import { listProducts } from "./products";

/** Clients et articles actifs proposés dans le formulaire de facture. */
export async function invoiceOptions(
  database: Db,
  organizationId: string,
  /** Pays de l'entreprise : format des prix préremplis (1'200.50 en Suisse, 1200,50 en Allemagne). */
  country?: string | null,
): Promise<{ contacts: ContactOption[]; products: ProductOption[] }> {
  const [contacts, products] = await Promise.all([
    listContacts(database, organizationId),
    listProducts(database, organizationId),
  ]);
  return {
    contacts: contacts
      .filter((c) => c.isCustomer)
      .map((c) => ({ id: c.id, name: c.name, language: c.language })),
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      unit: p.unit,
      unitPrice: formatAmountInput(p.unitPriceCents, country),
      vatCode: p.vatCode,
    })),
  };
}
