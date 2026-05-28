# Worklog

## 2026-05-27 - Correção de webhook Evolution em Atendimentos

Diagnóstico: a mensagem de teste não entrou na fila porque a instância remota `bot-whatsapp` estava com o webhook da Evolution apontando para outro endpoint externo (`/evolution-go/group-events/...`) em vez do webhook público do Multi Atendimento. A mensagem antiga `Hello` chegou no banco, mas a conversa foi encerrada depois; nenhuma mensagem nova apareceu em `WebhookEvent` enquanto o webhook remoto estava desviado.

Correção: o webhook foi ressincronizado manualmente para `https://mvpzap.mobigest.com.br/api/backend/webhooks/evolution/...` e a rotina de sincronização agora reaplica a configuração no startup, mesmo quando a URL salva não mudou, para recuperar drift externo da Evolution. O cron continua pulando quando a URL permanece igual.

Verificação:
- `npm run typecheck -w @multi/api`
- Consulta da Evolution confirmou `bot-whatsapp` conectado e com webhook correto.

## 2026-05-28 - Atendimentos com mídia WhatsApp

Mudança: o módulo visível deixou de ser `Inbox` e passou a ser `Atendimentos`, com rota nova `/atendimentos` e redirect de `/inbox`. A tela de atendimento ganhou renderização de texto, imagem, áudio, vídeo, documento, figurinha, localização, contato e mídia desconhecida; o composer agora tem anexo, legenda, validação de tipo/tamanho, estados de envio e bloqueio amigável quando o WhatsApp não está conectado.

Backend: `InboxController` passou a responder também em `/atendimentos`; foram adicionados envio de mídia por backend, armazenamento privado configurável em `MEDIA_STORAGE_DIR`, URL assinada temporária em `/atendimentos/media/:messageId`, limite de upload, body limit configurável e seleção segura da instância WhatsApp sem expor `apiKey`, `webhookSecret` ou `providerInstanceId`. O processador de webhooks passou a mapear tipos de mídia da Evolution Go, persistir metadados e tentar baixar a mídia recebida com credenciais server-side.

Banco: criada a migration `20260528000000_atendimentos_media`, adicionando tipos `VIDEO`, `STICKER`, `LOCATION`, `CONTACT`, `UNKNOWN`, status `PENDING` e os campos `mediaMimeType`, `mediaFileName`, `mediaSize`, `caption` e `storagePath` em `Message`, além de índices de tipo e storage. A migration foi aplicada com `npm run db:migrate:deploy` no banco configurado pelo `.env`.

Verificação:
- `npm run db:generate`
- `npm run db:migrate:deploy`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Smoke API em `GET /atendimentos/conversations` retornou 200.
- Smoke visual com Playwright headless em `http://127.0.0.1:3200/atendimentos` nos viewports `1366x900` e `390x844`: sem overflow horizontal, sem erro técnico cru e `/inbox` redirecionando para `/atendimentos`.

Bloqueio: `npm run e2e -- e2e/auth.spec.ts e2e/webhooks.spec.ts` não iniciou porque o Docker Desktop não está disponível (`dockerDesktopLinuxEngine` ausente). Os testes foram ajustados para `Atendimentos` e para webhook/envio de mídia, mas ficaram sem execução verde neste ambiente.

## 2026-05-27 - Painel premium de conexão WhatsApp

Mudança: a tela de WhatsApp foi simplificada para remover o telefone manual e deixar apenas um apelido opcional. O botão principal cria ou reutiliza a instância e já solicita o QR Code. O card principal agora destaca status, número identificado pela Evolution, perfil quando disponível, última sincronização, plano usado e ações por estado. Também foi adicionado modal de confirmação para desconectar o WhatsApp.

Backend: o serviço passou a salvar `phoneNumber`, `profileName` e `lastSyncedAt` a partir do refresh de status e dos webhooks de conexão. Foi criado o endpoint `POST /whatsapp/instances/:id/disconnect`, protegido por tenant e função, sem expor `apiKey`, `webhookSecret` ou `providerInstanceId` no frontend. A migration `20260527000000_whatsapp_instance_profile_sync` adiciona os campos de perfil e sincronização.

