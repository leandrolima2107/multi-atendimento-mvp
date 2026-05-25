import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import process from 'node:process';

const root = process.cwd();
const apiPort = process.env.E2E_API_PORT ?? '4200';
const webPort = process.env.E2E_WEB_PORT ?? '3200';
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const dbUrl =
  process.env.E2E_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:15432/multi_atendimento_e2e?schema=public';
const redisUrl = process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:16379';
const evolutionMockPort = process.env.E2E_EVOLUTION_MOCK_PORT ?? '65530';
const evolutionMockUrl = `http://127.0.0.1:${evolutionMockPort}`;

const children = [];
let evolutionMockServer;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...(options.env ?? {}) },
      shell: process.platform === 'win32',
      stdio: options.stdio ?? 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
      }
    });
    child.on('error', reject);
  });
}

async function runOptional(command, args, options = {}) {
  try {
    await run(command, args, options);
  } catch {
    return false;
  }
  return true;
}

async function retry(label, action, attempts = 30, delayMs = 1000) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`${label} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForHttp(url, label) {
  await retry(
    label,
    async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${url} returned ${response.status}`);
      }
    },
    90,
    1000,
  );
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...(options.env ?? {}) },
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  children.push(child);
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`${command} ${args.join(' ')} exited with ${code}`);
      shutdown(code ?? 1);
    }
  });
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  shuttingDown = true;
  evolutionMockServer?.close();
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function startEvolutionMock() {
  const qrImage =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQMAAAAlPW0iAAAABlBMVEUAAAD///+l2Z/dAAAAEklEQVR42mNgYGBgYGBgAAABAAEAci6tNwAAAABJRU5ErkJggg==';

  evolutionMockServer = createServer((request, response) => {
    const url = new URL(request.url ?? '/', evolutionMockUrl);
    const sendJson = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };

    if (request.method === 'POST' && url.pathname === '/instance/create') {
      sendJson(200, { data: { id: 'e2e-provider-created', token: 'e2e-instance-token' }, message: 'success' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/instance/connect') {
      sendJson(200, { data: { eventString: 'MESSAGE,SEND_MESSAGE,CONNECTION,QRCODE' }, message: 'success' });
      return;
    }

    if (
      request.method === 'GET' &&
      (url.pathname === '/instance/qr' || url.pathname.endsWith('/qrcode'))
    ) {
      sendJson(200, { data: { Qrcode: qrImage, Code: '2@e2e-qr-code' }, message: 'success' });
      return;
    }

    if (request.method === 'GET' && url.pathname.includes('/status')) {
      sendJson(200, { data: { connected: false, status: 'DISCONNECTED' }, message: 'success' });
      return;
    }

    if (request.method === 'DELETE' && url.pathname === '/instance/logout') {
      sendJson(200, { message: 'success' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/instance/disconnect') {
      sendJson(200, { message: 'success' });
      return;
    }

    sendJson(404, { message: 'mock route not found' });
  });

  await new Promise((resolve) => evolutionMockServer.listen(Number(evolutionMockPort), '127.0.0.1', resolve));
}

const e2eEnv = {
  NODE_ENV: 'test',
  API_PORT: apiPort,
  DATABASE_URL: dbUrl,
  DIRECT_URL: dbUrl,
  REDIS_URL: redisUrl,
  JWT_SECRET: 'e2e-local-secret',
  WEB_ORIGIN: webOrigin,
  WEBHOOK_PUBLIC_URL: `${apiUrl}/webhooks/evolution`,
  EVOLUTION_BASE_URL: evolutionMockUrl,
  EVOLUTION_GLOBAL_API_KEY: 'e2e-local-evolution-key',
  NEXT_PUBLIC_WS_URL: apiUrl,
  NEXT_PUBLIC_API_URL: apiUrl,
  NEXT_PUBLIC_EVOLUTION_MANAGER_URL: 'http://127.0.0.1:8082/manager',
  API_INTERNAL_URL: apiUrl,
};

await startEvolutionMock();
await run('docker', ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml', 'up', '-d', 'postgres', 'redis']);
await retry('postgres readiness', () =>
  run('docker', [
    'compose',
    '-f',
    'docker-compose.yml',
    '-f',
    'docker-compose.dev.yml',
    'exec',
    '-T',
    'postgres',
    'pg_isready',
    '-U',
    'postgres',
    '-d',
    'multi_atendimento',
  ]),
);
await runOptional('docker', [
  'compose',
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.dev.yml',
  'exec',
  '-T',
  'postgres',
  'createdb',
  '-U',
  'postgres',
  'multi_atendimento_e2e',
]);
await run('npx', ['prisma', 'db', 'push', '--force-reset', '--accept-data-loss', '--schema', 'packages/db/prisma/schema.prisma'], {
  env: e2eEnv,
});
await run('npx', ['tsx', 'packages/db/prisma/seed.ts'], { env: e2eEnv });

start('npm', ['run', 'dev', '-w', '@multi/api'], { env: e2eEnv });
await waitForHttp(`${apiUrl}/health`, 'api readiness');
start('npx', ['next', 'dev', '--port', webPort, '--hostname', '127.0.0.1'], {
  cwd: `${root}/apps/web`,
  env: e2eEnv,
});

setInterval(() => undefined, 60_000);
