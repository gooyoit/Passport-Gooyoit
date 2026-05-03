import { z } from "zod";

export const userInfoSchema = z.object({
  id: z.number(),
  email: z.string(),
  display_name: z.string().nullable(),
  status: z.string(),
});

export const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  user: userInfoSchema,
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});
