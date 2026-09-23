export const NETWORK_ERROR_MESSAGE =
  "Couldn't reach the server. Check your connection and try again.";

const fallbackFor = (status) => `Request failed (${status})`;

//? Always throws. The previous version only rethrew for 401, 403, 404, 422
//? and 500: a 409, a 400 or a dropped connection was logged and swallowed,
//? the service resolved undefined, and the caller carried on as if the
//? request had worked. A save that silently did nothing is worse than an
//? error message.
//?
//? The thrown value is a plain string because the screens render it straight
//? into JSX (`<li>{error}</li>`), and React will not render an Error object.
//? Where a caller needs the status code rather than the message - the save
//? picker treating 409 as "already saved" - it inspects error.response
//? itself before delegating here.
function errorHandler(error) {
  if (!error.response) {
    //? No response at all: offline, DNS, CORS, timeout, server down.
    throw NETWORK_ERROR_MESSAGE;
  }

  const { status, data } = error.response;

  throw data?.errors?.body?.[0] ?? fallbackFor(status);
}

export default errorHandler;
