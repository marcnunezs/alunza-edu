import 'reflect-metadata';
import { Readable } from 'node:stream';
import { of } from 'rxjs';
import type { ExecutionContext, NestInterceptor, Type } from '@nestjs/common';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { MaterialsController } from './materials.controller';

test.each(['upload', 'replace'] as const)(
  '%s accepts a file plus title and activity, preserving UTF-8 through its real interceptor',
  async (method) => {
    const name = 'función y parámetros.txt';
    const text = 'La función retorna un valor.';
    const data = new FormData();
    data.set('file', new Blob([text]), name);
    data.set('title', 'Funciones');
    data.set('activityId', 'a1becbf1-e9ed-442f-9127-176c276962fb');
    const wire = new Request('http://example.invalid/', {
      method: 'POST',
      body: data,
    });
    const bytes = Buffer.from(await wire.arrayBuffer());
    const request = Object.assign(Readable.from([bytes]), {
      headers: {
        'content-type': wire.headers.get('content-type')!,
        'content-length': String(bytes.length),
      },
      file: undefined as
        { originalname: string; buffer: Buffer; size: number } | undefined,
      body: undefined as Record<string, string> | undefined,
    });
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
    const [Interceptor] = Reflect.getMetadata(
      INTERCEPTORS_METADATA,
      MaterialsController.prototype[method],
    ) as Type<NestInterceptor>[];
    if (!Interceptor) throw new Error('Missing multipart interceptor');
    await new Interceptor().intercept(context, { handle: () => of(null) });
    expect(request.file?.originalname).toBe(name);
    expect(request.file?.buffer).toEqual(Buffer.from(text));
    expect(request.file?.size).toBe(Buffer.byteLength(text));
    expect(request.body).toEqual({
      title: 'Funciones',
      activityId: 'a1becbf1-e9ed-442f-9127-176c276962fb',
    });
  },
);

test.each(['field', 'file'] as const)(
  'rejects an extra multipart %s through the real interceptor',
  async (extra) => {
    const data = new FormData();
    data.set('file', new Blob(['Texto']), 'guía.txt');
    data.set('title', 'Funciones');
    data.set('activityId', 'a1becbf1-e9ed-442f-9127-176c276962fb');
    if (extra === 'field') data.set('unexpected', 'value');
    else data.append('file', new Blob(['Otro texto']), 'otro.txt');
    const wire = new Request('http://example.invalid/', {
      method: 'POST',
      body: data,
    });
    const bytes = Buffer.from(await wire.arrayBuffer());
    const request = Object.assign(Readable.from([bytes]), {
      headers: {
        'content-type': wire.headers.get('content-type')!,
        'content-length': String(bytes.length),
      },
    });
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
    const [Interceptor] = Reflect.getMetadata(
      INTERCEPTORS_METADATA,
      MaterialsController.prototype.upload,
    ) as Type<NestInterceptor>[];
    if (!Interceptor) throw new Error('Missing multipart interceptor');
    await expect(
      new Interceptor().intercept(context, { handle: () => of(null) }),
    ).rejects.toMatchObject({ status: 400 });
  },
);
