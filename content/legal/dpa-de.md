# Auftragsbearbeitungsvertrag (AVV) InvoiceLead

Fassung vom 30. September 2026.

## 1. Parteien und Gegenstand

Dieser Vertrag ergänzt die AGB von InvoiceLead. Er gilt, wenn der Nutzer («der Kunde», Verantwortlicher) in InvoiceLead Personendaten Dritter bearbeitet, namentlich seiner Kunden, Lieferanten und Kontakte. Die Quantum Liquid LLC, 30 N Gould St, Sheridan, WY 82801, USA, handelt als Auftragsbearbeiterin («die Auftragsbearbeiterin») im Sinne von Art. 28 DSGVO und Art. 9 DSG.

## 2. Bearbeitung

- Zweck: Offerten und Rechnungen erstellen, Zahlungen verfolgen, Buchhaltung und MWST des Kunden führen.
- Daten: Name, Adresse, Kontaktangaben, UID-/MWST-Nummern, Beträge, Beleg- und Zahlungshistorie, Notizen des Kunden.
- Betroffene: Kunden, Interessenten, Lieferanten und Kontakte des Kunden.
- Dauer: während der Nutzung des Dienstes, zuzüglich der Fristen für Herausgabe und Löschung.

## 3. Pflichten der Auftragsbearbeiterin

Die Auftragsbearbeiterin bearbeitet die Daten nur auf dokumentierte Weisung des Kunden (AGB, Einstellungen, Nutzung der Oberfläche, schriftliche Anfragen); verpflichtet ihr Personal zur Vertraulichkeit; wendet die Sicherheitsmassnahmen gemäss Anhang an; unterstützt den Kunden bei Anfragen betroffener Personen und bei Sicherheitspflichten; meldet Datenschutzverletzungen innert 72 Stunden nach Kenntnis; stellt die Informationen zur Verfügung, die zum Nachweis der Einhaltung dieses Vertrags nötig sind.

## 4. Unterauftragsbearbeiter

Der Kunde genehmigt die im Anhang aufgeführten Unterauftragsbearbeiter. Neue oder ersetzte Unterauftragsbearbeiter werden 30 Tage im Voraus angekündigt; der Kunde kann aus berechtigtem Grund widersprechen und, falls keine Lösung gefunden wird, kündigen.

## 5. Bekanntgabe ins Ausland

Die Daten werden in den USA gespeichert. Die Übermittlung stützt sich auf das Swiss-U.S. und das EU-U.S. Data Privacy Framework, soweit der Anbieter teilnimmt, sonst auf die Standardvertragsklauseln der EU-Kommission (Beschluss 2021/914), an das Schweizer Recht angepasst und durch Verweis einbezogen.

## 6. Audit

Einmal pro Jahr kann der Kunde mit 30 Tagen Vorankündigung und auf eigene Kosten die Einhaltung dieses Vertrags prüfen, vorrangig anhand verfügbarer Berichte und Zertifizierungen.

## 7. Ende der Bearbeitung

Nach Kündigung des Kontos bleiben die Daten 30 Tage exportierbar und werden danach gelöscht, Sicherungen innert weiterer 30 Tage. Auf Anfrage wird die Löschung bestätigt.

---

## Anhang I: Unterauftragsbearbeiter

| Unterauftragsbearbeiter | Aufgabe | Standort |
|---|---|---|
| Vercel Inc. | Hosting der Anwendung | USA (Cleveland, Ohio) |
| Neon (Databricks, Inc.) | Datenbank | USA (AWS us-east-2, Ohio) |

## Anhang II: Sicherheitsmassnahmen

- Verschlüsselung bei der Übertragung (TLS) und im Ruhezustand.
- Strikte Trennung der Daten nach Organisation, bei jeder Anfrage geprüft.
- Anmeldung über das Lead-Konto (PKCE, geprüfte signierte Token), kurze Sitzungen, nur als Hashwert gespeichert.
- Buchungsbelege nach Ausstellung unveränderbar, Korrekturen per Gegenbuchung, Prüfprotokoll.
- Sicherungen und zeitpunktgenaue Wiederherstellung der Datenbank.
- Code-Review und automatisierte Tests vor jeder Inbetriebnahme.
