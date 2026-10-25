import { ZodError } from 'zod';

export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const err = new Error('validation_error');
    err.status = 400;
    err.details = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw err;
  }
  return r.data;
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) return res.status(400).json({ error: 'validation_error' });
  const status = err.status && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: status >= 500 && !err.expose ? 'internal_error' : err.message,
    ...(err.details ? { details: err.details } : {}),
    ...(err.meta ? { meta: { code: err.meta.code, message: err.meta.message } } : {}),
  });
}
