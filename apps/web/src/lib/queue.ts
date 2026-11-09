import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  ApiError,
  ServiceUnavailableError,
  submitReport,
  type SubmitReportInput,
} from './api';

const DB_NAME = 'overflowgo';
const DB_VERSION = 1;
const STORE_NAME = 'report-queue';

export interface QueuedReport {
  id: string;
  createdAt: string;
  photo: Blob;
  lat: number;
  lng: number;
  note: string | null;
  deviceId: string;
}

interface OverflowDatabase extends DBSchema {
  'report-queue': {
    key: string;
    value: QueuedReport;
  };
}

let databasePromise: Promise<IDBPDatabase<OverflowDatabase>> | null = null;

function database(): Promise<IDBPDatabase<OverflowDatabase>> {
  if (!databasePromise) {
    databasePromise = openDB<OverflowDatabase>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      },
    });
  }
  return databasePromise;
}

export async function enqueueReport(report: QueuedReport): Promise<void> {
  const db = await database();
  await db.put(STORE_NAME, report);
}

export async function listQueuedReports(): Promise<QueuedReport[]> {
  const db = await database();
  return db.getAll(STORE_NAME);
}

export async function removeQueuedReport(id: string): Promise<void> {
  const db = await database();
  await db.delete(STORE_NAME, id);
}

export async function queuedReportCount(): Promise<number> {
  const db = await database();
  return db.count(STORE_NAME);
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ServiceUnavailableError) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof ApiError) return error.status >= 500;
  return false;
}

export interface QueueResult {
  sent: number;
  kept: number;
}

/**
 * Retry queued reports oldest first. Server idempotency keys make this safe
 * even if a request actually reached the API before the response was lost.
 */
export async function processQueue(): Promise<QueueResult> {
  const items = await listQueuedReports();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { sent: 0, kept: items.length };
  }

  let sent = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const input: SubmitReportInput = {
      photo: item.photo,
      lat: item.lat,
      lng: item.lng,
      note: item.note,
      deviceId: item.deviceId,
      clientReportId: item.id,
    };

    try {
      await submitReport(input);
      await removeQueuedReport(item.id);
      sent += 1;
    } catch (error) {
      if (isRetryable(error)) {
        return { sent, kept: items.length - index };
      }
      // A permanent 4xx will never succeed; drop it instead of retrying forever.
      await removeQueuedReport(item.id);
    }
  }

  return { sent, kept: 0 };
}
