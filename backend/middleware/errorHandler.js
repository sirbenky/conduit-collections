const {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} = require("../helper/customErrors");

//? jsonwebtoken throws these for a signature that does not verify, an expired
//? token or one used too early. All three mean "this token is no good", which
//? is a 401. Before, they fell through to the 500 branch, so a malformed
//? Authorization header looked like a server fault.
const JWT_ERRORS = ["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"];

const statusFor = (error) => {
  if (error instanceof UnauthorizedError) return 401;
  if (JWT_ERRORS.includes(error.name)) return 401;
  if (error instanceof ForbiddenError) return 403;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  if (error.name === "SequelizeUniqueConstraintError") return 409;
  if (error instanceof ValidationError) return 422;
  if (error.name === "SequelizeValidationError") return 422;
  return 500;
};

//? A 401 for a bad token says nothing useful about the token, and a 409 on a
//? duplicate save says nothing about the row. Anything else would be handing
//? back detail the client did not need.
const messageFor = (error, status) => {
  if (status === 401 && JWT_ERRORS.includes(error.name)) {
    return "Invalid or expired token";
  }
  if (error.name === "SequelizeUniqueConstraintError") {
    return "That already exists";
  }
  if (error.name === "SequelizeValidationError") {
    return error.errors?.[0]?.message ?? "Invalid input";
  }
  if (status === 500) return "Something went wrong";
  return error.message;
};

const errorHandler = (error, req, res, next) => {
  const status = statusFor(error);

  //? Log the name, message and stack rather than the error object. A
  //? Sequelize error carries the failing SQL and its bound parameters in
  //? enumerable fields, which is how password hashes and tokens end up in
  //? logs. 4xx responses are the API working as designed, so they get one
  //? quiet line; only 5xx gets a stack.
  if (status >= 500) {
    console.error(
      `[${req.method} ${req.originalUrl}] ${error.name}: ${error.message}`,
    );
    console.error(error.stack);
  } else if (process.env.NODE_ENV !== "test") {
    console.warn(`[${req.method} ${req.originalUrl}] ${status} ${error.name}`);
  }

  res.status(status).json({ errors: { body: [messageFor(error, status)] } });
};

module.exports = errorHandler;
