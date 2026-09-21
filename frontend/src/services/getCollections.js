import axios from "axios";
import errorHandler from "../helpers/errorHandler";

//? Pass articleSlug to have the server mark which collections already hold
//? that article. The save picker needs it, and asking for it here keeps the
//? picker to one request instead of one per collection.
async function getCollections({ headers, articleSlug }) {
  try {
    const { data } = await axios({
      headers,
      url: articleSlug
        ? `api/collections?article=${encodeURIComponent(articleSlug)}`
        : "api/collections",
    });

    return data.collections;
  } catch (error) {
    errorHandler(error);
  }
}

export default getCollections;
