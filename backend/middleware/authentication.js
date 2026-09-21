const { UnauthorizedError } = require("../helper/customErrors");
const { jwtVerify } = require("../helper/jwt");
const { User } = require("../models");

//? Identifies the caller if a token is present, and leaves req.loggedUser
//? undefined if it is not. Public routes rely on that: /api/articles serves
//? guests and signed-in users from the same handler.
const verifyToken = async (req, res, next) => {
  try {
    const { headers } = req;
    if (!headers.authorization) return next();

    const token = headers.authorization.split(" ")[1];
    //? Was a SyntaxError, which the error handler turned into a 500. A
    //? header the server cannot parse is the caller's problem, not a fault.
    if (!token) throw new UnauthorizedError("Invalid or expired token");

    const userVerified = await jwtVerify(token);
    if (!userVerified) throw new UnauthorizedError("Invalid or expired token");

    req.loggedUser = await User.findOne({
      attributes: { exclude: ["email"] },
      where: { email: userVerified.email },
    });

    //? The `return` was missing, so a token for a since-deleted user called
    //? next() twice: once with the error and once without. Express then ran
    //? the route handler as well as the error handler.
    if (!req.loggedUser) {
      return next(new UnauthorizedError("Invalid or expired token"));
    }

    headers.email = userVerified.email;
    req.loggedUser.dataValues.token = token;

    next();
  } catch (error) {
    next(error);
  }
};

//? Attach after verifyToken on any router where every route needs a signed-in
//? caller. Put on the router rather than on each route, so a route added later
//? cannot quietly ship without an auth check.
const requireAuth = (req, res, next) => {
  if (!req.loggedUser) return next(new UnauthorizedError());

  next();
};

//? Default export stays the function so the existing route files keep
//? working unchanged; requireAuth rides along as a property.
module.exports = verifyToken;
module.exports.verifyToken = verifyToken;
module.exports.requireAuth = requireAuth;
