import { Injectable } from '@nestjs/common';
import { ApiError } from '../http/errors';

@Injectable()
export class AuditExportAdmission {
  private active = 0;
  acquire(): () => void {
    if (this.active >= 2)
      throw new ApiError(
        'RATE_LIMITED',
        'Hay dos operaciones CSV en curso. Reintenta más tarde.',
        429,
        true,
      );
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }
}
