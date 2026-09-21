import axios from "axios";
import errorHandler from "../helpers/errorHandler";

//? offset counts rows on this endpoint, unlike api/articles where it counts
//? pages. The caller passes a page number and the row maths happens here, so
//? nothing above this line has to remember the difference.
async function getCollectionArticles({ headers, id, limit = 10, page = 0 }) {
  try {
    const { data } = await axios({
      headers,
      url: `api/collections/${id}/articles?limit=${limit}&offset=${page * limit}`,
    });

    return data;
  } catch (error) {
    errorHandler(error);
  }
}

export default getCollectionArticles;
