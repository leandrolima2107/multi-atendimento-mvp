'use client';

import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  Inbox,
  Loader2,
  LogOut,
  MapPin,
  MessageCircle,
  Mic,
  Paperclip,
  Plus,
  QrCode,
  RotateCcw,
  Send,
  Settings,
  Smile,
  Users,
  X,
} from 'lucide-react';
import { io } from 'socket.io-client';

const API_URL = '/api/backend';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4100';
const EVOLUTION_MANAGER_URL = process.env.NEXT_PUBLIC_EVOLUTION_MANAGER_URL ?? 'https://evo.devizando.com/manager';
const SESSION_STORAGE_KEY = 'multi.session';
const SESSION_EXPIRED_EVENT = 'multi:session-expired';
const SESSION_EXPIRED_MESSAGE = 'Sua sessão pode ter expirado. Faça login novamente.';
const WHATSAPP_DISCONNECTED_MESSAGE = 'Conecte seu WhatsApp para enviar e receber mensagens.';

const MEDIA_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm,video/mp4,video/webm,video/quicktime,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);

const DOCUMENT_EXTENSIONS = new Set(['csv', 'doc', 'docx', 'pdf', 'txt', 'xls', 'xlsx']);
const MEDIA_SIZE_LIMITS: Record<Extract<MessageKind, 'audio' | 'document' | 'image' | 'video'>, number> = {
  audio: 15 * 1024 * 1024,
  document: 15 * 1024 * 1024,
  image: 8 * 1024 * 1024,
  video: 15 * 1024 * 1024,
};

type Session = {
  accessToken: string;
  user: { id: string; name: string; email: string; platformRole: string };
  activeCompany: Company | null;
  memberships: Array<{ companyId: string; role: string; company: Company }>;
};

type Company = {
  id: string;
  name: string;
  slug: string;
  status?: string;
  plan?: { name: string; maxWhatsappInstances: number; maxUsers: number } | null;
  _count?: { members: number; whatsappInstances: number; leads: number; conversations: number };
};

type Plan = {
  id: string;
  name: string;
  slug: string;
  maxWhatsappInstances: number;
  maxUsers: number;
  isActive: boolean;
};

type PlatformSettings = {
  evolutionWebhook: {
    publicUrl: string;
    source: 'DATABASE' | 'ENV' | 'DEFAULT';
    updatedAt?: string | null;
    lastSyncedUrl?: string | null;
    lastSyncStatus?: string | null;
    lastSyncAt?: string | null;
  };
};

type Conversation = {
  id: string;
  status: string;
  lastMessageAt?: string;
  lead: { id: string; name?: string; phone?: string; remoteJid: string; pipelineStage?: { name: string } | null };
  assignedTo?: { id: string; name: string } | null;
  whatsappInstance: { id: string; name: string; status: string };
  messages: Message[];
};

type Message = {
  id: string;
  direction: MessageDirection;
  type?: MessageKind | string | null;
  body?: string | null;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  mediaFileName?: string | null;
  mediaSize?: number | null;
  caption?: string | null;
  status?: MessageDeliveryStatus | string | null;
  createdAt: string;
  sender?: { id: string; name: string } | null;
};

type MessageKind = 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'contact' | 'unknown';
type MessageDirection = 'INBOUND' | 'OUTBOUND' | 'SYSTEM';
type MessageDeliveryStatus = 'pending' | 'sending' | 'sent' | 'delivered' | 'read' | 'error' | 'failed' | 'received';
type ComposerSendState = 'idle' | 'sending' | 'sent' | 'error';

type ComposerAttachment = {
  file: File;
  fileName: string;
  mediaMimeType: string;
  previewUrl?: string;
  size: number;
  type: Extract<MessageKind, 'audio' | 'document' | 'image' | 'video'>;
};

type Lead = {
  id: string;
  name?: string;
  phone?: string;
  remoteJid: string;
  pipelineStage?: { name: string } | null;
};

type WhatsappInstance = {
  id: string;
  name: string;
  instanceKey: string;
  status: string;
  qrCode?: string | null;
  phoneNumber?: string | null;
  profileName?: string | null;
  lastError?: string | null;
  lastSyncedAt?: string | null;
  updatedAt?: string | null;
};

type Tab = 'atendimentos' | 'leads' | 'whatsapp' | 'settings';
type PlatformTab = 'companies' | 'plans' | 'settings';
type ConversationStatusFilter = 'ALL' | 'QUEUED' | 'OPEN' | 'CLOSED';
type BadgeTone = 'neutral' | 'green' | 'amber' | 'danger';

type NavItem = {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
};

type OnboardingItem = {
  label: string;
  done: boolean;
  detail: string;
};

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>('atendimentos');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    function handleSessionExpired(event: Event) {
      const detail = event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : '';
      localStorage.removeItem(SESSION_STORAGE_KEY);
      setSession(null);
      setIsLoggingIn(false);
      setError(detail || SESSION_EXPIRED_MESSAGE);
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return;
    }

    let storedSession: Session;
    try {
      storedSession = JSON.parse(raw) as Session;
    } catch {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      setError(SESSION_EXPIRED_MESSAGE);
      return;
    }

    if (!storedSession?.accessToken || !storedSession.user) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      setError(SESSION_EXPIRED_MESSAGE);
      return;
    }

    void api<unknown>('/auth/me', storedSession.accessToken)
      .then(() => setSession(storedSession))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          return;
        }
        setError(getErrorMessage(err, 'Não foi possível validar a sessão salva.'));
      });
  }, []);

  useEffect(() => {
    if (!session?.activeCompany?.id) {
      return;
    }
    const socket = io(WS_URL, {
      transports: ['websocket'],
      auth: { token: session.accessToken },
    });
    socket.emit('company:join', session.activeCompany.id);
    socket.on('message:new', () => window.dispatchEvent(new Event('multi:refresh')));
    socket.on('conversation:updated', () => window.dispatchEvent(new Event('multi:refresh')));
    socket.on('whatsapp:status', () => window.dispatchEvent(new Event('multi:refresh')));
    return () => {
      socket.disconnect();
    };
  }, [session?.accessToken, session?.activeCompany?.id]);

  async function login(email: string, password: string) {
    setError('');
    setIsLoggingIn(true);
    let response: Response;

    try {
      response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      setError('API indisponível. Inicie a API e o banco antes de entrar.');
      setIsLoggingIn(false);
      return;
    }

    if (!response.ok) {
      setError(response.status >= 500 ? 'API indisponível. Confira se a API e o banco estão rodando.' : 'E-mail ou senha inválidos.');
      setIsLoggingIn(false);
      return;
    }

    const data = (await response.json()) as Session;
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
    setSession(data);
    setIsLoggingIn(false);
  }

  function logout() {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    setSession(null);
    setError('');
  }

  if (!session) {
    return <LoginScreen error={error} isLoading={isLoggingIn} onLogin={login} />;
  }

  if (session.user.platformRole === 'PLATFORM_ADMIN' && !session.activeCompany) {
    return <PlatformShell session={session} onLogout={logout} />;
  }

  const activeRole = getActiveCompanyRole(session);
  const canManageWhatsapp = activeRole === 'COMPANY_ADMIN';
  const currentTab = !canManageWhatsapp && tab === 'whatsapp' ? 'atendimentos' : tab;
  const navItems: NavItem[] = [
    { active: currentTab === 'atendimentos', icon: <Inbox size={18} />, label: 'Atendimentos', onClick: () => setTab('atendimentos') },
    { active: currentTab === 'leads', icon: <Users size={18} />, label: 'Leads', onClick: () => setTab('leads') },
    ...(canManageWhatsapp
      ? [{ active: currentTab === 'whatsapp', icon: <MessageCircle size={18} />, label: 'WhatsApp', onClick: () => setTab('whatsapp') }]
      : []),
    { active: currentTab === 'settings', icon: <Settings size={18} />, label: 'Empresa', onClick: () => setTab('settings') },
  ];

  return (
    <AppLayout
      brandIcon={<MessageCircle size={20} />}
      brandSubtitle="Atendimento comercial"
      brandTitle="Multi Atendimento"
      navItems={navItems}
      onLogout={logout}
      planName={session.activeCompany?.plan?.name ?? 'Sem plano'}
      roleLabel={roleLabel(activeRole)}
      subtitle={session.activeCompany?.slug ? `Empresa ${session.activeCompany.slug}` : 'Ambiente de atendimento'}
      title={session.activeCompany?.name ?? 'Plataforma'}
      userEmail={session.user.email}
      userName={session.user.name}
    >
      {currentTab === 'atendimentos' && <AtendimentosView session={session} />}
      {currentTab === 'leads' && <LeadsView token={session.accessToken} />}
      {currentTab === 'whatsapp' && <WhatsappView token={session.accessToken} canManage={canManageWhatsapp} initialCompany={session.activeCompany} />}
      {currentTab === 'settings' && <SettingsView session={session} />}
    </AppLayout>
  );
}

