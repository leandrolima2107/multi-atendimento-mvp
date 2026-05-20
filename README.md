# Multi Atendimento

MVP SaaS multi-tenant para atendimento de leads via WhatsApp usando Evolution Go.

## Stack

- Next.js para o painel web
- NestJS para API, webhooks e tempo real
- PostgreSQL + Prisma como banco principal do CRM
- Redis/BullMQ para processamento assíncrono de webhooks
- Evolution Go como gateway WhatsApp
- Docker Compose para ambiente local e piloto em VPS

## Desenvolvimento Local

```bash
cp .env.example .env
npm install
npm run db:generate
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis evolution-go
npm run db:push
npm run db:seed
npm run dev
```

Usuários seed:

- Plataforma: `platform@multi.local` / `admin123`
- Admin empresa: `admin@acme.local` / `admin123`
- Atendente: `agent@acme.local` / `admin123`

URLs locais:

- Web: http://localhost:3000
- API: http://localhost:4100
- Swagger: http://localhost:4100/docs
- Evolution Go: http://localhost:8082
- Evolution Go Manager: http://localhost:8082/manager

## Coolify

O repositório tem um `Dockerfile` raiz multi-target para criar dois apps no Coolify a partir do mesmo código:

- API: target `api`, porta `4000`
- Web: target `web`, porta `3000`

Veja o passo a passo em [docs/coolify.md](docs/coolify.md).

## Piloto VPS

1. Copie o exemplo de produção e preencha todos os segredos:

```bash
cp .env.production.example .env.production
```

2. Ajuste `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` e `WEBHOOK_PUBLIC_URL` para os domínios reais do proxy reverso.
3. Antes do hardening final, troque `EVOLUTION_IMAGE=evoapicloud/evolution-go:latest` por uma tag ou digest testada.
4. Quando usar um Evolution Go remoto, configure `EVOLUTION_BASE_URL`, `EVOLUTION_GLOBAL_API_KEY` e `NEXT_PUBLIC_EVOLUTION_MANAGER_URL`. O `WEBHOOK_PUBLIC_URL` precisa ser uma URL pública acessível pelo servidor Evolution Go.
5. Suba o stack:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Por padrão, o compose de produção publica Web, API e Evolution Go apenas em `127.0.0.1`. Use Nginx, Caddy ou outro proxy reverso no VPS para expor HTTPS publicamente. PostgreSQL e Redis não são publicados no host em produção.

## Healthchecks

O compose espera que a API responda `200 OK` em `API_HEALTH_PATH` (`/health` por padrão).

## Migrations

Para produção, prefira migrations versionadas do Prisma e rode `migrate deploy` dentro do container da API:

```bash
npm run db:migrate:deploy
```

## Backup

Faça backup antes de migrations e antes de atualizar imagens.
