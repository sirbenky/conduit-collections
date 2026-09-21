require("dotenv").config();
const env = process.env.NODE_ENV || "development";
const PORT = process.env.PORT || 3001;
const app = require("./app");
const { sequelize } = require("./models");

//? Schema is owned by the migrations, so boot only checks the connection.
//? The previous `sequelize.sync({ alter: true })` here silently rewrote the
//? schema on every start, which hid the gaps in the committed migrations.
(async () => {
  try {
    await sequelize.authenticate();
    console.log(`Connection with ${env} database has been established.`);
  } catch (error) {
    console.error("Unable to connect to the database:", error.message);
    process.exit(1);
  }
})();

app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);
