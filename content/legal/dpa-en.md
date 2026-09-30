# InvoiceLead Data Processing Agreement (DPA)

_This English version is provided for convenience. In case of discrepancy, the German version prevails._

Version of 30 September 2026.

## 1. Parties and subject matter

This agreement supplements the InvoiceLead terms and conditions. It applies where the User ("the Customer", controller) processes personal data of third parties in InvoiceLead, in particular of its customers, suppliers and contacts. Quantum Liquid LLC, 30 N Gould St, Sheridan, WY 82801, United States, acts as processor ("the Processor") within the meaning of art. 28 GDPR and art. 9 FADP.

## 2. Processing

- Purpose: preparing quotes and invoices, tracking payments, keeping the Customer's accounts and VAT records.
- Data: name, address, contact details, UID/VAT numbers, amounts, history of documents and payments, notes entered by the Customer.
- Data subjects: customers, prospective customers, suppliers and contacts of the Customer.
- Duration: the period of use of the Service, plus the time limits for return and deletion.

## 3. Obligations of the Processor

The Processor processes the data only on documented instructions from the Customer (terms and conditions, settings, use of the interface, written requests); binds its personnel to confidentiality; applies the security measures set out in the annex; assists the Customer with requests from data subjects and with security obligations; notifies any personal data breach within 72 hours of becoming aware of it; makes available the information necessary to demonstrate compliance with this agreement.

## 4. Sub-processors

The Customer authorises the sub-processors listed in the annex. Any addition or replacement is announced 30 days in advance; the Customer may object on legitimate grounds and, if no solution is found, terminate.

## 5. Transfers

The data are hosted in the United States. Transfers are based on the Swiss-U.S. and EU-U.S. Data Privacy Framework where the provider participates in it and, failing that, on the standard contractual clauses of the European Commission (Decision 2021/914), adapted to Swiss law and incorporated by reference.

## 6. Audit

Once a year, with 30 days' notice and at its own expense, the Customer may verify compliance with this agreement, primarily on the basis of available reports and certifications.

## 7. End of processing

On closure of the account, the data remain available for export for 30 days and are then deleted, with backups deleted within a further 30 days. A confirmation of deletion is provided on request.

---

## Annex I: sub-processors

| Sub-processor | Role | Location |
|---|---|---|
| Vercel Inc. | Application hosting | United States (Cleveland, Ohio) |
| Neon (Databricks, Inc.) | Database | United States (AWS us-east-2, Ohio) |

## Annex II: security measures

- Encryption in transit (TLS) and at rest.
- Strict separation of data by organisation, verified on every request.
- Sign-in through the Lead Account (PKCE, verified signed tokens), short sessions stored only as hashes.
- Accounting documents locked after issue, corrections by reversing entry, audit log.
- Backups and point-in-time recovery of the database.
- Code review and automated testing before every production release.
