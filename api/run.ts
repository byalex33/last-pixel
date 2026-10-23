import { context, handleOptions, handleRun } from '../server/handlers.js';

export function POST(req: Request) {
  return handleRun(req, context(req));
}

export function OPTIONS() {
  return handleOptions();
}
