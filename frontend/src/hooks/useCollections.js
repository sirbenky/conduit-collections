import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import getCollections from "../services/getCollections";

//? Modelled on useArticles, with two things it does not have: an error state,
//? so a failed load can say so instead of showing an empty list, and a
//? reload() the screens call after a create, rename or delete.
function useCollections({ articleSlug } = {}) {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const { headers } = useAuth();

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    if (!headers) return;

    //? An in-flight response for an older request must not overwrite a newer
    //? one. The flag is flipped by the cleanup, so only the latest effect can
    //? still write to state.
    let current = true;

    setLoading(true);
    setError(null);

    getCollections({ headers, articleSlug })
      .then((data) => {
        if (current) setCollections(data);
      })
      .catch((message) => {
        if (current) setError(message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [headers, articleSlug, reloadToken]);

  return { collections, error, loading, reload, setCollections };
}

export default useCollections;
