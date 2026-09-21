import axios from "axios";
import errorHandler from "../helpers/errorHandler";

//? Create and rename share a shape, like setArticle.js does for articles:
//? an id means update, no id means create.
async function setCollection({ description, headers, id, name }) {
  try {
    const { data } = await axios({
      data: { collection: { name, description } },
      headers,
      method: id ? "PUT" : "POST",
      url: id ? `api/collections/${id}` : "api/collections",
    });

    return data.collection;
  } catch (error) {
    errorHandler(error);
  }
}

export default setCollection;
