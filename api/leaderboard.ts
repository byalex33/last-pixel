import { context, handleOptions, handleLeaderboard } from '../server/handlers.js';

export function GET(req: Request) {
  return handleLeaderboard(req, context(req));
}

export function OPTIONS() {
  return handleOptions();
}
