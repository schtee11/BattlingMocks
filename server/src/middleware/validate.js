import { ZodError } from 'zod';

// Generic validation middleware. Takes a map of { body?, query?, params? }
// Zod schemas and validates the corresponding req fields. Returns 400 with
// a structured error on failure.
export function validate(schemas) {
  return (req, res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.query = schemas.query.parse(req.query);
      if (schemas.params) req.params = schemas.params.parse(req.params);
      next();
    } catch (e) {
      if (e instanceof ZodError) {
        const messages = e.errors.map((err) => {
          const path = err.path.join('.');
          return path ? `${path}: ${err.message}` : err.message;
        });
        return res.status(400).json({ error: messages[0], details: messages });
      }
      next(e);
    }
  };
}
