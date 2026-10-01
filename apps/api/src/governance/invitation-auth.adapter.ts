import { Inject, Injectable } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_CONFIG } from '../config';
import type { AppConfig } from '../config';

export class InvitationDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly uncertain: boolean,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

@Injectable()
export class InvitationAuthAdapter {
  private readonly admin: SupabaseClient | null;
  private readonly publicAuth: SupabaseClient | null;
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const options = {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: ((url: Parameters<typeof fetch>[0], init?: RequestInit) =>
          fetch(url, {
            ...init,
            signal: AbortSignal.timeout(15_000),
          })) as typeof fetch,
      },
    };
    this.admin = config.invitationWorkerEnabled
      ? createClient(config.supabaseUrl!, config.supabaseSecretKey!, options)
      : null;
    this.publicAuth = config.invitationWorkerEnabled
      ? createClient(
          config.supabaseUrl!,
          config.supabasePublishableKey!,
          options,
        )
      : null;
  }
  async deliver(
    email: string,
    id: string,
    token: string,
    generation: number,
  ): Promise<string | null> {
    if (!this.admin || !this.publicAuth)
      throw new InvitationDeliveryError('DELIVERY_DISABLED', false, false);
    const redirect = new URL(this.config.invitationCallbackUrl);
    redirect.hash = new URLSearchParams({
      invitationId: id,
      invitationToken: token,
      generation: String(generation),
    }).toString();
    try {
      const result = await this.admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: redirect.toString(),
      });
      if (!result.error) return result.data.user?.id ?? null;
      // Only Auth's explicit account-conflict result takes this path. Other
      // provider failures never turn into a second email request.
      if (
        result.error.code === 'email_exists' ||
        result.error.code === 'user_already_exists'
      ) {
        const otp = await this.publicAuth.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: false,
            emailRedirectTo: redirect.toString(),
          },
        });
        if (otp.error) throw this.providerError(otp.error);
        return null;
      }
      throw this.providerError(result.error);
    } catch (error) {
      if (error instanceof InvitationDeliveryError) throw error;
      // A transport timeout cannot establish whether the provider sent mail.
      throw new InvitationDeliveryError('AUTH_DELIVERY_UNCERTAIN', true, true);
    }
  }
  private providerError(error: { status?: number; code?: string }) {
    const retryable =
      !error.status || error.status >= 500 || error.status === 429;
    return new InvitationDeliveryError(
      error.status === 429
        ? 'AUTH_RATE_LIMITED'
        : retryable
          ? 'AUTH_UNAVAILABLE'
          : 'AUTH_DELIVERY_REJECTED',
      !error.status || error.status >= 500,
      retryable,
    );
  }
}
