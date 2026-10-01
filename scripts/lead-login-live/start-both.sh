#!/usr/bin/env bash
# Lance CRMlead (Compte Lead, port 3301) et InvoiceLead (port 3300) en local, branchés l'un sur l'autre,
# pour les tests navigateur de ce dossier. Prérequis : Postgres local, bases crmlead_e2e et invoicelead_test
# (voir docs/HANDOFF.md), `npx vite build` dans ../crmlead et `npx next build` ici.
set -euo pipefail
LOG=${LOG:-/tmp}
CRM=${CRM_DIR:-/home/user/crmlead}
fuser -k 3301/tcp 3300/tcp >/dev/null 2>&1 || true
(cd "$CRM" && DATABASE_URL=postgres://postgres@localhost:5432/crmlead_e2e PGOPTIONS='-c role=crmlead_app' \
  NODE_ENV=production SERVE_DIST=1 PUBLIC_URL=http://localhost:3301 PORT=3301 \
  nohup npx tsx server/index.ts > "$LOG/crm.log" 2>&1 &)
DATABASE_URL=postgres://postgres@localhost:5432/invoicelead_test APP_URL=http://localhost:3300 \
  SESSION_SECRET=e2e-secret-e2e-secret-e2e-secret-e2e LEAD_ID_ISSUER=http://localhost:3301 \
  LEAD_ID_CLIENT_ID=invoicelead LEAD_ID_CLIENT_SECRET=lid_test_e2e_secret \
  LEAD_ID_REDIRECT_URI=http://localhost:3300/auth/lead/callback LEAD_ID_APP=invoicelead \
  RESEND_API_KEY=re_test AI_API_KEY=ai_test CRON_SECRET=cron-secret-for-tests-only \
  STRIPE_SECRET_KEY=sk_test STRIPE_CONNECT_CLIENT_ID=ca_test STRIPE_WEBHOOK_SECRET=whsec_test \
  NEXT_TELEMETRY_DISABLED=1 nohup npx next start -p 3300 > "$LOG/il.log" 2>&1 &
sleep 10
echo "CRMlead : http://localhost:3301   InvoiceLead : http://localhost:3300   journaux : $LOG"
