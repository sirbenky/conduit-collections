import axios from "axios";
import errorHandler from "../helpers/errorHandler";

async function deleteCollection({ headers, id }) {
  try {
    await axios({ headers, method: "DELETE", url: `api/collections/${id}` });
  } catch (error) {
    errorHandler(error);
  }
}

export default deleteCollection;
