import errorHandler, { NETWORK_ERROR_MESSAGE } from "./errorHandler";

const axiosError = (status, message) => ({
  response: {
    status,
    data: message ? { errors: { body: [message] } } : undefined,
  },
});

describe("Catching errors", () => {
  const errors = [401, 403, 404, 422, 500];

  test.each(errors)("Status %p should throw an error", (statusCode) => {
    const resError = {
      response: new Response(null, { status: statusCode }),
    };

    expect(() => errorHandler(resError)).toThrow();
  });

  test.each([400, 409, 429, 502])(
    "Status %p should throw too, not resolve quietly",
    (statusCode) => {
      //? These used to fall through to console.dir. The service then
      //? resolved undefined and the screen behaved as if the call worked.
      expect(() => errorHandler(axiosError(statusCode, "Nope"))).toThrow();
    },
  );

  test("throws the message the server sent, so a form can show it", () => {
    expect(() =>
      errorHandler(axiosError(409, "A collection with that name already exists.")),
    ).toThrow("A collection with that name already exists.");
  });

  test("falls back to the status when the body is not the usual shape", () => {
    expect(() => errorHandler(axiosError(500))).toThrow("Request failed (500)");
  });

  test("throws for a request that never got a response", () => {
    //? A network failure used to be logged and swallowed entirely.
    expect(() => errorHandler(new Error("Network Error"))).toThrow(
      NETWORK_ERROR_MESSAGE,
    );
  });

  test("throws a string, because screens render it straight into JSX", () => {
    let thrown;
    try {
      errorHandler(axiosError(422, "A collection name is required"));
    } catch (error) {
      thrown = error;
    }

    expect(typeof thrown).toBe("string");
  });
});
