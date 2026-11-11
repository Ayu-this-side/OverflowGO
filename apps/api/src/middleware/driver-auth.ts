import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../errors';
import { verifyDriverToken } from '../services/auth';

export interface DriverRequest extends Request {
  driverId: string;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

export function requireDriver(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = bearerToken(req);
  const driverId = token ? verifyDriverToken(token) : null;
  if (!driverId) {
    next(new ApiError(401, 'Driver login required', 'unauthorized'));
    return;
  }
  (req as DriverRequest).driverId = driverId;
  next();
}

export function currentDriverId(req: Request): string {
  const driverId = (req as DriverRequest).driverId;
  if (!driverId) {
    throw new ApiError(401, 'Driver login required', 'unauthorized');
  }
  return driverId;
}
