# Acuerdo de encargo del tratamiento (DPA) InvoiceLead

_Esta versión en español se ofrece por comodidad. En caso de discrepancia, prevalece la versión alemana._

Versión del 30 de septiembre de 2026.

## 1. Partes y objeto

El presente acuerdo complementa las condiciones generales de InvoiceLead. Se aplica cuando el Usuario («el Cliente», responsable del tratamiento) trata en InvoiceLead datos personales de terceros, en particular de sus clientes, proveedores y contactos. Quantum Liquid LLC, 30 N Gould St, Sheridan, WY 82801, Estados Unidos, actúa como encargado del tratamiento («el Encargado»), en el sentido del art. 28 RGPD y del art. 9 nLPD.

## 2. Tratamiento

- Finalidad: elaborar presupuestos y facturas, hacer el seguimiento de los pagos, llevar la contabilidad y el IVA del Cliente.
- Datos: nombre, dirección, datos de contacto, números IDE/IVA, importes, historial de documentos y de pagos, notas introducidas por el Cliente.
- Interesados: clientes, clientes potenciales, proveedores y contactos del Cliente.
- Duración: la de la utilización del Servicio, más los plazos de devolución y de supresión.

## 3. Obligaciones del Encargado

El Encargado trata los datos únicamente siguiendo instrucciones documentadas del Cliente (condiciones, configuración, uso de la interfaz, solicitudes escritas); somete a su personal a un deber de confidencialidad; aplica las medidas de seguridad del anexo; asiste al Cliente en las solicitudes de los interesados y en las obligaciones de seguridad; notifica cualquier violación de datos en un plazo de 72 horas desde que tenga conocimiento de ella; pone a disposición la información necesaria para demostrar el cumplimiento del presente acuerdo.

## 4. Subencargados del tratamiento

El Cliente autoriza a los subencargados del tratamiento enumerados en el anexo. Toda incorporación o sustitución se comunica con 30 días de antelación; el Cliente puede oponerse por un motivo legítimo y, a falta de solución, resolver el contrato.

## 5. Transferencias

Los datos se alojan en Estados Unidos. Las transferencias se basan en el Swiss-U.S. y el EU-U.S. Data Privacy Framework cuando el proveedor esté adherido a ellos y, en su defecto, en las cláusulas contractuales tipo de la Comisión Europea (Decisión 2021/914), adaptadas al derecho suizo e incorporadas por referencia.

## 6. Auditoría

Una vez al año, con un preaviso de 30 días y a su cargo, el Cliente puede verificar el cumplimiento del presente acuerdo, prioritariamente sobre la base de los informes y certificaciones disponibles.

## 7. Fin del tratamiento

Al cierre de la cuenta, los datos siguen pudiéndose exportar durante 30 días y después se suprimen, incluidas las copias de seguridad en un plazo adicional de 30 días. Previa solicitud, se facilita un certificado de supresión.

---

## Anexo I: subencargados del tratamiento

| Subencargado | Función | Ubicación |
|---|---|---|
| Vercel Inc. | Alojamiento de la aplicación | Estados Unidos (Cleveland, Ohio) |
| Neon (Databricks, Inc.) | Base de datos | Estados Unidos (AWS us-east-2, Ohio) |

## Anexo II: medidas de seguridad

- Cifrado en tránsito (TLS) y en reposo.
- Separación estricta de los datos por organización, verificada en cada solicitud.
- Inicio de sesión mediante la Cuenta Lead (PKCE, tokens firmados y verificados), sesiones cortas almacenadas en forma de huella (hash).
- Documentos contables bloqueados tras su emisión, correcciones mediante asiento de anulación, registro de auditoría.
- Copias de seguridad y restauración de la base de datos a un momento determinado.
- Revisión de código y pruebas automatizadas antes de cada puesta en producción.
