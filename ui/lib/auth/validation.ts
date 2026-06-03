import type { UserRole } from "@/lib/auth/store";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuthInput {
  name?: string;
  email: string;
  password: string;
  role?: string;
}

export function normalizeRole(inputRole: unknown): UserRole {
  if (inputRole === "admin") {
    return "admin";
  }

  if (inputRole === "pasien" || inputRole === "user") {
    return "pasien";
  }

  return "apoteker";
}

export function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

export function validatePassword(password: string): boolean {
  return password.length >= 8;
}

export function normalizeAuthInput(input: AuthInput): AuthInput {
  return {
    ...input,
    name: input.name?.trim(),
    email: input.email.trim().toLowerCase(),
    password: input.password,
    role: input.role,
  };
}
