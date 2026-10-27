# Accordo sul trattamento dei dati (DPA) InvoiceLead

_Questa versione italiana è fornita per comodità. In caso di divergenza fa fede la versione tedesca._

Versione del 30 settembre 2026.

## 1. Parti e oggetto

Il presente accordo integra le condizioni generali di InvoiceLead. Si applica quando l'Utente («il Cliente», titolare del trattamento) tratta in InvoiceLead dati personali di terzi, in particolare dei propri clienti, fornitori e contatti. Quantum Liquid LLC, 30 N Gould St, Sheridan, WY 82801, Stati Uniti, agisce in qualità di responsabile del trattamento («il Responsabile»), ai sensi dell'art. 28 GDPR e dell'art. 9 nLPD.

## 2. Trattamento

- Finalità: allestire preventivi e fatture, monitorare i pagamenti, tenere la contabilità e l'IVA del Cliente.
- Dati: nome, indirizzo, recapiti, numeri IDI/IVA, importi, cronologia dei documenti e dei pagamenti, note inserite dal Cliente.
- Interessati: clienti, potenziali clienti, fornitori e contatti del Cliente.
- Durata: quella dell'utilizzo del Servizio, maggiorata dei termini di restituzione e di cancellazione.

## 3. Obblighi del Responsabile

Il Responsabile tratta i dati soltanto su istruzione documentata del Cliente (condizioni, impostazioni, utilizzo dell'interfaccia, richieste scritte); vincola il proprio personale alla riservatezza; applica le misure di sicurezza dell'allegato; assiste il Cliente nelle richieste degli interessati e negli obblighi in materia di sicurezza; notifica qualsiasi violazione dei dati entro 72 ore dal momento in cui ne è venuto a conoscenza; mette a disposizione le informazioni necessarie per dimostrare il rispetto del presente accordo.

## 4. Sub-responsabili del trattamento

Il Cliente autorizza i sub-responsabili del trattamento elencati nell'allegato. Qualsiasi aggiunta o sostituzione è comunicata con 30 giorni di anticipo; il Cliente può opporvisi per un motivo legittimo e, in mancanza di una soluzione, recedere.

## 5. Trasferimenti

I dati sono ospitati negli Stati Uniti. I trasferimenti si fondano sullo Swiss-U.S. e sull'EU-U.S. Data Privacy Framework qualora il fornitore vi abbia aderito e, in mancanza, sulle clausole contrattuali tipo della Commissione europea (decisione 2021/914), adattate al diritto svizzero e incorporate mediante rinvio.

## 6. Audit

Una volta all'anno, con un preavviso di 30 giorni e a proprie spese, il Cliente può verificare il rispetto del presente accordo, in via prioritaria sulla base dei rapporti e delle certificazioni disponibili.

## 7. Fine del trattamento

Alla chiusura dell'account, i dati restano esportabili per 30 giorni e sono poi cancellati, backup compresi entro un ulteriore termine di 30 giorni. Su richiesta è fornita un'attestazione di cancellazione.

---

## Allegato I: sub-responsabili del trattamento

| Sub-responsabile | Ruolo | Ubicazione |
|---|---|---|
| Vercel Inc. | Hosting dell'applicazione | Stati Uniti (Cleveland, Ohio) |
| Neon (Databricks, Inc.) | Banca dati | Stati Uniti (AWS us-east-2, Ohio) |

## Allegato II: misure di sicurezza

- Cifratura in transito (TLS) e a riposo.
- Separazione rigorosa dei dati per organizzazione, verificata a ogni richiesta.
- Accesso tramite l'Account Lead (PKCE, token firmati e verificati), sessioni brevi memorizzate sotto forma di impronta (hash).
- Documenti contabili bloccati dopo l'emissione, rettifiche mediante registrazione di storno, registro di audit.
- Backup e ripristino della banca dati a un determinato momento.
- Revisione del codice e test automatizzati prima di ogni messa in produzione.
