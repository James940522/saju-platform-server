import type { Request } from 'express';

export type AuthPrincipal = {
  subject: string;
  displayName: string | null;
};

export type AuthenticatedRequest = Request & {
  authPrincipal: AuthPrincipal;
};
