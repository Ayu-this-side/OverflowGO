export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class InvalidImageError extends ApiError {
  constructor(message = 'The uploaded file is not a valid image') {
    super(400, message, 'invalid_image');
    this.name = 'InvalidImageError';
  }
}

export class AiServiceUnavailableError extends ApiError {
  constructor(message = 'The image check is temporarily unavailable. Please try again.') {
    super(503, message, 'ai_unavailable');
    this.name = 'AiServiceUnavailableError';
  }
}
