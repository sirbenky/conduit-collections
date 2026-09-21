import axios from "axios";
import errorHandler from "../helpers/errorHandler";

async function getCollection({ headers, id }) {
  try {
    const { data } = await axios({ headers, url: `api/collections/${id}` });

    return data.collection;
  } catch (error) {
    errorHandler(error);
  }
}

export default getCollection;
