import { setupServer } from "msw/node";

//? One server for the whole frontend suite. Handlers are added per test with
//? server.use(...), and reset between tests, so no test inherits another
//? test's stubs and the files can run in any order.
export const server = setupServer();
