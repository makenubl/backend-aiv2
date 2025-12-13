import * as fs from 'fs';
import * as path from 'path';

export interface ActivityLogEntry {
  id: string;
  userEmail?: string;
  userRole?: string;
  action: string;
  folder?: string;
  document?: string;
  version?: number;
  meta?: Record<string, any>;
  timestamp: string;
}

function getLogsPath(baseFolder: string) {
  const logsDir = path.join(baseFolder, '.logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  return path.join(logsDir, 'activity.log.json');
}

export function appendActivity(baseFolder: string, entry: ActivityLogEntry) {
  const file = getLogsPath(baseFolder);
  const now = new Date().toISOString();
  const payload = { ...entry, timestamp: now } as ActivityLogEntry;
  let list: ActivityLogEntry[] = [];
  if (fs.existsSync(file)) {
    try { list = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}
  }
  list.push(payload);
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
  return payload;
}

export function readActivities(baseFolder: string): ActivityLogEntry[] {
  const file = getLogsPath(baseFolder);
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return []; }
}
