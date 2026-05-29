const BASE = "https://discord.com/api/v10";

export class DiscordError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DiscordError";
  }
}

export interface DiscordMessage {
  id: string;
  content: string;
  timestamp: string;
  author: { id: string; username: string };
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  };
}

async function handleResponse<T>(res: Response, ctx: string): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;

  switch (res.status) {
    case 401:
      throw new DiscordError(`${ctx}: 401 Unauthorized — bot token invalid or missing`, 401);
    case 403:
      throw new DiscordError(
        `${ctx}: 403 Forbidden — bot is missing required permissions on this channel`,
        403,
      );
    case 404:
      throw new DiscordError(`${ctx}: 404 Not Found — bad channel or message ID`, 404);
    case 429: {
      const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
      const wait = body.retry_after ?? 1;
      throw new DiscordError(`${ctx}: 429 Rate limited — retry after ${wait}s`, 429);
    }
    default:
      throw new DiscordError(`${ctx}: HTTP ${res.status}`, res.status);
  }
}

export async function fetchMessage(
  channelId: string,
  messageId: string,
  token: string,
): Promise<DiscordMessage> {
  const res = await fetch(`${BASE}/channels/${channelId}/messages/${messageId}`, {
    headers: authHeaders(token),
  });
  return handleResponse<DiscordMessage>(res, `fetchMessage(${channelId}/${messageId})`);
}

export async function fetchRecent(
  channelId: string,
  limit: number,
  token: string,
): Promise<DiscordMessage[]> {
  const res = await fetch(
    `${BASE}/channels/${channelId}/messages?limit=${Math.min(limit, 100)}`,
    { headers: authHeaders(token) },
  );
  return handleResponse<DiscordMessage[]>(res, `fetchRecent(${channelId}, limit=${limit})`);
}

export async function postDebug(
  channelId: string,
  content: string,
  token: string,
): Promise<void> {
  const res = await fetch(`${BASE}/channels/${channelId}/messages`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ content }),
  });
  await handleResponse<unknown>(res, `postDebug(${channelId})`);
}

export function parseChannelId(uri: string): string {
  const match = uri.match(/^discord:\/\/[^/]+\/(\d+)$/);
  if (!match) throw new Error(`Invalid discord URI: ${uri}`);
  return match[1];
}

export async function resolveMessage(
  channelId: string,
  token: string,
  buffer: number,
  msgId?: string,
): Promise<DiscordMessage | null> {
  if (msgId) {
    return fetchMessage(channelId, msgId, token);
  }
  // Discord returns messages newest-first; buffer=0 → index 0, buffer=1 → index 1.
  const messages = await fetchRecent(channelId, buffer + 1, token);
  if (messages.length <= buffer) return null;
  return messages[buffer];
}
