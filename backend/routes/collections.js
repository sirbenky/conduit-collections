const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authentication");
const { requireAuth } = require("../middleware/authentication");
const {
  addArticle,
  allCollections,
  collectionArticles,
  createCollection,
  deleteCollection,
  removeArticle,
  singleCollection,
  updateCollection,
} = require("../controllers/collections");

//? Auth is applied to the router, not to each route. Collections are private
//? without exception, so a route added below inherits the check instead of
//? relying on whoever adds it to remember. A test walks the router's own
//? stack and asserts every route 401s without a token, so this cannot rot.
router.use(verifyToken, requireAuth);

//? All Collections - add ?article=<slug> for the save picker's hasArticle
router.get("/", allCollections);
//* Create Collection
router.post("/", createCollection);
// Single Collection
router.get("/:id", singleCollection);
//* Update Collection
router.put("/:id", updateCollection);
//* Delete Collection
router.delete("/:id", deleteCollection);

//? Articles in a Collection - limit and offset count rows here
router.get("/:id/articles", collectionArticles);
//* Add Article to Collection
router.post("/:id/articles", addArticle);
//* Remove Article from Collection
router.delete("/:id/articles/:slug", removeArticle);

module.exports = router;
