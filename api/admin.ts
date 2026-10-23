import { context, handleAdmin } from '../server/handlers.js';

export function DELETE(req: Request) {
  return handleAdmin(req, context(req));
}
