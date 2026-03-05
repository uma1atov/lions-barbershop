/**
 * errors.js — Standardized error classes + Express error handler
 */

class AppError extends Error {
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

class NotFoundError extends AppError {
  constructor(message = "Не найдено") {
    super(message, 404, "NOT_FOUND");
  }
}

class ForbiddenError extends AppError {
  constructor(message = "Недостаточно прав") {
    super(message, 403, "FORBIDDEN");
  }
}

class UnauthorizedError extends AppError {
  constructor(message = "Не авторизован") {
    super(message, 401, "UNAUTHORIZED");
  }
}

class ValidationError extends AppError {
  constructor(message = "Ошибка валидации") {
    super(message, 400, "VALIDATION_ERROR");
  }
}

class ConflictError extends AppError {
  constructor(message = "Конфликт данных") {
    super(message, 409, "CONFLICT");
  }
}

class TooManyRequestsError extends AppError {
  constructor(message = "Слишком много попыток. Попробуйте позже.") {
    super(message, 429, "TOO_MANY_REQUESTS");
  }
}

/**
 * Express error handler middleware (must be last app.use())
 */
function errorHandler(err, req, res, _next) {
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
  }

  // Unexpected errors
  console.error("Unexpected error:", err);
  res.status(500).json({
    error: "Внутренняя ошибка сервера",
    code: "INTERNAL_ERROR",
  });
}

module.exports = {
  AppError,
  NotFoundError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  ConflictError,
  TooManyRequestsError,
  errorHandler,
};
