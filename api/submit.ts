import { context, handleSubmit } from '../server/handlers.js';

export function POST(req: Request) {
  return handleSubmit(req, context(req));
}