function PlatformShell({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [tab, setTab] = useState<PlatformTab>('companies');
  const navItems: NavItem[] = [
    { active: tab === 'companies', icon: <Building2 size={18} />, label: 'Empresas', onClick: () => setTab('companies') },
    { active: tab === 'plans', icon: <CreditCard size={18} />, label: 'Planos', onClick: () => setTab('plans') },
    { active: tab === 'settings', icon: <Settings size={18} />, label: 'Configurações', onClick: () => setTab('settings') },
  ];

  return (
    <AppLayout
      brandIcon={<Building2 size={20} />}
      brandSubtitle="Admin da plataforma"
      brandTitle="Multi Atendimento"
      navItems={navItems}
      onLogout={onLogout}
      planName="Operação"
      roleLabel="Administrador da plataforma"
      subtitle="Gestão comercial e operacional"
      title="Plataforma"
      userEmail={session.user.email}
      userName={session.user.name}
    >
      {tab === 'companies' && <PlatformCompaniesView token={session.accessToken} />}
      {tab === 'plans' && <PlatformPlansView token={session.accessToken} />}
      {tab === 'settings' && <PlatformSettingsView token={session.accessToken} />}
    </AppLayout>
  );
}

function AppLayout({
  brandIcon,
  brandSubtitle,
  brandTitle,
  children,
  navItems,
  onLogout,
  planName,
  roleLabel: role,
  subtitle,
  title,
  userEmail,
  userName,
}: {
  brandIcon: ReactNode;
  brandSubtitle: string;
  brandTitle: string;
  children: ReactNode;
  navItems: NavItem[];
  onLogout: () => void;
  planName?: string | null;
  roleLabel: string;
  subtitle: string;
  title: string;
  userEmail: string;
  userName: string;
}) {
  return (
    <div className="app-shell">
      <Sidebar brandIcon={brandIcon} brandSubtitle={brandSubtitle} brandTitle={brandTitle} navItems={navItems} />
      <main className="main">
        <Header
          onLogout={onLogout}
          planName={planName}
          roleLabel={role}
          subtitle={subtitle}
          title={title}
          userEmail={userEmail}
          userName={userName}
        />
        <section className="workspace">{children}</section>
      </main>
    </div>
  );
}

function Sidebar({
  brandIcon,
  brandSubtitle,
  brandTitle,
  navItems,
}: {
  brandIcon: ReactNode;
  brandSubtitle: string;
  brandTitle: string;
  navItems: NavItem[];
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">{brandIcon}</div>
        <div className="brand-copy">
          <span>{brandTitle}</span>
          <small>{brandSubtitle}</small>
        </div>
      </div>
      <nav className="nav" aria-label="Navegação principal">
        {navItems.map((item) => (
          <NavButton key={item.label} active={item.active} icon={item.icon} label={item.label} onClick={item.onClick} />
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className="sidebar-status-dot" />
        <span>Ambiente seguro</span>
      </div>
    </aside>
  );
}

function Header({
  onLogout,
  planName,
  roleLabel: role,
  subtitle,
  title,
  userEmail,
  userName,
}: {
  onLogout: () => void;
  planName?: string | null;
  roleLabel: string;
  subtitle: string;
  title: string;
  userEmail: string;
  userName: string;
}) {
  return (
    <header className="topbar">
      <div className="topbar-context">
        <span className="eyebrow">{subtitle}</span>
        <strong>{title}</strong>
      </div>
      <div className="topbar-actions">
        <span className="badge green">{planName || 'Sem plano'}</span>
        <div className="user-chip">
          <span>{userName}</span>
          <small>{userEmail} · {role}</small>
        </div>
        <button className="button secondary compact" onClick={onLogout} title="Sair">
          <LogOut size={18} />
          Sair
        </button>
      </div>
    </header>
  );
}

function PlatformCompaniesView({ token }: { token: string }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const totals = companies.reduce(
    (acc, company) => ({
      users: acc.users + (company._count?.members ?? 0),
      whatsapps: acc.whatsapps + (company._count?.whatsappInstances ?? 0),
      leads: acc.leads + (company._count?.leads ?? 0),
    }),
    { users: 0, whatsapps: 0, leads: 0 },
  );

  useEffect(() => {
    async function loadCompanies() {
      setIsLoading(true);
      setLoadError('');
      try {
        setCompanies(await api<Company[]>('/companies', token));
      } catch (err) {
        setLoadError(getErrorMessage(err, 'Não foi possível carregar as empresas.'));
      } finally {
        setIsLoading(false);
      }
    }

    loadCompanies();
  }, [token]);

  return (
    <section className="grid">
      <div className="cards">
        <Metric label="Empresas" value={String(companies.length)} />
        <Metric label="Usuários" value={String(totals.users)} />
        <Metric label="WhatsApps" value={String(totals.whatsapps)} />
        <Metric label="Leads" value={String(totals.leads)} />
      </div>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Empresas cadastradas</div>
          <span className="badge green">PLATFORM_ADMIN</span>
        </div>
        <div className="conversation-list">
          {isLoading && <LoadingSkeleton count={4} variant="list" />}
          {loadError && <ErrorState title="Falha ao carregar empresas" description={loadError} />}
          {!isLoading && !loadError && companies.length === 0 && (
            <EmptyState
              icon={<Building2 size={20} />}
              title="Nenhuma empresa cadastrada"
              description="Crie a primeira empresa pela API ou seed para iniciar o piloto."
            />
          )}
          {companies.map((company) => (
            <div className="conversation-item" key={company.id}>
              <div className="row">
                <strong>{company.name}</strong>
                <span className="badge">{company.status ?? 'ACTIVE'}</span>
              </div>
              <div className="muted technical-text">
                {company.slug} · Plano {company.plan?.name ?? 'sem plano'} · {company._count?.members ?? 0} usuários ·{' '}
                {company._count?.whatsappInstances ?? 0} WhatsApp
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PlatformPlansView({ token }: { token: string }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    async function loadPlans() {
      setIsLoading(true);
      setLoadError('');
      try {
        setPlans(await api<Plan[]>('/companies/plans', token));
      } catch (err) {
        setLoadError(getErrorMessage(err, 'Não foi possível carregar os planos.'));
      } finally {
        setIsLoading(false);
      }
    }

    loadPlans();
  }, [token]);

  return (
    <section className="grid">
      <div className="panel-header panel">
        <div>
          <div className="panel-title">Planos</div>
          <div className="muted">Limites controlados manualmente no MVP</div>
        </div>
        <CreditCard />
      </div>
      <div className="cards">
        {isLoading && <LoadingSkeleton count={3} variant="cards" />}
        {loadError && <ErrorState title="Falha ao carregar planos" description={loadError} />}
        {!isLoading && !loadError && plans.length === 0 && (
          <EmptyState icon={<CreditCard size={20} />} title="Nenhum plano ativo" description="Cadastre planos para liberar empresas no piloto." />
        )}
        {plans.map((plan) => (
          <article className="card" key={plan.id}>
            <div className="row">
              <strong>{plan.name}</strong>
              <span className={`badge ${plan.isActive ? 'green' : 'amber'}`}>{plan.isActive ? 'Ativo' : 'Inativo'}</span>
            </div>
            <div className="muted technical-text">{plan.slug}</div>
            <div style={{ marginTop: 12 }}>
              <div>WhatsApp: {plan.maxWhatsappInstances}</div>
              <div>Usuários: {plan.maxUsers}</div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PlatformSettingsView({ token }: { token: string }) {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    async function loadSettings() {
      setIsLoading(true);
      setLoadError('');
      try {
        const data = await api<PlatformSettings>('/settings/platform', token);
        setSettings(data);
        setWebhookUrl(data.evolutionWebhook.publicUrl);
      } catch (err) {
        setLoadError(getErrorMessage(err, 'Não foi possível carregar as configurações.'));
      } finally {
        setIsLoading(false);
      }
    }

    loadSettings();
  }, [token]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setActionError('');
    setNotice('');
    try {
      const data = await api<PlatformSettings & { sync?: { ok?: boolean; error?: string } }>('/settings/platform/evolution-webhook', token, {
        method: 'PUT',
        body: JSON.stringify({ webhookPublicUrl: webhookUrl }),
      });
      setSettings(data);
      setWebhookUrl(data.evolutionWebhook.publicUrl);
      setNotice(data.sync?.ok ? 'Webhook atualizado na Evolution.' : data.sync?.error ?? 'URL salva. Sincronização pendente.');
    } catch (err) {
      setActionError(getErrorMessage(err, 'Não foi possível salvar a URL do webhook.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function syncNow() {
    setIsSyncing(true);
    setActionError('');
    setNotice('');
    try {
      const result = await api<{ ok?: boolean; updated?: number; error?: string }>('/settings/platform/evolution-webhook/sync', token, {
        method: 'POST',
      });
      const data = await api<PlatformSettings>('/settings/platform', token);
      setSettings(data);
      setWebhookUrl(data.evolutionWebhook.publicUrl);
      setNotice(result.ok ? `${result.updated ?? 0} instância(s) sincronizada(s).` : result.error ?? 'Sincronização pendente.');
    } catch (err) {
      setActionError(getErrorMessage(err, 'Não foi possível sincronizar os webhooks.'));
    } finally {
      setIsSyncing(false);
    }
  }

  const syncStatus = settings?.evolutionWebhook.lastSyncStatus;

  return (
    <section className="grid">
      <div className="panel-header panel">
        <div>
          <div className="panel-title">Configurações</div>
          <div className="muted">Evolution API</div>
        </div>
        <Settings />
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Webhook Evolution</div>
            <div className="muted technical-text">{settings?.evolutionWebhook.source ?? '...'}</div>
          </div>
          <button className="button secondary" onClick={syncNow} disabled={isLoading || isSaving || isSyncing} type="button">
            {isSyncing ? <Loader2 className="spin" size={18} /> : <RotateCcw size={18} />}
            Sincronizar
          </button>
        </div>
        {isLoading && <LoadingSkeleton count={2} variant="panel" />}
        {loadError && <ErrorState title="Falha ao carregar configurações" description={loadError} />}
        {!isLoading && !loadError && (
          <form className="settings-form" onSubmit={save}>
            <label>
              <span>URL pública do webhook</span>
              <input
                className="input"
                value={webhookUrl}
                onChange={(event) => setWebhookUrl(event.target.value)}
                placeholder="https://api.exemplo.com/webhooks/evolution"
              />
            </label>
            <div className="settings-meta">
              <Metric label="Última URL sincronizada" value={settings?.evolutionWebhook.lastSyncedUrl ?? '-'} technical />
              <Metric
                label="Última sincronização"
                value={settings?.evolutionWebhook.lastSyncAt ? new Date(settings.evolutionWebhook.lastSyncAt).toLocaleString('pt-BR') : '-'}
                technical
              />
            </div>
            {syncStatus && <InlineAlert>{syncStatus}</InlineAlert>}
            {notice && <InlineAlert>{notice}</InlineAlert>}
            {actionError && <InlineAlert tone="danger">{actionError}</InlineAlert>}
            <button className="button" type="submit" disabled={isSaving || isSyncing}>
              {isSaving ? <Loader2 className="spin" size={18} /> : <CheckCircle2 size={18} />}
              Salvar URL
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

function LoginScreen({
  error,
  isLoading,
  onLogin,
}: {
  error: string;
  isLoading: boolean;
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('admin@acme.local');
  const [password, setPassword] = useState('admin123');

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onLogin(email, password);
  }

  return (
    <main className="login">
      <section className="login-panel">
        <div className="brand" style={{ color: 'var(--ink)', marginBottom: 18 }}>
          <div className="brand-mark">
            <MessageCircle size={20} />
          </div>
          <span>Multi Atendimento</span>
        </div>
        <form className="form" onSubmit={submit}>
          <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail" />
          <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha" />
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
          <button className="button" type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="spin" size={18} />}
            {isLoading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}

function AtendimentosView({ session }: { session: Session }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [body, setBody] = useState('');
  const [caption, setCaption] = useState('');
  const [attachment, setAttachment] = useState<ComposerAttachment | null>(null);
  const [composerState, setComposerState] = useState<ComposerSendState>('idle');
  const [composerError, setComposerError] = useState('');
  const [statusFilter, setStatusFilter] = useState<ConversationStatusFilter>('QUEUED');
  const [isLoading, setIsLoading] = useState(true);
  const [isThreadLoading, setIsThreadLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [threadError, setThreadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState('');
  const selectedIdRef = useRef<string | null>(null);
  const didPickInitialRef = useRef(false);

  const token = session.accessToken;

  useEffect(() => {
    return () => {
      if (attachment?.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, [attachment?.previewUrl]);

  async function load() {
    setIsLoading(true);
    setListError('');
    const query = statusFilter === 'ALL' ? '' : `?status=${statusFilter}`;

    try {
      const rows = await apiWithInboxFallback<Conversation[]>(
        `/atendimentos/conversations${query}`,
        `/inbox/conversations${query}`,
        token,
      );
      setConversations(rows);

      if (rows.length === 0) {
        selectedIdRef.current = null;
        didPickInitialRef.current = false;
        setSelectedId(null);
        setSelected(null);
        return;
      }

      const selectedStillVisible = rows.some((conversation) => conversation.id === selectedIdRef.current);
      if (!selectedStillVisible || (!didPickInitialRef.current && !selectedIdRef.current)) {
        didPickInitialRef.current = true;
        setSelectedId(rows[0].id);
      }
    } catch (err) {
      setListError(getErrorMessage(err, 'Não foi possível carregar a fila.'));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSelected(id: string) {
    setIsThreadLoading(true);
    setThreadError('');
    try {
      const response = await apiWithInboxFallback<Conversation>(
        `/atendimentos/conversations/${id}`,
        `/inbox/conversations/${id}`,
        token,
      );

      setSelected(response);
    } catch (err) {
      setThreadError(getErrorMessage(err, 'Não foi possível carregar a conversa.'));
    } finally {
      setIsThreadLoading(false);
    }
  }

  useEffect(() => {
    didPickInitialRef.current = false;
    selectedIdRef.current = null;
    setSelectedId(null);
    setSelected(null);
    load();
    const refresh = () => load();
    window.addEventListener('multi:refresh', refresh);
    return () => window.removeEventListener('multi:refresh', refresh);
  }, [statusFilter]);

  useEffect(() => {
    if (selectedId) {
      selectedIdRef.current = selectedId;
      setBody('');
      setCaption('');
      setAttachment(null);
      setComposerState('idle');
      setComposerError('');
      loadSelected(selectedId);
    }
  }, [selectedId]);

  async function assign() {
    await runConversationAction('assign', 'Não foi possível assumir a conversa.', async (conversation) => {
      await apiWithInboxFallback(
        `/atendimentos/conversations/${conversation.id}/assign-me`,
        `/inbox/conversations/${conversation.id}/assign-me`,
        token,
        { method: 'POST' },
      );
    });
  }

  async function close() {
    await runConversationAction('close', 'Não foi possível encerrar a conversa.', async (conversation) => {
      await apiWithInboxFallback(
        `/atendimentos/conversations/${conversation.id}/close`,
        `/inbox/conversations/${conversation.id}/close`,
        token,
        { method: 'POST' },
      );
    });
  }

  async function reopen() {
    await runConversationAction('reopen', 'Não foi possível reabrir a conversa.', async (conversation) => {
      await apiWithInboxFallback(
        `/atendimentos/conversations/${conversation.id}/reopen`,
        `/inbox/conversations/${conversation.id}/reopen`,
        token,
        { method: 'POST' },
      );
    });
  }

  async function send() {
    if (!selected || (!body.trim() && !attachment)) return;

    if (selected.whatsappInstance.status !== 'CONNECTED') {
      setComposerState('error');
      setComposerError(WHATSAPP_DISCONNECTED_MESSAGE);
      return;
    }

    await runConversationAction('send', 'Não foi possível enviar a mensagem.', async (conversation) => {
      setComposerState('sending');
      setComposerError('');

      if (attachment) {
        await apiWithInboxFallback(
          `/atendimentos/conversations/${conversation.id}/media`,
          `/inbox/conversations/${conversation.id}/media`,
          token,
          {
            method: 'POST',
            body: JSON.stringify({
              type: attachment.type,
              fileName: attachment.fileName,
              mimeType: attachment.mediaMimeType,
              size: attachment.size,
              dataBase64: await fileToBase64(attachment.file),
              caption: caption.trim() || undefined,
            }),
          },
        );
        setAttachment(null);
        setCaption('');
      } else {
        await apiWithInboxFallback(
          `/atendimentos/conversations/${conversation.id}/messages`,
          `/inbox/conversations/${conversation.id}/messages`,
          token,
          {
            method: 'POST',
            body: JSON.stringify({ body: body.trim(), type: 'text' }),
          },
        );
        setBody('');
      }

      setComposerState('sent');
      window.setTimeout(() => setComposerState((current) => (current === 'sent' ? 'idle' : current)), 2400);
    });
  }

  function selectAttachment(file: File | null) {
    if (!file) {
      return;
    }

    const nextAttachment = buildComposerAttachment(file);
    if (typeof nextAttachment === 'string') {
      setComposerState('error');
      setComposerError(nextAttachment);
      return;
    }

    setAttachment(nextAttachment);
    setComposerState('idle');
    setComposerError('');
  }

  function removeAttachment() {
    setAttachment(null);
    setCaption('');
    setComposerState('idle');
    setComposerError('');
  }

  async function runConversationAction(
    action: string,
    fallbackMessage: string,
    mutate: (conversation: Conversation) => Promise<void>,
  ) {
    if (!selected) return;
    setActionPending(action);
    setActionError('');
    try {
      await mutate(selected);
      await loadSelected(selected.id);
      await load();
    } catch (err) {
      const message = getErrorMessage(err, fallbackMessage);
      setActionError(message);
      if (action === 'send') {
        setComposerState('error');
        setComposerError(message);
      }
    } finally {
      setActionPending('');
    }
  }

  return (
    <div className="grid atendimentos">
      <ConversationList
        conversations={conversations}
        isLoading={isLoading}
        listError={listError}
        onSelect={setSelectedId}
        onStatusFilterChange={setStatusFilter}
        selectedId={selectedId}
        statusFilter={statusFilter}
      />
      <ConversationPanel
        actionError={actionError}
        actionPending={actionPending}
        attachment={attachment}
        body={body}
        caption={caption}
        composerError={composerError}
        composerState={composerState}
        isThreadLoading={isThreadLoading}
        onAssign={assign}
        onAttachmentRemove={removeAttachment}
        onAttachmentSelected={selectAttachment}
        onBodyChange={setBody}
        onCaptionChange={setCaption}
        onClose={close}
        onReopen={reopen}
        onSend={send}
        selected={selected}
        threadError={threadError}
      />
    </div>
  );
}

function ConversationList({
  conversations,
  isLoading,
  listError,
  onSelect,
  onStatusFilterChange,
  selectedId,
  statusFilter,
}: {
  conversations: Conversation[];
  isLoading: boolean;
  listError: string;
  onSelect: (id: string) => void;
  onStatusFilterChange: (status: ConversationStatusFilter) => void;
  selectedId: string | null;
  statusFilter: ConversationStatusFilter;
}) {
  return (
    <section className="panel conversation-list-panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">Fila de atendimento</div>
          <div className="muted">Filtre por etapa e assuma os atendimentos do piloto.</div>
        </div>
        <span className="badge amber">{conversations.length}</span>
      </div>
      <div className="filter-bar" aria-label="Filtrar conversas por status">
        {(['QUEUED', 'OPEN', 'CLOSED', 'ALL'] as ConversationStatusFilter[]).map((status) => (
          <button key={status} className={statusFilter === status ? 'active' : ''} onClick={() => onStatusFilterChange(status)} type="button">
            {statusFilterLabel(status)}
          </button>
        ))}
      </div>
      <div className="conversation-list">
        {isLoading && <LoadingSkeleton count={5} variant="list" />}
        {listError && <ErrorState title="Falha ao carregar a fila" description={listError} />}
        {!isLoading &&
          !listError &&
          conversations.map((conversation) => (
            <button
              key={conversation.id}
              className={`conversation-item ${selectedId === conversation.id ? 'active' : ''}`}
              onClick={() => onSelect(conversation.id)}
            >
              <div className="row">
                <strong>{conversation.lead.name ?? conversation.lead.phone ?? conversation.lead.remoteJid}</strong>
                <StatusBadge status={conversation.status} />
              </div>
              <div className="muted text-ellipsis">{messagePreview(conversation.messages[0])}</div>
              <div className="conversation-meta">
                <span>{conversation.assignedTo ? `Com ${conversation.assignedTo.name}` : 'Aguardando atendente'}</span>
                {conversation.lastMessageAt && (
                  <span className="technical-text">{new Date(conversation.lastMessageAt).toLocaleDateString('pt-BR')}</span>
                )}
              </div>
            </button>
          ))}
        {!isLoading && !listError && conversations.length === 0 && (
          <EmptyState
            icon={<Inbox size={20} />}
            title={`Nenhuma conversa em ${statusFilterLabel(statusFilter).toLowerCase()}`}
            description="Quando uma mensagem chegar, ela aparecerá aqui para o time assumir e responder."
          />
        )}
      </div>
    </section>
  );
}

function ConversationPanel({
  actionError,
  actionPending,
  attachment,
  body,
  caption,
  composerError,
  composerState,
  isThreadLoading,
  onAssign,
  onAttachmentRemove,
  onAttachmentSelected,
  onBodyChange,
  onCaptionChange,
  onClose,
  onReopen,
  onSend,
  selected,
  threadError,
}: {
  actionError: string;
  actionPending: string;
  attachment: ComposerAttachment | null;
  body: string;
  caption: string;
  composerError: string;
  composerState: ComposerSendState;
  isThreadLoading: boolean;
  onAssign: () => void;
  onAttachmentRemove: () => void;
  onAttachmentSelected: (file: File | null) => void;
  onBodyChange: (value: string) => void;
  onCaptionChange: (value: string) => void;
  onClose: () => void;
  onReopen: () => void;
  onSend: () => void;
  selected: Conversation | null;
  threadError: string;
}) {
  if (isThreadLoading) {
    return (
      <section className="panel thread">
        <LoadingSkeleton count={4} variant="thread" />
      </section>
    );
  }

  if (threadError) {
    return (
      <section className="panel thread">
        <ErrorState title="Falha ao abrir conversa" description={threadError} />
      </section>
    );
  }

  if (!selected) {
    return (
      <section className="panel thread">
        <EmptyState
          icon={<Inbox size={20} />}
          title="Selecione uma conversa"
          description="Escolha um atendimento na lista para ver o histórico e responder pelo WhatsApp."
        />
      </section>
    );
  }

  const isSending = actionPending === 'send' || composerState === 'sending';
  const isWhatsappConnected = selected.whatsappInstance.status === 'CONNECTED';
  const isComposerBlocked = selected.status === 'CLOSED' || !isWhatsappConnected;
  const composerValue = attachment ? caption : body;
  const canSubmit = !isComposerBlocked && !isSending && Boolean(attachment || body.trim());
  const composerPlaceholder = selected.status === 'CLOSED'
    ? 'Reabra a conversa para responder'
    : !isWhatsappConnected
      ? 'WhatsApp desconectado'
      : attachment
        ? 'Legenda da mídia (opcional)'
        : 'Digite uma resposta';

  function updateComposerValue(value: string) {
    if (attachment) {
      onCaptionChange(value);
      return;
    }
    onBodyChange(value);
  }

  function handleAttachmentInput(event: ChangeEvent<HTMLInputElement>) {
    onAttachmentSelected(event.target.files?.[0] ?? null);
    event.target.value = '';
  }

  return (
    <section className="panel thread">
      <div className="panel-header thread-header">
        <div>
          <div className="panel-title">{selected.lead.name ?? selected.lead.phone ?? selected.lead.remoteJid}</div>
          <div className="muted">{selected.whatsappInstance.name} · {selected.assignedTo?.name ?? 'sem responsável'}</div>
        </div>
        <div className="row thread-actions">
          <StatusBadge status={selected.status} />
          {selected.status === 'CLOSED' ? (
            <button className="button secondary" onClick={onReopen} disabled={actionPending === 'reopen'}>
              {actionPending === 'reopen' ? <Loader2 className="spin" size={18} /> : <RotateCcw size={18} />}
              Reabrir
            </button>
          ) : (
            <>
              <button className="button secondary" onClick={onAssign} disabled={actionPending === 'assign'}>
                {actionPending === 'assign' && <Loader2 className="spin" size={18} />}
                Assumir
              </button>
              <button className="button danger" onClick={onClose} disabled={actionPending === 'close'}>
                {actionPending === 'close' && <Loader2 className="spin" size={18} />}
                Encerrar
              </button>
            </>
          )}
        </div>
      </div>
      {actionError && <InlineAlert tone="danger">{actionError}</InlineAlert>}
      {!isWhatsappConnected && <InlineAlert tone="danger">{WHATSAPP_DISCONNECTED_MESSAGE}</InlineAlert>}
      <div className="messages">
        {selected.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {selected.messages.length === 0 && (
          <EmptyState icon={<MessageCircle size={20} />} title="Sem mensagens ainda" description="A conversa foi criada, mas ainda não há histórico." />
        )}
      </div>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <div className="composer-main">
          {attachment && <ComposerAttachmentPreview attachment={attachment} caption={caption} onRemove={onAttachmentRemove} />}
          <div className="composer-controls">
            <label className={`icon-button ${isComposerBlocked || isSending ? 'disabled' : ''}`} title="Anexar mídia">
              <Paperclip size={18} />
              <input
                accept={MEDIA_ACCEPT}
                className="sr-only"
                disabled={isComposerBlocked || isSending}
                onChange={handleAttachmentInput}
                type="file"
              />
            </label>
            <button className="icon-button" disabled={isComposerBlocked || isSending} title="Emoji" type="button">
              <Smile size={18} />
            </button>
            <button className="icon-button mic-button" disabled title="Gravação de áudio em preparação" type="button">
              <Mic size={17} />
              <span className="audio-bars" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </button>
            <textarea
              className="input composer-textarea"
              disabled={isComposerBlocked || isSending}
              onChange={(event) => updateComposerValue(event.target.value)}
              placeholder={composerPlaceholder}
              rows={1}
              value={composerValue}
            />
          </div>
          <ComposerFeedback error={composerError} state={composerState} />
        </div>
        <button className="button composer-submit" disabled={!canSubmit} title="Enviar" type="submit">
          {isSending ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
          {isSending ? 'Enviando...' : 'Enviar'}
        </button>
      </form>
    </section>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const messageType = normalizeMessageType(message.type, message.mediaMimeType);
  const bodyBelongsToMediaCard = messageType === 'contact' || messageType === 'location';
  const caption = message.caption?.trim() || (messageType === 'text' || bodyBelongsToMediaCard ? '' : message.body?.trim() ?? '');
  const text = messageType === 'text' ? message.body?.trim() : '';

  return (
    <div className={`bubble ${message.direction === 'OUTBOUND' ? 'out' : ''}`}>
      {messageType !== 'text' && <MessageMediaPreview message={message} type={messageType} />}
      {text && <div className="message-body">{text}</div>}
      {caption && <div className="message-caption">{caption}</div>}
      {!text && !caption && messageType === 'text' && <div className="message-body">Mensagem sem texto</div>}
      <div className="message-footer">
        <span>{new Date(message.createdAt).toLocaleString('pt-BR')}</span>
        {message.direction === 'OUTBOUND' && <span>{messageStatusLabel(message.status)}</span>}
      </div>
    </div>
  );
}

function MessageMediaPreview({ message, type }: { message: Message; type: MessageKind }) {
  const source = message.mediaUrl ? mediaUrl(message.mediaUrl) : '';
  const fileName = message.mediaFileName ?? messageKindLabel(type);
  const fileSize = formatFileSize(message.mediaSize);

  if ((type === 'image' || type === 'sticker') && source) {
    return (
      <div className="message-media">
        <img
          alt={fileName}
          className={type === 'sticker' ? 'message-sticker' : 'message-image'}
          src={source}
        />
      </div>
    );
  }

  if (type === 'audio' && source) {
    return (
      <div className="message-media">
        <audio className="message-audio" controls src={source}>
          <track kind="captions" />
        </audio>
      </div>
    );
  }

  if (type === 'video' && source) {
    return (
      <div className="message-media">
        <video className="message-video" controls src={source}>
          <track kind="captions" />
        </video>
      </div>
    );
  }

  if (type === 'document') {
    return (
      <a className="message-document" href={source || undefined} rel="noreferrer" target="_blank">
        <FileText size={22} />
        <span>
          <strong>{fileName}</strong>
          <small>{fileSize || 'Documento'}</small>
        </span>
        {source && <Download size={18} />}
      </a>
    );
  }

  if (type === 'location') {
    return (
      <div className="message-compact-media">
        <MapPin size={22} />
        <span>{message.body || message.caption || 'Localização compartilhada'}</span>
      </div>
    );
  }

  if (type === 'contact') {
    return (
      <div className="message-compact-media">
        <Users size={22} />
        <span>{message.body || message.caption || 'Contato compartilhado'}</span>
      </div>
    );
  }

  return (
    <div className="message-compact-media">
      <AlertCircle size={22} />
      <span>{source ? 'Mídia recebida' : 'Mídia sem prévia disponível'}</span>
    </div>
  );
}

function ComposerAttachmentPreview({
  attachment,
  caption,
  onRemove,
}: {
  attachment: ComposerAttachment;
  caption: string;
  onRemove: () => void;
}) {
  return (
    <div className="attachment-preview">
      <div className="attachment-preview-media">
        {attachment.type === 'image' ? (
          <img alt={attachment.fileName} src={attachment.previewUrl} />
        ) : attachment.type === 'video' ? (
          <video muted src={attachment.previewUrl} />
        ) : attachment.type === 'audio' ? (
          <Mic size={22} />
        ) : (
          <FileText size={22} />
        )}
      </div>
      <div className="attachment-preview-copy">
        <strong>{attachment.fileName}</strong>
        <span>
          {messageKindLabel(attachment.type)} · {formatFileSize(attachment.size)}
          {caption.trim() ? ' · com legenda' : ''}
        </span>
      </div>
      <button className="icon-button" onClick={onRemove} title="Remover anexo" type="button">
        <X size={18} />
      </button>
    </div>
  );
}

function ComposerFeedback({ error, state }: { error: string; state: ComposerSendState }) {
  if (state === 'sending') {
    return <div className="composer-feedback">Enviando mensagem...</div>;
  }
  if (state === 'sent') {
    return <div className="composer-feedback success">Mensagem enviada.</div>;
  }
  if (state === 'error' && error) {
    return <div className="composer-feedback error">{error}</div>;
  }
  return null;
}

function LeadsView({ token }: { token: string }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    async function loadLeads() {
      setIsLoading(true);
      setLoadError('');
      try {
        setLeads(await api<Lead[]>('/leads', token));
      } catch (err) {
        setLoadError(getErrorMessage(err, 'Não foi possível carregar os leads.'));
      } finally {
        setIsLoading(false);
      }
    }

    loadLeads();
  }, [token]);

  return (
    <section className="grid">
      <div className="panel-header panel">
        <div className="panel-title">Leads</div>
        <span className="badge green">{leads.length} contatos</span>
      </div>
      <div className="cards">
        {isLoading && <LoadingSkeleton count={4} variant="cards" />}
        {loadError && <ErrorState title="Falha ao carregar leads" description={loadError} />}
        {!isLoading && !loadError && leads.length === 0 && (
          <EmptyState
            icon={<Users size={20} />}
            title="Nenhum lead cadastrado"
            description="Os contatos serão listados aqui assim que chegarem pelo WhatsApp ou forem importados."
          />
        )}
        {leads.map((lead) => (
          <article className="card" key={lead.id}>
            <strong>{lead.name ?? lead.phone ?? lead.remoteJid}</strong>
            <div className="muted technical-text">{lead.phone ?? lead.remoteJid}</div>
            <div style={{ marginTop: 12 }}><span className="badge">{lead.pipelineStage?.name ?? 'Sem etapa'}</span></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function WhatsappView({
  token,
  canManage,
  initialCompany,
}: {
  token: string;
  canManage: boolean;
  initialCompany: Company | null;
}) {
  const [instances, setInstances] = useState<WhatsappInstance[]>([]);
  const [company, setCompany] = useState<Company | null>(initialCompany);
  const [nickname, setNickname] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [actionPending, setActionPending] = useState('');
  const [disconnectTarget, setDisconnectTarget] = useState<WhatsappInstance | null>(null);
  const primaryInstance = instances[0] ?? null;
  const usedInstances = company?._count?.whatsappInstances ?? instances.length;
  const maxInstances = company?.plan?.maxWhatsappInstances ?? 0;
  const remainingInstances = Math.max(maxInstances - usedInstances, 0);
  const hasPlan = Boolean(company?.plan);
  const isLimitReached = !hasPlan || remainingInstances === 0;
  const canCreateNewConnection = hasPlan && remainingInstances > 0;

  async function load() {
    setIsLoading(true);
    setLoadError('');
    try {
      const [rows, overview] = await Promise.all([
        api<WhatsappInstance[]>('/whatsapp/instances', token),
        api<Company | null>('/companies/current', token).catch(() => null),
      ]);
      setInstances(rows);
      setCompany(overview ?? initialCompany);
    } catch (err) {
      setLoadError(getErrorMessage(err, 'Não foi possível carregar as conexões do WhatsApp.'));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener('multi:refresh', refresh);
    return () => window.removeEventListener('multi:refresh', refresh);
  }, [token]);

  useEffect(() => {
    const pending = instances.filter((instance) => instance.status === 'QR_PENDING');
    if (!pending.length) return;

    const timer = window.setInterval(async () => {
      const updates = await Promise.all(
        pending.map((instance) =>
          api<WhatsappInstance>(`/whatsapp/instances/${instance.id}`, token).catch(() => null),
        ),
      );
      const validUpdates = updates.filter((item): item is WhatsappInstance => Boolean(item));
      if (!validUpdates.length) return;

      setInstances((current) =>
        current.map((row) => validUpdates.find((updated) => updated.id === row.id) ?? row),
      );
    }, 5000);

    return () => window.clearInterval(timer);
  }, [instances, token]);

  async function connectWhatsapp() {
    if (!canManage) return;
    if (!primaryInstance && !hasPlan) {
      setActionError('Defina um plano para a empresa antes de criar conexões WhatsApp.');
      return;
    }
    if (!primaryInstance && !canCreateNewConnection) {
      setActionError(planLimitMessage(maxInstances));
      return;
    }
    setActionPending('connect');
    setActionError('');
    setActionNotice('');
    try {
      const target =
        primaryInstance ??
        (await api<WhatsappInstance>('/whatsapp/instances', token, {
          method: 'POST',
          body: JSON.stringify({ name: nickname.trim() || undefined }),
        }));
      const updated = await requestInstanceQrCode(target.id, token);
      setInstances((current) => {
        const exists = current.some((row) => row.id === updated.id);
        return exists ? current.map((row) => (row.id === updated.id ? updated : row)) : [updated, ...current];
      });
      setNickname('');
      setActionNotice(
        updated.qrCode
          ? 'QR Code gerado. Escaneie pelo WhatsApp em Dispositivos conectados.'
          : 'Conexão iniciada. O QR Code será exibido assim que a Evolution Go retornar.',
      );
      await load();
    } catch (err) {
      setActionError(getErrorMessage(err, 'Não foi possível iniciar a conexão WhatsApp.'));
    } finally {
      setActionPending('');
    }
  }

  async function requestQrCode(instance: WhatsappInstance) {
    if (!canManage) return;
    if (instance.status === 'CONNECTED') {
      const confirmed = window.confirm('Gerar um novo QR Code vai desconectar a sessão atual deste WhatsApp. Continuar?');
      if (!confirmed) return;
    }
    setActionPending(`qr:${instance.id}`);
    setActionError('');
    setActionNotice('');
    try {
      const updated = await requestInstanceQrCode(instance.id, token);
      setInstances((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setActionNotice(updated.qrCode ? 'QR Code gerado. Escaneie pelo WhatsApp em Dispositivos conectados.' : 'Pedido enviado. Atualize em alguns segundos se o QR Code ainda não aparecer.');
      await load();
    } catch (err) {
      setActionError(getErrorMessage(err, 'Não foi possível gerar o QR Code.'));
    } finally {
      setActionPending('');
    }
  }

  async function disconnectWhatsapp(instance: WhatsappInstance) {
    setActionPending(`disconnect:${instance.id}`);
    setActionError('');
    setActionNotice('');
    try {
      const updated = await api<WhatsappInstance>(`/whatsapp/instances/${instance.id}/disconnect`, token, { method: 'POST' });
      setInstances((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setDisconnectTarget(null);
      setActionNotice('WhatsApp desconectado. Agora você pode gerar um novo QR Code para conectar outro número.');
      await load();
    } catch (err) {
      setActionError(getErrorMessage(err, 'Não foi possível desconectar o WhatsApp.'));
    } finally {
      setActionPending('');
    }
  }

  async function refresh(id: string) {
    if (!canManage) return;
    setActionPending(`refresh:${id}`);
    setActionError('');
    setActionNotice('');
    try {
      await api(`/whatsapp/instances/${id}`, token);
      await load();
    } catch (err) {
      setActionError(getErrorMessage(err, 'Não foi possível atualizar o status.'));
    } finally {
      setActionPending('');
    }
  }

  return (
    <section className="grid whatsapp-page">
      <div className="panel whatsapp-hero">
        <div>
          <span className="eyebrow">Evolution Go</span>
          <div className="panel-title">Conexão WhatsApp</div>
          <div className="muted">Conecte um número por QR Code e acompanhe a sessão em tempo real.</div>
        </div>
        <a className="button secondary compact" href={EVOLUTION_MANAGER_URL} target="_blank" rel="noreferrer">
          Manager
        </a>
      </div>
      <div className="cards whatsapp-summary">
        <Metric label="Plano" value={company?.plan?.name ?? 'Sem plano'} />
        <Metric label="Plano usado" value={`${usedInstances}/${maxInstances}`} />
        <Metric label="Disponível" value={String(remainingInstances)} />
      </div>
      {isLimitReached && (
        <InlineAlert>
          {hasPlan
            ? planLimitMessage(maxInstances)
            : 'Defina um plano para a empresa antes de criar conexões WhatsApp.'}
        </InlineAlert>
      )}
      {actionError && <InlineAlert tone="danger">{actionError}</InlineAlert>}
      {actionNotice && <InlineAlert>{actionNotice}</InlineAlert>}
      <div className="whatsapp-main">
        {isLoading && <LoadingSkeleton count={1} variant="panel" />}
        {loadError && <ErrorState title="Falha ao carregar conexões" description={loadError} />}
        {!isLoading && !loadError && instances.length === 0 && (
          <article className="panel whatsapp-empty-card">
            <div className="whatsapp-card-title">
              <div className="whatsapp-status-icon neutral">
                <MessageCircle size={22} />
              </div>
              <div>
                <strong>Nenhum WhatsApp conectado</strong>
                <div className="muted">Conecte um número para começar a receber mensagens no atendimento.</div>
              </div>
            </div>
            {canManage && (
              <div className="whatsapp-connect-box">
                <input
                  className="input"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  aria-label="Apelido da conexão"
                  placeholder="Apelido da conexão, opcional"
                />
                <button className="button" onClick={connectWhatsapp} disabled={!canCreateNewConnection || actionPending === 'connect'}>
                  {actionPending === 'connect' ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
                  Conectar WhatsApp
                </button>
              </div>
            )}
          </article>
        )}
        {instances.map((instance) => {
          const statusMeta = whatsappStatusMeta(instance.status);
          const isBusy =
            actionPending === 'connect' ||
            actionPending === `refresh:${instance.id}` ||
            actionPending === `qr:${instance.id}` ||
            actionPending === `disconnect:${instance.id}`;
          const connected = instance.status === 'CONNECTED';
          const disconnected = ['DISCONNECTED', 'ERROR', 'CREATED'].includes(instance.status);

          return (
            <article className="panel whatsapp-card premium" key={instance.id}>
              <div className="whatsapp-card-top">
                <div className="whatsapp-card-title">
                  <div className={`whatsapp-status-icon ${statusMeta.tone}`}>
                    {whatsappStatusIcon(instance.status)}
                  </div>
                  <div>
                    <strong>{instance.name || 'WhatsApp principal'}</strong>
                    <div className="muted">{connected ? 'Sessão pronta para receber mensagens.' : statusMeta.description}</div>
                  </div>
                </div>
                <BadgeStatus label={statusMeta.label} tone={statusMeta.tone} />
              </div>
              <div className="whatsapp-details">
                <ConnectionDetail label="Número" value={formatPhone(instance.phoneNumber) ?? 'Ainda não identificado'} />
                <ConnectionDetail label="Perfil" value={instance.profileName ?? 'Não informado'} />
                <ConnectionDetail label="Status" value={statusMeta.label} />
                <ConnectionDetail label="Última sincronização" value={formatDateTime(instance.lastSyncedAt ?? instance.updatedAt)} />
                <ConnectionDetail label="Plano usado" value={`${usedInstances}/${maxInstances}`} />
              </div>
              {instance.lastError && <InlineAlert tone="danger">{friendlyOperationalMessage(instance.lastError)}</InlineAlert>}
              {instance.qrCode && instance.status !== 'CONNECTED' && <QrCodePreview value={instance.qrCode} />}
              {canManage && (
                <div className="instance-actions">
                  <button className="button secondary" onClick={() => refresh(instance.id)} disabled={isBusy}>
                    {actionPending === `refresh:${instance.id}` ? <Loader2 className="spin" size={18} /> : <RotateCcw size={18} />}
                    Atualizar status
                  </button>
                  {disconnected && (
                    <button className="button" onClick={() => requestQrCode(instance)} disabled={isBusy}>
                      {actionPending === `qr:${instance.id}` ? <Loader2 className="spin" size={18} /> : <QrCode size={18} />}
                      Reconectar
                    </button>
                  )}
                  {instance.status === 'QR_PENDING' && (
                    <button className="button" onClick={() => requestQrCode(instance)} disabled={isBusy}>
                      {actionPending === `qr:${instance.id}` ? <Loader2 className="spin" size={18} /> : <QrCode size={18} />}
                      Atualizar QR
                    </button>
                  )}
                  {connected && (
                    <button className="button danger" onClick={() => setDisconnectTarget(instance)} disabled={isBusy}>
                      {actionPending === `disconnect:${instance.id}` ? <Loader2 className="spin" size={18} /> : <LogOut size={18} />}
                      Desconectar WhatsApp
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {disconnectTarget && (
        <ConfirmModal
          title="Desconectar WhatsApp"
          description={`O número ${formatPhone(disconnectTarget.phoneNumber) ?? 'conectado'} será deslogado desta instância. Depois disso, você poderá gerar um novo QR Code para conectar outro número.`}
          confirmLabel="Desconectar WhatsApp"
          isBusy={actionPending === `disconnect:${disconnectTarget.id}`}
          onCancel={() => setDisconnectTarget(null)}
          onConfirm={() => disconnectWhatsapp(disconnectTarget)}
        />
      )}
    </section>
  );
}
function QrCodePreview({ value }: { value: string }) {
  const src = value.startsWith('data:image') ? value : `data:image/png;base64,${value}`;

  return (
    <div className="qr-frame">
      <img src={src} alt="QR Code do WhatsApp" />
    </div>
  );
}

function SettingsView({ session }: { session: Session }) {
  const [company, setCompany] = useState<Company | null>(session.activeCompany);
  const [instances, setInstances] = useState<WhatsappInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const stats = company?._count;
  const activeRole = getActiveCompanyRole(session);
  const connectedWhatsappCount = instances.filter((instance) => instance.status === 'CONNECTED').length;
  const whatsappConnectionCount = stats?.whatsappInstances ?? instances.length;

  async function load() {
    setIsLoading(true);
    setLoadError('');
    try {
      const [overview, whatsappInstances] = await Promise.all([
        api<Company | null>('/companies/current', session.accessToken).catch(() => session.activeCompany),
        api<WhatsappInstance[]>('/whatsapp/instances', session.accessToken).catch(() => []),
      ]);
      setCompany(overview);
      setInstances(whatsappInstances);
    } catch (err) {
      setLoadError(getErrorMessage(err, 'Não foi possível carregar os dados da empresa.'));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener('multi:refresh', refresh);
    return () => window.removeEventListener('multi:refresh', refresh);
  }, [session.accessToken, session.activeCompany?.id]);

  const onboardingItems = [
    {
      label: 'Plano definido',
      done: Boolean(company?.plan),
      detail: company?.plan ? `Plano ${company.plan.name}` : 'Defina um plano para liberar limites do piloto.',
    },
    {
      label: 'WhatsApp conectado',
      done: connectedWhatsappCount > 0,
      detail: connectedWhatsappCount > 0
        ? `${connectedWhatsappCount} conexão(ões) ativa(s).`
        : whatsappConnectionCount > 0
          ? 'Finalize o pareamento da conexão WhatsApp.'
          : 'Conecte uma instância do WhatsApp.',
    },
    {
      label: 'Equipe cadastrada',
      done: (stats?.members ?? session.memberships.length) > 1,
      detail: `${stats?.members ?? session.memberships.length} usuário(s) na empresa.`,
    },
    {
      label: 'Primeiros leads',
      done: (stats?.leads ?? 0) > 0,
      detail: (stats?.leads ?? 0) > 0 ? `${stats?.leads ?? 0} lead(s) cadastrados.` : 'Aguarde mensagens ou importe contatos.',
    },
    {
      label: 'Atendimentos iniciados',
      done: (stats?.conversations ?? 0) > 0,
      detail: (stats?.conversations ?? 0) > 0 ? `${stats?.conversations ?? 0} conversa(s) registradas.` : 'As conversas aparecerão em Atendimentos.',
    },
  ];

  return (
    <section className="grid">
      <div className="panel-header panel">
        <div>
          <div className="panel-title">Empresa</div>
          <div className="muted">{company?.slug} · {roleLabel(activeRole)}</div>
        </div>
        <Building2 />
      </div>
      <div className="cards">
        {isLoading ? (
          <LoadingSkeleton count={4} variant="cards" />
        ) : (
          <>
            <Metric label="Plano" value={company?.plan?.name ?? 'Sem plano'} />
            <Metric label="Usuários" value={`${stats?.members ?? session.memberships.length}/${company?.plan?.maxUsers ?? '-'}`} />
            <Metric label="WhatsApp" value={`${whatsappConnectionCount}/${company?.plan?.maxWhatsappInstances ?? '-'}`} />
            <Metric label="Leads" value={String(stats?.leads ?? 0)} />
          </>
        )}
      </div>
      {loadError && <ErrorState title="Não foi possível carregar a empresa" description={loadError} />}
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Checklist de onboarding</div>
            <div className="muted">Itens mínimos para a empresa operar o MVP piloto.</div>
          </div>
          <span className="badge green">{onboardingItems.filter((item) => item.done).length}/{onboardingItems.length}</span>
        </div>
        {isLoading ? <LoadingSkeleton count={5} variant="panel" /> : <OnboardingChecklist items={onboardingItems} />}
      </div>
    </section>
  );
}

function Metric({ label, value, technical = false }: { label: string; value: string; technical?: boolean }) {
  return (
    <article className="card stat-card">
      <div className="muted">{label}</div>
      <strong className={technical ? 'technical-value' : undefined}>{value}</strong>
    </article>
  );
}

function ConnectionDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="connection-detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ConfirmModal({
  confirmLabel,
  description,
  isBusy,
  onCancel,
  onConfirm,
  title,
}: {
  confirmLabel: string;
  description: string;
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div>
          <div className="panel-title" id="confirm-title">{title}</div>
          <div className="muted">{description}</div>
        </div>
        <div className="modal-actions">
          <button className="button secondary" onClick={onCancel} disabled={isBusy} type="button">
            Cancelar
          </button>
          <button className="button danger" onClick={onConfirm} disabled={isBusy} type="button">
            {isBusy && <Loader2 className="spin" size={18} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton({ count = 1, variant = 'list' }: { count?: number; variant?: 'cards' | 'list' | 'panel' | 'thread' }) {
  const items = Array.from({ length: count }, (_, index) => index);

  if (variant === 'thread') {
    return (
      <div className="skeleton-thread" aria-label="Carregando conversa">
        <div className="skeleton-header">
          <span />
          <span />
        </div>
        <div className="skeleton-messages">
          {items.map((item) => (
            <span className={item % 2 === 0 ? '' : 'out'} key={item} />
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'cards') {
    return (
      <>
        {items.map((item) => (
          <article className="card skeleton-card" key={item} aria-label="Carregando">
            <span />
            <strong />
            <em />
          </article>
        ))}
      </>
    );
  }

  if (variant === 'panel') {
    return (
      <div className="skeleton-panel" aria-label="Carregando">
        {items.map((item) => (
          <span key={item} />
        ))}
      </div>
    );
  }

  return (
    <>
      {items.map((item) => (
        <div className="skeleton-list-item" key={item} aria-label="Carregando">
          <span />
          <strong />
          <em />
        </div>
      ))}
    </>
  );
}

function ErrorState({ title, description }: { title: string; description?: string }) {
  return <StateBlock icon={<AlertCircle size={20} />} title={title} description={description} tone="danger" />;
}

function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return <StateBlock icon={icon} title={title} description={description} tone="empty" />;
}

function StateBlock({
  description,
  icon,
  title,
  tone = 'neutral',
}: {
  description?: string;
  icon: ReactNode;
  title: string;
  tone?: 'danger' | 'empty' | 'neutral';
}) {
  return (
    <div className={`state-block ${tone}`}>
      <div className="state-icon">{icon}</div>
      <div>
        <strong>{title}</strong>
        {description && <div className="muted">{description}</div>}
      </div>
    </div>
  );
}

function OnboardingChecklist({ items }: { items: OnboardingItem[] }) {
  const completed = items.filter((item) => item.done).length;
  const progress = Math.round((completed / items.length) * 100);

  return (
    <div className="checklist-wrap">
      <div className="progress-track" aria-label={`${completed} de ${items.length} itens concluídos`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="checklist">
        {items.map((item) => (
          <div className={`checklist-item ${item.done ? 'done' : ''}`} key={item.label}>
            {item.done ? <CheckCircle2 className="check-icon done" size={20} /> : <AlertCircle className="check-icon" size={20} />}
            <div>
              <strong>{item.label}</strong>
              <div className="muted">{item.detail}</div>
            </div>
            <BadgeStatus label={item.done ? 'Concluído' : 'Pendente'} tone={item.done ? 'green' : 'amber'} />
          </div>
        ))}
      </div>
    </div>
  );
}

function InlineAlert({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'danger' }) {
  return (
    <div className={`inline-alert ${tone === 'danger' ? 'danger' : ''}`}>
      <AlertCircle size={18} />
      <span>{children}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone: BadgeTone = status === 'OPEN' ? 'green' : status === 'CLOSED' ? 'neutral' : 'amber';
  return <BadgeStatus label={statusLabel(status)} tone={tone} />;
}

function BadgeStatus({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  return <span className={`badge ${tone}`}>{label}</span>;
}

function whatsappStatusMeta(status: string) {
  const meta: Record<string, { label: string; description: string; tone: BadgeTone }> = {
    CREATED: {
      label: 'Criada',
      description: 'Instância criada. Gere o QR Code para parear o telefone.',
      tone: 'amber',
    },
    QR_PENDING: {
      label: 'Aguardando QR',
      description: 'Escaneie o QR Code no WhatsApp para concluir a conexão.',
      tone: 'amber',
    },
    CONNECTED: {
      label: 'Conectada',
      description: 'WhatsApp conectado e pronto para receber mensagens.',
      tone: 'green',
    },
    DISCONNECTED: {
      label: 'Desconectada',
      description: 'A conexão caiu. Gere um novo QR Code para reconectar.',
      tone: 'neutral',
    },
    ERROR: {
      label: 'Erro',
      description: 'A última tentativa falhou. Confira a mensagem e tente novamente.',
      tone: 'danger',
    },
  };

  return meta[status] ?? {
    label: status,
    description: 'Status recebido da Evolution Go.',
    tone: 'amber',
  };
}

function whatsappStatusIcon(status: string) {
  if (status === 'CONNECTED') return <CheckCircle2 size={22} />;
  if (status === 'QR_PENDING') return <QrCode size={22} />;
  if (status === 'ERROR') return <AlertCircle size={22} />;
  return <MessageCircle size={22} />;
}

function planLimitMessage(maxInstances: number) {
  const allowed = Math.max(maxInstances, 1);
  const suffix = allowed === 1 ? 'conexão WhatsApp' : 'conexões WhatsApp';
  return `Seu plano permite ${allowed} ${suffix}. Desconecte a conexão atual ou altere seu plano para adicionar outro número.`;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return 'Ainda não sincronizado';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Ainda não sincronizado';
  }

  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Hoje às ${time}` : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatPhone(value?: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return digits ? `+${digits}` : null;
}

function messagePreview(message?: Message) {
  if (!message) {
    return 'Sem mensagens ainda';
  }

  const type = normalizeMessageType(message.type, message.mediaMimeType);
  const text = message.caption?.trim() || message.body?.trim();
  if (type === 'text') {
    return text || 'Mensagem sem texto';
  }

  return text ? `${messageKindLabel(type)}: ${text}` : messageKindLabel(type);
}

function normalizeMessageType(type?: string | null, mimeType?: string | null): MessageKind {
  const normalized = type?.trim().toLowerCase();
  if (
    normalized === 'text' ||
    normalized === 'image' ||
    normalized === 'audio' ||
    normalized === 'video' ||
    normalized === 'document' ||
    normalized === 'sticker' ||
    normalized === 'location' ||
    normalized === 'contact' ||
    normalized === 'unknown'
  ) {
    return normalized;
  }

  return inferMessageKindFromMime(mimeType) ?? 'unknown';
}

function messageKindLabel(type: MessageKind) {
  const labels: Record<MessageKind, string> = {
    audio: 'Áudio',
    contact: 'Contato',
    document: 'Documento',
    image: 'Imagem',
    location: 'Localização',
    sticker: 'Figurinha',
    text: 'Texto',
    unknown: 'Mídia',
    video: 'Vídeo',
  };
  return labels[type];
}

function messageStatusLabel(status?: string | null) {
  const normalized = status?.trim().toLowerCase();
  const labels: Record<string, string> = {
    delivered: 'Entregue',
    error: 'Erro',
    failed: 'Erro',
    pending: 'Pendente',
    read: 'Lida',
    received: 'Recebida',
    sending: 'Enviando',
    sent: 'Enviada',
  };

  return normalized ? labels[normalized] ?? status ?? '' : 'Enviada';
}

function formatFileSize(bytes?: number | null) {
  if (!bytes || bytes <= 0) {
    return '';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function mediaUrl(value: string) {
  if (/^(https?:|data:|blob:)/i.test(value) || value.startsWith('/api/')) {
    return value;
  }
  return `${API_URL}${value.startsWith('/') ? value : `/${value}`}`;
}

function buildComposerAttachment(file: File): ComposerAttachment | string {
  const type = inferMessageKindFromFile(file);
  if (type === 'unknown') {
    return 'Formato não suportado. Envie imagem, áudio, vídeo ou documento.';
  }

  const maxSize = MEDIA_SIZE_LIMITS[type];
  if (file.size > maxSize) {
    return `${messageKindLabel(type)} excede o limite de ${formatFileSize(maxSize)}.`;
  }

  const previewUrl = type === 'document' ? undefined : URL.createObjectURL(file);
  return {
    file,
    fileName: file.name || messageKindLabel(type),
    mediaMimeType: file.type || 'application/octet-stream',
    previewUrl,
    size: file.size,
    type,
  };
}

function inferMessageKindFromFile(file: File): ComposerAttachment['type'] | 'unknown' {
  const mimeType = file.type.toLowerCase();
  const extension = fileExtension(file.name);
  const typeByMime = inferMessageKindFromMime(mimeType);

  if (typeByMime === 'image' || typeByMime === 'audio' || typeByMime === 'video' || typeByMime === 'document') {
    return typeByMime;
  }
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return 'document';
  }

  return 'unknown';
}

function inferMessageKindFromMime(mimeType?: string | null): MessageKind | null {
  const normalized = mimeType?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith('image/')) {
    return 'image';
  }
  if (normalized.startsWith('audio/')) {
    return 'audio';
  }
  if (normalized.startsWith('video/')) {
    return 'video';
  }
  if (DOCUMENT_MIME_TYPES.has(normalized)) {
    return 'document';
  }
  return null;
}

function fileExtension(fileName: string) {
  const parts = fileName.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] ?? '' : '';
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo selecionado.'));
    reader.readAsDataURL(file);
  });
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={active ? 'active' : ''} onClick={onClick} title={label}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function getActiveCompanyRole(session: Session) {
  const activeCompanyId = session.activeCompany?.id;
  return session.memberships.find((membership) => membership.companyId === activeCompanyId)?.role ?? 'AGENT';
}

function roleLabel(role: string) {
  if (role === 'COMPANY_ADMIN') return 'Administrador da empresa';
  if (role === 'AGENT') return 'Atendente';
  if (role === 'PLATFORM_ADMIN') return 'Administrador da plataforma';
  return role;
}

function statusFilterLabel(status: ConversationStatusFilter) {
  const labels: Record<ConversationStatusFilter, string> = {
    ALL: 'Todas',
    QUEUED: 'Na fila',
    OPEN: 'Abertas',
    CLOSED: 'Encerradas',
  };
  return labels[status];
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    QUEUED: 'Na fila',
    OPEN: 'Aberta',
    CLOSED: 'Encerrada',
  };
  return labels[status] ?? status;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return 'Sua sessão pode ter expirado. Faça login novamente.';
    }
    if (error.status === 403) {
      return 'Seu perfil não tem acesso a esta área. Fale com um administrador da empresa.';
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return friendlyOperationalMessage(error.message, fallback);
  }
  return fallback;
}

function friendlyOperationalMessage(message: string, fallback = 'Não foi possível concluir esta ação. Tente novamente em alguns segundos.') {
  const normalized = message.trim();
  const lower = normalized.toLowerCase();

  if (!normalized) {
    return fallback;
  }
  if (lower.includes('webhook_public_url') || lower.includes('url local/interna')) {
    return 'A URL pública da API ainda não está pronta para a Evolution Go. Ajuste a URL pública do webhook nas configurações da plataforma antes de conectar.';
  }
  if (lower === 'unauthorized' || lower.includes('not authorized') || (lower.includes('evolution') && lower.includes('401'))) {
    return 'A Evolution Go recusou a conexão. Confira a API Key global e tente novamente.';
  }
  if (lower.includes('jwt') || lower.includes('token') || lower.includes('erro 401')) {
    return 'Sua sessão pode ter expirado. Faça login novamente.';
  }
  if (lower.includes('forbidden') || lower.includes('erro 403')) {
    return 'Seu perfil não tem acesso a esta área. Fale com um administrador da empresa.';
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return 'Não foi possível carregar os dados. Verifique sua conexão ou tente novamente.';
  }
  if (lower.includes('cannot post') || lower.includes('cannot get')) {
    return fallback;
  }

  return normalized;
}

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiWithInboxFallback<T>(
  primaryPath: string,
  inboxPath: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  try {
    return await api<T>(primaryPath, token, init);
  } catch (error) {
    if (error instanceof ApiError && [404, 405].includes(error.status)) {
      return api<T>(inboxPath, token, init);
    }
    throw error;
  }
}

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await readApiError(response);
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: SESSION_EXPIRED_MESSAGE }));
    }
    throw new ApiError(message, response.status);
  }

  const text = await response.text();
  return (text.trim() ? JSON.parse(text) : undefined) as T;
}

async function requestInstanceQrCode(id: string, token: string) {
  try {
    return await api<WhatsappInstance>(`/whatsapp/instances/${id}/qrcode`, token, { method: 'POST' });
  } catch (error) {
    const message = getErrorMessage(error, '');
    if (!message.includes('Cannot POST') && !message.includes('/qrcode') && !message.includes('404')) {
      throw error;
    }

    return api<WhatsappInstance>(`/whatsapp/instances/${id}/connect`, token, { method: 'POST' });
  }
}

async function readApiError(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    return `Erro ${response.status}`;
  }

  try {
    const data = JSON.parse(text) as { message?: string | string[]; error?: string };
    if (Array.isArray(data.message)) {
      return data.message.join(' ');
    }
    return data.message ?? data.error ?? text;
  } catch {
    return text;
  }
}
