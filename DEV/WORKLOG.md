# Worklog

## 2026-05-24 - Planos e limites SaaS

Mudança: ajuste da regra de planos para bloquear empresa suspensa, plano inativo e empresa sem plano na criação de WhatsApp; criação de empresa agora rejeita plano inexistente/inativo; criação de plano retorna conflito amigável para identificador duplicado; UI deixa de assumir limite padrão quando não há plano; E2E cobre lista de planos, acesso indevido, limite de WhatsApp, empresa sem plano e empresa suspensa.

Motivo: a auditoria de planos encontrou que `maxWhatsappInstances` existia, mas alguns estados de entitlement (`Company.status`, `Plan.isActive`, empresa sem plano) não eram tratados de forma consistente no backend.

Verificação:
- `npm run typecheck`
- `npm run lint`
- `npx playwright test e2e/auth.spec.ts e2e/company-ui.spec.ts e2e/plans.spec.ts`

Próximo contexto: `maxUsers` ainda é apenas informativo porque não há fluxo de criação de usuários/membros no app além do seed; quando esse fluxo existir, aplicar limite transacional semelhante ao de WhatsApp.

## 2026-05-25 - Evolution API e webhooks WhatsApp

Mudança: criada a instância remota `acme-main` na Evolution Go e sincronizado o `providerInstanceId` no banco local; o serviço de WhatsApp agora aplica configurações avançadas na Evolution antes de conectar e impede conectar uma Evolution remota quando `WEBHOOK_PUBLIC_URL` ainda aponta para `localhost`. O Docker Compose passou a repassar `WEBHOOK_PUBLIC_URL` para a API e deixou `EVOLUTION_BASE_URL` configurável também nos overrides dev/prod.

Motivo: o gateway remoto em `evo.devizando.com:8081` estava acessível, mas a instância esperada pelo sistema não existia lá, e os overrides do Compose podiam ignorar a URL remota configurada no ambiente. Sem uma URL pública da API, o webhook remoto não consegue entregar mensagens no sistema.

Verificação:
- `npm run typecheck`
- `npm run lint`
- `npm run e2e -- e2e/webhooks.spec.ts e2e/inbox-flow.spec.ts e2e/whatsapp-qr.spec.ts`
- Consulta sanitizada em `GET /instance/all` confirmou `acme-main` criada e configurações avançadas aplicadas.

Próximo contexto: configurar `WEBHOOK_PUBLIC_URL` com a URL pública real da API antes de gerar QR/conectar a instância remota; `localhost` só funciona quando Evolution e API rodam no mesmo ambiente local.

## 2026-05-25 - Configuração global do webhook Evolution

Mudança: adicionada configuração global persistida para a URL pública do webhook Evolution (`PlatformSetting`), endpoints protegidos por `PLATFORM_ADMIN`, aba `Configurações` no admin plataforma e rotina periódica server-side para detectar mudança da URL e reaplicar o webhook nas instâncias Evolution existentes. A atualização manual salva a URL e dispara sincronização imediata; a rotina periódica revalida mudanças por `EVOLUTION_WEBHOOK_SYNC_INTERVAL_MS` (padrão de 60s).

Motivo: a URL do webhook precisa ser alterável pelo admin sem editar `.env` e a Evolution precisa receber a nova URL quando ela mudar.

Verificação:
- `npm run db:generate`
- `npm run typecheck`
- `npm run lint`
- `npm run e2e -- e2e/platform-settings.spec.ts e2e/webhooks.spec.ts e2e/inbox-flow.spec.ts e2e/whatsapp-qr.spec.ts`

Próximo contexto: aplicar a migration `20260526000000_platform_settings` no ambiente persistente antes de usar a nova tela em produção/piloto.

## 2026-05-25 - Correção de falso conectado na Evolution

Mudança: corrigido o mapeamento de estado da Evolution para não considerar `DISCONNECTED` como conectado por conter a substring `CONNECTED`. O refresh de status agora limpa QR antigo quando não há QR válido e preserva o motivo de desconexão informado pela Evolution. Webhooks de conexão também salvam o motivo da desconexão.

Motivo: a tela mostrava o WhatsApp como conectado mesmo sem leitura do QR Code; a Evolution real informava `connected: false` e `QR code limit reached (5)`.

Verificação:
- `npm run typecheck`
- `npm run lint`
- `npm run e2e -- e2e/whatsapp-qr.spec.ts e2e/webhooks.spec.ts`

Próximo contexto: para gerar QR novo depois de `QR code limit reached (5)`, pode ser necessário recriar a instância remota ou resetar a sessão na Evolution.