Motivo: a Evolution Go identifica o número após o QR Code, então o usuário não precisa digitar telefone. O painel agora resolve a troca de número via desconexão/reconexão sem mexer diretamente no backend e sem exibir erros técnicos crus.

Verificação:
- `npm run db:generate`
- `npm run db:migrate:deploy`
- `npm run db:migrate:status`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Smoke visual com Playwright em `http://127.0.0.1:3200/`: sem campo de telefone, sem `Unauthorized` cru, status conectado, número automático e modal de desconexão cancelável.

Bloqueio: `npm run e2e -- e2e/whatsapp-qr.spec.ts e2e/company-ui.spec.ts` não iniciou porque o Docker Desktop não está disponível (`dockerDesktopLinuxEngine` ausente). Também foi tentado em portas alternativas para não conflitar com `3200`.

Complemento: o refresh de identidade agora combina `Name` do endpoint de status com `jid` do `/instance/all`, porque a Evolution Go retornou a sessão `Connected/LoggedIn`, mas enviou o número conectado somente no `jid`. O processador de webhooks também passou a tratar `PairSuccess` para preencher número e perfil logo após a leitura do QR. A conexão atual foi atualizada para `phoneNumber=556993949151` e `profileName=Leandro celulares`.

Verificação adicional:
- `npm run typecheck`
- `npm run lint`
- Smoke visual confirmou número e perfil no card WhatsApp e mensagem `Hello` presente no Inbox.

## 2026-05-27 - Identidade tipográfica premium

Mudança: o frontend passou a carregar Space Grotesk, Inter e JetBrains Mono via `next/font/google`, com variáveis globais e utilities semânticas `font-display`, `font-body` e `font-mono-ui`. A hierarquia visual foi ajustada para usar Space Grotesk em branding, sidebar, títulos, badges, botões e métricas; Inter ficou como fonte principal da aplicação; JetBrains Mono foi restrita a slugs, chaves, timestamps, telefones conectados e informações técnicas.

Motivo: criar uma aparência mais premium, tecnológica e profissional para o SaaS sem comprometer legibilidade, performance ou o layout já refatorado. O projeto não usa Tailwind atualmente, então as utilities foram implementadas no CSS global em vez de criar uma configuração Tailwind sem runtime.

Verificação:
- `npm run typecheck -w @multi/web`
- `npm run lint -w @multi/web`
- `npm run build -w @multi/web`
- Smoke visual em `http://localhost:3200/`: fontes computadas corretamente e sem overflow horizontal em `1366x900` e `390x844`.

## 2026-05-27 - Sessão expirada na criação de WhatsApp

Mudança: o front passou a validar a sessão salva em `multi.session` com `/auth/me` antes de renderizar a área logada. Qualquer resposta 401 agora dispara limpeza global da sessão, volta para o login e evita que a tela de WhatsApp continue exibindo `Unauthorized` como se fosse erro da Evolution ou da criação da instância. Também foi adicionado teste E2E cobrindo sessão velha no navegador.

Motivo: o fluxo de criação de conexão estava falhando visualmente com token antigo no `localStorage`, antes de chegar na Evolution Go. Isso mascarava a configuração correta da API Evolution e deixava a tela em estado inconsistente.

Verificação:
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Login direto na API local e listagem de `/whatsapp/instances` com token novo
- Smoke Playwright local em `http://127.0.0.1:3200`: sessão velha é limpa, `Unauthorized` não aparece e a conexão atual abre como `Conectada`

Bloqueio: `npx playwright test e2e/auth.spec.ts --project=chromium-desktop` não iniciou porque o Docker Desktop não está disponível (`dockerDesktopLinuxEngine` ausente). O teste fica pronto para rodar quando o Docker estiver ativo.

## 2026-05-26 - Status de QR pendente na Evolution

Mudança: ajustado o refresh de status do WhatsApp para tratar `Connected=true` com `LoggedIn=false` como conexão ainda não autenticada, mantendo a instância em QR pendente em vez de marcar como conectada. O refresh agora preserva o QR Code já salvo quando a Evolution não retorna um novo QR, e a falha ao pedir QR não sobrescreve um erro específico com mensagem genérica. A tela e as mensagens de plano passaram a chamar o limite de “conexões WhatsApp”, porque o slot é consumido pela instância criada, mesmo antes do pareamento.

