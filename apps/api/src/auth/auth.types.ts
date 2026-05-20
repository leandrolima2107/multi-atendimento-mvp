export type PlatformRole = 'USER' | 'PLATFORM_ADMIN';
export type CompanyRole = 'COMPANY_ADMIN' | 'AGENT';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  platformRole: PlatformRole;
  companyId: string | null;
  companyRole: CompanyRole | null;
};

export type JwtPayload = {
  sub: string;
  companyId?: string;
};
