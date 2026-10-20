import { context, handleLeaderboard } from '../server/handlers.js';

export function GET(req: Request) {
  return handleLeaderboard(req, context(req));
}
