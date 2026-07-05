export class AppError extends Error {
  constructor(message, status = 500, details = "") {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.details = details;
    this.isOperational = true;
  }
}

export function isAppError(error) {
  return error instanceof AppError || error?.isOperational === true;
}
