# Deploy no Coolify

Este projeto deve ser publicado no Coolify como dois apps usando o mesmo repositório e o `Dockerfile` raiz.

## API

Configuração do app API:

- Build Pack: Dockerfile
- Dockerfile: `Dockerfile`
- Build Target: `api`
- Porta: `4000`
- Healthcheck path: `/health`

Variáveis obrigatórias:

```env
NODE_ENV=production
API_PORT=4000
DATABASE_URL=postgresql://postgres:[PASSWORD]@161.97.113.95:5432/postgres?schema=public
DIRECT_URL=postgresql://postgres:[PASSWORD]@161.97.113.95:5432/postgres?schema=public
REDIS_URL=redis://[REDIS_HOST]:6379
JWT_SECRET=[LONG_RANDOM_SECRET]
WEBHOOK_PUBLIC_URL=https://[API_DOMAIN]/webhooks/evolution
EVOLUTION_BASE_URL=https://evo.devizando.com
EVOLUTION_GLOBAL_API_KEY=[EVOLUTION_API_KEY]
```

Comando de start:

```bash
node apps/api/dist/main.js
```

Comando de migration antes do primeiro deploy ou quando houver mudança de schema:

```bash
npm run db:migrate:deploy
```

## Web

Configuração do app Web:

- Build Pack: Dockerfile
- Dockerfile: `Dockerfile`
- Build Target: `web`
- Porta: `3000`

Build arguments:

```env
NEXT_PUBLIC_API_URL=https://[API_DOMAIN]
NEXT_PUBLIC_WS_URL=https://[API_DOMAIN]
NEXT_PUBLIC_EVOLUTION_MANAGER_URL=https://evo.devizando.com/manager
NEXT_PUBLIC_SUPABASE_URL=https://api.supabase.devizando.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=[SUPABASE_ANON_KEY]
```

Variáveis em runtime:

```env
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://[API_DOMAIN]
NEXT_PUBLIC_WS_URL=https://[API_DOMAIN]
NEXT_PUBLIC_EVOLUTION_MANAGER_URL=https://evo.devizando.com/manager
NEXT_PUBLIC_SUPABASE_URL=https://api.supabase.devizando.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=[SUPABASE_ANON_KEY]
```

Comando de start:

```bash
node apps/web/server.js
```

## Observações

- Não suba arquivos `.env` reais para o GitHub.
- A porta externa `5432` está aberta por decisão de desenvolvimento. Antes de produção, feche a porta ou restrinja por allowlist.
- Para produção, prefira colocar API, Redis e Supabase na mesma rede privada do Coolify.
- O frontend não deve usar credenciais de banco, service role ou chaves privadas.
