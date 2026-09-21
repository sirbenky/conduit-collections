const collections = require("../services/collections");

//? Thin on purpose: read the request, call the service, pick a status code.
//? The queries and the rules live in services/collections.js.
//?
//? Every handler takes the owner from req.loggedUser, which verifyToken set
//? from a verified token. No handler reads an owner id from params, query or
//? body, so there is nothing for a client to substitute.

//? All Collections
const allCollections = async (req, res, next) => {
  try {
    const list = await collections.listCollections({
      userId: req.loggedUser.id,
      articleSlug: req.query.article,
    });

    res.json({ collections: list });
  } catch (error) {
    next(error);
  }
};

//* Create Collection
const createCollection = async (req, res, next) => {
  try {
    const collection = await collections.createCollection({
      userId: req.loggedUser.id,
      payload: req.body?.collection ?? {},
    });

    res.status(201).json({ collection });
  } catch (error) {
    next(error);
  }
};

// Single Collection
const singleCollection = async (req, res, next) => {
  try {
    const collection = await collections.findOwnedCollection({
      userId: req.loggedUser.id,
      id: req.params.id,
    });

    res.json({ collection });
  } catch (error) {
    next(error);
  }
};

//* Update Collection
const updateCollection = async (req, res, next) => {
  try {
    const collection = await collections.updateCollection({
      userId: req.loggedUser.id,
      id: req.params.id,
      payload: req.body?.collection ?? {},
    });

    res.json({ collection });
  } catch (error) {
    next(error);
  }
};

//* Delete Collection
const deleteCollection = async (req, res, next) => {
  try {
    await collections.deleteCollection({
      userId: req.loggedUser.id,
      id: req.params.id,
    });

    //? 204: the collection is gone and the articles are untouched, so there
    //? is nothing worth sending back.
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

//? Articles in a Collection
const collectionArticles = async (req, res, next) => {
  try {
    const { articles, articlesCount } = await collections.listArticles({
      userId: req.loggedUser.id,
      id: req.params.id,
      query: req.query,
    });

    //? Same envelope as /api/articles so the existing list components can
    //? render it without a translation layer.
    res.json({ articles, articlesCount });
  } catch (error) {
    next(error);
  }
};

//* Add Article to Collection
const addArticle = async (req, res, next) => {
  try {
    const collection = await collections.addArticle({
      userId: req.loggedUser.id,
      id: req.params.id,
      slug: req.body?.article?.slug,
    });

    res.status(201).json({ collection });
  } catch (error) {
    next(error);
  }
};

//* Remove Article from Collection
const removeArticle = async (req, res, next) => {
  try {
    await collections.removeArticle({
      userId: req.loggedUser.id,
      id: req.params.id,
      slug: req.params.slug,
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addArticle,
  allCollections,
  collectionArticles,
  createCollection,
  deleteCollection,
  removeArticle,
  singleCollection,
  updateCollection,
};
