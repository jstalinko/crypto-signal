/**
 * Logger Utility
 * Provides standardized timestamped logging: YYYY-MM-DD HH:mm:ss [LEVEL] message
 * Automatically masks sensitive tokens.
 */

function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Regex to detect and mask Telegram Bot tokens: e.g. 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
const TELEGRAM_TOKEN_REGEX = /\b\d{8,10}:[a-zA-Z0-9_-]{35}\b/g;

function sanitize(message: string): string {
  return message.replace(TELEGRAM_TOKEN_REGEX, '***REDACTED_TELEGRAM_TOKEN***');
}

export const logger = {
  info: (message: string, ...args: unknown[]) => {
    const formattedArgs = args.length > 0 ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') : '';
    console.log(`${getTimestamp()} [INFO] ${sanitize(message + formattedArgs)}`);
  },
  warn: (message: string, ...args: unknown[]) => {
    const formattedArgs = args.length > 0 ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') : '';
    console.warn(`${getTimestamp()} [WARN] ${sanitize(message + formattedArgs)}`);
  },
  error: (message: string, ...args: unknown[]) => {
    const formattedArgs = args.length > 0 ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') : '';
    console.error(`${getTimestamp()} [ERROR] ${sanitize(message + formattedArgs)}`);
  },
  debug: (message: string, ...args: unknown[]) => {
    if (process.env.DEBUG === 'true') {
      const formattedArgs = args.length > 0 ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') : '';
      console.log(`${getTimestamp()} [DEBUG] ${sanitize(message + formattedArgs)}`);
    }
  }
};
