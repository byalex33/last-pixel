import { context, handleRun } from '../server/handlers.js';

export function POST(req: Request) {
  return handleRun(req, context(req));
}
