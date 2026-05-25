'use client';

import type { FormEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  CreditCard,
  Inbox,
  Loader2,
  LogOut,
  MessageCircle,
  Plus,
  QrCode,
  RotateCcw,
  Send,
  Settings,
  Wifi,
  Users,
} from 'lucide-react';
import { io } from 'socket.io-client';

const API_URL = '/api/backend';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4100';
const EVOLUTION_MANAGER_URL = process.env.NEXT_PUBLIC_EVOLUTION_MANAGER_URL ?? 'https://evo.devizando.com/manager';

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
  direction: 'INBOUND' | 'OUTBOUND' | 'SYSTEM';
  body?: string;
  createdAt: string;
  sender?: { id: string; name: string } | null;
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
  lastError?: string | null;
};

type Tab = 'inbox' | 'leads' | 'whatsapp' | 'settings';
type PlatformTab = 'companies' | 'plans';
type ConversationStatusFilter = 'ALL' | 'QUEUED' | 'OPEN' | 'CLOSED';

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>('inbox');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem('multi.session');
    if (raw) {
      setSession(JSON.parse(raw));
    }
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
    localStorage.setItem('multi.session', JSON.stringify(data));
    setSession(data);
    setIsLoggingIn(false);
  }

  function logout() {
    localStorage.removeItem('multi.session');
    setSession(null);
  }

  if (!session) {
    return <LoginScreen error={error} isLoading={isLoggingIn} onLogin={login} />;
  }

  if (session.user.platformRole === 'PLATFORM_ADMIN' && !session.activeCompany) {
    return <PlatformShell session={session} onLogout={logout} />;
  }

  const activeRole = getActiveCompanyRole(session);
  const canManageWhatsapp = activeRole === 'COMPANY_ADMIN';
  const currentTab = !canManageWhatsapp && tab === 'whatsapp' ? 'inbox' : tab;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <MessageCircle size={20} />
          </div>
          <span>Multi Atendimento</span>
        </div>
        <nav className="nav">
          <NavButton active={currentTab === 'inbox'} icon={<Inbox size={18} />} label="Inbox" onClick={() => setTab('inbox')} />
          <NavButton active={currentTab === 'leads'} icon={<Users size={18} />} label="Leads" onClick={() => setTab('leads')} />
          {canManageWhatsapp && (
            <NavButton active={currentTab === 'whatsapp'} icon={<MessageCircle size={18} />} label="WhatsApp" onClick={() => setTab('whatsapp')} />
          )}
          <NavButton active={currentTab === 'settings'} icon={<Settings size={18} />} label="Empresa" onClick={() => setTab('settings')} />
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <strong>{session.activeCompany?.name ?? 'Plataforma'}</strong>
            <div className="muted">{session.user.name} · {session.user.email} · {roleLabel(activeRole)}</div>
          </div>
          <button className="button secondary" onClick={logout} title="Sair">
            <LogOut size={18} />
            Sair
          </button>
        </header>
        <section className="workspace">
          {currentTab === 'inbox' && <InboxView session={session} />}
          {currentTab === 'leads' && <LeadsView token={session.accessToken} />}
          {currentTab === 'whatsapp' && <WhatsappView token={session.accessToken} canManage={canManageWhatsapp} initialCompany={session.activeCompany} />}
          {currentTab === 'settings' && <SettingsView session={session} />}
        </section>
      </main>
    </div>
  );
}

