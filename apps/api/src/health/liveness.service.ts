import { Injectable } from '@nestjs/common';

@Injectable()
export class LivenessService {
  status(): 'ok' {
    return 'ok';
  }
}
