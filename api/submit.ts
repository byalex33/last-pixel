import { context, handleOptions, handleSubmit } from '../server/handlers.js';

export function POST(req: Request) {
  return handleSubmit(req, context(req));
}

export function OPTIONS() {
  return handleOptions();
}
