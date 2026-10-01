import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { ApiRequest } from '../http/errors';
import { JwtVerifier } from './jwt-verifier';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly verifier: JwtVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const identity = await this.verifier.verify(request.headers.authorization);
    request.actorId = identity.actorId;
    request.sessionId = identity.sessionId;
    return true;
  }
}
