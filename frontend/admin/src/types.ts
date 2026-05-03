export interface Application {
  id: number;
  client_id: string;
  name: string;
  description: string | null;
  redirect_uris: string[];
  default_role_id: number | null;
  enable_public_users: boolean;
  enable_sso: boolean;
  status: string;
}

export interface ApplicationCreated extends Application {
  client_secret: string;
}

export interface LoginMethod {
  id: number;
  application_id: number;
  method: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
}

export interface Role {
  id: number;
  application_id: number;
  code: string;
  name: string;
  description: string | null;
  is_default: boolean;
}

export interface Permission {
  id: number;
  application_id: number;
  code: string;
  name: string;
  description: string | null;
}

export interface User {
  id: number;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  status: string;
}

export interface ApplicationUser {
  id: number;
  application_id: number;
  user_id: number;
  user_email: string;
  user_display_name: string | null;
  user_status: string;
  status: string;
  roles: string[];
  permissions: string[];
}

export interface TokenExchangeResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expires_in: number;
  user: {
    id: number;
    email: string;
    display_name: string | null;
    status: string;
  };
  roles: string[];
  permissions: string[];
}

export type ViewKey =
  | "dashboard"
  | "applications"
  | "users"
  | "app-detail"
  | "login-methods"
  | "roles"
  | "permissions"
  | "app-users";
