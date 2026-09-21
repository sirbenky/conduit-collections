class MyError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

class ForbiddenError extends MyError {
  constructor(message) {
    super(`You are not the author of this ${message}`);
  }
}
class NotFoundError extends MyError {
  constructor(property, message = "") {
    super(`${property} not found ${message}`);
  }
}
class UnauthorizedError extends MyError {
  constructor(message = "You need to login first!") {
    super(message);
  }
}

//? 409, for a request that is valid but conflicts with what is already
//? stored - saving an article into a collection that already holds it.
//? Retrying will not help, so it is not a 422.
class ConflictError extends MyError {}

class ValidationError extends MyError {}

class FieldRequiredError extends ValidationError {
  constructor(field) {
    super(`${field} is required`);
  }
}

class AlreadyTakenError extends ValidationError {
  constructor(property, message = "") {
    super(`${property} already exists.. ${message}`);
  }
}

module.exports = {
  AlreadyTakenError,
  ConflictError,
  FieldRequiredError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
};
