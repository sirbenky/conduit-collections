import axios from "axios";
import errorHandler from "../helpers/errorHandler";

//? Adding and removing are written as one toggle so the picker has a single
//? call to make, and so the "already in the state you asked for" cases are
//? handled in one place.
//?
//? A 409 on add means the article is already saved. A 404 on remove means it
//? is already gone. Either way the server is in the state the user asked
//? for, so both count as success. Without this, a double click or a second
//? browser tab would surface an error for something that actually worked.
async function toggleCollectionArticle({ headers, id, saved, slug }) {
  try {
    if (saved) {
      await axios({
        headers,
        method: "DELETE",
        url: `api/collections/${id}/articles/${encodeURIComponent(slug)}`,
      });

      return { saved: false };
    }

    await axios({
      data: { article: { slug } },
      headers,
      method: "POST",
      url: `api/collections/${id}/articles`,
    });

    return { saved: true };
  } catch (error) {
    const status = error.response?.status;

    if (!saved && status === 409) return { saved: true, alreadyDone: true };
    if (saved && status === 404) return { saved: false, alreadyDone: true };

    return errorHandler(error);
  }
}

export default toggleCollectionArticle;