function PlatformShell({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [tab, setTab] = useState<PlatformTab>('companies');

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Building2 size={20} />
          </div>
          <span>Admin Plataforma</span>
        </div>
        <nav className="nav">
          <NavButton active={tab === 'companies'} icon={<Building2 size={18} />} label="Empresas" onClick={() => setTab('companies')} />
          <NavButton active={tab === 'plans'} icon={<CreditCard size={18} />} label="Planos" onClick={() => setTab('plans')} />
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <strong>Plataforma</strong>
            <div className="muted">{session.user.name} · {session.user.email} · PLATFORM_ADMIN</div>
          </div>
          <button className="button secondary" onClick={onLogout} title="Sair">
            <LogOut size={18} />
            Sair
          </button>
        </header>
        <section className="workspace">
          {tab === 'companies' && <PlatformCompaniesView token={session.accessToken} />}
          {tab === 'plans' && <PlatformPlansView token={session.accessToken} />}
        </section>
      </main>
    </div>
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
          {isLoading && <StateBlock icon={<Loader2 className="spin" size={20} />} title="Carregando empresas..." />}
          {loadError && <StateBlock icon={<AlertCircle size={20} />} title="Falha ao carregar empresas" description={loadError} />}
          {!isLoading && !loadError && companies.length === 0 && (
            <StateBlock
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
              <div className="muted">
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
        {isLoading && <StateBlock icon={<Loader2 className="spin" size={20} />} title="Carregando planos..." />}
        {loadError && <StateBlock icon={<AlertCircle size={20} />} title="Falha ao carregar planos" description={loadError} />}
        {!isLoading && !loadError && plans.length === 0 && (
          <StateBlock icon={<CreditCard size={20} />} title="Nenhum plano ativo" description="Cadastre planos para liberar empresas no piloto." />
        )}
        {plans.map((plan) => (
          <article className="card" key={plan.id}>
            <div className="row">
              <strong>{plan.name}</strong>
              <span className={`badge ${plan.isActive ? 'green' : 'amber'}`}>{plan.isActive ? 'Ativo' : 'Inativo'}</span>
            </div>
            <div className="muted">{plan.slug}</div>
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

function InboxView({ session }: { session: Session }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [body, setBody] = useState('');
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

  async function load() {
    setIsLoading(true);
    setListError('');
    const query = statusFilter === 'ALL' ? '' : `?status=${statusFilter}`;

    try {
      const rows = await api<Conversation[]>(`/inbox/conversations${query}`, token);
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
      setSelected(await api<Conversation>(`/inbox/conversations/${id}`, token));
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
      loadSelected(selectedId);
    }
  }, [selectedId]);

  async function assign() {
    await runConversationAction('assign', 'Não foi possível assumir a conversa.', async (conversation) => {
      await api(`/inbox/conversations/${conversation.id}/assign-me`, token, { method: 'POST' });
    });
  }

  async function close() {
    await runConversationAction('close', 'Não foi possível encerrar a conversa.', async (conversation) => {
      await api(`/inbox/conversations/${conversation.id}/close`, token, { method: 'POST' });
    });
  }

  async function reopen() {
    await runConversationAction('reopen', 'Não foi possível reabrir a conversa.', async (conversation) => {
      await api(`/inbox/conversations/${conversation.id}/reopen`, token, { method: 'POST' });
    });
  }

  async function send() {
    if (!selected || !body.trim()) return;
    await runConversationAction('send', 'Não foi possível enviar a mensagem.', async (conversation) => {
      await api(`/inbox/conversations/${conversation.id}/messages`, token, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      setBody('');
    });
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
      setActionError(getErrorMessage(err, fallbackMessage));
    } finally {
      setActionPending('');
    }
  }

  return (
    <div className="grid inbox">
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Fila de atendimento</div>
            <div className="muted">Filtre por etapa e assuma os atendimentos do piloto.</div>
          </div>
          <span className="badge amber">{conversations.length}</span>
        </div>
        <div className="filter-bar" aria-label="Filtrar conversas por status">
          {(['QUEUED', 'OPEN', 'CLOSED', 'ALL'] as ConversationStatusFilter[]).map((status) => (
            <button
              key={status}
              className={statusFilter === status ? 'active' : ''}
              onClick={() => setStatusFilter(status)}
              type="button"
            >
              {statusFilterLabel(status)}
            </button>
          ))}
        </div>
        <div className="conversation-list">
          {isLoading && <StateBlock icon={<Loader2 className="spin" size={20} />} title="Carregando conversas..." />}
          {listError && <StateBlock icon={<AlertCircle size={20} />} title="Falha ao carregar a fila" description={listError} />}
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              className={`conversation-item ${selectedId === conversation.id ? 'active' : ''}`}
              onClick={() => setSelectedId(conversation.id)}
            >
              <div className="row">
                <strong>{conversation.lead.name ?? conversation.lead.phone ?? conversation.lead.remoteJid}</strong>
                <StatusBadge status={conversation.status} />
              </div>
              <div className="muted">{conversation.messages[0]?.body ?? 'Sem mensagens ainda'}</div>
              <div className="muted">{conversation.assignedTo ? `Com ${conversation.assignedTo.name}` : 'Aguardando atendente'}</div>
            </button>
          ))}
          {!isLoading && !listError && conversations.length === 0 && (
            <StateBlock
              icon={<Inbox size={20} />}
              title={`Nenhuma conversa em ${statusFilterLabel(statusFilter).toLowerCase()}`}
              description="Quando uma mensagem chegar, ela aparecerá aqui para o time assumir e responder."
            />
          )}
        </div>
      </section>
      <section className="panel thread">
        {isThreadLoading ? (
          <StateBlock icon={<Loader2 className="spin" size={20} />} title="Carregando conversa..." />
        ) : threadError ? (
          <StateBlock icon={<AlertCircle size={20} />} title="Falha ao abrir conversa" description={threadError} />
        ) : selected ? (
          <>
            <div className="panel-header">
              <div>
                <div className="panel-title">{selected.lead.name ?? selected.lead.phone ?? selected.lead.remoteJid}</div>
                <div className="muted">{selected.whatsappInstance.name} · {selected.assignedTo?.name ?? 'sem responsável'}</div>
              </div>
              <div className="row">
                <StatusBadge status={selected.status} />
                {selected.status === 'CLOSED' ? (
                  <button className="button secondary" onClick={reopen} disabled={actionPending === 'reopen'}>
                    {actionPending === 'reopen' ? <Loader2 className="spin" size={18} /> : <RotateCcw size={18} />}
                    Reabrir
                  </button>
                ) : (
                  <>
                    <button className="button secondary" onClick={assign} disabled={actionPending === 'assign'}>
                      {actionPending === 'assign' && <Loader2 className="spin" size={18} />}
                      Assumir
                    </button>
                    <button className="button danger" onClick={close} disabled={actionPending === 'close'}>
                      {actionPending === 'close' && <Loader2 className="spin" size={18} />}
                      Encerrar
                    </button>
                  </>
                )}
              </div>
            </div>
            {actionError && <InlineAlert tone="danger">{actionError}</InlineAlert>}
            <div className="messages">
              {selected.messages.map((message) => (
                <div key={message.id} className={`bubble ${message.direction === 'OUTBOUND' ? 'out' : ''}`}>
                  {message.body ?? 'Mídia recebida'}
                  <div className="muted">{new Date(message.createdAt).toLocaleString('pt-BR')}</div>
                </div>
              ))}
              {selected.messages.length === 0 && (
                <StateBlock icon={<MessageCircle size={20} />} title="Sem mensagens ainda" description="A conversa foi criada, mas ainda não há histórico." />
              )}
            </div>
            <div className="composer">
              <input
                className="input"
                disabled={selected.status === 'CLOSED' || actionPending === 'send'}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={selected.status === 'CLOSED' ? 'Reabra a conversa para responder' : 'Digite uma resposta'}
              />
              <button className="button" onClick={send} title="Enviar" disabled={!body.trim() || selected.status === 'CLOSED' || actionPending === 'send'}>
                {actionPending === 'send' ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
                {actionPending === 'send' ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </>
        ) : (
          <StateBlock
            icon={<Inbox size={20} />}
            title="Selecione uma conversa"
            description="Escolha um atendimento na lista para ver o histórico e responder pelo WhatsApp."
          />
        )}
      </section>
    </div>
  );
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
        {isLoading && <StateBlock icon={<Loader2 className="spin" size={20} />} title="Carregando leads..." />}
        {loadError && <StateBlock icon={<AlertCircle size={20} />} title="Falha ao carregar leads" description={loadError} />}
        {!isLoading && !loadError && leads.length === 0 && (
          <StateBlock
            icon={<Users size={20} />}
            title="Nenhum lead cadastrado"
            description="Os contatos serão listados aqui assim que chegarem pelo WhatsApp ou forem importados."
          />
        )}
        {leads.map((lead) => (
          <article className="card" key={lead.id}>
            <strong>{lead.name ?? lead.phone ?? lead.remoteJid}</strong>
            <div className="muted">{lead.phone ?? lead.remoteJid}</div>
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
  const [name, setName] = useState('WhatsApp principal');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [actionPending, setActionPending] = useState('');
  const usedInstances = company?._count?.whatsappInstances ?? instances.length;
  const maxInstances = company?.plan?.maxWhatsappInstances ?? 1;
  const remainingInstances = Math.max(maxInstances - usedInstances, 0);
  const isLimitReached = remainingInstances === 0;

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

  async function create() {
    if (!canManage || !name.trim()) return;
    if (isLimitReached) {
      setActionError('O limite de números WhatsApp do plano foi atingido.');
      return;
    }
    setActionPending('create');
    setActionError('');
    setActionNotice('');
    try {
      await api('/whatsapp/instances', token, {
        method: 'POST',
        body: JSON.stringify({ name, phoneNumber: phoneNumber.trim() || undefined }),
      });
      setPhoneNumber('');
      await load();
    } catch (err) {
      setActionError(getErrorMessage(err, 'Não foi possível criar a conexão.'));
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
      const updated = await api<WhatsappInstance>(`/whatsapp/instances/${instance.id}/qrcode`, token, { method: 'POST' });
      setInstances((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setActionNotice(updated.qrCode ? 'QR Code gerado. Escaneie pelo WhatsApp em Dispositivos conectados.' : 'Pedido enviado. Atualize em alguns segundos se o QR Code ainda não aparecer.');
      await load();
    } catch (err) {
      setActionError(getErrorMessage(err, 'Não foi possível gerar o QR Code.'));
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
    <section className="grid">
      <div className="panel-header panel whatsapp-header">
        <div>
          <div className="panel-title">Conexões WhatsApp</div>
          <div className="muted">Crie a instância, gere o QR Code e acompanhe o status da conexão.</div>
        </div>
        {canManage && (
          <div className="row toolbar-row">
            <a className="button secondary" href={EVOLUTION_MANAGER_URL} target="_blank" rel="noreferrer">
              Manager
            </a>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} aria-label="Nome da conexão" />
            <input
              className="input"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              aria-label="Telefone com DDI"
              placeholder="Telefone com DDI, opcional"
            />
            <button className="button" onClick={create} disabled={!name.trim() || isLimitReached || actionPending === 'create'}>
              {actionPending === 'create' ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
              Criar
            </button>
          </div>
        )}
      </div>
      <div className="cards whatsapp-summary">
        <Metric label="Plano" value={company?.plan?.name ?? 'Sem plano'} />
        <Metric label="Números usados" value={`${usedInstances}/${maxInstances}`} />
        <Metric label="Disponíveis" value={String(remainingInstances)} />
      </div>
      {isLimitReached && (
        <InlineAlert>
          Limite do plano atingido. Use a conexão existente ou ajuste o plano antes de criar outro número.
        </InlineAlert>
      )}
      {actionError && <InlineAlert tone="danger">{actionError}</InlineAlert>}
      {actionNotice && <InlineAlert>{actionNotice}</InlineAlert>}
      <div className="cards whatsapp-cards">
        {isLoading && <StateBlock icon={<Loader2 className="spin" size={20} />} title="Carregando conexões..." />}
        {loadError && <StateBlock icon={<AlertCircle size={20} />} title="Falha ao carregar conexões" description={loadError} />}
        {!isLoading && !loadError && instances.length === 0 && (
          <StateBlock
            icon={<MessageCircle size={20} />}
            title="Nenhum WhatsApp conectado"
            description={canManage ? 'Crie uma conexão para gerar o QR Code e iniciar o atendimento.' : 'Peça para um administrador conectar o WhatsApp da empresa.'}
          />
        )}
        {instances.map((instance) => {
          const statusMeta = whatsappStatusMeta(instance.status);
          const isBusy = actionPending === `refresh:${instance.id}` || actionPending === `qr:${instance.id}`;

          return (
            <article className="card whatsapp-card" key={instance.id}>
              <div className="row">
                <strong>{instance.name}</strong>
                <span className={`badge ${statusMeta.tone}`}>{statusMeta.label}</span>
              </div>
              <div className="muted">{instance.instanceKey}</div>
              {instance.phoneNumber && <div className="muted">Telefone: {instance.phoneNumber}</div>}
              <div className="instance-status-line">
                <Wifi size={18} />
                <span>{statusMeta.description}</span>
              </div>
              {instance.lastError && <InlineAlert tone="danger">{instance.lastError}</InlineAlert>}
              {instance.qrCode && instance.status !== 'CONNECTED' && <QrCodePreview value={instance.qrCode} />}
              {canManage && (
                <div className="instance-actions">
                  <button className="button secondary" onClick={() => refresh(instance.id)} disabled={isBusy}>
                    {actionPending === `refresh:${instance.id}` ? <Loader2 className="spin" size={18} /> : <RotateCcw size={18} />}
                    Atualizar
                  </button>
                  <button className="button" onClick={() => requestQrCode(instance)} disabled={isBusy}>
                    {actionPending === `qr:${instance.id}` ? <Loader2 className="spin" size={18} /> : <QrCode size={18} />}
                    {qrActionLabel(instance.status)}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
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
  const company = session.activeCompany;
  const stats = company?._count;
  const activeRole = getActiveCompanyRole(session);
  const onboardingItems = [
    {
      label: 'Plano definido',
      done: Boolean(company?.plan),
      detail: company?.plan ? `Plano ${company.plan.name}` : 'Defina um plano para liberar limites do piloto.',
    },
    {
      label: 'WhatsApp conectado',
      done: (stats?.whatsappInstances ?? 0) > 0,
      detail: (stats?.whatsappInstances ?? 0) > 0 ? 'Instância cadastrada.' : 'Conecte uma instância do WhatsApp.',
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
      detail: (stats?.conversations ?? 0) > 0 ? `${stats?.conversations ?? 0} conversa(s) registradas.` : 'As conversas aparecerão no Inbox.',
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
        <Metric label="Plano" value={company?.plan?.name ?? 'Sem plano'} />
        <Metric label="Usuários" value={`${stats?.members ?? session.memberships.length}/${company?.plan?.maxUsers ?? '-'}`} />
        <Metric label="WhatsApp" value={`${stats?.whatsappInstances ?? 0}/${company?.plan?.maxWhatsappInstances ?? '-'}`} />
        <Metric label="Leads" value={String(stats?.leads ?? 0)} />
      </div>
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Checklist de onboarding</div>
            <div className="muted">Itens mínimos para a empresa operar o MVP piloto.</div>
          </div>
          <span className="badge green">{onboardingItems.filter((item) => item.done).length}/{onboardingItems.length}</span>
        </div>
        <div className="checklist">
          {onboardingItems.map((item) => (
            <div className="checklist-item" key={item.label}>
              {item.done ? <CheckCircle2 className="check-icon done" size={20} /> : <AlertCircle className="check-icon" size={20} />}
              <div>
                <strong>{item.label}</strong>
                <div className="muted">{item.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="card">
      <div className="muted">{label}</div>
      <strong style={{ display: 'block', marginTop: 8, fontSize: 24 }}>{value}</strong>
    </article>
  );
}

function StateBlock({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <div className="state-block">
      <div className="state-icon">{icon}</div>
      <div>
        <strong>{title}</strong>
        {description && <div className="muted">{description}</div>}
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
  const badgeClass = status === 'OPEN' ? 'green' : status === 'CLOSED' ? '' : 'amber';
  return <span className={`badge ${badgeClass}`}>{statusLabel(status)}</span>;
}

function whatsappStatusMeta(status: string) {
  const meta: Record<string, { label: string; description: string; tone: string }> = {
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
      tone: '',
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

function qrActionLabel(status: string) {
  if (status === 'CONNECTED') return 'Gerar novo QR';
  if (status === 'QR_PENDING') return 'Atualizar QR';
  if (status === 'ERROR') return 'Gerar QR novamente';
  return 'Gerar QR';
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
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.json();
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
