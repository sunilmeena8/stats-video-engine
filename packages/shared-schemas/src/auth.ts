import {
  USER_ROLES,
  type CreateTopicRequest,
  type LoginRequest,
  type LoginResponse,
  type Topic,
  type User,
} from '@statsopedia/shared-types';
import { z } from 'zod';

import { isoDateTimeSchema, slugSchema, timestampsShape, uuidSchema } from './primitives.js';

export const emailSchema = z
  .email()
  .max(254)
  .transform((email) => email.toLowerCase());

/** Length rules only (NIST 800-63B): no composition rules, long passphrases welcome. */
export const passwordSchema = z.string().min(12).max(256);

export const userSchema = z.object({
  id: uuidSchema,
  email: z.email(),
  name: z.string().min(1).max(200),
  role: z.enum(USER_ROLES),
  isActive: z.boolean(),
  lastLoginAt: isoDateTimeSchema.nullable(),
  ...timestampsShape,
}) satisfies z.ZodType<User>;

export const loginRequestSchema = z
  .object({
    email: emailSchema,
    // Not passwordSchema: logins must not reveal the password policy or reject old passwords.
    password: z.string().min(1).max(256),
  })
  .strict() satisfies z.ZodType<LoginRequest, unknown>;

export const loginResponseSchema = z.object({
  token: z.string().min(32),
  expiresAt: isoDateTimeSchema,
  user: userSchema,
}) satisfies z.ZodType<LoginResponse>;

export const topicSchema = z.object({
  id: uuidSchema,
  slug: slugSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2_000).nullable(),
  ...timestampsShape,
}) satisfies z.ZodType<Topic>;

export const createTopicRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: slugSchema.optional(),
    description: z.string().trim().max(2_000).nullish(),
  })
  .strict() satisfies z.ZodType<CreateTopicRequest>;
