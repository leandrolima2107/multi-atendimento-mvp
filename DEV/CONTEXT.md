# Project Context

## Planos e Entitlements

- `Plan.maxWhatsappInstances` é regra de backend para criação de números WhatsApp.
- Empresa sem plano não pode criar números WhatsApp.
- Empresa suspensa não pode acessar recursos tenant nem entrar em salas realtime.
- Plano inativo bloqueia login tenant, JWT tenant e criação de WhatsApp.
- `Plan.maxUsers` ainda é métrica informativa porque não há fluxo de criação de membros fora do seed.

## Verificação Relevante

- `npm run typecheck`
- `npm run lint`
- `npx playwright test e2e/auth.spec.ts e2e/company-ui.spec.ts e2e/plans.spec.ts`