Motivo: a Evolution pode informar transporte conectado enquanto o WhatsApp ainda não foi pareado. Isso fazia a tela sugerir conexão ativa sem leitura do QR Code e podia apagar o QR exibido após uma atualização.

Verificação:
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Regressão direta via `npx tsx` para `Connected=true` + `LoggedIn=false`

Bloqueio: `npm run e2e -- e2e/whatsapp-qr.spec.ts e2e/webhooks.spec.ts` não concluiu porque o Docker Desktop não estava disponível (`dockerDesktopLinuxEngine` ausente). O teste E2E de regressão foi adicionado e fica pronto para rodar quando o Docker estiver iniciado.

## 2026-05-27 - Polimento premium da interface SaaS

Mudança: a interface web foi refatorada para uma aparência mais premium de SaaS B2B inspirado em WhatsApp, com `AppLayout`, `Sidebar`, `Header`, `ConversationList`, `ConversationPanel`, `LoadingSkeleton`, `EmptyState`, `ErrorState`, `BadgeStatus` e `OnboardingChecklist`. A sidebar, topbar, Inbox, WhatsApp, Leads e Empresa receberam novos tokens visuais, estados de loading/erro/vazio e regras responsivas para evitar overflow horizontal.

Motivo: reduzir aparência de MVP e deixar o produto mais confiável para demonstração comercial a lojistas, sem alterar regras de negócio, endpoints, autenticação, RLS, Supabase ou integrações.

Verificação:
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Smoke visual em `http://localhost:3200/` com Playwright headless nos viewports `1366x900` e `390x844`, sem overflow horizontal em Inbox, WhatsApp e Empresa.

Bloqueio: `npx playwright test e2e/auth.spec.ts e2e/company-ui.spec.ts` não iniciou porque `127.0.0.1:3200` já estava em uso e o `playwright.config.ts` está com `reuseExistingServer: false`. O servidor existente foi preservado porque estava em uso no browser local.

## 2026-05-26 - QR somente após solicitação do usuário

Mudança: a sincronização global do webhook Evolution deixou de chamar a Evolution para conexões recém-criadas em `CREATED`, evitando geração automática de QR antes do usuário pedir. A tela de WhatsApp agora faz refresh automático a cada 5s enquanto uma conexão está em `QR_PENDING`, para remover o QR e mostrar `Conectado` assim que a Evolution confirmar `LoggedIn=true`.

Motivo: ao criar uma conexão, a rotina de sincronização podia acionar o endpoint de conexão da Evolution e antecipar o QR Code. Depois do pareamento, a tela também podia continuar mostrando o QR até um refresh manual.

Complemento: a aba Empresa passou a buscar `/companies/current` e `/whatsapp/instances` ao abrir e em eventos de refresh, evitando usar o `_count` antigo retornado no login. O checklist “WhatsApp conectado” agora depende de instância com status `CONNECTED`, não apenas de existir uma conexão cadastrada.

Verificação:
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## 2026-05-26 - Recebimento de mensagens Evolution

Mudança: o processador de webhooks agora faz fallback para processamento inline quando o Redis/BullMQ não está disponível, evitando que mensagens recebidas fiquem sem tratamento no ambiente local ou em ambientes sem Redis. A URL pública da Evolution foi corrigida no banco para passar pelo rewrite do frontend: `https://mvpzap.mobigest.com.br/api/backend/webhooks/evolution`.

Motivo: `https://mvpzap.mobigest.com.br/webhooks/evolution` caía no Next/frontend e retornava 404, então a Evolution não alcançava a API. Além disso, a API local estava com `REDIS_URL` apontando para `127.0.0.1:16379`, mas o Redis estava fora, impedindo o processamento por fila.

Complemento: o registro local foi religado à instância remota `bot-whatsapp`, que é a única sessão listada e logada na Evolution. A sincronização de webhook agora também aceita instâncias com `apiKey` nula usando `EVOLUTION_GLOBAL_API_KEY`, evitando `not authorized` quando a instância é administrada pela chave global.

Verificação:
- Webhook local fake criou evento, conversa e mensagem com Redis fora.
- Webhook público fake em `/api/backend/webhooks/evolution/:id` retornou 201, processou mensagem e os dados de teste foram limpos.

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
