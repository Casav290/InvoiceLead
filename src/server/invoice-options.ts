import "server-only";
import type { ContactOption, ProductOption } from "@/components/invoices/InvoiceForm";
import { formatAmount } from "@/lib/money";
import { listContacts } from "./contacts";
import type { Db } from "./db";
import { listProducts } from "./products";

/** Clients et articles actifs proposés dans le formulaire de facture. */
export async function invoiceOptions(
  database: Db,
  organizationId: string,
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
      unitPrice: formatAmount(p.unitPriceCents),
      vatCode: p.vatCode,
    })),
  };
}
