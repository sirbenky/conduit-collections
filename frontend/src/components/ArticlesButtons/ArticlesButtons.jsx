import { useParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import ArticleAuthorButtons from "../ArticleAuthorButtons";
import FavButton from "../FavButton";
import FollowButton from "../FollowButton";
import SaveToCollection from "../SaveToCollection";

function ArticlesButtons({ article, setArticle }) {
  const { author: { username } = {}, author } = article || {};
  const { loggedUser } = useAuth();
  const { slug } = useParams();

  const followHandler = (author) => {
    setArticle((prev) => ({ ...prev, author }));
  };

  const handleFav = ({ favorited, favoritesCount }) => {
    setArticle((prev) => ({ ...prev, favorited, favoritesCount }));
  };

  //? Save sits alongside the existing buttons in both branches: an author
  //? saving their own article into a reading list is a reasonable thing to
  //? want, and leaving it out of the author branch would make Save vanish on
  //? your own articles for no reason a reader could explain.
  return loggedUser.username === username ? (
    <>
      <ArticleAuthorButtons {...article} slug={slug} />
      <SaveToCollection slug={slug} />
    </>
  ) : (
    <>
      <FollowButton {...author} handler={followHandler} />
      <FavButton {...article} handler={handleFav} text />{" "}
      <SaveToCollection slug={slug} />
    </>
  );
}

export default ArticlesButtons;
